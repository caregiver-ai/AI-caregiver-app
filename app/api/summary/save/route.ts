import { NextResponse } from "next/server";
import { normalizeAuthoritativeStructuredSummary, summaryToPlainText } from "@/lib/summary";
import { createSupabaseServerClient } from "@/lib/supabase";

export async function POST(request: Request) {
  const body = (await request.json()) as {
    sessionId?: string;
    editedSummary?: unknown;
  };

  if (!body.sessionId || !body.editedSummary) {
    return NextResponse.json({ error: "sessionId and editedSummary are required." }, { status: 400 });
  }

  const editedSummary = normalizeAuthoritativeStructuredSummary(body.editedSummary);

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

    const { data: existingSummaryRow, error: summaryLookupError } = await supabase
      .from("summaries")
      .select("summary_json")
      .eq("session_id", body.sessionId)
      .maybeSingle();

    if (summaryLookupError) {
      return NextResponse.json({ error: summaryLookupError.message }, { status: 500 });
    }

    const { error: summaryError } = await supabase.from("summaries").upsert(
      {
        session_id: body.sessionId,
        summary_json:
          (existingSummaryRow as { summary_json?: unknown } | null)?.summary_json ??
          sessionRow?.draft_json?.structuredSummary ??
          editedSummary,
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
              structuredSummary: sessionRow.draft_json.structuredSummary ?? editedSummary
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
