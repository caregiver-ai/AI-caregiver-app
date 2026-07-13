import { UiLanguage } from "@/lib/types";

const DEFAULT_TEXT_MODEL = "gpt-4.1";
const MAX_TRANSLATION_ATTEMPTS = 3;
const RETRYABLE_STATUS_CODES = new Set([429, 500, 503]);

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

export type TranslatableLanguage = Exclude<UiLanguage, "english">;

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

  for (let attempt = 1; attempt <= MAX_TRANSLATION_ATTEMPTS; attempt += 1) {
    const response = await requestFn();

    if (response.ok) {
      return response;
    }

    lastStatus = response.status;
    lastErrorText = await response.text();

    if (!RETRYABLE_STATUS_CODES.has(response.status) || attempt === MAX_TRANSLATION_ATTEMPTS) {
      break;
    }

    await sleep(800 * attempt);
  }

  const error = new Error(lastErrorText) as Error & { status?: number };
  error.status = lastStatus;
  throw error;
}

export function getCaregiverPromptContext({
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

export function normalizeTranslatableLanguage(value: string): TranslatableLanguage | null {
  const normalized = value.trim().toLowerCase();
  if (normalized === "spanish" || normalized === "mandarin") {
    return normalized;
  }

  return null;
}

export async function translateCaregiverTranscriptToEnglish({
  apiKey,
  model,
  transcript,
  promptContext,
  sourceLanguage
}: {
  apiKey: string;
  model?: string;
  transcript: string;
  promptContext: string;
  sourceLanguage: TranslatableLanguage;
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
          model: model ?? process.env.OPENAI_MODEL ?? DEFAULT_TEXT_MODEL,
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
                `Spoken language: ${sourceLanguage}.`,
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
