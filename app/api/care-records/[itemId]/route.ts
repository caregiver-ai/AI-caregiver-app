import { NextResponse } from "next/server";
import { resolvePublicUser } from "@/lib/auth-user";
import { CareRecordItemInput } from "@/lib/care-records";
import {
  deleteCareRecordItem,
  getOrCreateCareRecordWorkspace,
  listCareRecordItems,
  updateCareRecordItem
} from "@/lib/care-records-server";
import { getSupabaseAuthUserFromRequest } from "@/lib/supabase";

export async function PATCH(
  request: Request,
  { params }: { params: { itemId: string } }
) {
  const { user, error: authError } = await getSupabaseAuthUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: authError ?? "Unauthorized." }, { status: 401 });
  }

  const body = (await request.json()) as {
    item?: CareRecordItemInput;
  };

  if (!body.item) {
    return NextResponse.json({ error: "Care Record item is required." }, { status: 400 });
  }

  try {
    const { supabase, publicUserId } = await resolvePublicUser(user);
    const workspace = await getOrCreateCareRecordWorkspace(supabase, publicUserId);
    const item = await updateCareRecordItem(supabase, workspace.id, params.itemId, body.item);

    if (!item) {
      return NextResponse.json({ error: "Care Record item not found." }, { status: 404 });
    }

    return NextResponse.json({ item });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to update Care Record." },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: { itemId: string } }
) {
  const { user, error: authError } = await getSupabaseAuthUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: authError ?? "Unauthorized." }, { status: 401 });
  }

  try {
    const { supabase, publicUserId } = await resolvePublicUser(user);
    const workspace = await getOrCreateCareRecordWorkspace(supabase, publicUserId);
    await deleteCareRecordItem(supabase, workspace.id, params.itemId);
    const items = await listCareRecordItems(supabase, workspace.id);

    return NextResponse.json({ ok: true, items });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to delete Care Record." },
      { status: 500 }
    );
  }
}
