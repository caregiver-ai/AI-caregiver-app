import { NextResponse } from "next/server";
import { resolvePublicUser } from "@/lib/auth-user";
import {
  getOrCreateCareRecordWorkspace,
  listCareRecordItems
} from "@/lib/care-records-server";
import { migrateSessionDraftQuestionnaire } from "@/lib/questionnaire-migration";
import { finalizeSummaryWithQa } from "@/lib/summary-audit";
import { getSupabaseAuthUserFromRequest } from "@/lib/supabase";
import { SessionDraft, StructuredSummary } from "@/lib/types";

type SessionRow = {
  id: string;
  status: string;
  draft_json?: SessionDraft | null;
  updated_at: string;
};

function findLatestSummary(rows: SessionRow[]) {
  for (const row of rows) {
    const draft = row.draft_json ? migrateSessionDraftQuestionnaire(row.draft_json) : null;
    const summary = draft?.editedSummary ?? draft?.structuredSummary;

    if (summary) {
      return {
        sessionId: row.id,
        status: row.status,
        updatedAt: row.updated_at,
        summary: finalizeSummaryWithQa(summary as StructuredSummary, { source: "saved" }).summary
      };
    }
  }

  return null;
}

export async function GET(request: Request) {
  const { user, error: authError } = await getSupabaseAuthUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: authError ?? "Unauthorized." }, { status: 401 });
  }

  try {
    const { supabase, publicUserId } = await resolvePublicUser(user);
    const { data: sessions, error: sessionsError } = await supabase
      .from("sessions")
      .select("id, status, draft_json, updated_at")
      .eq("user_id", publicUserId)
      .order("updated_at", { ascending: false })
      .limit(10);

    if (sessionsError) {
      throw new Error(sessionsError.message);
    }

    const workspace = await getOrCreateCareRecordWorkspace(supabase, publicUserId);
    const careRecords = await listCareRecordItems(supabase, workspace.id);

    return NextResponse.json({
      knowMyLovedOne: findLatestSummary((sessions ?? []) as SessionRow[]),
      careRecords,
      workspace
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to load Complete Handoff." },
      { status: 500 }
    );
  }
}
