import { NextResponse } from "next/server";
import {
  getCaregiverPromptContext,
  normalizeTranslatableLanguage,
  translateCaregiverTranscriptToEnglish
} from "@/lib/caregiver-translation";

const MAX_TRANSLATION_CHARS = 12_000;

export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY is required for translation." },
      { status: 500 }
    );
  }

  const body = (await request.json().catch(() => null)) as {
    text?: string;
    sourceLanguage?: string;
    question?: string;
    sectionTitle?: string;
    promptLabel?: string;
  } | null;

  const text = body?.text?.trim() ?? "";
  const sourceLanguage = normalizeTranslatableLanguage(body?.sourceLanguage ?? "");

  if (!sourceLanguage) {
    return NextResponse.json({ error: "A supported sourceLanguage is required." }, { status: 400 });
  }

  if (!text) {
    return NextResponse.json({ transcript: "", content: "", translatedAt: null });
  }

  if (text.length > MAX_TRANSLATION_CHARS) {
    return NextResponse.json(
      { error: "Text is too long to translate in one request." },
      { status: 400 }
    );
  }

  const promptContext = getCaregiverPromptContext({
    question: body?.question ?? "",
    sectionTitle: body?.sectionTitle ?? "",
    promptLabel: body?.promptLabel ?? ""
  });

  try {
    const translatedTranscript = await translateCaregiverTranscriptToEnglish({
      apiKey,
      transcript: text,
      promptContext,
      sourceLanguage
    });

    const translatedAt = new Date().toISOString();
    return NextResponse.json({
      transcript: translatedTranscript,
      content: translatedTranscript,
      sourceContent: text,
      sourceLanguage,
      translatedAt
    });
  } catch (error) {
    const status = error instanceof Error && "status" in error ? Number(error.status) : 500;
    const rawMessage = error instanceof Error ? error.message : "Unknown translation failure.";

    if (status === 429 || status === 500 || status === 503) {
      console.error("Transient OpenAI translation error after retrying:", rawMessage);

      return NextResponse.json(
        {
          error:
            "OpenAI is temporarily overloaded. We retried automatically but could not finish the translation. Please try again in a moment."
        },
        { status: 503 }
      );
    }

    console.error("OpenAI translation failed:", rawMessage);

    return NextResponse.json(
      {
        error: "Unable to translate text right now. Please try again."
      },
      { status }
    );
  }
}
