import { NextResponse } from "next/server";
import { resolvePublicUser } from "@/lib/auth-user";
import {
  CARE_RECORD_CATEGORY_DEFINITIONS,
  CARE_RECORD_EXTRACTION_SCHEMA,
  CareRecordSourceType,
  buildFallbackCareRecordSuggestions,
  normalizeCareRecordSuggestions,
  parseCareRecordExtractionText
} from "@/lib/care-records";
import { getSupabaseAuthUserFromRequest } from "@/lib/supabase";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const DEFAULT_MODEL = "gpt-4.1";
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const ALLOWED_FILE_TYPES = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);

type ResponseContentPart =
  | {
      type: "input_text";
      text: string;
    }
  | {
      type: "input_file";
      filename: string;
      file_data: string;
      detail: "low";
    }
  | {
      type: "input_image";
      image_url: string;
      detail: "auto";
    };

function getCareRecordsPrompt() {
  const categoryGuide = CARE_RECORD_CATEGORY_DEFINITIONS.map(
    (category) => `${category.id}: ${category.title} - ${category.description}`
  ).join("\n");

  return [
    "You extract caregiver record details for a Care Records workspace.",
    "Return only facts that a caregiver would want another trusted person to have for handoff.",
    "Do not create legal, medical, or financial advice. Do not infer missing account numbers, IDs, dates, or contacts.",
    "Use short labels and values. Keep sensitive identifiers partial or described by location when the source only gives a document type.",
    "If the source is mostly a document image, extract the useful category, title, contact names, organizations, document types, phone numbers, dates, and action notes that are visible.",
    "Allowed categories:",
    categoryGuide
  ].join("\n\n");
}

function extractResponseText(data: unknown) {
  if (!data || typeof data !== "object") {
    return "";
  }

  const response = data as {
    output_text?: unknown;
    output?: Array<{
      type?: string;
      content?: Array<{
        type?: string;
        text?: string;
      }>;
    }>;
  };

  if (typeof response.output_text === "string") {
    return response.output_text.trim();
  }

  return (response.output ?? [])
    .flatMap((item) => item.content ?? [])
    .map((part) => (part.type === "output_text" && typeof part.text === "string" ? part.text : ""))
    .join("")
    .trim();
}

function getSourceType(file: File | null): CareRecordSourceType {
  if (!file) {
    return "typed";
  }

  return file.type === "application/pdf" ? "pdf" : "image";
}

function getSourceLabel(sourceType: CareRecordSourceType, file: File | null) {
  if (!file) {
    return "Typed entry";
  }

  return file.name || (sourceType === "pdf" ? "Uploaded PDF" : "Uploaded image");
}

async function buildFileContentPart(file: File): Promise<ResponseContentPart> {
  const buffer = Buffer.from(await file.arrayBuffer());
  const base64Data = `data:${file.type};base64,${buffer.toString("base64")}`;

  if (file.type === "application/pdf") {
    return {
      type: "input_file",
      filename: file.name || "care-record.pdf",
      file_data: base64Data,
      detail: "low"
    };
  }

  return {
    type: "input_image",
    image_url: base64Data,
    detail: "auto"
  };
}

async function requestOpenAiExtraction({
  apiKey,
  model,
  text,
  file
}: {
  apiKey: string;
  model: string;
  text: string;
  file: File | null;
}) {
  const content: ResponseContentPart[] = [
    {
      type: "input_text",
      text: [
        "Extract Care Records suggestions from this caregiver input.",
        text ? `Typed or pasted text:\n${text}` : "No typed text was provided.",
        file ? "An uploaded file is included in this message. Use it only for extraction." : ""
      ]
        .filter(Boolean)
        .join("\n\n")
    }
  ];

  if (file) {
    content.push(await buildFileContentPart(file));
  }

  const response = await fetch(OPENAI_RESPONSES_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      store: false,
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text: getCareRecordsPrompt()
            }
          ]
        },
        {
          role: "user",
          content
        }
      ],
      text: {
        format: {
          type: "json_schema",
          name: "care_records_extraction",
          strict: true,
          schema: CARE_RECORD_EXTRACTION_SCHEMA
        }
      },
      max_output_tokens: 2500
    })
  });

  const rawResponse = await response.text();
  if (!response.ok) {
    throw new Error(rawResponse || "Care Records extraction failed.");
  }

  const responseData = rawResponse ? JSON.parse(rawResponse) : {};
  const outputText = extractResponseText(responseData);
  if (!outputText) {
    return { items: [] };
  }

  return parseCareRecordExtractionText(outputText);
}

export async function POST(request: Request) {
  const { user, error: authError } = await getSupabaseAuthUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: authError ?? "Unauthorized." }, { status: 401 });
  }

  try {
    await resolvePublicUser(user);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to resolve account." },
      { status: 500 }
    );
  }

  const formData = await request.formData();
  const text = typeof formData.get("text") === "string" ? String(formData.get("text")).trim() : "";
  const fileEntry = formData.get("file");
  const file = fileEntry instanceof File && fileEntry.size > 0 ? fileEntry : null;

  if (!text && !file) {
    return NextResponse.json({ error: "Add text or upload one image/PDF first." }, { status: 400 });
  }

  if (file) {
    if (!ALLOWED_FILE_TYPES.has(file.type)) {
      return NextResponse.json(
        { error: "Upload a PDF, PNG, JPG, or WebP image." },
        { status: 400 }
      );
    }

    if (file.size > MAX_FILE_BYTES) {
      return NextResponse.json(
        { error: "Upload a file smaller than 8 MB." },
        { status: 400 }
      );
    }
  }

  const sourceType = getSourceType(file);
  const sourceLabel = getSourceLabel(sourceType, file);
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    if (file && !text) {
      return NextResponse.json(
        { error: "File extraction requires an OpenAI API key. Add text instead for local testing." },
        { status: 500 }
      );
    }

    return NextResponse.json({
      suggestions: buildFallbackCareRecordSuggestions(text),
      sourceType,
      sourceLabel,
      extractionMode: "fallback"
    });
  }

  try {
    const extracted = await requestOpenAiExtraction({
      apiKey,
      model: process.env.OPENAI_CARE_RECORDS_MODEL ?? process.env.OPENAI_MODEL ?? DEFAULT_MODEL,
      text,
      file
    });
    const suggestions = normalizeCareRecordSuggestions(extracted, sourceType, sourceLabel);

    return NextResponse.json({
      suggestions,
      sourceType,
      sourceLabel,
      extractionMode: "openai"
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to extract Care Records." },
      { status: 500 }
    );
  }
}
