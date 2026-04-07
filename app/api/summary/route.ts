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

const synthesisRules = `You are organizing caregiver input into a structured caregiver handoff.

Step 1: Understand and extract
- Carefully review the full transcript.
- Break the caregiver's input into individual statements.
- Each statement should represent one idea, behavior, need, support, trigger, safety issue, or contact instruction.
- Do not assume the caregiver placed information in the correct section.

Step 2: Categorize by meaning, not location
- Assign each statement to the single best category based on meaning.
- Use these section titles, in this order, when the transcript supports them:
  1. Communication
  2. Daily Needs & Routines
  3. What helps the day go well
  4. What can upset or overwhelm them
  5. Signs they need help
  6. What helps when they are having a hard time
  7. Health & Safety
  8. Who to contact (and when)
- Categorization rules:
  - Communication: how the person expresses themselves and how to understand them.
  - Daily Needs & Routines: regular supports, schedules, meals, hygiene, toileting, bedtime, and daily living assistance.
  - What helps the day go well: proactive and preventive supports that help them stay regulated and successful.
  - What can upset or overwhelm them: triggers, stressors, overload, or situations that make regulation harder.
  - Signs they need help: observable changes in body, behavior, or communication that suggest distress, illness, pain, hunger, toileting needs, or another need.
  - What helps when they are having a hard time: actions a caregiver should take in response to distress.
  - Health & Safety: medical needs, allergies, medications, equipment, and safety risks.
  - Who to contact (and when): emergency and non-emergency contact instructions.
- Special rules:
  - Behaviors or changes that signal a need belong in Signs they need help.
  - Medical or risk-related details belong in Health & Safety.
  - Preventive supports belong in What helps the day go well.
  - Caregiver responses during distress belong in What helps when they are having a hard time.
- If a detail could fit more than one section, place it where it would be most useful to another caregiver in the moment.
- Do not repeat the same fact across sections unless omitting it would create a safety risk.

Step 3: Generate output
- Always write the final output in English.
- Build a useful caregiver handoff, not a worksheet recap.
- Keep only sections supported by the transcript.
- Use clear section headers and concise bullet items.
- Each bullet should contain one actionable idea in plain language.
- Prefer a 6th-8th grade reading level.
- Avoid jargon, meta commentary, process notes, or unsupported assumptions.
- overview must be a short 1-2 sentence summary of the most important themes, not a transcript recap.
- Keep overview under 80 words.
- Make the summary easy to scan in under 2 minutes.
- Highlight important safety information clearly.

Step 4: Quality check
- Every item is in the correct category based on meaning, not where it was entered.
- Similar ideas are combined when that improves clarity.
- There are no unnecessary duplicates across sections.
- No important safety information is missing.
- The final result is clear, concise, respectful, and actionable.`;

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
    ? `The product already displays the overall heading "Caregiver Handoff". For the JSON "title" field, use exactly "Caring for ${nameHint}".`
    : 'The product already displays the overall heading "Caregiver Handoff". For the JSON "title" field, use "Caring for <Name>" if the name is clear and reliable in the transcript. Otherwise use "Caregiver Handoff Summary".';
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
              text: "You are a classifier and organizer for caregiver handoff notes. Read nonlinear caregiver input, extract individual facts, place each fact into the best handoff category based on meaning, prioritize safety and actionability, deduplicate overlap, and never invent facts."
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

function isUsefulNameHint(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }

  const letterCount = (trimmed.match(/[A-Za-z\u00C0-\u024F\u4E00-\u9FFF]/g) ?? []).length;
  const digitCount = (trimmed.match(/\d/g) ?? []).length;

  if (letterCount === 0) {
    return false;
  }

  return digitCount <= letterCount;
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
    const rawNameHint = typeof body.nameHint === "string" ? body.nameHint.trim() : "";
    const nameHint = isUsefulNameHint(rawNameHint) ? rawNameHint : "";
    const summary = {
      ...(await generateSummaryWithGemini(body.turns, nameHint || undefined)),
      generatedAt: new Date().toISOString()
    };

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
