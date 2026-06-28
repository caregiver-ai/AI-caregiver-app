import {
  PREFERRED_SUMMARY_SECTION_ORDER,
  normalizeAuthoritativeStructuredSummary,
} from "@/lib/summary";
import type { CaregiverInsight, SessionDraft, StructuredSummary } from "@/lib/types";

const NO_INFORMATION_PLACEHOLDER = "(No information provided)";

function normalizeItem(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function itemTokens(value: string) {
  return normalizeItem(value)
    .split(" ")
    .filter((token) => token.length > 2);
}

function itemsAreEquivalent(left: string, right: string) {
  const normalizedLeft = normalizeItem(left);
  const normalizedRight = normalizeItem(right);

  if (!normalizedLeft || !normalizedRight) {
    return false;
  }

  if (
    normalizedLeft === normalizedRight ||
    (normalizedLeft.length >= 20 &&
      normalizedRight.length >= 20 &&
      (normalizedLeft.includes(normalizedRight) ||
        normalizedRight.includes(normalizedLeft)))
  ) {
    return true;
  }

  const leftTokens = itemTokens(left);
  const rightTokens = itemTokens(right);
  if (leftTokens.length < 3 || rightTokens.length < 3) {
    return false;
  }

  const overlap = leftTokens.filter((token) => rightTokens.includes(token)).length;
  const union = new Set([...leftTokens, ...rightTokens]).size;
  return union > 0 && overlap / union >= 0.8;
}

function meaningfulItems(summary: StructuredSummary, title: string) {
  return (
    summary.sections
      .find((section) => section.title === title)
      ?.items.filter(
        (item) => normalizeItem(item) !== normalizeItem(NO_INFORMATION_PLACEHOLDER),
      ) ?? []
  );
}

function meaningfulSectionSignature(summary: StructuredSummary, title: string) {
  const section = summary.sections.find((entry) => entry.title === title);
  if (!section) {
    return "";
  }

  return JSON.stringify({
    intro: section.intro ?? "",
    blocks: section.blocks ?? null,
    items: meaningfulItems(summary, title),
  });
}

function applyReviewedInsightEdits(
  current: StructuredSummary,
  previousGenerated: StructuredSummary,
  previousEdited: StructuredSummary,
) {
  const generatedById = new Map(
    (previousGenerated.caregiverInsights ?? []).map((insight) => [insight.insightId, insight]),
  );
  const editedById = new Map(
    (previousEdited.caregiverInsights ?? []).map((insight) => [insight.insightId, insight]),
  );
  const merged = (current.caregiverInsights ?? []).map((insight) => {
    const generated = generatedById.get(insight.insightId);
    const edited = editedById.get(insight.insightId);
    if (
      generated &&
      edited &&
      normalizeItem(generated.statement) !== normalizeItem(edited.statement)
    ) {
      return {
        ...insight,
        statement: edited.statement,
      } satisfies CaregiverInsight;
    }

    return insight;
  });

  for (const edited of previousEdited.caregiverInsights ?? []) {
    if (generatedById.has(edited.insightId)) {
      continue;
    }

    if (!merged.some((insight) => itemsAreEquivalent(insight.statement, edited.statement))) {
      merged.push(edited);
    }
  }

  return merged;
}

export function applyReviewedSummaryEdits(
  currentSummary: StructuredSummary,
  previousGenerated?: StructuredSummary,
  previousEdited?: StructuredSummary,
  nameHint?: string,
) {
  if (!previousGenerated || !previousEdited) {
    return currentSummary;
  }

  const current = normalizeAuthoritativeStructuredSummary(
    currentSummary,
    nameHint,
  );
  const generated = normalizeAuthoritativeStructuredSummary(
    previousGenerated,
    nameHint,
  );
  const edited = normalizeAuthoritativeStructuredSummary(
    previousEdited,
    nameHint,
  );

  const sections = PREFERRED_SUMMARY_SECTION_ORDER.map((title, index) => {
    const currentSection = current.sections.find((section) => section.title === title);
    const editedSection = edited.sections.find((section) => section.title === title);

    if (
      title === "About" &&
      editedSection &&
      meaningfulSectionSignature(generated, title) !== meaningfulSectionSignature(edited, title)
    ) {
      return {
        ...editedSection,
        id: currentSection?.id ?? editedSection.id ?? `section-${index + 1}`,
        title,
      };
    }

    const generatedItems = meaningfulItems(generated, title);
    const editedItems = meaningfulItems(edited, title);
    const currentItems = meaningfulItems(current, title);
    const additions = editedItems.filter(
      (item) =>
        !generatedItems.some((generatedItem) =>
          itemsAreEquivalent(item, generatedItem),
        ),
    );
    const removals = generatedItems.filter(
      (item) =>
        !editedItems.some((editedItem) => itemsAreEquivalent(item, editedItem)),
    );
    const retained = currentItems.filter(
      (item) => !removals.some((removed) => itemsAreEquivalent(item, removed)),
    );

    for (const addition of additions) {
      if (!retained.some((item) => itemsAreEquivalent(item, addition))) {
        retained.push(addition);
      }
    }

    return {
      id: currentSection?.id ?? `section-${index + 1}`,
      title,
      items: retained.length > 0 ? retained : [NO_INFORMATION_PLACEHOLDER],
    };
  });

  return normalizeAuthoritativeStructuredSummary(
    {
      ...current,
      caregiverInsights: applyReviewedInsightEdits(current, generated, edited),
      sections,
    },
    nameHint,
  );
}

export function archiveDraftSummaries(
  draft: SessionDraft,
  archivedAt = new Date().toISOString(),
): SessionDraft {
  if (!draft.structuredSummary && !draft.editedSummary) {
    return draft;
  }

  const archives = draft.summaryArchives ?? [];
  const structuredSignature = JSON.stringify(draft.structuredSummary ?? null);
  const editedSignature = JSON.stringify(draft.editedSummary ?? null);
  const alreadyArchived = archives.some(
    (archive) =>
      JSON.stringify(archive.structuredSummary ?? null) === structuredSignature &&
      JSON.stringify(archive.editedSummary ?? null) === editedSignature,
  );

  if (alreadyArchived) {
    return draft;
  }

  return {
    ...draft,
    summaryArchives: [
      ...archives,
      {
        structuredSummary: draft.structuredSummary,
        editedSummary: draft.editedSummary,
        archivedAt,
        reason: "stale_regeneration",
      },
    ],
  };
}
