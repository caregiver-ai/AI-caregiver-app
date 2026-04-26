import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { createSupabaseServerClient, getSupabaseAuthUserFromRequest } from "@/lib/supabase";
import { getSummaryFreshness } from "@/lib/summary-structured";
import { SessionDraft, SessionIntakeDetails } from "@/lib/types";

type SessionRow = {
  id: string;
  user_id?: string;
  consented: boolean;
  status: string;
  caregiver_name: string | null;
  caregiver_first_name: string | null;
  caregiver_last_name: string | null;
  caregiver_is_55_or_older: boolean | null;
  caregiver_phone: string | null;
  care_recipient_name: string | null;
  care_recipient_first_name: string | null;
  care_recipient_last_name: string | null;
  care_recipient_preferred_name: string | null;
  care_recipient_date_of_birth: string | null;
  draft_json: SessionDraft | null;
};

function buildEmptyIntakeDetails(): SessionIntakeDetails {
  return {
    caregiverFirstName: "",
    caregiverLastName: "",
    caregiver55OrOlder: "",
    caregiverPhone: "",
    careRecipientFirstName: "",
    careRecipientLastName: "",
    careRecipientPreferredName: "",
    careRecipientDateOfBirth: "",
    preferredLanguage: "english"
  };
}

function buildDraftFromSessionRow(row: SessionRow, email: string): SessionDraft {
  if (row.draft_json) {
    return {
      ...row.draft_json,
      sessionId: row.id,
      email,
      consented: row.draft_json.consented ?? row.consented
    };
  }

  return {
    sessionId: row.id,
    email,
    consented: row.consented,
    intakeDetails: {
      caregiverFirstName: row.caregiver_first_name ?? "",
      caregiverLastName: row.caregiver_last_name ?? "",
      caregiver55OrOlder:
        row.caregiver_is_55_or_older === null ? "" : row.caregiver_is_55_or_older ? "yes" : "no",
      caregiverPhone: row.caregiver_phone ?? "",
      careRecipientFirstName: row.care_recipient_first_name ?? "",
      careRecipientLastName: row.care_recipient_last_name ?? "",
      careRecipientPreferredName: row.care_recipient_preferred_name ?? "",
      careRecipientDateOfBirth: row.care_recipient_date_of_birth ?? "",
      preferredLanguage: "english"
    },
    turns: []
  };
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
    publicUserId: userRecord.id,
    email
  };
}

async function getLatestDraftSession(publicUserId: string) {
  const supabase = createSupabaseServerClient();
  if (!supabase) {
    throw new Error("Supabase server client is not configured.");
  }

  const { data, error } = await supabase
    .from("sessions")
    .select(
      "id, consented, status, caregiver_name, caregiver_first_name, caregiver_last_name, caregiver_is_55_or_older, caregiver_phone, care_recipient_name, care_recipient_first_name, care_recipient_last_name, care_recipient_preferred_name, care_recipient_date_of_birth, draft_json"
    )
    .eq("user_id", publicUserId)
    .in("status", ["draft", "in_progress"])
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data as SessionRow | null;
}

async function getOwnedSessionById(publicUserId: string, sessionId: string) {
  const supabase = createSupabaseServerClient();
  if (!supabase) {
    throw new Error("Supabase server client is not configured.");
  }

  const { data, error } = await supabase
    .from("sessions")
    .select(
      "id, consented, status, caregiver_name, caregiver_first_name, caregiver_last_name, caregiver_is_55_or_older, caregiver_phone, care_recipient_name, care_recipient_first_name, care_recipient_last_name, care_recipient_preferred_name, care_recipient_date_of_birth, draft_json"
    )
    .eq("id", sessionId)
    .eq("user_id", publicUserId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data as SessionRow | null;
}

async function getSessionById(sessionId: string) {
  const supabase = createSupabaseServerClient();
  if (!supabase) {
    throw new Error("Supabase server client is not configured.");
  }

  const { data, error } = await supabase
    .from("sessions")
    .select("id, user_id")
    .eq("id", sessionId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data as Pick<SessionRow, "id" | "user_id"> | null;
}

function buildSessionRecord(
  publicUserId: string,
  draft: SessionDraft,
  status: string
) {
  const caregiverName = [
    draft.intakeDetails.caregiverFirstName?.trim(),
    draft.intakeDetails.caregiverLastName?.trim()
  ]
    .filter(Boolean)
    .join(" ");
  const careRecipientName = [
    draft.intakeDetails.careRecipientFirstName?.trim(),
    draft.intakeDetails.careRecipientLastName?.trim()
  ]
    .filter(Boolean)
    .join(" ");

  return {
    id: draft.sessionId,
    user_id: publicUserId,
    consented: draft.consented,
    status,
    caregiver_name: caregiverName || null,
    caregiver_first_name: draft.intakeDetails.caregiverFirstName.trim() || null,
    caregiver_last_name: draft.intakeDetails.caregiverLastName.trim() || null,
    caregiver_is_55_or_older:
      draft.intakeDetails.caregiver55OrOlder === ""
        ? null
        : draft.intakeDetails.caregiver55OrOlder === "yes",
    caregiver_phone: draft.intakeDetails.caregiverPhone.trim() || null,
    care_recipient_name: careRecipientName || null,
    care_recipient_first_name: draft.intakeDetails.careRecipientFirstName.trim() || null,
    care_recipient_last_name: draft.intakeDetails.careRecipientLastName.trim() || null,
    care_recipient_preferred_name: draft.intakeDetails.careRecipientPreferredName.trim() || null,
    care_recipient_date_of_birth: draft.intakeDetails.careRecipientDateOfBirth || null,
    draft_json: draft,
    updated_at: new Date().toISOString()
  };
}

export async function GET(request: Request) {
  const { user, error: authError } = await getSupabaseAuthUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: authError ?? "Unauthorized." }, { status: 401 });
  }

  try {
    const { publicUserId, email } = await resolvePublicUser(user);
    const session = await getLatestDraftSession(publicUserId);
    const draft = session ? buildDraftFromSessionRow(session, email) : null;

    return NextResponse.json({
      draft,
      summaryFreshness: draft
        ? getSummaryFreshness(draft.turns, draft.structuredSummary, draft.editedSummary)
        : null
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to load draft."
      },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  const { user, error: authError } = await getSupabaseAuthUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: authError ?? "Unauthorized." }, { status: 401 });
  }

  const body = (await request.json()) as {
    draft?: Partial<SessionDraft>;
    status?: string;
  };

  if (!body.draft) {
    return NextResponse.json({ error: "Draft is required." }, { status: 400 });
  }

  try {
    const { supabase, publicUserId, email } = await resolvePublicUser(user);
    const incomingSessionId =
      typeof body.draft.sessionId === "string" && body.draft.sessionId.trim()
        ? body.draft.sessionId.trim()
        : undefined;
    let existingSession = incomingSessionId
      ? await getOwnedSessionById(publicUserId, incomingSessionId)
      : await getLatestDraftSession(publicUserId);

    if (incomingSessionId && !existingSession) {
      const existingSessionOwner = await getSessionById(incomingSessionId);
      if (existingSessionOwner?.user_id && existingSessionOwner.user_id !== publicUserId) {
        return NextResponse.json(
          { error: "Unable to find that saved draft for this account." },
          { status: 404 }
        );
      }
    }

    const normalizedDraft: SessionDraft = {
      sessionId: incomingSessionId ?? existingSession?.id ?? randomUUID(),
      email,
      consented: body.draft.consented ?? existingSession?.consented ?? false,
      intakeDetails: {
        ...buildEmptyIntakeDetails(),
        ...(existingSession ? buildDraftFromSessionRow(existingSession, email).intakeDetails : {}),
        ...(body.draft.intakeDetails ?? {})
      },
      turns: body.draft.turns ?? existingSession?.draft_json?.turns ?? [],
      structuredSummary:
        body.draft.structuredSummary ?? existingSession?.draft_json?.structuredSummary,
      editedSummary: body.draft.editedSummary ?? existingSession?.draft_json?.editedSummary,
      structuredSummaryAudit:
        body.draft.structuredSummaryAudit ?? existingSession?.draft_json?.structuredSummaryAudit,
      editedSummaryAudit:
        body.draft.editedSummaryAudit ?? existingSession?.draft_json?.editedSummaryAudit,
      summaryArchives: body.draft.summaryArchives ?? existingSession?.draft_json?.summaryArchives,
      feedback: body.draft.feedback ?? existingSession?.draft_json?.feedback
    };

    const { error } = await supabase.from("sessions").upsert(buildSessionRecord(
      publicUserId,
      normalizedDraft,
      body.status ?? "draft"
    ), {
      onConflict: "id"
    });

    if (error) {
      throw new Error(error.message);
    }

    return NextResponse.json({
      draft: normalizedDraft,
      summaryFreshness: getSummaryFreshness(
        normalizedDraft.turns,
        normalizedDraft.structuredSummary,
        normalizedDraft.editedSummary
      )
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to save draft."
      },
      { status: 500 }
    );
  }
}
