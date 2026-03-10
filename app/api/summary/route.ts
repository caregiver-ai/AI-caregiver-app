import OpenAI from "openai";
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
- Keep each bullet concise and specific, usually 1 sentence or short phrase.
- caregiver_summary_text must be a 3-5 sentence synthesis of the overall pattern, not a transcript recap.
- Do not invent facts. If something is unclear, leave the section sparse and use unresolved_questions.
- Write in neutral, supportive language suitable for review and editing.`;

async function generateSummaryWithOpenAI(turns: ConversationTurn[]) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return buildFallbackSummary(turns);
  }

  const openai = new OpenAI({ apiKey });
  const completion = await openai.chat.completions.create({
    model: process.env.OPENAI_MODEL ?? "gpt-4.1-mini",
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "You turn caregiver reflections into concise, synthesized summaries for review. Prefer abstraction over quotation. Never invent facts."
      },
      {
        role: "user",
        content: `${schemaDescription}\n\n${synthesisRules}\n\nConversation transcript:\n${buildTranscript(turns)}`
      }
    ]
  });

  const content = completion.choices[0]?.message?.content;
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
    const summary = await generateSummaryWithOpenAI(body.turns);

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
