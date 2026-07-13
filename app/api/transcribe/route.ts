import { NextResponse } from "next/server";
import {
  TranslatableLanguage,
  getCaregiverPromptContext,
  translateCaregiverTranscriptToEnglish
} from "@/lib/caregiver-translation";

const MAX_AUDIO_BYTES = 10 * 1024 * 1024;
const DEFAULT_TRANSCRIPTION_MODEL = "gpt-4o-transcribe";
const MAX_TRANSCRIPTION_ATTEMPTS = 3;
const RETRYABLE_STATUS_CODES = new Set([429, 500, 503]);
const SUPPORTED_SPOKEN_LANGUAGES = new Set(["english", "spanish", "mandarin"]);

type SpokenLanguage = "english" | "spanish" | "mandarin";

function sleep(delayMs: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
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
  const promptContext = getCaregiverPromptContext({ question, sectionTitle, promptLabel });

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
      return NextResponse.json({ transcript, content: transcript });
    }

    const translatedTranscript = await translateCaregiverTranscriptToEnglish({
      apiKey,
      transcript,
      promptContext,
      sourceLanguage: spokenLanguage as TranslatableLanguage
    });

    return NextResponse.json({
      transcript: translatedTranscript,
      content: translatedTranscript,
      sourceTranscript: transcript,
      sourceContent: transcript,
      sourceLanguage: spokenLanguage,
      translatedAt: new Date().toISOString()
    });
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
