import { NextResponse } from "next/server";
import { createSupabaseAuthServerClient, createSupabaseServerClient } from "@/lib/supabase";

type ConfirmExistingRequest = {
  email?: string;
  password?: string;
};

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

export async function POST(request: Request) {
  const authClient = createSupabaseAuthServerClient();
  const adminClient = createSupabaseServerClient();

  if (!authClient || !adminClient) {
    return NextResponse.json(
      { error: "Supabase auth is not configured." },
      { status: 500 }
    );
  }

  const body = (await request.json()) as ConfirmExistingRequest;
  const email = typeof body.email === "string" ? normalizeEmail(body.email) : "";
  const password = typeof body.password === "string" ? body.password : "";

  if (!email || !password) {
    return NextResponse.json(
      { error: "Email and password are required." },
      { status: 400 }
    );
  }

  const { error: signInError } = await authClient.auth.signInWithPassword({
    email,
    password
  });

  if (!signInError || !signInError.message.toLowerCase().includes("email not confirmed")) {
    return NextResponse.json(
      { error: "This account could not be confirmed automatically." },
      { status: 400 }
    );
  }

  const { data: usersData, error: listUsersError } = await adminClient.auth.admin.listUsers();
  if (listUsersError) {
    return NextResponse.json({ error: listUsersError.message }, { status: 500 });
  }

  const matchedUser = usersData.users.find(
    (user) => user.email?.trim().toLowerCase() === email
  );

  if (!matchedUser) {
    return NextResponse.json({ error: "Account not found." }, { status: 404 });
  }

  const { error: confirmError } = await adminClient.auth.admin.updateUserById(matchedUser.id, {
    email_confirm: true
  });

  if (confirmError) {
    return NextResponse.json({ error: confirmError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
