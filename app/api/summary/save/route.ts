import { NextResponse } from "next/server";
import { normalizeStructuredSummary, summaryToPlainText } from "@/lib/summary";
import { createSupabaseServerClient } from "@/lib/supabase";

export async function POST(request: Request) {
  const body = (await request.json()) as {
    sessionId?: string;
    editedSummary?: unknown;
  };

  if (!body.sessionId || !body.editedSummary) {
    return NextResponse.json({ error: "sessionId and editedSummary are required." }, { status: 400 });
  }

  const editedSummary = normalizeStructuredSummary(body.editedSummary);

  const supabase = createSupabaseServerClient();

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
        summary_json: editedSummary,
        edited_json: editedSummary,
        summary_text: summaryToPlainText(editedSummary),
        confirmed_at: new Date().toISOString()
      },
      {
        onConflict: "session_id"
      }
    );

    if (summaryError) {
      return NextResponse.json({ error: summaryError.message }, { status: 500 });
    }

    const sessionUpdate = {
      status: "completed",
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      ...(sessionRow?.draft_json
        ? {
            draft_json: {
              ...sessionRow.draft_json,
              editedSummary,
              structuredSummary: editedSummary
            }
          }
        : {})
    };

    const { error: sessionError } = await supabase
      .from("sessions")
      .update(sessionUpdate)
      .eq("id", body.sessionId);

    if (sessionError) {
      return NextResponse.json({ error: sessionError.message }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true });
}
