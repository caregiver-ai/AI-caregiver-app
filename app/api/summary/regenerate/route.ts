import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import {
  SummaryModelRequestError,
  generateCaregiverSummaryWithQa
} from "@/lib/summary-generation";
import { collectRepairHintsFromAuditReport, normalizeSummaryAuditReport } from "@/lib/summary-audit";
import { getSummaryFreshness } from "@/lib/summary-structured";
import { summaryToPlainText } from "@/lib/summary";
import { createSupabaseServerClient, getSupabaseAuthUserFromRequest } from "@/lib/supabase";
import { SessionDraft } from "@/lib/types";

type SessionRow = {
  id: string;
  user_id: string | null;
  status: string;
  care_recipient_first_name: string | null;
  care_recipient_last_name: string | null;
  care_recipient_preferred_name: string | null;
  draft_json?: SessionDraft | null;
};

function collectStoredRepairHints(draft?: SessionDraft | null) {
  const reports = [
    draft?.editedSummaryAudit,
    draft?.structuredSummaryAudit
  ].filter(Boolean);

  const messages = reports.flatMap((report) =>
    collectRepairHintsFromAuditReport(normalizeSummaryAuditReport(report!), "all")
  );

  return [...new Set(messages.map((message) => message.trim()).filter(Boolean))].slice(0, 8);
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

async function resolvePublicUser(authUser: { id: string; email?: string | null }) {
  const supabase = createSupabaseServerClient();
  if (!supabase) {
    throw new Error("Supabase server client is not configured.");
  }

  const email = authUser.email?.trim().toLowerCase();
  if (!email) {
    throw new Error("Authenticated user is missing an email address.");
  }

  let { data: userRecord, error: userLookupError } = await supabase
    .from("users")
    .select("id, email, auth_user_id")
    .eq("auth_user_id", authUser.id)
    .maybeSingle();

  if (userLookupError) {
    throw new Error(userLookupError.message);
  }

  if (!userRecord) {
    const { data: emailMatchedUser, error: emailLookupError } = await supabase
      .from("users")
      .select("id, email, auth_user_id")
      .eq("email", email)
      .maybeSingle();

    if (emailLookupError) {
      throw new Error(emailLookupError.message);
    }

    if (emailMatchedUser) {
      const { error: updateError } = await supabase
        .from("users")
        .update({ auth_user_id: authUser.id })
        .eq("id", emailMatchedUser.id);

      if (updateError) {
        throw new Error(updateError.message);
      }

      userRecord = {
        ...emailMatchedUser,
        auth_user_id: authUser.id
      };
    }
  }

  if (!userRecord) {
    const newUserId = randomUUID();
    const { error: insertError } = await supabase.from("users").insert({
      id: newUserId,
      auth_user_id: authUser.id,
      email
    });

    if (insertError) {
      throw new Error(insertError.message);
    }

    userRecord = {
      id: newUserId,
      email,
      auth_user_id: authUser.id
    };
  }

  return {
    supabase,
    publicUserId: userRecord.id
  };
}

export async function POST(request: Request) {
  const { user, error: authError } = await getSupabaseAuthUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: authError ?? "Unauthorized." }, { status: 401 });
  }

  const body = (await request.json()) as {
    sessionId?: string;
  };

  if (!body.sessionId) {
    return NextResponse.json({ error: "sessionId is required." }, { status: 400 });
  }

  try {
    const { supabase, publicUserId } = await resolvePublicUser(user);
    const { data: sessionRow, error: sessionLookupError } = await supabase
      .from("sessions")
      .select(
        "id, user_id, status, care_recipient_first_name, care_recipient_last_name, care_recipient_preferred_name, draft_json"
      )
      .eq("id", body.sessionId)
      .eq("user_id", publicUserId)
      .maybeSingle();

    if (sessionLookupError) {
      return NextResponse.json({ error: sessionLookupError.message }, { status: 500 });
    }

    const ownedSession = sessionRow as SessionRow | null;
    if (!ownedSession) {
      return NextResponse.json({ error: "Unable to find that saved summary." }, { status: 404 });
    }

    const turns = ownedSession.draft_json?.turns ?? [];
    if (turns.length === 0) {
      return NextResponse.json(
        { error: "No saved caregiver answers are available for regeneration." },
        { status: 400 }
      );
    }

    const rawNameHint =
      ownedSession.care_recipient_preferred_name?.trim() ||
      ownedSession.care_recipient_first_name?.trim() ||
      [ownedSession.care_recipient_first_name, ownedSession.care_recipient_last_name]
        .filter(Boolean)
        .join(" ")
        .trim();
    const nameHint = isUsefulNameHint(rawNameHint) ? rawNameHint : "";
    const generated = await generateCaregiverSummaryWithQa(
      turns,
      nameHint || undefined,
      "two-step",
      {
        repairHints: collectStoredRepairHints(ownedSession.draft_json)
      }
    );
    const summary = {
      ...generated.summary,
      generatedAt: new Date().toISOString()
    };
    const auditReport = generated.auditReport;

    const nextDraft: SessionDraft = {
      ...(ownedSession.draft_json ?? {
        sessionId: ownedSession.id,
        email: user.email?.trim().toLowerCase() ?? "",
        consented: false,
        intakeDetails: {
          caregiverFirstName: "",
          caregiverLastName: "",
          caregiver55OrOlder: "",
          caregiverPhone: "",
          careRecipientFirstName: "",
          careRecipientLastName: "",
          careRecipientPreferredName: "",
          careRecipientDateOfBirth: "",
          preferredLanguage: "english"
        },
        turns
      }),
      sessionId: ownedSession.id,
      turns,
      summaryArchives: [
        ...(ownedSession.draft_json?.summaryArchives ?? []),
        {
          structuredSummary: ownedSession.draft_json?.structuredSummary,
          editedSummary: ownedSession.draft_json?.editedSummary,
          archivedAt: new Date().toISOString(),
          reason: "stale_regeneration" as const
        }
      ].filter(
        (archive) => archive.structuredSummary || archive.editedSummary
      ),
      structuredSummary: summary,
      editedSummary: summary,
      structuredSummaryAudit: auditReport,
      editedSummaryAudit: auditReport
    };

    const { error: summaryUpsertError } = await supabase.from("summaries").upsert(
      {
        session_id: ownedSession.id,
        summary_json: summary,
        edited_json: summary,
        summary_text: summaryToPlainText(summary)
      },
      {
        onConflict: "session_id"
      }
    );

    if (summaryUpsertError) {
      return NextResponse.json({ error: summaryUpsertError.message }, { status: 500 });
    }

    const { error: sessionUpdateError } = await supabase
      .from("sessions")
      .update({
        draft_json: nextDraft,
        updated_at: new Date().toISOString(),
        status: ownedSession.status
      })
      .eq("id", ownedSession.id);

    if (sessionUpdateError) {
      return NextResponse.json({ error: sessionUpdateError.message }, { status: 500 });
    }

    return NextResponse.json({
      summary,
      draft: nextDraft,
      summaryFreshness: getSummaryFreshness(turns, summary, summary),
      auditReport
    });
  } catch (error) {
    if (error instanceof SummaryModelRequestError) {
      console.error("[summary:regenerate] model request failed", {
        message: error.message,
        kind: error.kind,
        status: error.status,
        diagnostics: error.diagnostics
      });
    }

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to regenerate the summary."
      },
      { status: 500 }
    );
  }
}
