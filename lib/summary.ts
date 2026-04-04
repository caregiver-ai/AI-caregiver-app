import { EMPTY_SUMMARY } from "@/lib/constants";
import { ConversationTurn, StructuredSummary, SummarySection, UiLanguage } from "@/lib/types";

type LegacyStructuredSummary = {
  key_barriers?: unknown;
  emotional_concerns?: unknown;
  safety_considerations?: unknown;
  past_negative_experiences?: unknown;
  situations_to_avoid?: unknown;
  conditions_for_successful_respite?: unknown;
  unresolved_questions?: unknown;
  caregiver_summary_text?: unknown;
};

function userResponses(turns: ConversationTurn[]) {
  return turns
    .filter((turn) => turn.role === "user" && !turn.skipped)
    .map((turn) => turn.content.trim())
    .filter(Boolean);
}

function splitSentences(text: string) {
  return text
    .split(/[.;\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function dedupe(items: string[]) {
  const seen = new Set<string>();

  return items.filter((item) => {
    const key = item.toLowerCase();
    if (!item || seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function limitItems(items: string[], limit = 5) {
  return dedupe(
    items
      .map((item) => item.trim())
      .filter(Boolean)
  ).slice(0, limit);
}

function shortenOverview(text: string) {
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 2);

  const combined = sentences.join(" ");
  if (!combined) {
    return "";
  }

  const words = combined.split(/\s+/).filter(Boolean);
  if (words.length <= 70) {
    return combined;
  }

  return `${words.slice(0, 70).join(" ").replace(/[,\s;:]+$/, "")}.`;
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function defaultSummaryTitle(nameHint?: string) {
  return nameHint ? `Caring for ${nameHint}` : "Caregiver Handoff Summary";
}

function normalizeSection(input: unknown, index: number): SummarySection | null {
  const candidate = input as Partial<SummarySection> | undefined;
  const title = typeof candidate?.title === "string" ? candidate.title.trim() : "";
  const items = Array.isArray(candidate?.items) ? limitItems(candidate.items.map(String)) : [];

  if (!title || items.length === 0) {
    return null;
  }

  const normalizedId =
    typeof candidate?.id === "string" && candidate.id.trim()
      ? candidate.id.trim()
      : `${slugify(title) || "section"}-${index + 1}`;

  return {
    id: normalizedId,
    title,
    items
  };
}

function coerceStringArray(value: unknown) {
  return Array.isArray(value) ? limitItems(value.map(String)) : [];
}

function normalizeLegacySummary(input: LegacyStructuredSummary, nameHint?: string): StructuredSummary {
  const rawLegacySections = [
    { title: "Key barriers", items: coerceStringArray(input.key_barriers) },
    { title: "Emotional concerns", items: coerceStringArray(input.emotional_concerns) },
    { title: "Safety considerations", items: coerceStringArray(input.safety_considerations) },
    { title: "Past negative experiences", items: coerceStringArray(input.past_negative_experiences) },
    { title: "Situations to avoid", items: coerceStringArray(input.situations_to_avoid) },
    {
      title: "Conditions for successful respite",
      items: coerceStringArray(input.conditions_for_successful_respite)
    },
    { title: "Unresolved questions", items: coerceStringArray(input.unresolved_questions) }
  ];

  const legacySections: SummarySection[] = rawLegacySections
    .filter((section) => section.items.length > 0)
    .map((section, index) => ({
      id: `${slugify(section.title) || "section"}-${index + 1}`,
      title: section.title,
      items: section.items
    }));

  return {
    title: defaultSummaryTitle(nameHint),
    overview:
      typeof input.caregiver_summary_text === "string"
        ? shortenOverview(input.caregiver_summary_text)
        : "",
    sections: legacySections,
    generatedAt: ""
  };
}

function matchesSentences(sentences: string[], pattern: RegExp, limit = 4) {
  return limitItems(
    sentences
      .filter((sentence) => pattern.test(sentence))
      .map((sentence) => sentence.replace(/\s+/g, " ").trim()),
    limit
  );
}

function buildOverview(sections: SummarySection[]) {
  const firstSection = sections[0];
  const secondSection = sections[1];

  if (!firstSection) {
    return "This summary highlights the most important caregiver handoff details that were shared.";
  }

  const fragments = [
    firstSection.items[0] ? `${firstSection.title}: ${firstSection.items[0]}` : "",
    secondSection?.items[0] ? `${secondSection.title}: ${secondSection.items[0]}` : ""
  ].filter(Boolean);

  if (fragments.length === 0) {
    return "This summary highlights the most important caregiver handoff details that were shared.";
  }

  return shortenOverview(fragments.join(". "));
}

export function buildFallbackSummary(
  turns: ConversationTurn[],
  nameHint?: string
): StructuredSummary {
  const responses = userResponses(turns);
  const sentences = splitSentences(responses.join(". "));

  const sectionDefinitions: Array<{ title: string; pattern: RegExp }> = [
    {
      title: "Communication",
      pattern:
        /(non[- ]speaking|communicat|aac|device|ipad|touch ?chat|gesture|sound|word|lead you|attention)/i
    },
    {
      title: "Daily needs and routines",
      pattern:
        /(bathroom|toilet|pull ?up|speaker|hour|routine|meal|snack|food|hungry|fridge|cheese|prompt|remind)/i
    },
    {
      title: "What helps",
      pattern: /(calm|soothe|car ride|walk|preferred|likes to go|helps when|settle)/i
    },
    {
      title: "Signs they need help",
      pattern: /(upset|angry|yell|scream|elope|run away|bite|dysreg|grunt|hide|hiding)/i
    },
    {
      title: "Safety notes",
      pattern: /(safety|two people|at least two|supervision|elop|unsafe|bite you)/i
    }
  ];

  const sections = sectionDefinitions
    .map((definition, index) => {
      const items = matchesSentences(sentences, definition.pattern);
      if (items.length === 0) {
        return null;
      }

      return {
        id: `${slugify(definition.title) || "section"}-${index + 1}`,
        title: definition.title,
        items
      };
    })
    .filter((section): section is SummarySection => Boolean(section));

  if (sections.length === 0 && responses.length > 0) {
    sections.push({
      id: "caregiver-notes-1",
      title: "Caregiver notes",
      items: limitItems(sentences, 5)
    });
  }

  return {
    ...EMPTY_SUMMARY,
    title: defaultSummaryTitle(nameHint),
    overview: buildOverview(sections),
    sections,
    generatedAt: ""
  };
}

const summaryLocales: Record<UiLanguage, string> = {
  english: "en-US",
  spanish: "es-US",
  mandarin: "zh-CN"
};

export function formatSummaryGeneratedAt(value: string, language: UiLanguage = "english") {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return new Intl.DateTimeFormat(summaryLocales[language], {
    dateStyle: "long",
    timeStyle: "short"
  }).format(date);
}

export function summaryToPlainText(summary: StructuredSummary) {
  const overview = summary.overview.trim();
  if (overview) {
    return overview;
  }

  const flattenedItems = summary.sections.flatMap((section) => section.items);
  if (flattenedItems.length > 0) {
    return shortenOverview(flattenedItems.slice(0, 2).join(". "));
  }

  return summary.title.trim() || defaultSummaryTitle();
}

export function normalizeStructuredSummary(input: unknown, nameHint?: string): StructuredSummary {
  const candidate = input as Partial<StructuredSummary & LegacyStructuredSummary> | undefined;

  if (!candidate) {
    return {
      ...EMPTY_SUMMARY,
      title: defaultSummaryTitle(nameHint)
    };
  }

  if (Array.isArray(candidate.sections) || typeof candidate.title === "string" || typeof candidate.overview === "string") {
    const sections = Array.isArray(candidate.sections)
      ? candidate.sections
          .map((section, index) => normalizeSection(section, index))
          .filter((section): section is SummarySection => Boolean(section))
      : [];

    return {
      title:
        typeof candidate.title === "string" && candidate.title.trim()
          ? candidate.title.trim()
          : defaultSummaryTitle(nameHint),
      overview:
        typeof candidate.overview === "string" ? shortenOverview(candidate.overview) : buildOverview(sections),
      sections,
      generatedAt:
        typeof candidate.generatedAt === "string" && candidate.generatedAt.trim()
          ? candidate.generatedAt.trim()
          : ""
    };
  }

  return normalizeLegacySummary(candidate, nameHint);
}
