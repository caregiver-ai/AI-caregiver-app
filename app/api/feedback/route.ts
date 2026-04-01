import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase";

export async function POST(request: Request) {
  const body = (await request.json()) as {
    sessionId?: string;
    usefulnessRating?: string;
    comments?: string;
  };

  if (!body.sessionId) {
    return NextResponse.json({ error: "sessionId is required." }, { status: 400 });
  }

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

    const { error } = await supabase.from("feedback").insert({
      session_id: body.sessionId,
      usefulness_rating: body.usefulnessRating ?? null,
      comments: body.comments ?? null
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (sessionRow?.draft_json) {
      const { error: sessionUpdateError } = await supabase
        .from("sessions")
        .update({
          draft_json: {
            ...sessionRow.draft_json,
            feedback: {
              usefulnessRating: body.usefulnessRating ?? "",
              comments: body.comments ?? ""
            }
          },
          updated_at: new Date().toISOString()
        })
        .eq("id", body.sessionId);

      if (sessionUpdateError) {
        return NextResponse.json({ error: sessionUpdateError.message }, { status: 500 });
      }
    }
  }

  return NextResponse.json({ ok: true });
}
