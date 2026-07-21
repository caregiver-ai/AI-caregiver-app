import {
  CareRecordItem,
  CareRecordItemInput,
  CareRecordWorkspace,
  normalizeCareRecordCategory,
  normalizeCareRecordFields,
  normalizeCareRecordItemInput,
  normalizeCareRecordSourceType
} from "@/lib/care-records";

type SupabaseLike = {
  from: (table: string) => any;
};

type WorkspaceRow = {
  id: string;
  status: string;
  created_at: string;
  updated_at: string;
};

type ItemRow = {
  id: string;
  workspace_id: string;
  category: string;
  title: string;
  fields_json: unknown;
  notes: string | null;
  source_type: string | null;
  source_label: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
};

function mapWorkspace(row: WorkspaceRow): CareRecordWorkspace {
  return {
    id: row.id,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function mapCareRecordItem(row: ItemRow): CareRecordItem {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    category: normalizeCareRecordCategory(row.category),
    title: row.title,
    fields: normalizeCareRecordFields(row.fields_json),
    notes: row.notes ?? "",
    sourceType: normalizeCareRecordSourceType(row.source_type),
    sourceLabel: row.source_label ?? "Caregiver entry",
    reviewedAt: row.reviewed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export async function getOrCreateCareRecordWorkspace(
  supabase: SupabaseLike,
  publicUserId: string
) {
  const existing = await supabase
    .from("care_record_workspaces")
    .select("id, status, created_at, updated_at")
    .eq("user_id", publicUserId)
    .maybeSingle();

  if (existing.error) {
    throw new Error(existing.error.message ?? "Unable to load Care Records workspace.");
  }

  if (existing.data) {
    return mapWorkspace(existing.data as WorkspaceRow);
  }

  const inserted = await supabase
    .from("care_record_workspaces")
    .insert({
      user_id: publicUserId,
      status: "active"
    })
    .select("id, status, created_at, updated_at")
    .single();

  if (inserted.error) {
    if (!String(inserted.error.message ?? "").toLowerCase().includes("duplicate")) {
      throw new Error(inserted.error.message ?? "Unable to create Care Records workspace.");
    }

    const retry = await supabase
      .from("care_record_workspaces")
      .select("id, status, created_at, updated_at")
      .eq("user_id", publicUserId)
      .single();

    if (retry.error) {
      throw new Error(retry.error.message ?? "Unable to load Care Records workspace.");
    }

    return mapWorkspace(retry.data as WorkspaceRow);
  }

  return mapWorkspace(inserted.data as WorkspaceRow);
}

export async function listCareRecordItems(supabase: SupabaseLike, workspaceId: string) {
  const { data, error } = await supabase
    .from("care_record_items")
    .select(
      "id, workspace_id, category, title, fields_json, notes, source_type, source_label, reviewed_at, created_at, updated_at"
    )
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(error.message ?? "Unable to load Care Records.");
  }

  return ((data ?? []) as ItemRow[]).map(mapCareRecordItem);
}

export async function insertCareRecordItems(
  supabase: SupabaseLike,
  workspaceId: string,
  inputs: CareRecordItemInput[]
) {
  const reviewedAt = new Date().toISOString();
  const rows = inputs.map((input) => {
    const item = normalizeCareRecordItemInput(input);

    return {
      workspace_id: workspaceId,
      category: item.category,
      title: item.title,
      fields_json: item.fields,
      notes: item.notes,
      source_type: item.sourceType,
      source_label: item.sourceLabel,
      reviewed_at: reviewedAt,
      updated_at: reviewedAt
    };
  });

  if (rows.length === 0) {
    return [];
  }

  const { data, error } = await supabase
    .from("care_record_items")
    .insert(rows)
    .select(
      "id, workspace_id, category, title, fields_json, notes, source_type, source_label, reviewed_at, created_at, updated_at"
    );

  if (error) {
    throw new Error(error.message ?? "Unable to save Care Records.");
  }

  await supabase
    .from("care_record_workspaces")
    .update({ status: "active", updated_at: reviewedAt })
    .eq("id", workspaceId);

  return ((data ?? []) as ItemRow[]).map(mapCareRecordItem);
}

export async function updateCareRecordItem(
  supabase: SupabaseLike,
  workspaceId: string,
  itemId: string,
  input: CareRecordItemInput
) {
  const item = normalizeCareRecordItemInput(input);
  const updatedAt = new Date().toISOString();
  const { data, error } = await supabase
    .from("care_record_items")
    .update({
      category: item.category,
      title: item.title,
      fields_json: item.fields,
      notes: item.notes,
      source_type: item.sourceType,
      source_label: item.sourceLabel,
      reviewed_at: updatedAt,
      updated_at: updatedAt
    })
    .eq("workspace_id", workspaceId)
    .eq("id", itemId)
    .select(
      "id, workspace_id, category, title, fields_json, notes, source_type, source_label, reviewed_at, created_at, updated_at"
    )
    .maybeSingle();

  if (error) {
    throw new Error(error.message ?? "Unable to update Care Record.");
  }

  if (!data) {
    return null;
  }

  return mapCareRecordItem(data as ItemRow);
}

export async function deleteCareRecordItem(
  supabase: SupabaseLike,
  workspaceId: string,
  itemId: string
) {
  const { error } = await supabase
    .from("care_record_items")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("id", itemId);

  if (error) {
    throw new Error(error.message ?? "Unable to delete Care Record.");
  }
}
