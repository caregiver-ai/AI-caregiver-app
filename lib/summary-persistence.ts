import {
  StructuredCaptureFact,
  SummarySectionArtifact
} from "@/lib/summary-generation";

type SupabaseLike = {
  from: (table: string) => any;
};

function missingColumnError(error: { message?: string; code?: string } | null, column: string) {
  if (!error) {
    return false;
  }

  const message = error.message ?? "";
  return error.code === "PGRST204" || message.toLowerCase().includes(column.toLowerCase());
}

function factRows(
  sessionId: string,
  sourceTurnsHash: string,
  facts: StructuredCaptureFact[],
  includeSubcategory: boolean
) {
  return facts.map((fact) => ({
    session_id: sessionId,
    source_turns_hash: sourceTurnsHash,
    fact_id: fact.factId,
    entry_id: fact.entryId,
    section_title: fact.section,
    fact_kind: fact.factKind,
    ...(includeSubcategory ? { subcategory: fact.subcategory } : {}),
    statement: fact.statement,
    safety_relevant: fact.safetyRelevant,
    concept_keys: fact.conceptKeys,
    source_entry_ids: fact.sourceEntryIds
  }));
}

function sectionRows(
  sessionId: string,
  sourceTurnsHash: string,
  sectionSummaries: SummarySectionArtifact[]
) {
  return sectionSummaries.map((section) => ({
    session_id: sessionId,
    source_turns_hash: sourceTurnsHash,
    section_title: section.sectionTitle,
    items_json: section.itemsJson
  }));
}

export async function persistSummarySectionArtifacts({
  supabase,
  sessionId,
  sourceTurnsHash,
  sectionSummaries
}: {
  supabase: SupabaseLike;
  sessionId: string;
  sourceTurnsHash: string;
  sectionSummaries: SummarySectionArtifact[];
}) {
  const sectionsDelete = await supabase
    .from("summary_section_summaries")
    .delete()
    .eq("session_id", sessionId);
  if (sectionsDelete.error) {
    throw new Error(sectionsDelete.error.message ?? "Unable to clear existing section summaries.");
  }

  if (sectionSummaries.length > 0) {
    const sectionInsert = await supabase
      .from("summary_section_summaries")
      .insert(sectionRows(sessionId, sourceTurnsHash, sectionSummaries));
    if (sectionInsert.error) {
      throw new Error(sectionInsert.error.message ?? "Unable to save section summaries.");
    }
  }
}

export async function persistSummaryArtifacts({
  supabase,
  sessionId,
  sourceTurnsHash,
  facts,
  sectionSummaries
}: {
  supabase: SupabaseLike;
  sessionId: string;
  sourceTurnsHash: string;
  facts: StructuredCaptureFact[];
  sectionSummaries: SummarySectionArtifact[];
}) {
  const factsDelete = await supabase.from("summary_facts").delete().eq("session_id", sessionId);
  if (factsDelete.error) {
    throw new Error(factsDelete.error.message ?? "Unable to clear existing summary facts.");
  }

  if (facts.length > 0) {
    const withSubcategory = await supabase
      .from("summary_facts")
      .insert(factRows(sessionId, sourceTurnsHash, facts, true));

    if (withSubcategory.error) {
      if (!missingColumnError(withSubcategory.error, "subcategory")) {
        throw new Error(withSubcategory.error.message ?? "Unable to save summary facts.");
      }

      const withoutSubcategory = await supabase
        .from("summary_facts")
        .insert(factRows(sessionId, sourceTurnsHash, facts, false));
      if (withoutSubcategory.error) {
        throw new Error(withoutSubcategory.error.message ?? "Unable to save summary facts.");
      }
    }
  }

  await persistSummarySectionArtifacts({
    supabase,
    sessionId,
    sourceTurnsHash,
    sectionSummaries
  });
}
