import { NextResponse } from "next/server";

const MAX_AUDIO_BYTES = 10 * 1024 * 1024;
const DEFAULT_TRANSCRIPTION_MODEL = "gemini-2.5-flash";
const MAX_TRANSCRIPTION_ATTEMPTS = 3;
const RETRYABLE_STATUS_CODES = new Set([429, 500, 503]);

function sleep(delayMs: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

async function requestGeminiTranscription({
  apiKey,
  model,
  audioBytes,
  audioMimeType,
  promptContext
}: {
  apiKey: string;
  model: string;
  audioBytes: string;
  audioMimeType: string;
  promptContext: string;
}) {
  let lastStatus = 500;
  let lastErrorText = "Unknown Gemini transcription error.";

  for (let attempt = 1; attempt <= MAX_TRANSCRIPTION_ATTEMPTS; attempt += 1) {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey
        },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [
                {
                  text: [
                    "Transcribe the spoken audio as faithfully as possible.",
                    promptContext
                      ? `The speaker is responding to this caregiver intake prompt: ${promptContext}.`
                      : "",
                    "Return JSON with one key: transcript.",
                    "Do not answer the prompt, do not summarize, and do not add speaker labels.",
                    "If the audio is blank or unintelligible, return an empty transcript."
                  ]
                    .filter(Boolean)
                    .join(" ")
                },
                {
                  inline_data: {
                    mime_type: audioMimeType,
                    data: audioBytes
                  }
                }
              ]
            }
          ],
          generationConfig: {
            responseMimeType: "application/json",
            responseJsonSchema: {
              type: "object",
              properties: {
                transcript: {
                  type: "string"
                }
              },
              required: ["transcript"]
            }
          }
        })
      }
    );

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

export async function POST(request: Request) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "GEMINI_API_KEY is required for audio transcription." },
      { status: 500 }
    );
  }

  const formData = await request.formData();
  const audio = formData.get("audio");
  const question = String(formData.get("question") ?? "");
  const sectionTitle = String(formData.get("sectionTitle") ?? "");
  const promptLabel = String(formData.get("promptLabel") ?? "");

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

  const model = process.env.GEMINI_TRANSCRIPTION_MODEL ?? DEFAULT_TRANSCRIPTION_MODEL;
  const audioBytes = Buffer.from(await audio.arrayBuffer()).toString("base64");
  const promptContext = getPromptContext({ question, sectionTitle, promptLabel });

  try {
    const response = await requestGeminiTranscription({
      apiKey,
      model,
      audioBytes,
      audioMimeType: audio.type || "audio/wav",
      promptContext
    });

    const data = (await response.json()) as {
      candidates?: Array<{
        content?: {
          parts?: Array<{
            text?: string;
          }>;
        };
      }>;
    };

    const content = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!content) {
      return NextResponse.json({ transcript: "" });
    }

    try {
      const parsed = JSON.parse(content) as { transcript?: string };

      return NextResponse.json({
        transcript: typeof parsed.transcript === "string" ? parsed.transcript.trim() : ""
      });
    } catch {
      return NextResponse.json({
        transcript: content.trim()
      });
    }
  } catch (error) {
    const status = error instanceof Error && "status" in error ? Number(error.status) : 500;
    const rawMessage = error instanceof Error ? error.message : "Unknown transcription failure.";

    if (status === 429 || status === 500 || status === 503) {
      console.error("Transient Gemini transcription error after retrying:", rawMessage);

      return NextResponse.json(
        {
          error:
            "Gemini is temporarily overloaded. We retried automatically but could not finish the transcription. Please try again in a moment."
        },
        { status: 503 }
      );
    }

    console.error("Gemini transcription failed:", rawMessage);

    return NextResponse.json({
      error: "Unable to transcribe audio right now. Please try again."
    }, { status });
  }
}
