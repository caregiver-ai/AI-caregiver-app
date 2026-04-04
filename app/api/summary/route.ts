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
- Pull important details across the whole transcript, even if the caregiver said them while answering a different prompt.
- Create only the sections that are actually helpful for this person.
- Prefer specific, practical section titles such as Communication, How to understand what he means, How they ask for help, Bathroom needs, What helps the day go well, What can upset or overwhelm him, Signs he needs help, What helps when he is having a hard time, Safety notes, or similar.
- Avoid vague umbrella titles like Preferences & cues or Daily routines & needs when more specific sections are possible.
- Keep separate sections for interpreted meaning, help-seeking, daily needs, distress signs, calming strategies, and safety if those details appear in the transcript.
- When the transcript supports them, prefer a structure like: Communication; How to understand what they mean; How they ask for help; Daily needs related to communication; What helps the day go well; What can upset or overwhelm them; Signs they need help; What helps when they are having a hard time; Safety notes.
- If the transcript includes both triggers and outward behaviors, keep What can upset or overwhelm them separate from Signs they need help.
- Use What can upset or overwhelm them for triggers, causes, or situations that make things harder. Do not put outward distress behaviors there.
- Use Signs they need help for observable behaviors or communication changes such as yelling, eloping, hand biting, covering ears, withdrawing, or other signs of dysregulation.
- If the transcript includes preventive supports for a smooth day and reactive calming strategies for distress, keep What helps the day go well separate from What helps when they are having a hard time.
- When the transcript implies proactive caregiver guidance, create a section like What helps the day go well even if the caregiver did not label it that way.
- If you can derive at least 2 proactive caregiver actions from the transcript, include a What helps the day go well section.
- Convert repeated practical advice into caregiver-facing guidance, such as responding to AAC selections as meaningful requests, checking search history when a device request suggests something is not working, prompting bathroom use, or noticing hunger cues early.
- If the transcript explains how the person asks for help or attention, do not bury that inside Communication. Give it its own section when there is enough detail.
- If the transcript explains what specific sounds, gestures, behaviors, or device selections usually mean, give that interpreted meaning its own section when there is enough detail.
- Fold hunger cues, bathroom cues, and similar daily-function details into interpreted meaning or daily-needs sections instead of inventing a vague standalone category unless that category is clearly warranted.
- It is fine to create subsections that were not explicit prompts if the caregiver mentioned important details.
- If enough meaningful details exist, create 6-9 sections rather than compressing everything into a few broad buckets.
- Keep sections focused and concrete.
- Keep each bullet concise and specific, usually 1 short sentence.
- Do not over-compress. If a detail changes how another caregiver should respond, include it.
- When the caregiver explains that a word, device selection, sound, behavior, or routine usually means something, convert that into explicit handoff guidance.
- Surface practical "if X, it usually means Y" details clearly.
- Include clear response guidance when it was stated, such as checking search history, prompting bathroom use, redirecting instead of physically intervening, or requiring two adults for outings.
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
    : 'If the person\'s name is clear in the transcript, use a title like "Caring for <Name>". Otherwise use "Caregiver Handoff Summary".';
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
              text: "You are summarizing caregiver reflections into polished structured notes for review. Your job is to synthesize, organize, and clarify. Prefer abstraction over quotation, prioritize the most decision-relevant themes, keep the output concise but not reductive, and never invent facts."
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
