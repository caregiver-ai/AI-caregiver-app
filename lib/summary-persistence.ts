import { createSupabaseServerClient } from "@/lib/supabase";
import {
  StructuredSectionSummary,
  StructuredSummaryFact,
  SummarySectionTitle,
  StructuredFactKind
} from "@/lib/types";

type SupabaseServerClient = NonNullable<ReturnType<typeof createSupabaseServerClient>>;

type SummaryFactRow = {
  source_turns_hash: string;
  fact_id: string;
  entry_id: string;
  section_title: string;
  fact_kind: string;
  statement: string;
  safety_relevant: boolean | null;
  concept_keys: unknown;
  source_entry_ids: unknown;
};

function stringArrayFromJson(value: unknown) {
  if (!Array.isArray(value)) {
    return [] as string[];
  }

  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
}

function isSummarySectionTitle(value: string): value is SummarySectionTitle {
  return [
    "Communication",
    "Daily Needs & Routines",
    "What helps the day go well",
    "What can upset or overwhelm them",
    "Signs they need help",
    "What helps when they are having a hard time",
    "Health & Safety",
    "Who to contact (and when)"
  ].includes(value);
}

function isStructuredFactKind(value: string): value is StructuredFactKind {
  return [
    "communication_method",
    "communication_signal",
    "support_strategy",
    "routine",
    "trigger",
    "help_sign",
    "caregiver_action",
    "condition",
    "medication",
    "equipment",
    "safety_risk",
    "contact",
    "preference"
  ].includes(value);
}

export async function loadSummaryFactsForSession(
  supabase: SupabaseServerClient,
  sessionId: string
) {
  const { data, error } = await supabase
    .from("summary_facts")
    .select(
      "source_turns_hash, fact_id, entry_id, section_title, fact_kind, statement, safety_relevant, concept_keys, source_entry_ids"
    )
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  const rows = (data ?? []) as SummaryFactRow[];

  return rows
    .map((row) => {
      const sectionTitle = typeof row.section_title === "string" ? row.section_title.trim() : "";
      const factKind = typeof row.fact_kind === "string" ? row.fact_kind.trim() : "";
      const statement = typeof row.statement === "string" ? row.statement.trim() : "";
      const sourceTurnsHash =
        typeof row.source_turns_hash === "string" ? row.source_turns_hash.trim() : "";
      const factId = typeof row.fact_id === "string" ? row.fact_id.trim() : "";
      const entryId = typeof row.entry_id === "string" ? row.entry_id.trim() : "";

      if (
        !factId ||
        !entryId ||
        !statement ||
        !sourceTurnsHash ||
        !isSummarySectionTitle(sectionTitle) ||
        !isStructuredFactKind(factKind)
      ) {
        return null;
      }

      return {
        factId,
        entryId,
        sectionTitle,
        factKind,
        statement,
        safetyRelevant: Boolean(row.safety_relevant),
        conceptKeys: stringArrayFromJson(row.concept_keys),
        sourceEntryIds: stringArrayFromJson(row.source_entry_ids),
        sourceTurnsHash
      } satisfies StructuredSummaryFact;
    })
    .filter((fact): fact is StructuredSummaryFact => Boolean(fact));
}

export async function replaceSummaryFactsForSession(
  supabase: SupabaseServerClient,
  sessionId: string,
  facts: StructuredSummaryFact[]
) {
  const { error: deleteError } = await supabase
    .from("summary_facts")
    .delete()
    .eq("session_id", sessionId);

  if (deleteError) {
    throw new Error(deleteError.message);
  }

  if (facts.length === 0) {
    return;
  }

  const rows = facts.map((fact) => ({
    session_id: sessionId,
    source_turns_hash: fact.sourceTurnsHash,
    fact_id: fact.factId,
    entry_id: fact.entryId,
    section_title: fact.sectionTitle,
    fact_kind: fact.factKind,
    statement: fact.statement,
    safety_relevant: fact.safetyRelevant,
    concept_keys: fact.conceptKeys,
    source_entry_ids: fact.sourceEntryIds
  }));

  const { error: insertError } = await supabase.from("summary_facts").insert(rows);

  if (insertError) {
    throw new Error(insertError.message);
  }
}

export async function replaceSummarySectionSummariesForSession(
  supabase: SupabaseServerClient,
  sessionId: string,
  sectionSummaries: StructuredSectionSummary[]
) {
  const { error: deleteError } = await supabase
    .from("summary_section_summaries")
    .delete()
    .eq("session_id", sessionId);

  if (deleteError) {
    throw new Error(deleteError.message);
  }

  if (sectionSummaries.length === 0) {
    return;
  }

  const rows = sectionSummaries.map((section) => ({
    session_id: sessionId,
    source_turns_hash: section.sourceTurnsHash,
    section_title: section.sectionTitle,
    items_json: section.items
  }));

  const { error: insertError } = await supabase.from("summary_section_summaries").insert(rows);

  if (insertError) {
    throw new Error(insertError.message);
  }
}
