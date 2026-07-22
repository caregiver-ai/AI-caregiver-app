import { NextResponse } from "next/server";
import { resolvePublicUser } from "@/lib/auth-user";
import {
  CareRecordItemInput,
  normalizeApprovedCareRecordInputs
} from "@/lib/care-records";
import {
  getOrCreateCareRecordWorkspace,
  insertCareRecordItems,
  listCareRecordItems
} from "@/lib/care-records-server";
import { getSupabaseAuthUserFromRequest } from "@/lib/supabase";

export async function GET(request: Request) {
  const { user, error: authError } = await getSupabaseAuthUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: authError ?? "Unauthorized." }, { status: 401 });
  }

  try {
    const { supabase, publicUserId } = await resolvePublicUser(user);
    const workspace = await getOrCreateCareRecordWorkspace(supabase, publicUserId);
    const items = await listCareRecordItems(supabase, workspace.id);

    return NextResponse.json({ workspace, items });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to load Care Records." },
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
    items?: CareRecordItemInput[];
  };

  if (!Array.isArray(body.items) || body.items.length === 0) {
    return NextResponse.json({ error: "At least one reviewed Care Record is required." }, { status: 400 });
  }

  const normalizedInputs = normalizeApprovedCareRecordInputs(body.items);
  if (normalizedInputs.length === 0) {
    return NextResponse.json({ error: "Reviewed records need at least one field or note." }, { status: 400 });
  }

  try {
    const { supabase, publicUserId } = await resolvePublicUser(user);
    const workspace = await getOrCreateCareRecordWorkspace(supabase, publicUserId);
    const savedItems = await insertCareRecordItems(supabase, workspace.id, normalizedInputs);
    const items = await listCareRecordItems(supabase, workspace.id);

    return NextResponse.json({ workspace, savedItems, items });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to save Care Records." },
      { status: 500 }
    );
  }
}
