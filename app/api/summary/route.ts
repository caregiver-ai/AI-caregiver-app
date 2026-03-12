import { NextResponse } from "next/server";
import { buildTranscript } from "@/lib/reflection";
import { buildFallbackSummary, normalizeStructuredSummary } from "@/lib/summary";
import { createSupabaseServerClient } from "@/lib/supabase";
import { ConversationTurn } from "@/lib/types";

const schemaDescription = `Return JSON with exactly these keys:
{
  "key_barriers": ["string"],
  "emotional_concerns": ["string"],
  "safety_considerations": ["string"],
  "past_negative_experiences": ["string"],
  "situations_to_avoid": ["string"],
  "conditions_for_successful_respite": ["string"],
  "unresolved_questions": ["string"],
  "caregiver_summary_text": "string"
}`;

const synthesisRules = `Requirements:
- Summarize and normalize the caregiver's answers instead of copying their wording.
- Deduplicate overlap across sections.
- Keep each bullet concise and specific, usually a short phrase or 1 short sentence.
- Prefer 1-2 bullets per section unless there is a strong reason for more.
- caregiver_summary_text must be a 2-3 sentence synthesis of the overall pattern, not a transcript recap.
- Keep caregiver_summary_text under 75 words.
- Emphasize the main themes, tradeoffs, and what would make respite feel possible.
- When multiple details express the same issue, collapse them into one clearer summary point.
- Avoid repeating the same idea in multiple sections unless it is necessary for clarity.
- Do not invent facts. If something is unclear, leave the section sparse and use unresolved_questions.
- Write in neutral, supportive language suitable for review and editing.
- The final result should read like a polished case summary, not raw notes.`;

const summarySchema = {
  type: "object",
  properties: {
    key_barriers: {
      type: "array",
      items: {
        type: "string"
      }
    },
    emotional_concerns: {
      type: "array",
      items: {
        type: "string"
      }
    },
    safety_considerations: {
      type: "array",
      items: {
        type: "string"
      }
    },
    past_negative_experiences: {
      type: "array",
      items: {
        type: "string"
      }
    },
    situations_to_avoid: {
      type: "array",
      items: {
        type: "string"
      }
    },
    conditions_for_successful_respite: {
      type: "array",
      items: {
        type: "string"
      }
    },
    unresolved_questions: {
      type: "array",
      items: {
        type: "string"
      }
    },
    caregiver_summary_text: {
      type: "string"
    }
  },
  required: [
    "key_barriers",
    "emotional_concerns",
    "safety_considerations",
    "past_negative_experiences",
    "situations_to_avoid",
    "conditions_for_successful_respite",
    "unresolved_questions",
    "caregiver_summary_text"
  ]
};

async function generateSummaryWithGemini(turns: ConversationTurn[]) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return buildFallbackSummary(turns);
  }

  const model = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
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
                text: `${schemaDescription}\n\n${synthesisRules}\n\nConversation transcript:\n${buildTranscript(turns)}`
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
    return buildFallbackSummary(turns);
  }

  return normalizeStructuredSummary(JSON.parse(content));
}

export async function POST(request: Request) {
  const body = (await request.json()) as {
    sessionId?: string;
    turns?: ConversationTurn[];
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
    const summary = await generateSummaryWithGemini(body.turns);

    if (supabase) {
      const { error: summaryError } = await supabase.from("summaries").upsert(
        {
          session_id: body.sessionId,
          summary_json: summary,
          summary_text: summary.caregiver_summary_text
        },
        {
          onConflict: "session_id"
        }
      );

      if (summaryError) {
        return NextResponse.json({ error: summaryError.message }, { status: 500 });
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
