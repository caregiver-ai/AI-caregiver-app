import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase";

function parseAge(value: unknown, required = false) {
  if (typeof value !== "string" || !value.trim()) {
    if (required) {
      return { error: "Age is required." };
    }

    return { value: null };
  }

  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < 0) {
    return { error: "Age must be a valid non-negative number." };
  }

  return { value: parsed };
}

export async function POST(request: Request) {
  const body = (await request.json()) as {
    email?: string;
    consented?: boolean;
    caregiverName?: string;
    caregiverAge?: string;
    caregiverPhone?: string;
    careRecipientName?: string;
    careRecipientAge?: string;
  };
  const sessionId = randomUUID();
  const email = body.email?.trim().toLowerCase();
  const consented = Boolean(body.consented);
  const caregiverName = body.caregiverName?.trim();
  const caregiverPhone = body.caregiverPhone?.trim() || null;
  const careRecipientName = body.careRecipientName?.trim();
  const caregiverAge = parseAge(body.caregiverAge);
  const careRecipientAge = parseAge(body.careRecipientAge, true);

  if (!email) {
    return NextResponse.json({ error: "Email is required." }, { status: 400 });
  }

  if (!caregiverName) {
    return NextResponse.json({ error: "Caregiver name is required." }, { status: 400 });
  }

  if (!careRecipientName) {
    return NextResponse.json({ error: "Care recipient name is required." }, { status: 400 });
  }

  if (caregiverAge.error) {
    return NextResponse.json({ error: caregiverAge.error }, { status: 400 });
  }

  if (careRecipientAge.error) {
    return NextResponse.json({ error: careRecipientAge.error }, { status: 400 });
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

    const { error: sessionError } = await supabase.from("sessions").insert({
      id: sessionId,
      user_id: userRecord.id,
      consented,
      status: "in_progress",
      caregiver_name: caregiverName,
      caregiver_age: caregiverAge.value,
      caregiver_phone: caregiverPhone,
      care_recipient_name: careRecipientName,
      care_recipient_age: careRecipientAge.value
    });

    if (sessionError) {
      return NextResponse.json({ error: sessionError.message }, { status: 500 });
    }
  }

  return NextResponse.json({
    sessionId,
    persistence: supabase ? "supabase" : "local"
  });
}
