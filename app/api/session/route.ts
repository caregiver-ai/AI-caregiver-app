import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase";

function parseYesNo(value: unknown, required = false) {
  if (value === "yes") {
    return { value: true };
  }

  if (value === "no") {
    return { value: false };
  }

  if (required) {
    return { error: "Select yes or no." };
  }

  return { value: null };
}

function parseDate(value: unknown, required = false) {
  if (typeof value !== "string" || !value.trim()) {
    if (required) {
      return { error: "Date is required." };
    }

    return { value: null };
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return { error: "Date must be in YYYY-MM-DD format." };
  }

  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    return { error: "Date must be valid." };
  }

  return { value };
}

function isMissingColumnError(error: { code?: string | null; message?: string | null }) {
  const message = error.message ?? "";
  return error.code === "PGRST204" || /schema cache|could not find.+column/i.test(message);
}

export async function POST(request: Request) {
  const body = (await request.json()) as {
    email?: string;
    consented?: boolean;
    caregiverFirstName?: string;
    caregiverLastName?: string;
    caregiver55OrOlder?: string;
    caregiverPhone?: string;
    careRecipientFirstName?: string;
    careRecipientLastName?: string;
    careRecipientPreferredName?: string;
    careRecipientDateOfBirth?: string;
  };
  const sessionId = randomUUID();
  const email = body.email?.trim().toLowerCase();
  const consented = Boolean(body.consented);
  const caregiverFirstName = body.caregiverFirstName?.trim();
  const caregiverLastName = body.caregiverLastName?.trim();
  const caregiverPhone = body.caregiverPhone?.trim() || null;
  const caregiver55OrOlder = parseYesNo(body.caregiver55OrOlder, true);
  const careRecipientFirstName = body.careRecipientFirstName?.trim();
  const careRecipientLastName = body.careRecipientLastName?.trim();
  const careRecipientPreferredName = body.careRecipientPreferredName?.trim() || null;
  const careRecipientDateOfBirth = parseDate(body.careRecipientDateOfBirth);
  const caregiverName = [caregiverFirstName, caregiverLastName].filter(Boolean).join(" ");
  const careRecipientName = [careRecipientFirstName, careRecipientLastName].filter(Boolean).join(" ");

  if (!email) {
    return NextResponse.json({ error: "Email is required." }, { status: 400 });
  }

  if (!caregiverFirstName) {
    return NextResponse.json({ error: "Caregiver first name is required." }, { status: 400 });
  }

  if (!caregiverLastName) {
    return NextResponse.json({ error: "Caregiver last name is required." }, { status: 400 });
  }

  if (caregiver55OrOlder.error) {
    return NextResponse.json({ error: caregiver55OrOlder.error }, { status: 400 });
  }

  if (!careRecipientFirstName) {
    return NextResponse.json({ error: "Care recipient first name is required." }, { status: 400 });
  }

  if (!careRecipientLastName) {
    return NextResponse.json({ error: "Care recipient last name is required." }, { status: 400 });
  }

  if (careRecipientDateOfBirth.error) {
    return NextResponse.json({ error: careRecipientDateOfBirth.error }, { status: 400 });
  }

  const supabase = createSupabaseServerClient();

  if (supabase) {
    let { data: userRecord, error: userLookupError } = await supabase
      .from("users")
      .select("id")
      .eq("email", email)
      .maybeSingle();

    if (userLookupError) {
      return NextResponse.json({ error: userLookupError.message }, { status: 500 });
    }

    if (!userRecord) {
      const newUserId = randomUUID();
      const { error: userInsertError } = await supabase.from("users").insert({
        id: newUserId,
        email
      });

      if (userInsertError) {
        return NextResponse.json({ error: userInsertError.message }, { status: 500 });
      }

      userRecord = { id: newUserId };
    }

    if (!userRecord) {
      return NextResponse.json({ error: "Unable to resolve user." }, { status: 500 });
    }

    const sessionRecord = {
      id: sessionId,
      user_id: userRecord.id,
      consented,
      status: "in_progress",
      caregiver_name: caregiverName,
      caregiver_first_name: caregiverFirstName,
      caregiver_last_name: caregiverLastName,
      caregiver_is_55_or_older: caregiver55OrOlder.value,
      caregiver_phone: caregiverPhone,
      care_recipient_name: careRecipientName,
      care_recipient_first_name: careRecipientFirstName,
      care_recipient_last_name: careRecipientLastName,
      care_recipient_preferred_name: careRecipientPreferredName,
      care_recipient_date_of_birth: careRecipientDateOfBirth.value
    };

    let { error: sessionError } = await supabase.from("sessions").insert(sessionRecord);

    if (sessionError && isMissingColumnError(sessionError)) {
      ({ error: sessionError } = await supabase.from("sessions").insert({
        id: sessionId,
        user_id: userRecord.id,
        consented,
        status: "in_progress",
        caregiver_name: caregiverName,
        caregiver_phone: caregiverPhone,
        care_recipient_name: careRecipientName
      }));
    }

    if (sessionError) {
      return NextResponse.json({ error: sessionError.message }, { status: 500 });
    }
  }

  return NextResponse.json({
    sessionId,
    persistence: supabase ? "supabase" : "local"
  });
}
