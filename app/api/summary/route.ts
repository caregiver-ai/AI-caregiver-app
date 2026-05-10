import { NextResponse } from "next/server";
import { summaryToPlainText } from "@/lib/summary";
import {
  SummaryModelRequestError,
  generateCaregiverSummaryWithQa
} from "@/lib/summary-generation";
import { createSupabaseServerClient } from "@/lib/supabase";
import { ConversationTurn } from "@/lib/types";

export const maxDuration = 800;

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
    const generated = await generateCaregiverSummaryWithQa(body.turns, nameHint || undefined, "two-step");
    const summary = {
      ...generated.summary,
      generatedAt: new Date().toISOString()
    };
    const auditReport = generated.auditReport;

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
          edited_json: summary,
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
              editedSummary: summary,
              structuredSummaryAudit: auditReport,
              editedSummaryAudit: auditReport
            },
            updated_at: new Date().toISOString()
          })
          .eq("id", body.sessionId);

        if (sessionUpdateError) {
          return NextResponse.json({ error: sessionUpdateError.message }, { status: 500 });
        }
      }
    }

    return NextResponse.json({ summary, auditReport });
  } catch (error) {
    if (error instanceof SummaryModelRequestError) {
      console.error("[summary] model request failed", {
        message: error.message,
        kind: error.kind,
        status: error.status,
        diagnostics: error.diagnostics
      });
    }

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Summary generation failed."
      },
      { status: 500 }
    );
  }
}
