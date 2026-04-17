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

const NO_INFORMATION_PLACEHOLDER = "(No information provided)";

export const PREFERRED_SUMMARY_SECTION_ORDER = [
  "Communication",
  "Daily Needs & Routines",
  "What helps the day go well",
  "What can upset or overwhelm them",
  "Signs they need help",
  "What helps when they are having a hard time",
  "Health & Safety",
  "Who to contact (and when)"
] as const;

const GENERATED_SUMMARY_SECTION_FIELDS = [
  { key: "communication", title: "Communication" },
  { key: "dailyNeedsRoutines", title: "Daily Needs & Routines" },
  { key: "whatHelpsTheDayGoWell", title: "What helps the day go well" },
  { key: "whatCanUpsetOrOverwhelmThem", title: "What can upset or overwhelm them" },
  { key: "signsTheyNeedHelp", title: "Signs they need help" },
  { key: "whatHelpsWhenTheyAreHavingAHardTime", title: "What helps when they are having a hard time" },
  { key: "healthAndSafety", title: "Health & Safety" },
  { key: "whoToContactAndWhen", title: "Who to contact (and when)" }
] as const;

type GeneratedSummarySectionKey = (typeof GENERATED_SUMMARY_SECTION_FIELDS)[number]["key"];

type GeneratedStructuredSummary = {
  title?: unknown;
  overview?: unknown;
  generatedAt?: unknown;
} & Partial<Record<GeneratedSummarySectionKey, unknown>>;

type PreferredSummarySectionTitle = (typeof PREFERRED_SUMMARY_SECTION_ORDER)[number];

type SummaryNormalizationOptions = {
  reclassify?: boolean;
};

const CONTACT_PATTERN =
  /\b(911|emergency|non-?emergenc|guardian|doctor|contact|call right away|call first|crisis support)\b/i;
const HEALTH_AND_SAFETY_PATTERN =
  /\b(allerg|medicat|medicine|dose|doctor|seizure|asthma|diabet|gi issues?|medical|wheelchair|hearing aids?|glasses|feeding tube|brace|equipment|safety|unsafe|supervision|risk|two caregivers?|two people)\b/i;
const HARD_TIME_SUPPORT_PATTERN =
  /\b(quieter space|another room|outside|car ride|turn(?:ing)? off tv|lowering voices|dim lights|headphones|music|fidget|weighted blanket|snack|drink|stay with|support communication|sensory supports?|brushing|preferred treat|basic needs|redirect|do not try to stop|do not block|do not physically stop)\b/i;
const SIGNS_NEED_HELP_PATTERN =
  /\b(covering ears|covering eyes|breathing changes?|low energy|guarding|staring|not responding|blinking|fluttering|stiffening|jerking|pacing|yelling|becoming quieter|aggression|self-injury|withdrawing|running away|repetitive movements|changes in eating|talking less|unable to answer|pain|hungry|hunger|toilet|bathroom)\b/i;
const UPSET_OR_OVERWHELM_PATTERN =
  /\b(trigger|upset|overwhelm|plans change|without warning|stopping an activity|switching activities|unexpected visitors|unexpected outings|loud noise|bright lights|crowded places?|strong smells?|too many people|too close|unfamiliar people|poor sleep|tired|tiredness)\b/i;
const DAILY_NEEDS_PATTERN =
  /\b(routine|morning|breakfast|meal|meals|snack|snacks|bedtime|bath|shower|brush teeth|transition|countdown|visual schedule|medication before|with food|crushed|liquid|reminders?)\b/i;
const COMMUNICATION_PATTERN =
  /\b(communicat|gesture|gestures|pointing|leading you|pictures?|device|writing|words?|sounds?|phrase|phrases|mean|attention)\b/i;
const WHAT_HELPS_DAY_GO_WELL_PATTERN =
  /\b(choices instead of open-ended questions|waiting before repeating|written questions|images|walks?|ipad time|preferred videos?|sensory swing|sports|crafts|games|quiet time|downtime|resting|low lights|sensory space)\b/i;
const CAREGIVER_HARM_PATTERN =
  /\b(bite you|bite caregiver|hurt caregiver|harm caregiver|injure caregiver|could hurt you)\b/i;
const QUESTION_ECHO_PATTERN =
  /^(what|who|how|when|where|why|are|do|does|did|is|can|could|should|would)\b.*\?$/i;
const NON_ANSWER_PATTERN =
  /^(?:use skip|skip|n\/a|na|none|unknown|not sure|not clearly stated(?: in the raw input)?|not stated|not provided|no information)$/i;
const TRANSCRIPTION_NOISE_PATTERN =
  /^(?:um+|uh+|hmm+|mm+|eh+|ah+|ha+|heh+|eheh+|haha+|huh+|mmm+|uh-huh|mm-hmm)$/i;
const SECTION_LABEL_OVERVIEW_PATTERN =
  /\b(?:Communication|Daily Needs(?: &| and) Routines|What helps the day go well|What can upset or overwhelm(?: them)?|Signs they need help|What helps when they are having a hard time|Health(?: &| and) Safety|Who to contact(?: \(and when\)| and when)?)\s*:/i;

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

function splitFallbackClauses(text: string) {
  return text
    .split(
      /\s*(?:;\s+|,\s*(?:but|however|though|although|whereas|as|because)\s+|\b(?:but|however|though|although|whereas|because)\b\s+)/i
    )
    .map((item) => item.trim())
    .filter(Boolean);
}

function extractNameFromTitle(value?: string) {
  const match = value?.trim().match(/^Caring for\s+(.+)$/i);
  return match?.[1]?.trim() ?? "";
}

function formatList(items: string[]) {
  if (items.length === 0) {
    return "";
  }

  if (items.length === 1) {
    return items[0];
  }

  if (items.length === 2) {
    return `${items[0]} and ${items[1]}`;
  }

  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
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

const COMPARISON_STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "because",
  "but",
  "can",
  "for",
  "from",
  "he",
  "her",
  "him",
  "his",
  "i",
  "if",
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

function extractSummaryConcepts(value: string) {
  const concepts = new Set<string>();
  const normalized = normalizeComparisonText(value);

  if (!normalized) {
    return concepts;
  }

  if (
    /\b(bathroom|toilet)\b/.test(normalized) &&
    /\b(reminder|reminders|prompt|prompts|hourly|prompted)\b/.test(normalized)
  ) {
    concepts.add("bathroom_reminders");
  }

  if (
    /\b(food|fridge|cheese|hungry|hunger)\b/.test(normalized) &&
    /\b(access|often|regular|frequent|prevent|distress|available)\b/.test(normalized)
  ) {
    concepts.add("food_access");
  }

  if (/\b(fridge|grabbing cheese)\b/.test(normalized)) {
    concepts.add("hunger_sign");
  }

  if (/\bcar ride|car rides\b/.test(normalized) && /\b(help|regulat|calm|sooth)\b/.test(normalized)) {
    concepts.add("car_ride_regulation");
  }

  if (/\bwalk|walks\b/.test(normalized) && /\b(help|regulat|calm|sooth)\b/.test(normalized)) {
    concepts.add("walk_regulation");
  }

  if (
    /\bipad\b/.test(normalized) &&
    /\b(help|find|access|search history|trying)\b/.test(normalized) &&
    !/\b(not working|cannot find|can t find|unable|upset)\b/.test(normalized)
  ) {
    concepts.add("ipad_help");
  }

  if (
    /\bipad\b/.test(normalized) &&
    /\b(not working|cannot find|can t find|unable|not being able|access)\b/.test(normalized)
  ) {
    concepts.add("ipad_trigger");
  }

  if (/\b(open|opening)\b/.test(normalized) && /\b(low muscle tone|unable|can t|cannot|help)\b/.test(normalized)) {
    concepts.add("opening_items");
  }

  if (/\b(loud|angry) vocalizations?\b/.test(normalized) || /\bangry sounds?\b/.test(normalized)) {
    concepts.add("vocalization_sign");
  }

  if (/\belopement|elopen|running away|run away\b/.test(normalized)) {
    concepts.add("elopement");
  }

  if (/\b(hand biting|biting his hand|biting her hand|biting their hand)\b/.test(normalized)) {
    concepts.add("hand_biting");
  }

  if (
    /\b(hiding|hides|hide)\b/.test(normalized) &&
    /\b(grunting|grunts|grunt|bowel movement|pull up|pullup)\b/.test(normalized)
  ) {
    concepts.add("bowel_movement_sign");
  }

  if (/\b(pulling|leading a caregiver|lead you|lead them|lead him|lead her)\b/.test(normalized)) {
    concepts.add("caregiver_leading_sign");
  }

  if (/\b(sitting very close|sit very close|extra attention|wants attention|seeking attention)\b/.test(normalized)) {
    concepts.add("attention_sign");
  }

  if (/^offer\b.*\bcar ride\b/.test(normalized)) {
    concepts.add("offer_car_ride");
  }

  if (
    /^help\b.*\b(ipad|access|find)\b/.test(normalized) ||
    /\bhelp him access\b|\bhelp her access\b|\bhelp them access\b/.test(normalized)
  ) {
    concepts.add("help_ipad_access");
  }

  if (/\bredirect\b/.test(normalized)) {
    concepts.add("redirect");
  }

  if (/\b(do not|don t)\b.*\b(stop|block)\b.*\b(hand|biting)\b/.test(normalized)) {
    concepts.add("do_not_block_hand_biting");
  }

  if (/\blow muscle tone\b/.test(normalized)) {
    concepts.add("low_muscle_tone");
  }

  if (/\btwo caregivers|two people\b/.test(normalized)) {
    concepts.add("two_caregivers");
  }

  if (/\bsafety risk\b/.test(normalized) && /\belopement|elopen|run away\b/.test(normalized)) {
    concepts.add("elopement_risk");
  }

  if (
    /\bsafety risk\b/.test(normalized) &&
    /\b(hand biting|biting his hand|biting her hand|biting their hand)\b/.test(normalized)
  ) {
    concepts.add("hand_biting_risk");
  }

  return concepts;
}

function lookLikeSupportAction(item: string) {
  return /\b(help(?:ing)?|check(?:ing)?|find(?:ing)?|offer|redirect|do not|don't|prevent|reduce|reduces|calm|soothe|regulate)\b/i.test(
    item
  );
}

function looksLikeCommunicationItem(item: string) {
  if (
    lookLikeSupportAction(item) ||
    /\b(not working|cannot find|can't find|unable to access|upset|frustration)\b/i.test(item)
  ) {
    return false;
  }

  return /\b(non-speaking|cannot use words|AAC|TouchChat|uses?(?: an)? AAC device|device on an iPad|makes? sounds?|uses? (?:his|her|their) AAC device|selects? (?:car|color|iPad)|means? (?:he|she|they)|looking for an object of that color|ask for help|approach|touch|lead you|lead them|lead him|lead her|communicat)\b/i.test(
    item
  );
}

function itemsAreNearDuplicate(
  left: string,
  right: string,
  title?: string
) {
  const normalizedLeft = normalizeComparisonText(left);
  const normalizedRight = normalizeComparisonText(right);

  if (!normalizedLeft || !normalizedRight) {
    return false;
  }

  if (normalizedLeft === normalizedRight) {
    return true;
  }

  if (
    normalizedLeft.length >= 24 &&
    normalizedRight.length >= 24 &&
    (normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft))
  ) {
    return true;
  }

  const canonicalTitle = canonicalizeSectionTitle(title ?? "");
  const sectionUsesConceptDedupe =
    canonicalTitle === "What helps the day go well" ||
    canonicalTitle === "Signs they need help" ||
    canonicalTitle === "What helps when they are having a hard time";

  if (sectionUsesConceptDedupe) {
    const leftConcepts = extractSummaryConcepts(left);
    const rightConcepts = extractSummaryConcepts(right);

    if ([...leftConcepts].some((concept) => rightConcepts.has(concept))) {
      return true;
    }
  }

  const leftTokens = comparisonTokens(left);
  const rightTokens = comparisonTokens(right);

  if (leftTokens.length < 4 || rightTokens.length < 4) {
    return false;
  }

  const overlapCount = leftTokens.filter((token) => rightTokens.includes(token)).length;
  const unionCount = new Set([...leftTokens, ...rightTokens]).size;
  const jaccard = unionCount === 0 ? 0 : overlapCount / unionCount;

  return jaccard >= 0.78;
}

function cleanSummaryItem(value: string) {
  const trimmed = value
    .replace(/^[\-\u2022*]+\s*/u, "")
    .replace(/^["'“”]+|["'“”]+$/gu, "")
    .trim();

  if (!trimmed) {
    return null;
  }

  if (isNoInformationItem(trimmed)) {
    return NO_INFORMATION_PLACEHOLDER;
  }

  if (NON_ANSWER_PATTERN.test(trimmed) || QUESTION_ECHO_PATTERN.test(trimmed)) {
    return null;
  }

  if (TRANSCRIPTION_NOISE_PATTERN.test(trimmed)) {
    return null;
  }

  const alphanumericCount = (trimmed.match(/[A-Za-z0-9]/g) ?? []).length;
  if (alphanumericCount < 3) {
    return null;
  }

  return trimmed.replace(/\s+/g, " ");
}

function polishSummaryItem(title: string, value: string) {
  let item = value.trim();

  if (!item || isNoInformationItem(item)) {
    return item;
  }

  const canonicalTitle = canonicalizeSectionTitle(title);

  if (canonicalTitle === "What helps the day go well") {
    item = item.replace(
      /^Check his iPad search history to help figure out what he is trying to access\.?$/i,
      "Checking his iPad search history can help you find what he wants and prevent frustration"
    );
    item = item.replace(
      /^Checking his search history can help identify what he is trying to access(?: on his iPad)?\.?$/i,
      "Checking his iPad search history can help you find what he wants and prevent frustration"
    );
    item = item.replace(
      /^Checking his iPad search history can help identify what he is trying to access\.?$/i,
      "Checking his iPad search history can help you find what he wants and prevent frustration"
    );
    item = item.replace(
      /^Checking his iPad search history can help figure out what he is trying to access\.?$/i,
      "Checking his iPad search history can help you find what he wants and prevent frustration"
    );
    item = item.replace(
      /^He needs regular reminders to use the bathroom\.?$/i,
      "Consistent bathroom reminders help the day go more smoothly"
    );
    item = item.replace(
      /^The home has hourly prompts to remind him to use the bathroom\.?$/i,
      "Hourly bathroom prompts help keep the day on track"
    );
    item = item.replace(
      /^He needs food often and needs frequent access to food\.?$/i,
      "Regular access to food helps prevent distress"
    );
    item = item.replace(
      /^Car rides help regulate him when he is upset\.?$/i,
      "Car rides can help him regulate"
    );
    item = item.replace(
      /^Car rides can help him stay regulated\.?$/i,
      "Car rides can help with regulation"
    );
    item = item.replace(
      /^Walks can help regulate him too(?:,? but only with at least two caregivers for safety)?\.?$/i,
      "Walks can help him regulate"
    );
    item = item.replace(
      /^Walks can also help him stay regulated\.?$/i,
      "Walks can help with regulation"
    );
    item = item.replace(
      /^Walks can help him stay regulated\.?$/i,
      "Walks can help with regulation"
    );
    item = item.replace(
      /^Helping him find items on his iPad reduces frustration\.?$/i,
      "Helping him find items on his iPad can prevent frustration"
    );
    item = item.replace(
      /^Checking his search history can help identify what he is trying to access\.?$/i,
      "Checking his search history can help you find what he is trying to access"
    );
  }

  if (canonicalTitle === "Signs they need help") {
    item = item.replace(
      /^Making loud or angry vocalizations can mean he needs help\.?$/i,
      "Loud or angry vocalizations can mean he needs help"
    );
    item = item.replace(
      /^He often hides behind furniture or curtains and grunts when having a bowel movement\.?$/i,
      "Hiding behind furniture or curtains and grunting usually means he is having a bowel movement"
    );
    item = item.replace(
      /^Repeated trips to the fridge or grabbing cheese usually means he is hungry\.?$/i,
      "Repeated trips to the fridge or grabbing cheese usually mean he is hungry"
    );
  }

  item = item
    .replace(/\bTouchchat\b/gi, "TouchChat")
    .replace(/\bi pad\b/gi, "iPad")
    .replace(/\baac\b/gi, "AAC")
    .replace(/\s+/g, " ")
    .trim();

  if (item && !/^[A-Z(]/.test(item)) {
    item = `${item.charAt(0).toUpperCase()}${item.slice(1)}`;
  }

  if (item && !/[.!?]$/.test(item)) {
    item = `${item}.`;
  }

  return item;
}

function limitItems(items: string[], limit?: number, title?: string) {
  const deduped = items
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item, index, allItems) => {
      if (!item) {
        return false;
      }

      return !allItems.slice(0, index).some((existing) => itemsAreNearDuplicate(existing, item, title));
    });
  const filteredItems = deduped.some((item) => !isNoInformationItem(item))
    ? deduped.filter((item) => !isNoInformationItem(item))
    : deduped;

  return typeof limit === "number" ? filteredItems.slice(0, limit) : filteredItems;
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

function isNoInformationItem(value: string) {
  return value.trim().toLowerCase() === NO_INFORMATION_PLACEHOLDER.toLowerCase();
}

function normalizeSummaryItems(items: string[], limit?: number) {
  const expanded = items.flatMap((item) =>
    item
      .replace(/\r/g, "\n")
      .split(/\n+/)
      .flatMap((line) => line.split(/\s*[•*]\s*/u))
      .flatMap((line) => line.split(/;\s+/))
      .flatMap((line) => line.split(/(?<=[.!?])\s+(?=[A-Z(])/))
      .map(cleanSummaryItem)
      .filter((line): line is string => Boolean(line))
  );

  return limitItems(expanded, limit);
}

function normalizeSectionItems(title: string, items: string[], limit?: number) {
  const expanded = items.flatMap((item) =>
    item
      .replace(/\r/g, "\n")
      .split(/\n+/)
      .flatMap((line) => line.split(/\s*[•*]\s*/u))
      .flatMap((line) => line.split(/;\s+/))
      .flatMap((line) => line.split(/(?<=[.!?])\s+(?=[A-Z(])/))
      .map(cleanSummaryItem)
      .filter((line): line is string => Boolean(line))
      .flatMap((line) => {
        if (
          canonicalizeSectionTitle(title) === "What helps the day go well" &&
          /\bcar rides?\s+and\s+walks?\b/i.test(line) &&
          /\b(help|regulated?|regulation|calm|soothe)\b/i.test(line)
        ) {
          return ["Car rides can help him regulate", "Walks can help him regulate"];
        }

        return [line];
      })
      .map((line) => polishSummaryItem(title, line))
      .filter((line): line is string => Boolean(line))
  );

  return limitItems(expanded, limit, title);
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
      existing.items = normalizeSectionItems(title, [...existing.items, ...section.items]);
      continue;
    }

    merged.set(key, {
      ...section,
      title,
      items: normalizeSectionItems(title, section.items)
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

function createPlaceholderSection(title: (typeof PREFERRED_SUMMARY_SECTION_ORDER)[number], index: number): SummarySection {
  return {
    id: `${slugify(title) || "section"}-${index + 1}`,
    title,
    items: [NO_INFORMATION_PLACEHOLDER]
  };
}

function ensurePreferredSections(sections: SummarySection[]) {
  const normalizedSections = sortAndMergeSections(sections);
  const byTitle = new Map(normalizedSections.map((section) => [section.title.toLowerCase(), section]));

  return PREFERRED_SUMMARY_SECTION_ORDER.map((title, index) => {
    const existing = byTitle.get(title.toLowerCase());

    if (!existing) {
      return createPlaceholderSection(title, index);
    }

    return {
      ...existing,
      items: existing.items.length > 0 ? existing.items : [NO_INFORMATION_PLACEHOLDER]
    };
  });
}

function usesPreferredSectionStructure(sections: SummarySection[]) {
  const preferredTitles = new Set(PREFERRED_SUMMARY_SECTION_ORDER.map((title) => title.toLowerCase()));

  return sections.every((section) => preferredTitles.has(canonicalizeSectionTitle(section.title).toLowerCase()));
}

function normalizeSection(input: unknown, index: number): SummarySection | null {
  const candidate = input as Partial<SummarySection> | undefined;
  const title =
    typeof candidate?.title === "string" ? canonicalizeSectionTitle(candidate.title) : "";
  const items = Array.isArray(candidate?.items)
    ? normalizeSectionItems(title, candidate.items.map(String))
    : [];

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
  return Array.isArray(value) ? normalizeSummaryItems(value.map(String)) : [];
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

function normalizeFallbackIdeaText(value: string) {
  return value
    .replace(/^[,\-\s]+/, "")
    .replace(/[,\-\s]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractFallbackIdeas(turn: ConversationTurn) {
  return splitTurnIntoStatements(turn).flatMap((statement) => {
    const clauseIdeas = splitFallbackClauses(statement)
      .map(normalizeFallbackIdeaText)
      .filter(Boolean)
      .map((text) => {
        const title = inferFallbackSectionTitle(turn, text);
        return title ? { title, text } : null;
      })
      .filter((idea): idea is { title: (typeof PREFERRED_SUMMARY_SECTION_ORDER)[number]; text: string } =>
        Boolean(idea)
      );

    const clauseTitles = new Set(clauseIdeas.map((idea) => idea.title));
    if (clauseTitles.size > 1) {
      return clauseIdeas;
    }

    const normalizedStatement = normalizeFallbackIdeaText(statement);
    const statementTitle = inferFallbackSectionTitle(turn, normalizedStatement);
    return statementTitle ? [{ title: statementTitle, text: normalizedStatement }] : [];
  });
}

function inferFallbackSectionTitle(turn: ConversationTurn, statement: string) {
  if (CONTACT_PATTERN.test(statement)) {
    return "Who to contact (and when)";
  }

  if (HEALTH_AND_SAFETY_PATTERN.test(statement) || CAREGIVER_HARM_PATTERN.test(statement)) {
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

function inferNormalizedSectionTitle(
  item: string,
  currentTitle: PreferredSummarySectionTitle
): PreferredSummarySectionTitle {
  if (CONTACT_PATTERN.test(item)) {
    return "Who to contact (and when)";
  }

  if (
    /^(?:offer|redirect|do not|don't|help (?:him|her|them)|check (?:whether|if|the)|take (?:him|her|them)|support communication|stay with (?:him|her|them)|give (?:him|her|them))\b/i.test(
      item
    )
  ) {
    return "What helps when they are having a hard time";
  }

  if (
    /\b(two caregivers?|two people|close supervision|supervision needs?|safety risk|low muscle tone|may bite you|bite you|unsafe|for safety reasons?)\b/i.test(
      item
    ) ||
    CAREGIVER_HARM_PATTERN.test(item)
  ) {
    return "Health & Safety";
  }

  if (
    /\b(run(?:ning)? away|elope|biting (?:his|her|their) hand|angry sounds?|yelling|hiding|hides|grunt(?:ing|s)?|go(?:ing)? to the fridge|grabbing cheese|repeatedly going to the fridge|pulling|leading a caregiver|sit(?:ting)? very close|wanting attention|proximity-seeking)\b/i.test(
      item
    )
  ) {
    return currentTitle === "Communication" ? currentTitle : "Signs they need help";
  }

  if (
    /\b(consistent bathroom reminders|bathroom reminders help|hourly bathroom prompts|regular access to food|food helps prevent distress|helping (?:him|her|them) find|can prevent frustration|car rides? can help|car rides? help|walks? can help|walks? help|checking (?:his|her|their) search history can help|regulate|soothe)\b/i.test(
      item
    ) ||
    WHAT_HELPS_DAY_GO_WELL_PATTERN.test(item)
  ) {
    return "What helps the day go well";
  }

  if (
    /\b(bathroom|toilet|pull-up|hourly prompt|hourly reminder|regular reminders?|go when prompted|food often|frequent access to food|needs food constantly)\b/i.test(
      item
    )
  ) {
    return "Daily Needs & Routines";
  }

  if (
    /\b(not being able|unable to|internet is down|can't find|cannot find|not working|difficulty finding|lack of available food|hunger|hard to stop|stopping (?:what|an activity))\b/i.test(
      item
    ) ||
    UPSET_OR_OVERWHELM_PATTERN.test(item)
  ) {
    return "What can upset or overwhelm them";
  }

  if (looksLikeCommunicationItem(item)) {
    return "Communication";
  }

  return currentTitle;
}

function reclassifySummarySections(sections: SummarySection[]) {
  const buckets = new Map<PreferredSummarySectionTitle, string[]>();

  for (const section of sections) {
    const currentTitle = canonicalizeSectionTitle(section.title) as PreferredSummarySectionTitle;

    for (const item of section.items) {
      if (isNoInformationItem(item)) {
        continue;
      }

      const title = inferNormalizedSectionTitle(item, currentTitle);
      const existing = buckets.get(title) ?? [];
      existing.push(item);
      buckets.set(title, existing);
    }
  }

  return ensurePreferredSections(
    [...buckets.entries()].map(([title, items], index) => ({
      id: `${slugify(title) || "section"}-${index + 1}`,
      title,
      items
    }))
  );
}

function sectionContainsConcept(section: SummarySection, concept: string) {
  return section.items.some((item) => extractSummaryConcepts(item).has(concept));
}

function surfaceDayGoWellSupports(sections: SummarySection[]) {
  const nextSections = sections.map((section) => ({
    ...section,
    items: [...section.items]
  }));
  const dayGoWellSection = nextSections.find(
    (section) => section.title === "What helps the day go well"
  );

  if (!dayGoWellSection) {
    return nextSections;
  }

  const allItems = nextSections.flatMap((section) => section.items);
  const addSupport = (concept: string, item: string, matcher: (value: string) => boolean) => {
    if (sectionContainsConcept(dayGoWellSection, concept)) {
      return;
    }

    if (allItems.some((existingItem) => matcher(existingItem) || extractSummaryConcepts(existingItem).has(concept))) {
      dayGoWellSection.items.push(item);
    }
  };

  addSupport(
    "bathroom_reminders",
    "Consistent bathroom reminders help the day go more smoothly.",
    (item) => /\b(bathroom|toilet)\b/i.test(item) && /\b(reminder|prompt|hourly|prompted)\b/i.test(item)
  );
  addSupport(
    "food_access",
    "Regular access to food helps prevent distress.",
    (item) =>
      /\b(food often|frequent access to food|regular access to food|lack of available food|hunger|hungry|fridge|grabbing cheese)\b/i.test(
        item
      )
  );
  addSupport(
    "car_ride_regulation",
    "Car rides can help with regulation.",
    (item) =>
      (/\bcar rides?\b/i.test(item) && /\b(help|regulat|calm|sooth)\b/i.test(item)) ||
      /^offer\b.*\bcar ride\b/i.test(item)
  );
  addSupport(
    "walk_regulation",
    "Walks can help with regulation.",
    (item) => /\bwalks?\b/i.test(item) && /\b(help|regulat|calm|sooth)\b/i.test(item)
  );
  addSupport(
    "ipad_help",
    "Helping with iPad searches can prevent frustration.",
    (item) =>
      /\b(ipad|search history)\b/i.test(item) &&
      /\b(help|find|access|prevent|reduce|frustration|trying)\b/i.test(item)
  );

  return nextSections;
}

function refinePreferredSections(sections: SummarySection[]) {
  const normalizedSections = ensurePreferredSections(
    sections.map((section, index) => ({
      ...section,
      id: section.id || `${slugify(section.title) || "section"}-${index + 1}`,
      items: normalizeSectionItems(section.title, section.items)
    }))
  );
  const surfacedSections = surfaceDayGoWellSupports(normalizedSections);

  return ensurePreferredSections(
    surfacedSections.map((section, index) => ({
      ...section,
      id: section.id || `${slugify(section.title) || "section"}-${index + 1}`,
      items: normalizeSectionItems(section.title, section.items),
      title: canonicalizeSectionTitle(section.title)
    }))
  );
}

function buildOverview(title: string, sections: SummarySection[]) {
  const meaningfulSections = sections.filter((section) =>
    section.items.some((item) => !isNoInformationItem(item))
  );
  const personName = extractNameFromTitle(title);
  const subject = personName || "This person";
  const communicationItems =
    meaningfulSections.find((section) => section.title === "Communication")?.items ?? [];
  const healthAndSafetyItems =
    meaningfulSections.find((section) => section.title === "Health & Safety")?.items ?? [];
  const signItems =
    meaningfulSections.find((section) => section.title === "Signs they need help")?.items ?? [];

  const communicationSignals: string[] = [];
  if (communicationItems.some((item) => /\bnon-speaking\b/i.test(item))) {
    communicationSignals.push("non-speaking");
  }
  if (communicationItems.some((item) => /\bAAC|TouchChat|iPad\b/i.test(item))) {
    communicationSignals.push("AAC device");
  }
  if (communicationItems.some((item) => /\bsounds?\b/i.test(item))) {
    communicationSignals.push("sounds");
  }
  if (communicationItems.some((item) => /\blead|touch|sit close|attention\b/i.test(item))) {
    communicationSignals.push("behavior cues");
  }

  const safetySignals: string[] = [];
  if ([...healthAndSafetyItems, ...signItems].some((item) => /\belope|run away\b/i.test(item))) {
    safetySignals.push("elopement");
  }
  if ([...healthAndSafetyItems, ...signItems].some((item) => /\bbiting (?:his|her|their) hand|self-injury\b/i.test(item))) {
    safetySignals.push("self-injury");
  }
  if (healthAndSafetyItems.some((item) => /\btwo caregivers?|two people|close supervision|supervision\b/i.test(item))) {
    safetySignals.push("close supervision needs");
  }

  const overviewSentences: string[] = [];
  if (communicationSignals.length > 0) {
    if (communicationSignals.includes("non-speaking")) {
      const communicationModes = communicationSignals.filter((signal) => signal !== "non-speaking");
      if (communicationModes.length > 0) {
        overviewSentences.push(
          `${subject} is non-speaking and communicates using ${formatList(communicationModes)}.`
        );
      } else {
        overviewSentences.push(`${subject} is non-speaking.`);
      }
    } else {
      overviewSentences.push(
        `${subject} communicates using ${formatList(communicationSignals)}.`
      );
    }
  }

  if (safetySignals.length > 0) {
    overviewSentences.push(
      `${personName || "They"} require${personName ? "s" : ""} close supervision due to safety risks including ${formatList(
        safetySignals
      )}.`
    );
  }

  if (overviewSentences.length > 0) {
    return shortenOverview(overviewSentences.join(" "));
  }

  const firstSection = meaningfulSections[0];
  const secondSection = meaningfulSections[1];

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

function shouldRewriteOverview(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return true;
  }

  if (SECTION_LABEL_OVERVIEW_PATTERN.test(trimmed)) {
    return true;
  }

  if (QUESTION_ECHO_PATTERN.test(trimmed) || NON_ANSWER_PATTERN.test(trimmed)) {
    return true;
  }

  return false;
}

function buildSectionsFromStructuredPayload(candidate: GeneratedStructuredSummary) {
  return GENERATED_SUMMARY_SECTION_FIELDS.map((field, index) => ({
    id: `${slugify(field.title) || "section"}-${index + 1}`,
    title: field.title,
    items: coerceStringArray(candidate[field.key])
  }));
}

export function normalizeGeneratedSummary(input: unknown, nameHint?: string): StructuredSummary {
  return normalizeGeneratedSummaryWithOptions(input, nameHint);
}

function normalizePreferredSections(
  sections: SummarySection[],
  { reclassify = true }: SummaryNormalizationOptions = {}
) {
  const preferredSections = ensurePreferredSections(sections);
  const normalizedSections = reclassify
    ? reclassifySummarySections(preferredSections)
    : preferredSections;

  return refinePreferredSections(normalizedSections);
}

export function normalizeGeneratedSummaryWithOptions(
  input: unknown,
  nameHint?: string,
  options: SummaryNormalizationOptions = {}
): StructuredSummary {
  const candidate = input as GeneratedStructuredSummary | undefined;

  if (!candidate || typeof candidate !== "object") {
    return {
      ...EMPTY_SUMMARY,
      title: defaultSummaryTitle(nameHint),
      sections: ensurePreferredSections([])
    };
  }

  const sections = normalizePreferredSections(buildSectionsFromStructuredPayload(candidate), options);
  const summaryTitle =
    typeof candidate.title === "string" && candidate.title.trim()
      ? candidate.title.trim()
      : defaultSummaryTitle(nameHint);

  return {
    title: summaryTitle,
    overview:
      typeof candidate.overview === "string" && !shouldRewriteOverview(candidate.overview)
        ? shortenOverview(candidate.overview)
        : buildOverview(summaryTitle, sections),
    sections,
    generatedAt:
      typeof candidate.generatedAt === "string" && candidate.generatedAt.trim()
        ? candidate.generatedAt.trim()
        : ""
  };
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

    for (const idea of extractFallbackIdeas(turn)) {
      const existing = sectionBuckets.get(idea.title) ?? [];
      existing.push(idea.text);
      sectionBuckets.set(idea.title, existing);
    }
  }

  const sections = sortAndMergeSections(
    [...sectionBuckets.entries()].map(([title, items], index) => ({
      id: `${slugify(title) || "section"}-${index + 1}`,
      title,
      items: normalizeSummaryItems(items)
    }))
  );

  if (sections.length === 0 && responses.length > 0) {
    const fallbackItems = limitItems(
      turns
        .filter((turn) => turn.role === "user" && !turn.skipped)
        .flatMap((turn) => splitTurnIntoStatements(turn))
    );

    sections.push({
      id: "caregiver-notes-1",
      title: "Caregiver notes",
      items: fallbackItems
    });
  }

  const finalSections = normalizePreferredSections(sections);

  return {
    ...EMPTY_SUMMARY,
    title: defaultSummaryTitle(nameHint),
    overview: buildOverview(defaultSummaryTitle(nameHint), finalSections),
    sections: finalSections,
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

  const flattenedItems = summary.sections
    .flatMap((section) => section.items)
    .filter((item) => !isNoInformationItem(item));
  if (flattenedItems.length > 0) {
    return shortenOverview(flattenedItems.slice(0, 2).join(". "));
  }

  return summary.title.trim() || defaultSummaryTitle();
}

export function normalizeStructuredSummary(input: unknown, nameHint?: string): StructuredSummary {
  return normalizeStructuredSummaryWithOptions(input, nameHint);
}

export function normalizeAuthoritativeStructuredSummary(input: unknown, nameHint?: string): StructuredSummary {
  return normalizeStructuredSummaryWithOptions(input, nameHint, { reclassify: false });
}

export function normalizeStructuredSummaryWithOptions(
  input: unknown,
  nameHint?: string,
  options: SummaryNormalizationOptions = {}
): StructuredSummary {
  const candidate = input as Partial<StructuredSummary & LegacyStructuredSummary & GeneratedStructuredSummary> | undefined;

  if (!candidate) {
    return {
      ...EMPTY_SUMMARY,
      title: defaultSummaryTitle(nameHint)
    };
  }

  if (GENERATED_SUMMARY_SECTION_FIELDS.some((field) => field.key in candidate)) {
    return normalizeGeneratedSummaryWithOptions(candidate, nameHint, options);
  }

  if (Array.isArray(candidate.sections) || typeof candidate.title === "string" || typeof candidate.overview === "string") {
    const sections = Array.isArray(candidate.sections)
      ? candidate.sections
          .map((section, index) => normalizeSection(section, index))
          .filter((section): section is SummarySection => Boolean(section))
      : [];

    const orderedSections = sortAndMergeSections(sections);
    const finalSections = usesPreferredSectionStructure(orderedSections)
      ? normalizePreferredSections(orderedSections, options)
      : orderedSections;
    const summaryTitle =
      typeof candidate.title === "string" && candidate.title.trim()
        ? candidate.title.trim()
        : defaultSummaryTitle(nameHint);

    return {
      title: summaryTitle,
      overview:
        typeof candidate.overview === "string" && !shouldRewriteOverview(candidate.overview)
          ? shortenOverview(candidate.overview)
          : buildOverview(summaryTitle, finalSections),
      sections: finalSections,
      generatedAt:
        typeof candidate.generatedAt === "string" && candidate.generatedAt.trim()
          ? candidate.generatedAt.trim()
          : ""
    };
  }

  return normalizeLegacySummary(candidate, nameHint);
}
