import { EMPTY_SUMMARY } from "@/lib/constants";
import { deriveItemsFromBlocks, hydrateStructuredSection } from "@/lib/summary-structured";
import { ConversationTurn, StructuredSummary, SummarySection, UiLanguage } from "@/lib/types";

const NO_INFORMATION_PLACEHOLDER = "(No information provided)";
const OVERVIEW_LABELS = [
  "Communication",
  "Key Needs",
  "Top Risks",
  "Best Supports",
  "Emergency Contact"
] as const;

export const PREFERRED_SUMMARY_SECTION_ORDER = [
  "Communication",
  "Understanding and Learning",
  "Daily Schedule",
  "Activities & Preferences",
  "Signs They Are Having a Hard Time",
  "What helps when they are having a hard time",
  "Health & Safety"
] as const;

type PreferredSummarySectionTitle = (typeof PREFERRED_SUMMARY_SECTION_ORDER)[number];

const GENERATED_SUMMARY_SECTION_FIELDS = [
  { key: "communication", title: "Communication" },
  { key: "understandingAndLearning", title: "Understanding and Learning" },
  { key: "dailySchedule", title: "Daily Schedule" },
  { key: "activitiesAndPreferences", title: "Activities & Preferences" },
  { key: "signsTheyAreHavingAHardTime", title: "Signs They Are Having a Hard Time" },
  {
    key: "whatHelpsWhenTheyAreHavingAHardTime",
    title: "What helps when they are having a hard time"
  },
  { key: "healthAndSafety", title: "Health & Safety" }
] as const;

type GeneratedSummarySectionKey = (typeof GENERATED_SUMMARY_SECTION_FIELDS)[number]["key"];

type GeneratedStructuredSummary = {
  title?: unknown;
  overview?: unknown;
  generatedAt?: unknown;
} & Partial<Record<GeneratedSummarySectionKey, unknown>>;

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

type SummaryNormalizationOptions = {
  reclassify?: boolean;
  semanticRepair?: boolean;
};

const CONTACT_PATTERN =
  /\b(911|emergency|non-?emergenc|guardian|doctor|nurse|contact|call right away|call first|phone|crisis support)\b/i;
const STRONG_HEALTH_PATTERN =
  /\b(allerg|diagnos|disabil|condition|medicat|medicine|dose|seizure|epilep|asthma|diabet|wheelchair|hearing aid|glasses|feeding tube|brace|cane|equipment|pica|autism|syndrome|cerebral palsy|adhd|dementia|vision|hearing loss)\b/i;
const HEALTH_PATTERN =
  /\b(allerg|diagnos|disabil|condition|medicat|medicine|dose|seizure|epilep|asthma|diabet|wheelchair|hearing aid|glasses|feeding tube|brace|cane|equipment|supervision|safety|unsafe|risk|wander|pica|autism|syndrome|cerebral palsy|adhd|dementia|vision|hearing loss)\b/i;
const LEARNING_PATTERN =
  /\b(learn|understand|process(?:ing)?|read|write|literacy|one-step|two-step|direction|extra time|express|consequence|decision|recognizes? (?:pictures?|words?)|independent)\b/i;
const HARD_TIME_SUPPORT_PATTERN =
  /\b(help|calm|quieter|reduce noise|dim lights|give space|stay nearby|headphones|music|fidget|weighted blanket|favorite item|favorite drink|favorite snack|countdown|timer|visual schedule|written schedule|reassur|incentive|car ride|go outside|transition)\b/i;
const HARD_TIME_SIGNS_PATTERN =
  /\b(hard time|trigger|upset|overwhelm|routine change|waiting|rushed|loud noise|crowded|hunger|thirst|pain|poor sleep|illness|too hot|too cold|low energy|limp(?:s|ed|ing)?|not eating|not drinking|breathing change|covering ears|covering eyes|staring|not responding|stiffen|jerk|pacing|repetitive|yelling|quieter|aggression|self-injury|hand biting|angry vocalizations?|press(?:es|ed|ing)? help|withdraw|running away|elop(?:e|es|ed|ing|ement)?|hiding|grunting|repeat(?:ing)? words|difficulty communicating)\b/i;
const DAILY_PATTERN =
  /\b(daily|routine|morning|wake|bathroom|toilet|toileting|pull-?up|bowel movement|shower|dress|groom|deodorant|breakfast|meal|snack|eat|drink|bedtime|blanket|lights out|brush(?:ing)? teeth|prepar(?:e|ing) for work|school|day program|reminder)\b/i;
const COMMUNICATION_PATTERN =
  /\b(communicat|speak|speaking|sound|gesture|point|sign language|aac|touchchat|communication device|writing|texting|limited choices|visual choices|simple language|waiting before repeating|pictures|demonstration|means?|lead(?:s|ing)? (?:you|a caregiver|caregivers|them|him|her)|sitting close|attention)\b/i;
const ACTIVITIES_PATTERN =
  /\b(activit|enjoy|favorite|music|animal|book|technology|ipad|phone|video game|art|shopping|game|sport|walk|restaurant|community|friend|family|pet|caregiver|outside the home|car ride)\b/i;
const QUESTION_ECHO_PATTERN =
  /^(what|who|how|when|where|why|are|do|does|did|is|can|could|should|would)\b.*\?$/i;
const NON_ANSWER_PATTERN =
  /^(?:use skip|skip|n\/a|na|none|unknown|not sure|not stated|not provided|no information)$/i;

const FALLBACK_STEP_TO_SECTION_TITLE: Record<string, PreferredSummarySectionTitle> = {
  communication: "Communication",
  understanding_learning: "Understanding and Learning",
  daily_schedule: "Daily Schedule",
  activities_preferences: "Activities & Preferences",
  upset_overwhelm: "Signs They Are Having a Hard Time",
  signs_need_help: "Signs They Are Having a Hard Time",
  hard_time_support: "What helps when they are having a hard time",
  health_safety: "Health & Safety",
  who_to_contact: "Health & Safety"
};

function compactWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function isNoInformationItem(value: string) {
  return (
    compactWhitespace(value).replace(/[.!?]+$/, "").toLowerCase() ===
    NO_INFORMATION_PLACEHOLDER.toLowerCase()
  );
}

function cleanSummaryItem(value: string) {
  const cleaned = compactWhitespace(value.replace(/^[\-\u2022*]+\s*/u, ""))
    .replace(/\bTouchchat\b/gi, "TouchChat")
    .replace(/\bIpad\b/g, "iPad")
    .replace(/\b(\d{1,2}:\d{2})\s*a\.(?=\s|$)/gi, "$1 a.m.")
    .replace(/\b(\d{1,2}:\d{2})\s*p\.(?=\s|$)/gi, "$1 p.m.");
  if (!cleaned || QUESTION_ECHO_PATTERN.test(cleaned) || NON_ANSWER_PATTERN.test(cleaned)) {
    return null;
  }

  if (isNoInformationItem(cleaned)) {
    return NO_INFORMATION_PLACEHOLDER;
  }

  return /[.!?]$/.test(cleaned) ? cleaned : `${cleaned}.`;
}

const COMPARISON_STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "for",
  "from",
  "he",
  "her",
  "him",
  "his",
  "in",
  "is",
  "it",
  "may",
  "of",
  "on",
  "or",
  "she",
  "that",
  "the",
  "their",
  "them",
  "they",
  "this",
  "to",
  "when",
  "with"
]);

function normalizeComparisonText(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function comparisonTokens(value: string) {
  return normalizeComparisonText(value)
    .split(" ")
    .filter((token) => token.length > 2 && !COMPARISON_STOPWORDS.has(token));
}

function itemsAreNearDuplicate(left: string, right: string) {
  const normalizedLeft = normalizeComparisonText(left);
  const normalizedRight = normalizeComparisonText(right);
  if (!normalizedLeft || !normalizedRight) {
    return false;
  }

  if (
    normalizedLeft === normalizedRight ||
    (normalizedLeft.length >= 24 &&
      normalizedRight.length >= 24 &&
      (normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft)))
  ) {
    return true;
  }

  const leftTokens = comparisonTokens(left);
  const rightTokens = comparisonTokens(right);
  if (leftTokens.length < 4 || rightTokens.length < 4) {
    return false;
  }

  const overlap = leftTokens.filter((token) => rightTokens.includes(token)).length;
  const union = new Set([...leftTokens, ...rightTokens]).size;
  return union > 0 && overlap / union >= 0.82;
}

function uniqueItems(values: string[]) {
  const items: string[] = [];

  for (const value of values) {
    const cleaned = cleanSummaryItem(value);
    if (!cleaned) {
      continue;
    }

    const duplicateIndices = items.flatMap((item, index) =>
      itemsAreNearDuplicate(item, cleaned) ? [index] : []
    );
    if (duplicateIndices.length === 0) {
      items.push(cleaned);
      continue;
    }

    const candidates = [cleaned, ...duplicateIndices.map((index) => items[index])];
    const preferred = candidates.sort((left, right) => right.length - left.length)[0];
    for (const index of duplicateIndices.sort((left, right) => right - left)) {
      items.splice(index, 1);
    }
    items.push(preferred);
  }

  return items;
}

function formatList(items: string[]) {
  if (items.length === 1) {
    return items[0];
  }

  if (items.length === 2) {
    return `${items[0]} and ${items[1]}`;
  }

  return `${items.slice(0, -1).join(", ")}, and ${items.at(-1)}`;
}

function lowercaseFirst(value: string) {
  return value ? `${value.charAt(0).toLowerCase()}${value.slice(1)}` : value;
}

function replaceItemGroup(
  items: string[],
  predicate: (item: string) => boolean,
  replacement: (matched: string[]) => string | null
) {
  const matched = items.filter(predicate);
  const combined = replacement(matched);
  if (!combined || matched.length < 2) {
    return items;
  }

  const firstIndex = items.findIndex(predicate);
  const matchedSet = new Set(matched);
  const remaining = items.filter((item) => !matchedSet.has(item));
  remaining.splice(firstIndex, 0, combined);
  return remaining;
}

function condenseHardTimeSigns(items: string[]) {
  let condensed = replaceItemGroup(
    items,
    (item) => /\b(?:can|may) (?:upset|overwhelm)\b/i.test(item),
    (matched) => {
      if (matched.length < 3) {
        return null;
      }

      const situations = matched.map((item) =>
        lowercaseFirst(
          item
            .replace(/\s+(?:can|may)\s+(?:upset|overwhelm).*$/i, "")
            .replace(/[.!?]+$/, "")
        )
      );
      return `Situations that can be hard include ${formatList(situations)}.`;
    }
  );

  condensed = replaceItemGroup(
    condensed,
    (item) =>
      /^(?:limping|low energy|not eating|not drinking|not eating or not drinking)\b/i.test(item) &&
      /\bsign\b/i.test(item),
    (matched) => {
      const signs = matched.map((item) =>
        lowercaseFirst(
          item.replace(/\s+(?:is|are) (?:a )?sign.*$/i, "").replace(/[.!?]+$/, "")
        )
      );
      return signs.length >= 2
        ? `Physical signs that may mean help is needed include ${formatList(signs)}.`
        : null;
    }
  );

  condensed = replaceItemGroup(
    condensed,
    (item) =>
      !/^(?:do not|don't)\b/i.test(item) &&
      (
        /^Behavior or communication signs that may mean help is needed include\b/i.test(item) ||
        (
          /^(?:eloping|hand biting|angry vocalizations|pressing help)\b/i.test(item) &&
          /\b(?:sign|means? .*needs? help)\b/i.test(item)
        )
      ),
    (matched) => {
      const text = matched.join(" ");
      const signs = [
        /\beloping\b/i.test(text) ? "eloping" : "",
        /\bhand biting\b/i.test(text) ? "hand biting" : "",
        /\bangry vocalizations\b/i.test(text) ? "angry vocalizations" : "",
        /\bpressing help\b/i.test(text) ? "pressing Help on the communication device" : ""
      ].filter(Boolean);
      return signs.length >= 2
        ? `Behavior or communication signs that may mean help is needed include ${formatList(signs)}.`
        : null;
    }
  );

  condensed = replaceItemGroup(
    condensed,
    (item) =>
      /\b(?:hid(?:e|es|ing)|grunt(?:s|ing)?)\b/i.test(item) &&
      /\bbowel movements?\b/i.test(item),
    (matched) =>
      matched.length >= 2
        ? "Hiding or grunting may mean they are having a bowel movement."
        : null
  );

  const behaviorSummary = condensed.find((item) =>
    /^Behavior or communication signs that may mean help is needed include\b/i.test(item)
  );
  const bowelSummary = condensed.find((item) =>
    /^Hiding or grunting may mean\b/i.test(item)
  );

  return condensed.filter((item) => {
    if (item === behaviorSummary || item === bowelSummary) {
      return true;
    }

    if (behaviorSummary) {
      const sign = item.match(
        /^(eloping|hand biting|angry vocalizations|pressing help)\b/i
      )?.[1];
      if (sign && behaviorSummary.toLowerCase().includes(sign.toLowerCase())) {
        return false;
      }
    }

    if (bowelSummary && /^(?:hiding|grunting)\b/i.test(item)) {
      return false;
    }

    return true;
  });
}

function condenseCommunication(items: string[]) {
  return replaceItemGroup(
    items,
    (item) => /\b(?:aac|touchchat|communication device)\b/i.test(item),
    (matched) => {
      const text = matched.join(" ");
      const name = matched
        .map((item) => item.match(/^([A-Z][A-Za-z'-]+)\b/)?.[1] ?? "")
        .find((candidate) => candidate && !/^(?:He|She|They|On|The|An)$/i.test(candidate));
      const subject = name || "They";
      const device = [
        "an AAC device",
        /\b(?:device )?on an ipad\b/i.test(text) ? "on an iPad" : "",
        /\btouchchat\b/i.test(text) ? "with TouchChat" : ""
      ].filter(Boolean).join(" ");
      const actions = [
        /\bask(?:s|ing)? for help\b/i.test(text) ? "ask for help" : "",
        /\brequest(?:s|ed|ing)? car rides?\b/i.test(text) ? "request car rides" : "",
        /\b(?:tell|say).{0,35}\b(he|she|they) wants? (his|her|their) ipad\b/i.test(text)
          ? text.replace(
              /^.*?\b(?:tell|say).{0,35}\b(he|she|they) wants? (his|her|their) ipad\b.*$/i,
              "say when $1 wants $2 iPad"
            )
          : ""
      ].filter(Boolean);

      if (actions.length === 0) {
        return `${subject} ${subject === "They" ? "use" : "uses"} ${device}.`;
      }

      return `${subject} ${subject === "They" ? "use" : "uses"} ${device} to ${formatList(actions)}.`;
    }
  );
}

function condenseHardTimeSupports(items: string[]) {
  let condensed = replaceItemGroup(
    items,
    (item) =>
      /\b(?:do not|don't)\b.*\b(?:block|stop)\b.*\b(?:hand|biting)\b/i.test(item),
    (matched) =>
      matched.length >= 2
        ? matched.slice().sort((left, right) => right.length - left.length)[0]
        : null
  );

  condensed = replaceItemGroup(
    condensed,
    (item) => /\b(squeeze and release|deep breaths?|count(?:ing)? to 10)\b/i.test(item),
    (matched) => {
      const text = matched.join(" ");
      const actions = [
        /\bsqueeze and release\b/i.test(text) ? "squeeze and release" : "",
        /\bdeep breaths?\b/i.test(text) ? "deep breaths" : "",
        /\bcount(?:ing)? to 10\b/i.test(text) ? "counting to 10" : ""
      ].filter(Boolean);
      return actions.length >= 2
        ? `When they are still somewhat calm, prompt ${formatList(actions)}.`
        : null;
    }
  );

  condensed = replaceItemGroup(
    condensed,
    (item) =>
      /\b(?:give (?:him|her|them)?\s*space|reduce noise|reduce stimulation|keep .*quiet)\b/i.test(
        item
      ),
    (matched) => {
      const text = matched.join(" ");
      const hasSpace = /\bgive (?:him|her|them)?\s*space\b/i.test(text);
      const hasNoise = /\breduce noise\b/i.test(text);
      const hasStimulation = /\breduce stimulation\b/i.test(text);
      const actions = [
        hasSpace ? "give space" : "",
        hasNoise && hasStimulation
          ? "reduce noise and stimulation"
          : hasNoise
            ? "reduce noise"
            : hasStimulation
              ? "reduce stimulation"
              : ""
      ].filter(Boolean);
      return actions.length >= 2
        ? `If they are escalating, ${formatList(actions)}.`
        : null;
    }
  );

  return replaceItemGroup(
    condensed,
    (item) =>
      /\b(?:resets?|help.*day go well|quiet.*help.*regulat|low-light.*help.*regulat)\b/i.test(
        item
      ) &&
      /\b(?:car rides?|quiet|low-light|time alone)\b/i.test(item),
    (matched) => {
      const text = matched.join(" ");
      const resets = [
        /\bcar rides?\b/i.test(text) ? "car rides" : "",
        /\b(?:quiet|low-light)\b/i.test(text) ? "quiet or low-light environments" : "",
        /\btime alone\b/i.test(text) ? "time alone" : ""
      ].filter(Boolean);
      return resets.length >= 2 ? `Helpful resets include ${formatList(resets)}.` : null;
    }
  );
}

function condenseActivityPreferences(items: string[]) {
  const preferenceItems: Array<{ item: string; preference: string }> = [];

  for (const item of items) {
    const match = item.match(
      /^(?:(?:he|she|they|[A-Z][a-z]+)\s+)?(?:also\s+)?(?:likes?|loves?|enjoys?)\s+(.+?)[.!?]?$/i
    );
    if (match?.[1]) {
      preferenceItems.push({ item, preference: match[1].trim().replace(/[.!?]+$/, "") });
    }
  }

  if (preferenceItems.length < 6) {
    return items;
  }

  const preferenceSet = new Set(preferenceItems.map(({ item }) => item));
  const preferences = uniqueItems(preferenceItems.map(({ preference }) => preference)).map((item) =>
    item.replace(/[.!?]+$/, "")
  );

  return [
    ...items.filter((item) => !preferenceSet.has(item)),
    `Preferred activities include ${formatList(preferences)}.`
  ];
}

function canonicalizeSectionTitle(title: string): PreferredSummarySectionTitle | null {
  const normalized = compactWhitespace(title);

  if (/^communication$/i.test(normalized)) {
    return "Communication";
  }

  if (/^(understanding and learning|learning and understanding)$/i.test(normalized)) {
    return "Understanding and Learning";
  }

  if (/^(daily schedule|daily needs(?: and| &) routines|daily needs to know.*)$/i.test(normalized)) {
    return "Daily Schedule";
  }

  if (
    /^(activities(?: and| &) preferences|what helps the day go well|what .* enjoys?|preferred activities)$/i.test(
      normalized
    )
  ) {
    return "Activities & Preferences";
  }

  if (
    /^(signs .* (?:having a hard time|needs? help)|what can upset(?: or overwhelm)?.*)$/i.test(
      normalized
    )
  ) {
    return "Signs They Are Having a Hard Time";
  }

  if (/^(what helps when .* having a hard time|what to do when .* upset)$/i.test(normalized)) {
    return "What helps when they are having a hard time";
  }

  if (
    /^(health(?: and| &) safety|who to contact.*|contacts?|safety notes.*|medications?.*|equipment.*|health conditions.*)$/i.test(
      normalized
    )
  ) {
    return "Health & Safety";
  }

  return null;
}

function createPlaceholderSection(title: PreferredSummarySectionTitle, index: number): SummarySection {
  return {
    id: `${slugify(title)}-${index + 1}`,
    title,
    items: [NO_INFORMATION_PLACEHOLDER]
  };
}

function sectionItems(section: SummarySection) {
  if (Array.isArray(section.blocks) && section.blocks.length > 0) {
    return deriveItemsFromBlocks(section.blocks);
  }

  return section.items;
}

function normalizeSections(
  sections: SummarySection[],
  { reclassify = false }: SummaryNormalizationOptions = {}
) {
  const buckets = new Map<PreferredSummarySectionTitle, string[]>(
    PREFERRED_SUMMARY_SECTION_ORDER.map((title) => [title, []])
  );

  for (const section of sections) {
    const currentTitle = canonicalizeSectionTitle(section.title);
    if (!currentTitle) {
      continue;
    }

    for (const item of uniqueItems(sectionItems(section))) {
      if (isNoInformationItem(item)) {
        continue;
      }

      const destination = reclassify
        ? inferAuthoritativeSectionTitle(item, currentTitle)
        : currentTitle;
      buckets.get(destination)?.push(item);
    }
  }

  return PREFERRED_SUMMARY_SECTION_ORDER.map((title, index) => {
    const uniqueSectionItems = uniqueItems(buckets.get(title) ?? []);
    const items =
      title === "Communication"
        ? condenseCommunication(uniqueSectionItems)
        : title === "Activities & Preferences"
        ? condenseActivityPreferences(uniqueSectionItems)
        : title === "Signs They Are Having a Hard Time"
          ? condenseHardTimeSigns(uniqueSectionItems)
          : title === "What helps when they are having a hard time"
            ? condenseHardTimeSupports(uniqueSectionItems)
        : uniqueSectionItems;
    return items.length > 0
      ? {
          id: `${slugify(title)}-${index + 1}`,
          title,
          items
        }
      : createPlaceholderSection(title, index);
  });
}

function coerceStringArray(value: unknown) {
  return Array.isArray(value) ? value.map(String) : [];
}

function buildSectionsFromStructuredPayload(candidate: GeneratedStructuredSummary) {
  return GENERATED_SUMMARY_SECTION_FIELDS.map((field, index) => ({
    id: `${slugify(field.title)}-${index + 1}`,
    title: field.title,
    items: coerceStringArray(candidate[field.key])
  }));
}

function defaultSummaryTitle(nameHint?: string) {
  return nameHint?.trim() ? `Caring for ${nameHint.trim()}` : "Caregiver Handoff Summary";
}

function firstMeaningfulItem(sections: SummarySection[], title: PreferredSummarySectionTitle) {
  return (
    sections
      .find((section) => section.title === title)
      ?.items.find((item) => !isNoInformationItem(item)) ?? ""
  );
}

function firstMatchingItem(
  sections: SummarySection[],
  title: PreferredSummarySectionTitle,
  pattern: RegExp
) {
  return (
    sections
      .find((section) => section.title === title)
      ?.items.find((item) => !isNoInformationItem(item) && pattern.test(item)) ?? ""
  );
}

function buildOverview(sections: SummarySection[]) {
  const communicationItems =
    sections
      .find((section) => section.title === "Communication")
      ?.items.filter((item) => !isNoInformationItem(item)) ?? [];
  const communicationMethods = communicationItems
    .filter((item) => /\b(aac|touchchat|communication device|non-speaking|speak)\b/i.test(item))
    .slice(0, 2)
    .join(" ");
  const communication = communicationMethods || communicationItems[0] || "";
  const keyNeeds =
    firstMeaningfulItem(sections, "Understanding and Learning") ||
    firstMeaningfulItem(sections, "Daily Schedule");
  const allItems = sections.flatMap((section) => section.items).join(" ");
  const riskLabels = [
    /\b(?:elopement|eloping|running away|wandering)\b/i.test(allItems)
      ? "elopement"
      : "",
    /\b(?:hand biting|biting (?:his|her|their) hand|self-injury)\b/i.test(allItems)
      ? "hand biting"
      : "",
    /\bunsafe walking\b/i.test(allItems) ? "unsafe walking" : ""
  ].filter(Boolean);
  const topRisks =
    riskLabels.length > 0
      ? `Key safety risks include ${formatList(riskLabels)}.`
      : firstMatchingItem(
          sections,
          "Health & Safety",
          /\b(safety|risk|supervision|wander|elop|self-injury|unsafe|two adults|two caregivers)\b/i
        ) ||
        firstMeaningfulItem(sections, "Signs They Are Having a Hard Time");
  const bestSupports =
    firstMeaningfulItem(sections, "What helps when they are having a hard time") ||
    firstMeaningfulItem(sections, "Activities & Preferences");
  const emergencyContact = firstMatchingItem(sections, "Health & Safety", CONTACT_PATTERN);
  const emergencyContactValue = emergencyContact.replace(
    /^Emergency contact:\s*/i,
    "",
  );

  return [
    `Communication: ${communication || "Not provided"}`,
    `Key Needs: ${keyNeeds || "Not provided"}`,
    `Top Risks: ${topRisks || "Not provided"}`,
    `Best Supports: ${bestSupports || "Not provided"}`,
    `Emergency Contact: ${emergencyContactValue || "Not provided"}`
  ].join("\n");
}

function normalizeOverview(value: unknown, sections: SummarySection[]) {
  if (typeof value !== "string" || !value.trim()) {
    return buildOverview(sections);
  }

  const lines = getOverviewLines(value);
  const usesStructuredLabels = OVERVIEW_LABELS.every((label) =>
    lines.some((line) => line.toLowerCase().startsWith(`${label.toLowerCase()}:`))
  );

  return usesStructuredLabels ? lines.join("\n") : buildOverview(sections);
}

export function getOverviewLines(value: string) {
  return value
    .replace(/\r/g, "\n")
    .split(/\n+/)
    .map((line) => compactWhitespace(line.replace(/^[\-\u2022*]+\s*/u, "")))
    .filter(Boolean);
}

export function inferAuthoritativeSectionTitle(
  item: string,
  currentTitle: PreferredSummarySectionTitle
): PreferredSummarySectionTitle {
  if (CONTACT_PATTERN.test(item)) {
    return "Health & Safety";
  }

  if (STRONG_HEALTH_PATTERN.test(item)) {
    return "Health & Safety";
  }

  if (LEARNING_PATTERN.test(item)) {
    return "Understanding and Learning";
  }

  if (HEALTH_PATTERN.test(item)) {
    return "Health & Safety";
  }

  if (
    /\b(?:press(?:es|ed|ing)?|select(?:s|ed|ing)?)\b.{0,25}\bhelp\b/i.test(item) &&
    /\b(?:when|need|needs|needed|signal|sign|mean|means)\b/i.test(item)
  ) {
    return "Signs They Are Having a Hard Time";
  }

  if (
    /^(?:do not|don't)\b.*\b(?:block|stop)\b.*\b(?:hand|biting)\b/i.test(item)
  ) {
    return "What helps when they are having a hard time";
  }

  if (
    HARD_TIME_SUPPORT_PATTERN.test(item) &&
    /^(?:do not|don't|give|help|move|go|reduce|dim|stay|use|offer|provide|allow|tell|show|keep|reassure|prepare|countdown|set)\b/i.test(
      item
    )
  ) {
    return "What helps when they are having a hard time";
  }

  if (HARD_TIME_SIGNS_PATTERN.test(item)) {
    return "Signs They Are Having a Hard Time";
  }

  if (DAILY_PATTERN.test(item)) {
    return "Daily Schedule";
  }

  if (COMMUNICATION_PATTERN.test(item)) {
    return "Communication";
  }

  if (
    HARD_TIME_SUPPORT_PATTERN.test(item) &&
    /\b(calm|sooth|regulat|transition|hard time|reset|work best|works best)\b/i.test(item)
  ) {
    return "What helps when they are having a hard time";
  }

  if (ACTIVITIES_PATTERN.test(item)) {
    return "Activities & Preferences";
  }

  if (HARD_TIME_SUPPORT_PATTERN.test(item)) {
    return "What helps when they are having a hard time";
  }

  return currentTitle;
}

function splitResponse(value: string) {
  return value
    .replace(/\r/g, "\n")
    .split(/\n+|(?<=[.!?])\s+/)
    .map(compactWhitespace)
    .filter(Boolean);
}

function inferFallbackTitle(turn: ConversationTurn, item: string) {
  const stepTitle = turn.stepId ? FALLBACK_STEP_TO_SECTION_TITLE[turn.stepId] : undefined;
  return inferAuthoritativeSectionTitle(
    item,
    stepTitle ?? canonicalizeSectionTitle(turn.sectionTitle ?? "") ?? "Communication"
  );
}

export function buildFallbackSummary(
  turns: ConversationTurn[],
  nameHint?: string
): StructuredSummary {
  const buckets = new Map<PreferredSummarySectionTitle, string[]>(
    PREFERRED_SUMMARY_SECTION_ORDER.map((title) => [title, []])
  );

  for (const turn of turns) {
    if (turn.role !== "user" || turn.skipped) {
      continue;
    }

    for (const item of splitResponse(turn.content)) {
      const title = inferFallbackTitle(turn, item);
      buckets.get(title)?.push(item);
    }
  }

  const sections = normalizeSections(
    PREFERRED_SUMMARY_SECTION_ORDER.map((title, index) => ({
      id: `${slugify(title)}-${index + 1}`,
      title,
      items: buckets.get(title) ?? []
    }))
  );

  return {
    ...EMPTY_SUMMARY,
    title: defaultSummaryTitle(nameHint),
    overview: buildOverview(sections),
    sections
  };
}

export function normalizeGeneratedSummary(input: unknown, nameHint?: string): StructuredSummary {
  return normalizeGeneratedSummaryWithOptions(input, nameHint);
}

export function normalizeGeneratedSummaryWithOptions(
  input: unknown,
  nameHint?: string,
  options: SummaryNormalizationOptions = {}
): StructuredSummary {
  const candidate = input as GeneratedStructuredSummary | undefined;
  if (!candidate || typeof candidate !== "object") {
    const sections = normalizeSections([]);
    return {
      ...EMPTY_SUMMARY,
      title: defaultSummaryTitle(nameHint),
      overview: buildOverview(sections),
      sections
    };
  }

  const sections = normalizeSections(buildSectionsFromStructuredPayload(candidate), {
    reclassify: options.reclassify ?? true
  });

  return {
    title:
      typeof candidate.title === "string" && candidate.title.trim()
        ? candidate.title.trim()
        : defaultSummaryTitle(nameHint),
    overview: options.reclassify ? buildOverview(sections) : normalizeOverview(candidate.overview, sections),
    sections,
    generatedAt:
      typeof candidate.generatedAt === "string" ? candidate.generatedAt.trim() : "",
    pipelineVersion: "",
    layoutVersion: "",
    sourceTurnsHash: ""
  };
}

function normalizeSectionCandidate(value: unknown, index: number) {
  const candidate = hydrateStructuredSection(
    (value ?? {}) as Partial<SummarySection>,
    index
  );
  if (!candidate) {
    return null;
  }

  const title = canonicalizeSectionTitle(candidate.title);
  if (!title) {
    return null;
  }

  return {
    ...candidate,
    title,
    items: sectionItems(candidate)
  } satisfies SummarySection;
}

function preserveCurrentStructuredSections(sections: SummarySection[], reclassify: boolean) {
  if (
    sections.length !== PREFERRED_SUMMARY_SECTION_ORDER.length ||
    !sections.some(
      (section) =>
        Boolean(section.intro?.trim()) ||
        (Array.isArray(section.blocks) && section.blocks.length > 0)
    )
  ) {
    return null;
  }

  const byTitle = new Map(
    sections.map((section) => [section.title as PreferredSummarySectionTitle, section])
  );
  if (
    byTitle.size !== PREFERRED_SUMMARY_SECTION_ORDER.length ||
    !PREFERRED_SUMMARY_SECTION_ORDER.every((title) => byTitle.has(title))
  ) {
    return null;
  }

  if (
    reclassify &&
    sections.some((section) =>
      sectionItems(section).some(
        (item) =>
          inferAuthoritativeSectionTitle(
            item,
            section.title as PreferredSummarySectionTitle
          ) !== section.title
      )
    )
  ) {
    return null;
  }

  return PREFERRED_SUMMARY_SECTION_ORDER.map((title, index) => {
    const section = byTitle.get(title)!;
    return {
      ...section,
      id: section.id || `${slugify(title)}-${index + 1}`,
      title
    };
  });
}

function normalizeLegacySummary(
  candidate: LegacyStructuredSummary,
  nameHint?: string
): StructuredSummary {
  const legacyBuckets: Array<[PreferredSummarySectionTitle, unknown]> = [
    ["Signs They Are Having a Hard Time", candidate.key_barriers],
    ["Signs They Are Having a Hard Time", candidate.emotional_concerns],
    ["Health & Safety", candidate.safety_considerations],
    ["Signs They Are Having a Hard Time", candidate.past_negative_experiences],
    ["Signs They Are Having a Hard Time", candidate.situations_to_avoid],
    ["What helps when they are having a hard time", candidate.conditions_for_successful_respite],
    ["Health & Safety", candidate.unresolved_questions]
  ];
  const sections = normalizeSections(
    legacyBuckets.map(([title, value], index) => ({
      id: `${slugify(title)}-${index + 1}`,
      title,
      items: Array.isArray(value) ? value.map(String) : typeof value === "string" ? [value] : []
    })),
    { reclassify: true }
  );

  return {
    ...EMPTY_SUMMARY,
    title: defaultSummaryTitle(nameHint),
    overview:
      typeof candidate.caregiver_summary_text === "string" &&
      candidate.caregiver_summary_text.trim()
        ? candidate.caregiver_summary_text.trim()
        : buildOverview(sections),
    sections
  };
}

function normalizeStructuredCandidate(
  input: unknown,
  nameHint: string | undefined,
  options: SummaryNormalizationOptions,
  editable: boolean
) {
  const candidate = input as
    | Partial<StructuredSummary & LegacyStructuredSummary & GeneratedStructuredSummary>
    | undefined;

  if (!candidate || typeof candidate !== "object") {
    return {
      ...EMPTY_SUMMARY,
      title: defaultSummaryTitle(nameHint),
      sections: normalizeSections([])
    };
  }

  if (GENERATED_SUMMARY_SECTION_FIELDS.some((field) => field.key in candidate)) {
    return normalizeGeneratedSummaryWithOptions(candidate, nameHint, {
      ...options,
      reclassify: editable ? false : options.reclassify
    });
  }

  if (Array.isArray(candidate.sections)) {
    const normalizedCandidates = candidate.sections
      .map(normalizeSectionCandidate)
      .filter((section) => section !== null);
    const reclassify = editable ? false : options.reclassify ?? false;
    const sections =
      preserveCurrentStructuredSections(normalizedCandidates, reclassify) ??
      normalizeSections(normalizedCandidates, { reclassify });

    return {
      title:
        typeof candidate.title === "string" && candidate.title.trim()
          ? candidate.title.trim()
          : defaultSummaryTitle(nameHint),
      overview: reclassify ? buildOverview(sections) : normalizeOverview(candidate.overview, sections),
      sections,
      generatedAt:
        typeof candidate.generatedAt === "string" ? candidate.generatedAt.trim() : "",
      pipelineVersion:
        typeof candidate.pipelineVersion === "string" ? candidate.pipelineVersion.trim() : "",
      layoutVersion:
        typeof candidate.layoutVersion === "string" ? candidate.layoutVersion.trim() : "",
      sourceTurnsHash:
        typeof candidate.sourceTurnsHash === "string" ? candidate.sourceTurnsHash.trim() : ""
    } satisfies StructuredSummary;
  }

  return normalizeLegacySummary(candidate, nameHint);
}

export function normalizeStructuredSummary(input: unknown, nameHint?: string): StructuredSummary {
  return normalizeStructuredSummaryWithOptions(input, nameHint);
}

export function normalizeEditableStructuredSummary(
  input: unknown,
  nameHint?: string
): StructuredSummary {
  return normalizeStructuredCandidate(input, nameHint, { reclassify: false }, true);
}

export function normalizeAuthoritativeStructuredSummary(
  input: unknown,
  nameHint?: string
): StructuredSummary {
  return normalizeStructuredCandidate(input, nameHint, { reclassify: true }, false);
}

export function normalizeStructuredSummaryWithOptions(
  input: unknown,
  nameHint?: string,
  options: SummaryNormalizationOptions = {}
): StructuredSummary {
  return normalizeStructuredCandidate(input, nameHint, options, false);
}

const summaryLocales: Record<UiLanguage, string> = {
  english: "en-US",
  spanish: "es-US",
  mandarin: "zh-CN"
};

export function formatSummaryGeneratedAt(
  value: string,
  language: UiLanguage = "english"
) {
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
    timeZone: "America/New_York",
    timeZoneName: "short"
  }).format(date);
}

export function summaryToPlainText(summary: StructuredSummary) {
  return [
    summary.title.trim(),
    summary.overview.trim(),
    ...summary.sections.flatMap((section) => [
      section.title,
      ...section.items.filter((item) => !isNoInformationItem(item)).map((item) => `- ${item}`)
    ])
  ]
    .filter(Boolean)
    .join("\n");
}
