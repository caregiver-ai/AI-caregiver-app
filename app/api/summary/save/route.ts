import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase";
import { StructuredSummary } from "@/lib/types";

export async function POST(request: Request) {
  const body = (await request.json()) as {
    sessionId?: string;
    editedSummary?: StructuredSummary;
  };

  if (!body.sessionId || !body.editedSummary) {
    return NextResponse.json({ error: "sessionId and editedSummary are required." }, { status: 400 });
  }

  const supabase = createSupabaseServerClient();

  if (supabase) {
    const { error: summaryError } = await supabase.from("summaries").upsert(
      {
        session_id: body.sessionId,
        summary_json: body.editedSummary,
        edited_json: body.editedSummary,
        summary_text: body.editedSummary.caregiver_summary_text,
        confirmed_at: new Date().toISOString()
      },
      {
        onConflict: "session_id"
      }
    );

    if (summaryError) {
      return NextResponse.json({ error: summaryError.message }, { status: 500 });
    }

    const { error: sessionError } = await supabase
      .from("sessions")
      .update({
        status: "completed",
        completed_at: new Date().toISOString()
      })
      .eq("id", body.sessionId);

    if (sessionError) {
      return NextResponse.json({ error: sessionError.message }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true });
}
