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

const PREFERRED_SUMMARY_SECTION_ORDER = [
  "Communication",
  "Daily Needs & Routines",
  "What helps the day go well",
  "What can upset or overwhelm them",
  "Signs they need help",
  "What helps when they are having a hard time",
  "Health & Safety",
  "Who to contact (and when)"
] as const;

const CONTACT_PATTERN =
  /\b(911|emergency|non-?emergenc|guardian|doctor|contact|call right away|call first|crisis support)\b/i;
const HEALTH_AND_SAFETY_PATTERN =
  /\b(allerg|medicat|medicine|dose|doctor|seizure|asthma|diabet|gi issues?|medical|wheelchair|hearing aids?|glasses|feeding tube|brace|equipment|safety|unsafe|supervision|risk)\b/i;
const HARD_TIME_SUPPORT_PATTERN =
  /\b(quieter space|another room|outside|car ride|turn(?:ing)? off tv|lowering voices|dim lights|headphones|music|fidget|weighted blanket|snack|drink|stay with|support communication|sensory supports?|brushing|preferred treat|basic needs)\b/i;
const SIGNS_NEED_HELP_PATTERN =
  /\b(covering ears|covering eyes|breathing changes?|low energy|guarding|staring|not responding|blinking|fluttering|stiffening|jerking|pacing|yelling|becoming quieter|aggression|self-injury|withdrawing|running away|repetitive movements|changes in eating|talking less|unable to answer|pain|hungry|hunger|toilet|bathroom)\b/i;
const UPSET_OR_OVERWHELM_PATTERN =
  /\b(trigger|upset|overwhelm|plans change|without warning|stopping an activity|switching activities|unexpected visitors|unexpected outings|loud noise|bright lights|crowded places?|strong smells?|too many people|too close|unfamiliar people|poor sleep|tired|tiredness)\b/i;
const DAILY_NEEDS_PATTERN =
  /\b(routine|morning|breakfast|meal|meals|snack|snacks|bedtime|bath|shower|brush teeth|transition|countdown|visual schedule|medication before|with food|crushed|liquid|reminders?)\b/i;
const COMMUNICATION_PATTERN =
  /\b(communicat|gesture|gestures|pointing|leading you|pictures?|device|writing|words?|sounds?|phrase|phrases|mean|attention)\b/i;
const WHAT_HELPS_DAY_GO_WELL_PATTERN =
  /\b(choices instead of open-ended questions|waiting before repeating|written questions|images|walks?|ipad|sensory swing|sports|crafts|games|videos|quiet time|downtime|resting|low lights|sensory space)\b/i;

const FALLBACK_STEP_TO_SECTION_TITLE: Record<string, (typeof PREFERRED_SUMMARY_SECTION_ORDER)[number]> = {
  communication: "Communication",
  daily_schedule: "Daily Needs & Routines",
  activities_preferences: "What helps the day go well",
  upset_overwhelm: "What can upset or overwhelm them",
  signs_need_help: "Signs they need help",
  hard_time_support: "What helps when they are having a hard time",
  health_safety: "Health & Safety",
  who_to_contact: "Who to contact (and when)"
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

function canonicalizeSectionTitle(title: string) {
  const normalized = title.trim();

  if (/^communication$/i.test(normalized)) {
    return "Communication";
  }

  if (/^daily needs(?: and| &) routines$/i.test(normalized)) {
    return "Daily Needs & Routines";
  }

  if (/^what helps the day go well$/i.test(normalized)) {
    return "What helps the day go well";
  }

  if (/^what can upset or overwhelm(?: (them|him|her))?$/i.test(normalized)) {
    return "What can upset or overwhelm them";
  }

  if (/^signs (they|he|she)(?: may)? need(?:s)? help$/i.test(normalized)) {
    return "Signs they need help";
  }

  if (/^what helps when (they|he|she) (are|is) having a hard time$/i.test(normalized)) {
    return "What helps when they are having a hard time";
  }

  if (/^health(?: and| &) safety$/i.test(normalized)) {
    return "Health & Safety";
  }

  if (/^who to contact(?: \(and when\)| and when)?$/i.test(normalized)) {
    return "Who to contact (and when)";
  }

  return normalized;
}

function sortAndMergeSections(sections: SummarySection[]) {
  const merged = new Map<string, SummarySection>();

  for (const section of sections) {
    const title = canonicalizeSectionTitle(section.title);
    const key = title.toLowerCase();
    const existing = merged.get(key);

    if (existing) {
      existing.items = limitItems([...existing.items, ...section.items]);
      continue;
    }

    merged.set(key, {
      ...section,
      title,
      items: limitItems(section.items)
    });
  }

  const orderedTitles = new Map(
    PREFERRED_SUMMARY_SECTION_ORDER.map((title, index) => [title.toLowerCase(), index])
  );

  return [...merged.values()].sort((left, right) => {
    const leftOrder = orderedTitles.get(left.title.toLowerCase()) ?? Number.MAX_SAFE_INTEGER;
    const rightOrder = orderedTitles.get(right.title.toLowerCase()) ?? Number.MAX_SAFE_INTEGER;

    if (leftOrder !== rightOrder) {
      return leftOrder - rightOrder;
    }

    return left.title.localeCompare(right.title);
  });
}

function normalizeSection(input: unknown, index: number): SummarySection | null {
  const candidate = input as Partial<SummarySection> | undefined;
  const title =
    typeof candidate?.title === "string" ? canonicalizeSectionTitle(candidate.title) : "";
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
    sections: sortAndMergeSections(legacySections),
    generatedAt: ""
  };
}

function splitTurnIntoStatements(turn: ConversationTurn) {
  return splitSentences(turn.content)
    .map((statement) =>
      statement
        .replace(/^[\-\u2022*]+\s*/u, "")
        .replace(/\s+/g, " ")
        .trim()
    )
    .filter(Boolean);
}

function inferFallbackSectionTitle(turn: ConversationTurn, statement: string) {
  if (CONTACT_PATTERN.test(statement)) {
    return "Who to contact (and when)";
  }

  if (HEALTH_AND_SAFETY_PATTERN.test(statement)) {
    return "Health & Safety";
  }

  if (HARD_TIME_SUPPORT_PATTERN.test(statement)) {
    return "What helps when they are having a hard time";
  }

  if (SIGNS_NEED_HELP_PATTERN.test(statement)) {
    return "Signs they need help";
  }

  if (UPSET_OR_OVERWHELM_PATTERN.test(statement)) {
    return "What can upset or overwhelm them";
  }

  if (COMMUNICATION_PATTERN.test(statement)) {
    return "Communication";
  }

  const stepMatch = turn.stepId ? FALLBACK_STEP_TO_SECTION_TITLE[turn.stepId] : undefined;
  if (stepMatch) {
    return stepMatch;
  }

  if (DAILY_NEEDS_PATTERN.test(statement)) {
    return "Daily Needs & Routines";
  }

  if (WHAT_HELPS_DAY_GO_WELL_PATTERN.test(statement)) {
    return "What helps the day go well";
  }

  return null;
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
  const sectionBuckets = new Map<string, string[]>();

  for (const turn of turns) {
    if (turn.role !== "user" || turn.skipped) {
      continue;
    }

    const statements = splitTurnIntoStatements(turn);

    for (const statement of statements) {
      const title = inferFallbackSectionTitle(turn, statement);
      if (!title) {
        continue;
      }

      const existing = sectionBuckets.get(title) ?? [];
      existing.push(statement);
      sectionBuckets.set(title, existing);
    }
  }

  const sections = sortAndMergeSections(
    [...sectionBuckets.entries()].map(([title, items], index) => ({
      id: `${slugify(title) || "section"}-${index + 1}`,
      title,
      items: limitItems(items)
    }))
  );

  if (sections.length === 0 && responses.length > 0) {
    const fallbackItems = limitItems(
      turns
        .filter((turn) => turn.role === "user" && !turn.skipped)
        .flatMap((turn) => splitTurnIntoStatements(turn)),
      5
    );

    sections.push({
      id: "caregiver-notes-1",
      title: "Caregiver notes",
      items: fallbackItems
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

const SUMMARY_TIME_ZONE = "America/New_York";

export function formatSummaryGeneratedAt(value: string, language: UiLanguage = "english") {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return new Intl.DateTimeFormat(summaryLocales[language], {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: SUMMARY_TIME_ZONE,
    timeZoneName: "short"
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

    const orderedSections = sortAndMergeSections(sections);

    return {
      title:
        typeof candidate.title === "string" && candidate.title.trim()
          ? candidate.title.trim()
          : defaultSummaryTitle(nameHint),
      overview:
        typeof candidate.overview === "string"
          ? shortenOverview(candidate.overview)
          : buildOverview(orderedSections),
      sections: orderedSections,
      generatedAt:
        typeof candidate.generatedAt === "string" && candidate.generatedAt.trim()
          ? candidate.generatedAt.trim()
          : ""
    };
  }

  return normalizeLegacySummary(candidate, nameHint);
}
