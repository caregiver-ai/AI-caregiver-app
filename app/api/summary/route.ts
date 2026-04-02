import { NextResponse } from "next/server";
import { buildTranscript } from "@/lib/reflection";
import { buildFallbackSummary, normalizeStructuredSummary, summaryToPlainText } from "@/lib/summary";
import { createSupabaseServerClient } from "@/lib/supabase";
import { ConversationTurn } from "@/lib/types";

const schemaDescription = `Return JSON with exactly these keys:
{
  "title": "string",
  "overview": "string",
  "sections": [
    {
      "title": "string",
      "items": ["string"]
    }
  ]
}`;

const synthesisRules = `Requirements:
- Always write the final output in English.
- Summarize and normalize the caregiver's answers instead of copying their wording.
- Build a useful caregiver handoff, not a rigid worksheet.
- Create only the sections that are actually helpful for this person.
- Section titles should be specific and practical, such as Communication, How to understand requests, Bathroom needs, What helps when upset, Signs they need help, Safety notes, or similar.
- It is fine to create subsections that were not explicit prompts if the caregiver mentioned important details.
- Keep sections focused and concrete. Usually 4-8 sections is enough.
- Keep each bullet concise and specific, usually a short phrase or 1 short sentence.
- Prefer 2-5 bullets per section when relevant.
- overview must be a short 1-2 sentence summary of the most important themes, not a transcript recap.
- Keep overview under 80 words.
- Deduplicate overlap across sections.
- Avoid repeating the same fact in multiple places unless it materially changes how a caregiver should respond.
- Emphasize actionable meaning: what the person is communicating, what helps, what escalates distress, what is a safety issue, and what another caregiver must know.
- Do not invent facts. If something is unclear, leave it out rather than guessing.
- Write in neutral, supportive language suitable for caregiver handoff review.
- The final result should read like polished handoff notes, not raw notes or a therapy summary.`;

const summarySchema = {
  type: "object",
  properties: {
    title: {
      type: "string"
    },
    overview: {
      type: "string"
    },
    sections: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: {
            type: "string"
          },
          items: {
            type: "array",
            items: {
              type: "string"
            }
          }
        },
        required: ["title", "items"]
      }
    }
  },
  required: ["title", "overview", "sections"]
};

async function generateSummaryWithGemini(turns: ConversationTurn[], nameHint?: string) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return buildFallbackSummary(turns, nameHint);
  }

  const model = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
  const titleInstruction = nameHint
    ? `Use the title "Caring for ${nameHint}" unless the transcript clearly suggests a better handoff title for the same person.`
    : 'Use a concise title like "Caregiver Handoff Summary" if no name is available.';
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [
            {
              text: "You are summarizing caregiver reflections into polished structured notes for review. Your job is to synthesize, compress, and clarify. Prefer abstraction over quotation, prioritize only the most decision-relevant themes, keep the output concise, and never invent facts."
            }
          ]
        },
        contents: [
          {
            role: "user",
            parts: [
              {
                text: `${schemaDescription}\n\n${synthesisRules}\n\n${titleInstruction}\n\nConversation transcript:\n${buildTranscript(turns)}`
              }
            ]
          }
        ],
        generationConfig: {
          responseMimeType: "application/json",
          responseJsonSchema: summarySchema
        }
      })
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini request failed: ${errorText}`);
  }

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
    return buildFallbackSummary(turns, nameHint);
  }

  return normalizeStructuredSummary(JSON.parse(content), nameHint);
}

export async function POST(request: Request) {
  const body = (await request.json()) as {
    sessionId?: string;
    turns?: ConversationTurn[];
    nameHint?: string;
  };

  if (!body.sessionId || !Array.isArray(body.turns) || body.turns.length === 0) {
    return NextResponse.json({ error: "sessionId and turns are required." }, { status: 400 });
  }

  const supabase = createSupabaseServerClient();

  if (supabase) {
    const conversationRows = body.turns.map((turn) => ({
      session_id: body.sessionId,
      role: turn.role,
      prompt_type: turn.promptType,
      content: turn.content
    }));

    const { error: turnError } = await supabase.from("conversation_turns").insert(conversationRows);
    if (turnError) {
      return NextResponse.json({ error: turnError.message }, { status: 500 });
    }
  }

  try {
    const nameHint = typeof body.nameHint === "string" ? body.nameHint.trim() : "";
    const summary = await generateSummaryWithGemini(body.turns, nameHint || undefined);

    if (supabase) {
      const { data: sessionRow, error: sessionLookupError } = await supabase
        .from("sessions")
        .select("draft_json")
        .eq("id", body.sessionId)
        .maybeSingle();

      if (sessionLookupError) {
        return NextResponse.json({ error: sessionLookupError.message }, { status: 500 });
      }

      const { error: summaryError } = await supabase.from("summaries").upsert(
        {
          session_id: body.sessionId,
          summary_json: summary,
          summary_text: summaryToPlainText(summary)
        },
        {
          onConflict: "session_id"
        }
      );

      if (summaryError) {
        return NextResponse.json({ error: summaryError.message }, { status: 500 });
      }

      if (sessionRow?.draft_json) {
        const { error: sessionUpdateError } = await supabase
          .from("sessions")
          .update({
            draft_json: {
              ...sessionRow.draft_json,
              turns: body.turns,
              structuredSummary: summary,
              editedSummary: summary
            },
            updated_at: new Date().toISOString()
          })
          .eq("id", body.sessionId);

        if (sessionUpdateError) {
          return NextResponse.json({ error: sessionUpdateError.message }, { status: 500 });
        }
      }
    }

    return NextResponse.json({ summary });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Summary generation failed."
      },
      { status: 500 }
    );
  }
}
