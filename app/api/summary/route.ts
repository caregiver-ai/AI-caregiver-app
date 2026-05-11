import { NextResponse } from "next/server";
import { summaryToPlainText } from "@/lib/summary";
import {
  SummaryModelRequestError,
  generateCaregiverSummaryArtifactsWithQa
} from "@/lib/summary-generation";
import {
  replaceSummaryFactsForSession,
  replaceSummarySectionSummariesForSession
} from "@/lib/summary-persistence";
import { createSupabaseServerClient } from "@/lib/supabase";
import { ConversationTurn, SessionDraft } from "@/lib/types";

export const maxDuration = 800;

type SummarySessionRow = {
  draft_json?: SessionDraft | null;
  user_id?: string | null;
  consented?: boolean | null;
  caregiver_first_name?: string | null;
  caregiver_last_name?: string | null;
  caregiver_is_55_or_older?: boolean | null;
  caregiver_phone?: string | null;
  care_recipient_first_name?: string | null;
  care_recipient_last_name?: string | null;
  care_recipient_preferred_name?: string | null;
  care_recipient_date_of_birth?: string | null;
};

function yesNoFromBoolean(value: boolean | null | undefined) {
  if (value === true) {
    return "yes" as const;
  }

  if (value === false) {
    return "no" as const;
  }

  return "";
}

function buildSessionDraftSnapshot(
  sessionId: string,
  turns: ConversationTurn[],
  sessionRow: SummarySessionRow,
  email: string,
  summary: NonNullable<SessionDraft["structuredSummary"]>,
  auditReport: NonNullable<SessionDraft["structuredSummaryAudit"]>
): SessionDraft {
  return {
    sessionId,
    email: sessionRow.draft_json?.email ?? email,
    consented: sessionRow.draft_json?.consented ?? Boolean(sessionRow.consented),
    intakeDetails: {
      caregiverFirstName:
        sessionRow.draft_json?.intakeDetails.caregiverFirstName ??
        sessionRow.caregiver_first_name ??
        "",
      caregiverLastName:
        sessionRow.draft_json?.intakeDetails.caregiverLastName ??
        sessionRow.caregiver_last_name ??
        "",
      caregiver55OrOlder:
        sessionRow.draft_json?.intakeDetails.caregiver55OrOlder ??
        yesNoFromBoolean(sessionRow.caregiver_is_55_or_older),
      caregiverPhone:
        sessionRow.draft_json?.intakeDetails.caregiverPhone ??
        sessionRow.caregiver_phone ??
        "",
      careRecipientFirstName:
        sessionRow.draft_json?.intakeDetails.careRecipientFirstName ??
        sessionRow.care_recipient_first_name ??
        "",
      careRecipientLastName:
        sessionRow.draft_json?.intakeDetails.careRecipientLastName ??
        sessionRow.care_recipient_last_name ??
        "",
      careRecipientPreferredName:
        sessionRow.draft_json?.intakeDetails.careRecipientPreferredName ??
        sessionRow.care_recipient_preferred_name ??
        "",
      careRecipientDateOfBirth:
        sessionRow.draft_json?.intakeDetails.careRecipientDateOfBirth ??
        sessionRow.care_recipient_date_of_birth ??
        "",
      preferredLanguage: sessionRow.draft_json?.intakeDetails.preferredLanguage ?? "english"
    },
    turns,
    structuredSummary: summary,
    editedSummary: summary,
    structuredSummaryAudit: auditReport,
    editedSummaryAudit: auditReport,
    summaryArchives: sessionRow.draft_json?.summaryArchives,
    feedback: sessionRow.draft_json?.feedback
  };
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

  try {
    const rawNameHint = typeof body.nameHint === "string" ? body.nameHint.trim() : "";
    const nameHint = isUsefulNameHint(rawNameHint) ? rawNameHint : "";
    const generated = await generateCaregiverSummaryArtifactsWithQa(
      body.turns,
      nameHint || undefined,
      "two-step"
    );
    const summary = {
      ...generated.summary,
      generatedAt: new Date().toISOString()
    };
    const auditReport = generated.auditReport;

    if (supabase) {
      const { data: sessionRow, error: sessionLookupError } = await supabase
        .from("sessions")
        .select(
          "draft_json, user_id, consented, caregiver_first_name, caregiver_last_name, caregiver_is_55_or_older, caregiver_phone, care_recipient_first_name, care_recipient_last_name, care_recipient_preferred_name, care_recipient_date_of_birth"
        )
        .eq("id", body.sessionId)
        .maybeSingle();

      if (sessionLookupError) {
        return NextResponse.json({ error: sessionLookupError.message }, { status: 500 });
      }

      let storedEmail = sessionRow?.draft_json?.email ?? "";
      if (!storedEmail && sessionRow?.user_id) {
        const { data: userRow, error: userLookupError } = await supabase
          .from("users")
          .select("email")
          .eq("id", sessionRow.user_id)
          .maybeSingle();

        if (userLookupError) {
          return NextResponse.json({ error: userLookupError.message }, { status: 500 });
        }

        storedEmail = userRow?.email?.trim().toLowerCase() ?? "";
      }

      await replaceSummaryFactsForSession(supabase, body.sessionId, generated.facts);
      await replaceSummarySectionSummariesForSession(
        supabase,
        body.sessionId,
        generated.sectionSummaries
      );

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

      if (sessionRow) {
        const nextDraft = buildSessionDraftSnapshot(
          body.sessionId,
          body.turns,
          sessionRow as SummarySessionRow,
          storedEmail,
          summary,
          auditReport
        );

        const { error: sessionUpdateError } = await supabase
          .from("sessions")
          .update({
            draft_json: nextDraft,
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
