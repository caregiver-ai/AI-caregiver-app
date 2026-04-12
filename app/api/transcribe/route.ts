import { NextResponse } from "next/server";

const MAX_AUDIO_BYTES = 10 * 1024 * 1024;
const DEFAULT_TRANSCRIPTION_MODEL = "gpt-4o-mini-transcribe";
const DEFAULT_TEXT_MODEL = "gpt-4.1";
const MAX_TRANSCRIPTION_ATTEMPTS = 3;
const RETRYABLE_STATUS_CODES = new Set([429, 500, 503]);
const SUPPORTED_SPOKEN_LANGUAGES = new Set(["english", "spanish", "mandarin"]);

const translationSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    transcript: {
      type: "string"
    }
  },
  required: ["transcript"]
} as const;

type SpokenLanguage = "english" | "spanish" | "mandarin";

function sleep(delayMs: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

function extractChatCompletionText(
  content?: string | Array<{ type?: string; text?: string }>
) {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .map((part) => (part?.type === "text" && typeof part.text === "string" ? part.text : ""))
    .join("")
    .trim();
}

async function requestWithRetry(
  requestFn: () => Promise<Response>,
  unknownErrorMessage: string
) {
  let lastStatus = 500;
  let lastErrorText = unknownErrorMessage;

  for (let attempt = 1; attempt <= MAX_TRANSCRIPTION_ATTEMPTS; attempt += 1) {
    const response = await requestFn();

    if (response.ok) {
      return response;
    }

    lastStatus = response.status;
    lastErrorText = await response.text();

    if (!RETRYABLE_STATUS_CODES.has(response.status) || attempt === MAX_TRANSCRIPTION_ATTEMPTS) {
      break;
    }

    await sleep(800 * attempt);
  }

  const error = new Error(lastErrorText) as Error & { status?: number };
  error.status = lastStatus;
  throw error;
}

function normalizeSpokenLanguage(value: string): SpokenLanguage {
  const normalized = value.trim().toLowerCase();
  if (SUPPORTED_SPOKEN_LANGUAGES.has(normalized)) {
    return normalized as SpokenLanguage;
  }

  return "english";
}

function getPromptContext({
  question,
  sectionTitle,
  promptLabel
}: {
  question: string;
  sectionTitle: string;
  promptLabel: string;
}) {
  return [sectionTitle, promptLabel, question].filter(Boolean).join(" / ");
}

function getSpokenLanguageCode(spokenLanguage: SpokenLanguage) {
  if (spokenLanguage === "spanish") {
    return "es";
  }

  if (spokenLanguage === "mandarin") {
    return "zh";
  }

  return "en";
}

function buildTranscriptionPrompt({
  promptContext,
  spokenLanguage
}: {
  promptContext: string;
  spokenLanguage: SpokenLanguage;
}) {
  return [
    "Transcribe the spoken audio as faithfully as possible.",
    spokenLanguage === "english"
      ? "Return the transcript in English."
      : spokenLanguage === "spanish"
        ? "The expected spoken language is Spanish. Return a faithful transcript in Spanish without translating yet."
        : "The expected spoken language is Mandarin Chinese. Return a faithful transcript in Mandarin Chinese without translating yet.",
    promptContext
      ? `The speaker is responding to this caregiver intake prompt: ${promptContext}.`
      : "",
    "Do not answer the prompt, do not summarize, and do not add speaker labels.",
    "If the audio is blank or unintelligible, return an empty transcript."
  ]
    .filter(Boolean)
    .join(" ");
}

async function requestOpenAITranscription({
  apiKey,
  model,
  audio,
  promptContext,
  spokenLanguage
}: {
  apiKey: string;
  model: string;
  audio: File;
  promptContext: string;
  spokenLanguage: SpokenLanguage;
}) {
  const openAiFormData = new FormData();
  openAiFormData.append("file", audio, audio.name || "recording.webm");
  openAiFormData.append("model", model);
  openAiFormData.append("language", getSpokenLanguageCode(spokenLanguage));
  openAiFormData.append("prompt", buildTranscriptionPrompt({ promptContext, spokenLanguage }));
  openAiFormData.append("response_format", "json");

  return requestWithRetry(
    () =>
      fetch("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`
        },
        body: openAiFormData
      }),
    "Unknown OpenAI transcription error."
  );
}

async function translateTranscriptToEnglish({
  apiKey,
  model,
  transcript,
  promptContext,
  spokenLanguage
}: {
  apiKey: string;
  model: string;
  transcript: string;
  promptContext: string;
  spokenLanguage: Exclude<SpokenLanguage, "english">;
}) {
  const response = await requestWithRetry(
    () =>
      fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model,
          store: false,
          temperature: 0,
          messages: [
            {
              role: "system",
              content:
                "You translate caregiver intake transcripts into natural English. Preserve meaning and important detail. Do not summarize, answer the prompt, or add commentary."
            },
            {
              role: "user",
              content: [
                `Spoken language: ${spokenLanguage}.`,
                promptContext ? `Caregiver intake prompt: ${promptContext}.` : "",
                "Return JSON with one key: transcript.",
                "The transcript must be in natural English only.",
                `Transcript:\n${transcript}`
              ]
                .filter(Boolean)
                .join("\n\n")
            }
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "translated_transcript",
              strict: true,
              schema: translationSchema
            }
          }
        })
      }),
    "Unknown OpenAI translation error."
  );

  const data = (await response.json()) as {
    choices?: Array<{
      message?: {
        content?: string | Array<{
          type?: string;
          text?: string;
        }>;
      };
    }>;
  };

  const content = extractChatCompletionText(data.choices?.[0]?.message?.content);
  if (!content) {
    return "";
  }

  try {
    const parsed = JSON.parse(content) as { transcript?: string };
    return typeof parsed.transcript === "string" ? parsed.transcript.trim() : "";
  } catch {
    return content.trim();
  }
}

export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY is required for audio transcription." },
      { status: 500 }
    );
  }

  const formData = await request.formData();
  const audio = formData.get("audio");
  const question = String(formData.get("question") ?? "");
  const sectionTitle = String(formData.get("sectionTitle") ?? "");
  const promptLabel = String(formData.get("promptLabel") ?? "");
  const spokenLanguage = normalizeSpokenLanguage(String(formData.get("spokenLanguage") ?? ""));

  if (!(audio instanceof File)) {
    return NextResponse.json({ error: "Audio file is required." }, { status: 400 });
  }

  if (audio.size === 0) {
    return NextResponse.json({ error: "Audio file is empty." }, { status: 400 });
  }

  if (audio.size > MAX_AUDIO_BYTES) {
    return NextResponse.json(
      { error: "Audio is too large. Keep recordings under 10 MB." },
      { status: 400 }
    );
  }

  const transcriptionModel =
    process.env.OPENAI_TRANSCRIPTION_MODEL ?? DEFAULT_TRANSCRIPTION_MODEL;
  const textModel = process.env.OPENAI_MODEL ?? DEFAULT_TEXT_MODEL;
  const promptContext = getPromptContext({ question, sectionTitle, promptLabel });

  try {
    const transcriptionResponse = await requestOpenAITranscription({
      apiKey,
      model: transcriptionModel,
      audio,
      promptContext,
      spokenLanguage
    });

    const transcriptionData = (await transcriptionResponse.json()) as { text?: string };
    const transcript =
      typeof transcriptionData.text === "string" ? transcriptionData.text.trim() : "";

    if (!transcript) {
      return NextResponse.json({ transcript: "" });
    }

    if (spokenLanguage === "english") {
      return NextResponse.json({ transcript });
    }

    const translatedTranscript = await translateTranscriptToEnglish({
      apiKey,
      model: textModel,
      transcript,
      promptContext,
      spokenLanguage
    });

    return NextResponse.json({ transcript: translatedTranscript });
  } catch (error) {
    const status = error instanceof Error && "status" in error ? Number(error.status) : 500;
    const rawMessage = error instanceof Error ? error.message : "Unknown transcription failure.";

    if (status === 429 || status === 500 || status === 503) {
      console.error("Transient OpenAI transcription error after retrying:", rawMessage);

      return NextResponse.json(
        {
          error:
            "OpenAI is temporarily overloaded. We retried automatically but could not finish the transcription. Please try again in a moment."
        },
        { status: 503 }
      );
    }

    console.error("OpenAI transcription failed:", rawMessage);

    return NextResponse.json(
      {
        error: "Unable to transcribe audio right now. Please try again."
      },
      { status }
    );
  }
}
