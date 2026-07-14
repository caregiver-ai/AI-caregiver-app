import { EMPTY_SUMMARY } from "@/lib/constants";
import {
  getSummarySectionDisplayTitle,
  getSectionBlocks
} from "@/lib/summary-display";
import { deriveItemsFromBlocks, hydrateStructuredSection } from "@/lib/summary-structured";
import {
  CaregiverInsight,
  ConversationTurn,
  SummaryBlock,
  StructuredSummary,
  SummarySection,
  UiLanguage
} from "@/lib/types";

const NO_INFORMATION_PLACEHOLDER = "(No information provided)";
const OVERVIEW_LABELS = [
  "Communication",
  "Key Needs",
  "Top Risks",
  "Best Supports",
  "Emergency Contact"
] as const;

export const PREFERRED_SUMMARY_SECTION_ORDER = [
  "About",
  "Communication",
  "Understanding and Learning",
  "Daily Routine",
  "Food and Meals",
  "Activities and Interests",
  "What Can Upset or Overwhelm",
  "Signs They Need Help",
  "What Helps When They Are Having a Hard Time",
  "Health & Safety",
  "Quick Tips for New Caregivers"
] as const;

type PreferredSummarySectionTitle = (typeof PREFERRED_SUMMARY_SECTION_ORDER)[number];

const GENERATED_SUMMARY_SECTION_FIELDS = [
  { key: "communication", title: "Communication" },
  { key: "understandingAndLearning", title: "Understanding and Learning" },
  { key: "dailySchedule", title: "Daily Routine" },
  { key: "activitiesAndPreferences", title: "Activities and Interests" },
  { key: "signsTheyAreHavingAHardTime", title: "Signs They Need Help" },
  {
    key: "whatHelpsWhenTheyAreHavingAHardTime",
    title: "What Helps When They Are Having a Hard Time"
  },
  { key: "healthAndSafety", title: "Health & Safety" }
] as const;

type GeneratedSummarySectionKey = (typeof GENERATED_SUMMARY_SECTION_FIELDS)[number]["key"];

type GeneratedStructuredSummary = {
  title?: unknown;
  overview?: unknown;
  caregiverInsights?: unknown;
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

const STRONG_HEALTH_PATTERN =
  /\b(allerg|diagnos|disabil|condition|medicat|medicine|dose|mg\b|abilify|aripiprazole|miralax|polyethylene glycol|clearlax|gavilax|healthylax|multivitamin|gummy vites|seizure|epilep|asthma|diabet|wheelchair|hearing aid|glasses|feeding tube|brace|cane|equipment|pica|autism|syndrome|cerebral palsy|adhd|dementia|vision|hearing loss|sensory processing difficulty|two people|more than one person|at least two)\b/i;
const HEALTH_PATTERN =
  /\b(allerg|diagnos|disabil|condition|medicat|medicine|dose|mg\b|abilify|aripiprazole|miralax|polyethylene glycol|clearlax|gavilax|healthylax|multivitamin|gummy vites|seizure|epilep|asthma|diabet|wheelchair|hearing aid|glasses|feeding tube|brace|cane|equipment|supervision|safety|unsafe|risk|wander|pica|autism|syndrome|cerebral palsy|adhd|dementia|vision|hearing loss|sensory processing difficulty|two people|more than one person|at least two)\b/i;
const LEARNING_PATTERN =
  /\b(learn|understand|read|write|literacy|one-step|two-step|2-step|direction|extra time|express|consequence|decision|recognizes? (?:pictures?|words?)|visual learner|very visual|first[ -]?then|first this,? then that|model(?:ing)?|watch(?:ing)?|videos?|pictures?|actual items?|items themselves|physical cues?|gentle physical cues?|tap(?:ping)? .*foot)\b/i;
const HARD_TIME_SUPPORT_PATTERN =
  /\b(calm|quieter|reduce noise|reduce stimulation|dim lights|give space|stay nearby|space|quiet|do not crowd|don't crowd|back off|time alone|headphones|music|fidget|weighted blanket|favorite item|favorite drink|favorite snack|countdown|timer|visual schedule|written schedule|visual timer|reassur|incentive|car ride|go outside|transition|squeeze and release|deep breaths?|count(?:ing)? to 10|swedish fish|gumm(?:y|ies)|candy|safe|hurt (?:himself|herself|themself))\b/i;
const HARD_TIME_SIGNS_PATTERN =
  /\b(hard time|trigger|upset|overwhelm|routine change|waiting|rushed|loud noise|crowded|hunger|thirst|pain|poor sleep|illness|too hot|too cold|low energy|limp(?:s|ed|ing)?|not eating|not drinking|breathing change|covering ears|covering eyes|staring|not responding|stiffen|jerk|pacing|repetitive|yelling|quieter|aggression|self-injury|hand biting|angry vocalizations?|press(?:es|ed|ing)? help|withdraw|running away|elop(?:e|es|ed|ing|ement)?|hiding|grunting|repeat(?:ing)? words|difficulty communicating)\b/i;
const DAILY_PATTERN =
  /\b(daily|routine|morning|wake|bathroom|toilet|toileting|pull-?up|bowel movement|shower|dress|groom|deodorant|breakfast|meal|snack|eat|drink|bedtime|blanket|lights out|brush(?:ing)? teeth|prepar(?:e|ing) for work|school|day program|reminder)\b/i;
const COMMUNICATION_PATTERN =
  /\b(communicat|speak|speaking|sound|gesture|point|sign language|aac|touchchat|communication device|writing|texting|limited choices|visual choices|simple language|waiting before repeating|pictures|demonstration|means?|lead(?:s|ing)? (?:you|a caregiver|caregivers|them|him|her)|sitting close|attention)\b/i;
const ACTIVITIES_PATTERN =
  /\b(activit|enjoy|favorite|music|animal|book|technology|ipad|phone|video game|art|shopping|game|sport|walk|restaurant|community|friend|family|pet|caregiver|outside the home|car ride|downtime|watch tv|being left alone|left alone to do)\b/i;
const QUESTION_ECHO_PATTERN =
  /^(what|who|how|when|where|why|are|do|does|did|is|can|could|should|would)\b.*\?$/i;
const NON_ANSWER_PATTERN =
  /^(?:use skip|skip|n\/a|na|none|unknown|not sure|not stated|not provided|no information)$/i;

function itemLooksLikeHardTimeSupport(item: string) {
  return HARD_TIME_SUPPORT_PATTERN.test(item) &&
    /\b(helpful|helps|work best|works best|calm|sooth|regulat|redirect|reduce|prompt|give (?:him|her|them)?\s*space|keep(?:ing)? (?:everything|things|it)?\s*quiet|do not crowd|don't crowd|back off|time alone|time to calm|moment to (?:himself|herself|themself)|squeeze and release|deep breaths?|count(?:ing)? to 10|make sure .*safe|cannot hurt|can't hurt|do not|don't|swedish fish|gumm(?:y|ies)|candy|visual schedule|visual timer)\b/i.test(
      item
    );
}

function itemLooksLikePreferredActivitiesList(item: string) {
  return /^Preferred activities include\b/i.test(item) ||
    (
      item.length > 180 &&
      /\b(walks?|scooter|swimming|swinging|jumping|horseback|car rides?|farms?|animals?|dinosaurs?|books?|planets?|music|ipad|youtube|malls?|museums?|stores?)\b/i.test(item)
    );
}

function itemExplicitlySaysPreferenceHelps(item: string) {
  return /\b(helps?|helpful|works? best|calm|sooth|regulat|redirect|reset|transition|hard time|upset|dysregulated|escalat)\b/i.test(
    item
  );
}

function itemLooksLikeLearningSupport(item: string) {
  if (/\b(likes?|loves?|enjoys?|favorite|preferred activities|downtime)\b/i.test(item)) {
    return false;
  }

  return LEARNING_PATTERN.test(item) &&
    /\b(visual|pictures?|actual items?|items themselves|videos?|model(?:ing)?|watch(?:ing)?|two-step|2-step|first[ -]?then|first this,? then that|directions?|physical cues?|gentle physical cues?|tap(?:ping)? .*foot|prompt(?:s|ing)? .*lift)\b/i.test(item);
}

function itemLooksLikeLearningItem(item: string) {
  if (itemLooksLikeLearningSupport(item)) {
    return true;
  }

  if (/\b(likes?|loves?|enjoys?|favorite|preferred activities|downtime|watch tv|being left alone|left alone to do)\b/i.test(item)) {
    return false;
  }

  return LEARNING_PATTERN.test(item);
}

function itemLooksLikeEquipmentInventory(item: string) {
  if (itemLooksLikeHardTimeSupport(item)) {
    return false;
  }

  if (
    /\bpull-?ups?\b/i.test(item) &&
    /\b(bowel movements?|bathroom|toilet|toileting)\b/i.test(item)
  ) {
    return false;
  }

  return /\b(noise-?cancel(?:ing|ling)? headphones?|buckle buddy|white cane|pull-?ups?|fidgets?)\b/i.test(item) &&
    !/\b(calm|sooth|regulat|reset|helps?|helpful|hard time|upset|escalat)\b/i.test(item);
}

function itemLooksLikeNonEmergencyContactDetail(item: string) {
  return /\b(facebook group|parent group|parents describe|decode|unclear words?|unclear phrases?|what .*means?|talk(?:s|ing)? to|on the phone to show|over bluetooth|takes .*places|weekends?|friends?|social media|eye contact|physical contact)\b/i.test(item);
}

function itemLooksLikeActualEmergencyContact(item: string) {
  const content = item.replace(/^[^:]+:\s*/, "");

  if (itemLooksLikeNonEmergencyContactDetail(content)) {
    return false;
  }

  if (/\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/.test(content)) {
    return true;
  }

  return /\b(?:call 911|emergency|non-?emergency|crisis support|guardian|physical custody|phone number|contact .*first|call(?:ed)? .*first|should be called first|contact (?:his|her|their)?\s*(?:mother|father|parent|guardian|grandmother|grandfather|sister|brother)|(?:mother|father|parent|guardian|grandmother|grandfather|sister|brother).{0,60}\b(?:emergency|contact|call|called first|phone number))\b/i.test(
    content
  );
}

function itemLooksLikeNegativeRisk(item: string) {
  const content = item.replace(/^[^:]+:\s*/, "");
  return /\b(?:does not|doesn't|do not|don't|has not|never|no known|not known|not a|not at)\b.{0,55}\b(?:run away|running away|elope|elopement|wander|safety risk|risk|unsafe)\b/i.test(
    content
  );
}

const OVERVIEW_GROUP_LABEL_PATTERN =
  /\b(?:How they communicate|What specific things mean|What helps communication|How they learn|Visual and concrete supports|Day-specific routines|Hygiene and dressing details|Toileting and bathroom support|Morning and daily routines|Food and drink notes|Technology and music|Movement and physical activities|Sensory activities|Outings and exploration|Interests and toys|Social preferences and downtime|Other activities and preferences|Additional activity notes|Sensory and environmental triggers|Routine, transition, and control triggers|Body-state triggers|Body signs|Behavior signs|Communication signs|Environmental supports|Calming supports|Transitions and motivation|Safety in the moment|Additional support notes|Emergency contacts|Diagnoses and conditions|Medications and allergies|Equipment and supports|Supervision and safety|Quick tips):\s*/gi;

function cleanOverviewItem(item: string) {
  const cleaned = compactWhitespace(
    item
      .replace(OVERVIEW_GROUP_LABEL_PATTERN, "")
      .replace(/^(?:Environmental supports|Calming supports|Transition supports|Technology and music interests|Movement activities|Sensory activities|Outings and exploration|Interests|Social connection and downtime|Other activities and preferences)\s+include\s+/i, "")
      .replace(/\s+([.,;:!?])/g, "$1")
  );
  if (!cleaned || !/^[a-z]/.test(cleaned) || /^iPad\b/.test(cleaned)) {
    return cleaned;
  }

  return `${cleaned.charAt(0).toUpperCase()}${cleaned.slice(1)}`;
}

const FALLBACK_STEP_TO_SECTION_TITLE: Record<string, PreferredSummarySectionTitle> = {
  communication: "Communication",
  understanding_learning: "Understanding and Learning",
  daily_schedule: "Daily Routine",
  activities_preferences: "Activities and Interests",
  upset_overwhelm: "What Can Upset or Overwhelm",
  signs_need_help: "Signs They Need Help",
  hard_time_support: "What Helps When They Are Having a Hard Time",
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
  "really",
  "she",
  "that",
  "the",
  "their",
  "them",
  "they",
  "this",
  "to",
  "very",
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

  if (
    /\belop/.test(normalizedLeft) &&
    /\belop/.test(normalizedRight) &&
    /\b(upset|hard time|dysregulat)\b/.test(normalizedLeft) &&
    /\b(upset|hard time|dysregulat)\b/.test(normalizedRight)
  ) {
    return true;
  }

  if (
    /\b(two people|more than one person|at least two people|two caregivers)\b/.test(normalizedLeft) &&
    /\b(two people|more than one person|at least two people|two caregivers)\b/.test(normalizedRight) &&
    /\bcar rides?\b/.test(`${normalizedLeft} ${normalizedRight}`) &&
    /\bwalks?\b/.test(`${normalizedLeft} ${normalizedRight}`)
  ) {
    return true;
  }

  if (
    (
      /\b(?:press(?:es)?|select(?:s)?)\b.*\bhelp\b/.test(normalizedLeft) &&
      /\b(?:press(?:es)?|select(?:s)?)\b.*\bhelp\b/.test(normalizedRight)
    ) ||
    (
      /\bsigns?\b.*\bhelp\b/.test(normalizedLeft) &&
      /\bsigns?\b.*\bhelp\b/.test(normalizedRight)
    ) ||
    (
      /\basks?\b.*\bhelp\b/.test(normalizedLeft) &&
      /\basks?\b.*\bhelp\b/.test(normalizedRight)
    )
  ) {
    return true;
  }

  if (
    /\b(abilify|aripiprazole)\b/.test(normalizedLeft) &&
    /\b(abilify|aripiprazole)\b/.test(normalizedRight)
  ) {
    return true;
  }

  if (
    /\b(miralax|polyethylene glycol|clearlax|gavilax|healthylax)\b/.test(normalizedLeft) &&
    /\b(miralax|polyethylene glycol|clearlax|gavilax|healthylax)\b/.test(normalizedRight)
  ) {
    return true;
  }

  if (
    /\b(swedish fish|gumm(?:y|ies)|candy)\b/.test(normalizedLeft) &&
    /\b(swedish fish|gumm(?:y|ies)|candy)\b/.test(normalizedRight) &&
    /\b(transition|hard time|redirect|motivat|calm|upset)\b/.test(normalizedLeft) &&
    /\b(transition|hard time|redirect|motivat|calm|upset)\b/.test(normalizedRight)
  ) {
    return true;
  }

  if (
    /\b(body language|nonverbal|non verbal|sounds?|vocali[sz])\b/.test(normalizedLeft) &&
    /\b(body language|nonverbal|non verbal|sounds?|vocali[sz])\b/.test(normalizedRight) &&
    /\bcommunicat|express/.test(`${normalizedLeft} ${normalizedRight}`)
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

function mergeComplementaryItems(values: string[]) {
  const normalizedValues = values.map(normalizeComparisonText);
  const combined = normalizedValues.join(" ");

  if (
    normalizedValues.every((value) =>
      /\b(two people|more than one person|at least two people|two caregivers)\b/.test(value)
    ) &&
    /\bcar rides?\b/.test(combined) &&
    /\bwalks?\b/.test(combined)
  ) {
    return values.some((value) => /\bGavin\b/.test(value))
      ? "Gavin needs more than one person with him for car rides and walks."
      : "They need more than one person with them for car rides and walks.";
  }

  if (combined.includes("abilify") || combined.includes("aripiprazole")) {
    const text = values.join(" ");
    const subject = values.some((value) => /\bGavin\b/.test(value)) ? "Gavin" : "They";
    const takes = subject === "They" ? "take" : "takes";
    const medication =
      combined.includes("abilify") && combined.includes("aripiprazole")
        ? "Abilify (aripiprazole)"
        : combined.includes("aripiprazole")
          ? "aripiprazole"
          : "Abilify";
    const dose = text.match(/\b\d+(?:\.\d+)?\s*mg\b/i)?.[0] ?? "";
    const frequency = /\bonce daily\b/i.test(text)
      ? "once daily"
      : /\bonce a day\b/i.test(text)
        ? "once a day"
        : /\bdaily\b/i.test(text)
          ? "daily"
          : "";
    const time = text.match(/\bat\s+\d{1,2}(?::\d{2})?\s*(?:a\.m\.|p\.m\.|am|pm)\b/i)?.[0] ?? "";
    const details = [dose, frequency, time].filter(Boolean).join(" ");
    const purposes = [
      /\birritability\b/i.test(text) ? "irritability" : "",
      /\baggression\b/i.test(text) ? "aggression" : "",
      /\brepetitive behaviors?\b/i.test(text) ? "repetitive behaviors" : "",
      /\bself-injury\b/i.test(text) ? "self-injury" : ""
    ].filter(Boolean);
    const purpose = purposes.length > 0 ? ` to help manage ${formatList(purposes)}` : "";
    return `${subject} ${takes} ${medication}${details ? ` ${details}` : ""}${purpose}.`;
  }

  if (/\b(miralax|polyethylene glycol|clearlax|gavilax|healthylax)\b/.test(combined)) {
    const text = values.join(" ");
    const subject = values.some((value) => /\bGavin\b/.test(value)) ? "Gavin" : "They";
    const takes = subject === "They" ? "take" : "takes";
    const hasPolyethylene = /\bpolyethylene glycol\b/i.test(text);
    const hasMiralax = /\bmiralax\b/i.test(text);
    const has3350 = /\b3350\b/i.test(text);
    const medication =
      hasPolyethylene && hasMiralax
        ? `polyethylene glycol${has3350 ? " 3350" : ""} / MiraLax`
        : hasPolyethylene
          ? `polyethylene glycol${has3350 ? " 3350" : ""}`
          : "MiraLax";
    const details = [
      /\bdaily\b/i.test(text) ? "daily" : "",
      /\bin water\b/i.test(text) ? "in water" : ""
    ].filter(Boolean).join(" ");
    const purpose = /\bstool regular\b/i.test(text) ? " to keep stool regular" : "";
    return `${subject} ${takes} ${medication}${details ? ` ${details}` : ""}${purpose}.`;
  }

  return null;
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
    const preferred =
      mergeComplementaryItems(candidates) ??
      candidates.sort((left, right) => right.length - left.length)[0];
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
  let condensed = replaceItemGroup(
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

  condensed = replaceItemGroup(
    condensed,
    (item) =>
      /\b(body language|nonverbal|non-verbal|sounds?|vocali[sz]|singing-like|happy sounds?|angry sounds?)\b/i.test(item) &&
      /\b(communicat|express|sound|nonverbal|body language)\b/i.test(item),
    (matched) => {
      const text = matched.join(" ");
      const name = matched
        .map((item) => item.match(/^([A-Z][A-Za-z'-]+)\b/)?.[1] ?? "")
        .find((candidate) => candidate && !/^(?:He|She|They|On|The|An|If)$/i.test(candidate));
      const subject = name || "They";
      const channels = [
        /\bbody language\b/i.test(text) ? "body language" : "",
        /\bnonverbal|non-verbal\b/i.test(text) ? "other nonverbal communication" : "",
        /\bsounds?|vocali[sz]/i.test(text) ? "sounds" : "",
        /\bhappy sounds?\b/i.test(text) ? "happy sounds" : "",
        /\bsinging-like|singing\b/i.test(text) ? "singing-like sounds" : "",
        /\bangry sounds?\b/i.test(text) ? "angry sounds" : ""
      ].filter(Boolean);
      return channels.length >= 2
        ? `${subject} communicate${subject === "They" ? "" : "s"} with ${formatList([...new Set(channels)])}.`
        : null;
    }
  );

  return condensed;
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

  condensed = replaceItemGroup(
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

  return replaceItemGroup(
    condensed,
    (item) => /\b(swedish fish|gumm(?:y|ies)|candy)\b/i.test(item),
    (matched) => {
      const text = matched.join(" ");
      const uses = [
        /\bredirect/i.test(text) ? "redirect him" : "",
        /\bmotivat|reward|transition/i.test(text) ? "motivate him during transitions" : "",
        /\bcalm/i.test(text) ? "help him calm" : ""
      ].filter(Boolean);
      const action = uses.length > 0 ? ` to ${formatList([...new Set(uses)])}` : "";
      return matched.length >= 2
        ? `Candy such as Swedish Fish or gummies can sometimes help${action}.`
        : null;
    }
  );
}

function condenseHealthSafety(items: string[]) {
  let condensed = replaceItemGroup(
    items,
    (item) => /\b(abilify|aripiprazole)\b/i.test(item),
    (matched) => (matched.length >= 2 ? mergeComplementaryItems(matched) : null)
  );

  condensed = replaceItemGroup(
    condensed,
    (item) => /\b(miralax|polyethylene glycol|clearlax|gavilax|healthylax)\b/i.test(item),
    (matched) => (matched.length >= 2 ? mergeComplementaryItems(matched) : null)
  );

  condensed = replaceItemGroup(
    condensed,
    (item) =>
      /\b(diagnoses and conditions|autism spectrum disorder|cerebral visual impairment|cvi|pica|language regression|mixed receptive-expressive language disorder|global developmental delay|apraxia of speech|low muscle tone|sensory processing difficulty)\b/i.test(item),
    (matched) => {
      const text = matched.join(" ");
      const diagnoses = [
        /\bautism spectrum disorder\b/i.test(text) ? "Autism Spectrum Disorder" : "",
        /\bcerebral visual impairment|cvi\b/i.test(text) ? "Cerebral Visual Impairment (CVI)" : "",
        /\bpica\b/i.test(text) ? "Pica" : "",
        /\blanguage regression\b/i.test(text) ? "Language Regression" : "",
        /\bmixed receptive-expressive language disorder\b/i.test(text)
          ? "Mixed receptive-expressive language disorder"
          : "",
        /\bglobal developmental delay\b/i.test(text) ? "Global Developmental Delay" : "",
        /\bapraxia of speech\b/i.test(text) ? "Apraxia of Speech" : "",
        /\blow muscle tone\b/i.test(text) ? "low muscle tone" : "",
        /\bsensory processing difficulty\b/i.test(text) ? "Sensory Processing Difficulty" : ""
      ].filter(Boolean);
      return diagnoses.length >= 2
        ? `Diagnoses and conditions include ${formatList([...new Set(diagnoses)])}.`
        : null;
    }
  );

  return replaceItemGroup(
    condensed,
    (item) =>
      /\b(noise-?cancel(?:ing|ling)? headphones?|buckle buddy|white cane|pull-?ups?|fidgets?)\b/i.test(item),
    (matched) => {
      const text = matched.join(" ");
      const equipment = [
        /\bnoise-?cancel(?:ing|ling)? headphones?\b/i.test(text) ? "noise-canceling headphones" : "",
        /\bbuckle buddy\b/i.test(text) ? "Buckle Buddy" : "",
        /\bwhite cane\b/i.test(text) ? "white cane" : "",
        /\bpull-?ups?\b/i.test(text) ? "pull-ups" : "",
        /\bfidgets?\b/i.test(text) ? "fidgets" : ""
      ].filter(Boolean);
      return equipment.length >= 2
        ? `Equipment and supports include ${formatList([...new Set(equipment)])}.`
        : null;
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

  if (/^about(?:\s+.+)?$/i.test(normalized)) {
    return "About";
  }

  if (/^communication$/i.test(normalized)) {
    return "Communication";
  }

  if (/^(understanding and learning|learning and understanding)$/i.test(normalized)) {
    return "Understanding and Learning";
  }

  if (/^(daily routine|daily schedule|daily needs(?: and| &) routines|daily needs to know.*)$/i.test(normalized)) {
    return "Daily Routine";
  }

  if (/^(food(?: and| &) meals|food and nutrition|meals(?: and| &) snacks|meals?|snacks?)$/i.test(normalized)) {
    return "Food and Meals";
  }

  if (
    /^(activities(?: and| &) interests|activities(?: and| &) preferences|what helps the day go well|what .* enjoys?|preferred activities)$/i.test(
      normalized
    )
  ) {
    return "Activities and Interests";
  }

  if (
    /^(what can upset(?: or overwhelm)?.*|situations that make things harder)$/i.test(
      normalized
    )
  ) {
    return "What Can Upset or Overwhelm";
  }

  if (/^(signs .* (?:having a hard time|needs? help)|signs .* may need help|body signs|behavior or communication changes)$/i.test(normalized)) {
    return "Signs They Need Help";
  }

  if (/^(what helps when .* having a hard time|what to do when .* upset)$/i.test(normalized)) {
    return "What Helps When They Are Having a Hard Time";
  }

  if (
    /^(health(?: and| &) safety|who to contact.*|contacts?|safety notes.*|medications?.*|equipment.*|health conditions.*)$/i.test(
      normalized
    )
  ) {
    return "Health & Safety";
  }

  if (/^quick tips(?: for new caregivers)?$/i.test(normalized)) {
    return "Quick Tips for New Caregivers";
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
        : title === "Activities and Interests"
        ? condenseActivityPreferences(uniqueSectionItems)
        : title === "Signs They Need Help"
          ? condenseHardTimeSigns(uniqueSectionItems)
          : title === "What Helps When They Are Having a Hard Time"
            ? condenseHardTimeSupports(uniqueSectionItems)
            : title === "Health & Safety"
              ? condenseHealthSafety(uniqueSectionItems)
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

function uniqueCompactStrings(values: unknown[]) {
  const seen = new Set<string>();
  const items: string[] = [];

  for (const value of values) {
    const item = compactWhitespace(String(value));
    if (!item || seen.has(item)) {
      continue;
    }

    seen.add(item);
    items.push(item);
  }

  return items;
}

function normalizeCaregiverInsights(input: unknown): CaregiverInsight[] {
  if (!Array.isArray(input)) {
    return [];
  }

  return input
    .map((entry, index) => {
      const candidate = entry as Partial<CaregiverInsight> | undefined;
      const statement = cleanSummaryItem(String(candidate?.statement ?? ""));
      if (!candidate || !statement || isNoInformationItem(statement)) {
        return null;
      }

      const section = canonicalizeSectionTitle(String(candidate.section ?? "")) ?? "";
      const supportingFactIds = uniqueCompactStrings(
        Array.isArray(candidate.supportingFactIds)
          ? candidate.supportingFactIds
          : []
      );
      const themes = uniqueCompactStrings(
        Array.isArray(candidate.themes) ? candidate.themes : []
      );
      const insightId =
        compactWhitespace(String(candidate.insightId ?? "")) ||
        `insight-${index + 1}-${slugify(statement).slice(0, 32)}`;

      return {
        insightId,
        section,
        statement,
        supportingFactIds,
        themes
      } satisfies CaregiverInsight;
    })
    .filter((insight): insight is CaregiverInsight => Boolean(insight));
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

function selectEmergencyContact(sections: SummarySection[]) {
  const healthItems =
    sections
      .find((section) => section.title === "Health & Safety")
      ?.items.filter((item) => !isNoInformationItem(item)) ?? [];

  return (
    healthItems.find((item) => /\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/.test(item) && itemLooksLikeActualEmergencyContact(item)) ??
    healthItems.find(itemLooksLikeActualEmergencyContact) ??
    ""
  );
}

function bestScoredItem(items: string[], scoreItem: (item: string) => number) {
  return items
    .filter((item) => !isNoInformationItem(item))
    .map((item) => ({ item, score: scoreItem(item) }))
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score || left.item.length - right.item.length)[0]?.item ?? "";
}

function selectKeyNeeds(sections: SummarySection[]) {
  const learningItems =
    sections
      .find((section) => section.title === "Understanding and Learning")
      ?.items.filter((item) => !isNoInformationItem(item)) ?? [];
  const learningNeed = bestScoredItem(learningItems, (item) => {
    if (STRONG_HEALTH_PATTERN.test(item) || HEALTH_PATTERN.test(item)) {
      return 0;
    }
    if (/\b(no interest|does not pay attention|not helpful|does not help|does not work|do not work)\b/i.test(item)) {
      return 0;
    }
    if (
      /\b(friend|friends|likes?|loves?|enjoys?|favorite|preferred|downtime|video games?|games?|train-loving|music class|youtube)\b/i.test(item) &&
      !/\b(learns?|understand|support|helps?|helpful|best with|schedule|first[ -]?then|directions?|model(?:ing)?|prompt|two-step|2-step|pictures?|actual items?)\b/i.test(item)
    ) {
      return 0;
    }

    let score = 1;
    if (/\b(visual|pictures?|items?|videos?|model(?:ing)?|watch(?:ing)?)\b/i.test(item)) {
      score += 4;
    }
    if (/\b(two-step|2-step|first[ -]?then|directions?)\b/i.test(item)) {
      score += 4;
    }
    if (/\b(prompt|physical cue|tap(?:ping)? .*foot)\b/i.test(item)) {
      score += 2;
    }
    return score;
  });
  if (learningNeed) {
    return learningNeed;
  }

  const dailyItems =
    sections
      .find((section) => section.title === "Daily Routine")
      ?.items.filter((item) => !isNoInformationItem(item)) ?? [];
  return bestScoredItem(dailyItems, (item) => {
    let score = 1;
    if (/\b(routine|bathroom|food|hungry|prompt|schedule)\b/i.test(item)) {
      score += 3;
    }
    return score;
  }) || firstMeaningfulItem(sections, "Daily Routine");
}

function selectBestSupports(sections: SummarySection[]) {
  const supportItems =
    sections
      .find((section) => section.title === "What Helps When They Are Having a Hard Time")
      ?.items.filter((item) => !isNoInformationItem(item)) ?? [];
  const support = bestScoredItem(supportItems, (item) => {
    if (itemLooksLikePreferredActivitiesList(item)) {
      return 0;
    }

    let score = 1;
    if (/\b(space|quiet|reduce noise|reduce stimulation|low-light|time alone)\b/i.test(item)) {
      score += 5;
    }
    if (/\b(car rides?|reset|visual schedule|visual timer|transition)\b/i.test(item)) {
      score += 4;
    }
    if (/\b(squeeze and release|deep breaths?|count(?:ing)? to 10|calm)\b/i.test(item)) {
      score += 3;
    }
    if (/\b(dog|romeo|emotional support)\b/i.test(item)) {
      score += 6;
    }
    if (/\b(make sure .*safe|cannot hurt|can't hurt|do not block|may bite)\b/i.test(item)) {
      score += 2;
    }
    if (item.length > 220) {
      score -= 4;
    }
    return score;
  });
  if (support) {
    return support;
  }

  return firstMeaningfulItem(sections, "What Helps When They Are Having a Hard Time") ||
    firstMeaningfulItem(sections, "Activities and Interests");
}

function selectCommunicationOverview(sections: SummarySection[]) {
  const communicationItems =
    sections
      .find((section) => section.title === "Communication")
      ?.items.filter((item) => !isNoInformationItem(item)) ?? [];

  return bestScoredItem(communicationItems, (item) => {
    let score = 1;
    if (/\b(non-speaking|does not speak|cannot say words)\b/i.test(item)) {
      score += 5;
    }
    if (/\b(aac|touchchat|communication device|ipad)\b/i.test(item)) {
      score += 5;
    }
    if (/\b(body language|sounds?|gesture|lead|touch|proximity|close)\b/i.test(item)) {
      score += 3;
    }
    if (/\b(help|i want ipad|request|label)\b/i.test(item)) {
      score += 2;
    }
    if (/\bdoes not tell caregivers when\b/i.test(item)) {
      score -= 3;
    }
    if (item.length > 220) {
      score -= 4;
    }
    return score;
  }) || communicationItems[0] || "";
}

function buildOverview(sections: SummarySection[]) {
  const communication = cleanOverviewItem(selectCommunicationOverview(sections));
  const keyNeeds = cleanOverviewItem(selectKeyNeeds(sections));
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
      : (
          sections
            .find((section) => section.title === "Health & Safety")
            ?.items.find(
              (item) =>
                !isNoInformationItem(item) &&
                !itemLooksLikeNegativeRisk(item) &&
                /\b(safety|risk|supervision|wander|elop|self-injury|unsafe|two adults|two caregivers)\b/i.test(item)
            ) ?? ""
        ) ||
        (
          sections
            .find((section) => section.title === "Signs They Need Help")
            ?.items.find((item) => !isNoInformationItem(item) && !itemLooksLikeNegativeRisk(item)) ?? ""
        );
  const bestSupports = cleanOverviewItem(selectBestSupports(sections));
  const emergencyContact = selectEmergencyContact(sections);
  const emergencyContactValue = cleanOverviewItem(emergencyContact).replace(
    /^Emergency contact:\s*/i,
    "",
  );

  return [
    `Communication: ${communication || "Not provided"}`,
    `Key Needs: ${keyNeeds || "Not provided"}`,
    `Top Risks: ${cleanOverviewItem(topRisks) || "Not provided"}`,
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
  if (currentTitle === "About" || currentTitle === "Quick Tips for New Caregivers") {
    return currentTitle;
  }

  if (
    currentTitle === "What Can Upset or Overwhelm" &&
    /\b(trigger|upset|overwhelm|hard|rushed|waiting|loud|crowded|hunger|thirst|pain|poor sleep|illness|too hot|too cold|routine change|out of place|moved|bright lights?)\b/i.test(item)
  ) {
    return currentTitle;
  }

  if (itemLooksLikeActualEmergencyContact(item)) {
    return "Health & Safety";
  }

  if (
    currentTitle === "Communication" &&
    COMMUNICATION_PATTERN.test(item) &&
    !itemLooksLikeLearningItem(item) &&
    !HARD_TIME_SIGNS_PATTERN.test(item)
  ) {
    return currentTitle;
  }

  if (currentTitle === "Daily Routine" && DAILY_PATTERN.test(item)) {
    return currentTitle;
  }

  if (
    currentTitle === "Food and Meals" &&
    /\b(food|foods?|meal|meals?|snack|eat|eating|drink|drinking|diet|breakfast|lunch|dinner|cheese|pasta|pita|labneh|zaatar|lettuce|beans?|cauliflower|water|sippy cup|grazes?|bite-sized|appetite)\b/i.test(item)
  ) {
    return currentTitle;
  }

  if (currentTitle === "Activities and Interests" && ACTIVITIES_PATTERN.test(item)) {
    return currentTitle;
  }

  if (STRONG_HEALTH_PATTERN.test(item)) {
    return "Health & Safety";
  }

  if (
    /^(?:do not|don't)\b.*\b(?:block|stop)\b.*\b(?:hand|biting)\b/i.test(item)
  ) {
    return "What Helps When They Are Having a Hard Time";
  }

  if (itemLooksLikeHardTimeSupport(item)) {
    return "What Helps When They Are Having a Hard Time";
  }

  if (currentTitle === "Signs They Need Help" && HARD_TIME_SIGNS_PATTERN.test(item)) {
    return currentTitle;
  }

  if (currentTitle === "Health & Safety" && (STRONG_HEALTH_PATTERN.test(item) || HEALTH_PATTERN.test(item))) {
    return currentTitle;
  }

  if (
    /\b(?:press(?:es|ed|ing)?|select(?:s|ed|ing)?)\b.{0,25}\bhelp\b/i.test(item) &&
    /\b(?:when|need|needs|needed|signal|sign|mean|means)\b/i.test(item)
  ) {
    return "Signs They Need Help";
  }

  if (
    currentTitle === "What Helps When They Are Having a Hard Time" &&
    (
      /\b(?:take|try|use|go for)\b.{0,80}\bcar rides?\b/i.test(item) ||
      /\bcar rides?\b.{0,80}\b(?:calm|reset|helps?|works?|few minutes|escalat|if that does not work)\b/i.test(item)
    )
  ) {
    return "What Helps When They Are Having a Hard Time";
  }

  if (itemLooksLikePreferredActivitiesList(item) && !itemExplicitlySaysPreferenceHelps(item)) {
    return "Activities and Interests";
  }

  if (itemLooksLikeLearningItem(item)) {
    return "Understanding and Learning";
  }

  if (itemLooksLikeEquipmentInventory(item) || HEALTH_PATTERN.test(item)) {
    return "Health & Safety";
  }

  if (
    HARD_TIME_SUPPORT_PATTERN.test(item) &&
    /^(?:do not|don't|give|help|move|go|reduce|dim|stay|use|offer|provide|allow|tell|show|keep|reassure|prepare|countdown|set)\b/i.test(
      item
    )
  ) {
    return "What Helps When They Are Having a Hard Time";
  }

  if (HARD_TIME_SIGNS_PATTERN.test(item)) {
    return "Signs They Need Help";
  }

  if (DAILY_PATTERN.test(item)) {
    if (!/\bshower(?:head)?\b/i.test(item) && /\b(food|foods?|meal|meals?|snack|eat|eating|drink|drinking|diet|breakfast|lunch|dinner|cheese|pasta|pita|labneh|zaatar|lettuce|beans?|cauliflower|water|sippy cup|grazes?)\b/i.test(item)) {
      return "Food and Meals";
    }

    return "Daily Routine";
  }

  if (COMMUNICATION_PATTERN.test(item)) {
    return "Communication";
  }

  if (
    HARD_TIME_SUPPORT_PATTERN.test(item) &&
    /\b(calm|sooth|regulat|transition|hard time|reset|work best|works best)\b/i.test(item)
  ) {
    return "What Helps When They Are Having a Hard Time";
  }

  if (ACTIVITIES_PATTERN.test(item)) {
    return "Activities and Interests";
  }

  if (HARD_TIME_SUPPORT_PATTERN.test(item)) {
    return "What Helps When They Are Having a Hard Time";
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

function fallbackGroupedSupportBlocks(items: string[], nameHint?: string): SummaryBlock[] | null {
  const remaining = uniqueItems(items).filter((item) => !isNoInformationItem(item));
  if (remaining.length === 0) {
    return null;
  }

  const take = (pattern: RegExp) => {
    const matched = remaining.filter((item) => pattern.test(item));
    for (const item of matched) {
      const index = remaining.indexOf(item);
      if (index >= 0) {
        remaining.splice(index, 1);
      }
    }
    return matched;
  };

  const hasName = Boolean(compactWhitespace(nameHint ?? ""));
  const name = hasName ? compactWhitespace(nameHint ?? "") : "They";
  const continueVerb = hasName ? "Continues" : "Continue";
  const earlySignItems = take(HARD_TIME_SIGNS_PATTERN);
  const firstItems = take(/\b(space|quiet|low-light|reduce noise|reduce stimulation|time alone|do not crowd|don't crowd|back off|hand biting|block|bite you)\b/i);
  const nextItems = take(/\b(squeeze and release|deep breaths?|count(?:ing)? to 10|gumm(?:y|ies)|candy|swedish fish|ipad|internet|history|youtube|video|visual schedule|written schedule|visual timer|first[ -]?then|reward|motivat|preferred)\b/i);
  const escalationItems = take(/\b(car rides?|driv(?:e|ing)|buckle buddy|seat ?belt|back seat|backseat|two adults?|two caregivers?|few minutes|within minutes|settle|calm)\b/i);
  const groups = [
    {
      label: "Recognize the Early Signs",
      items: earlySignItems
    },
    {
      label: "First: Give Space",
      items: firstItems
    },
    {
      label: "Next: Try Simple Solutions",
      items: [...nextItems, ...remaining.splice(0, remaining.length)]
    },
    {
      label: `If ${name} ${continueVerb} to Escalate`,
      items: escalationItems
    }
  ].filter((group) => group.items.length > 0);

  return groups.length > 0
    ? [
        {
          type: "labeledBullets",
          groups
        }
      ]
    : null;
}

function applyFallbackStructuredBlocks(
  sections: SummarySection[],
  nameHint?: string
): SummarySection[] {
  return sections.map((section) => {
    if (section.title !== "What Helps When They Are Having a Hard Time") {
      return section;
    }

    const blocks = fallbackGroupedSupportBlocks(section.items, nameHint);
    return blocks
      ? {
          ...section,
          blocks,
          items: deriveItemsFromBlocks(blocks)
        }
      : section;
  });
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

  const sections = applyFallbackStructuredBlocks(normalizeSections(
    PREFERRED_SUMMARY_SECTION_ORDER.map((title, index) => ({
      id: `${slugify(title)}-${index + 1}`,
      title,
      items: buckets.get(title) ?? []
    }))
  ), nameHint);

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
      caregiverInsights: [],
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
    caregiverInsights: normalizeCaregiverInsights(candidate.caregiverInsights),
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

function preserveCurrentStructuredSections(sections: SummarySection[]) {
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
    ["Signs They Need Help", candidate.key_barriers],
    ["Signs They Need Help", candidate.emotional_concerns],
    ["Health & Safety", candidate.safety_considerations],
    ["Signs They Need Help", candidate.past_negative_experiences],
    ["What Can Upset or Overwhelm", candidate.situations_to_avoid],
    ["What Helps When They Are Having a Hard Time", candidate.conditions_for_successful_respite],
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
    caregiverInsights: [],
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
      caregiverInsights: [],
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
      preserveCurrentStructuredSections(normalizedCandidates) ??
      normalizeSections(normalizedCandidates, { reclassify });

    return {
      title:
        typeof candidate.title === "string" && candidate.title.trim()
          ? candidate.title.trim()
          : defaultSummaryTitle(nameHint),
      overview: reclassify ? buildOverview(sections) : normalizeOverview(candidate.overview, sections),
      caregiverInsights: normalizeCaregiverInsights(candidate.caregiverInsights),
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
  const insightLines = (summary.caregiverInsights ?? [])
    .map((insight) => insight.statement.trim())
    .filter(Boolean);
  const linesForSection = (section: SummarySection) => {
    const lines = [getSummarySectionDisplayTitle(summary, section)];
    if (section.intro?.trim() && !isNoInformationItem(section.intro)) {
      lines.push(section.intro.trim());
    }

    for (const block of getSectionBlocks(section)) {
      if (block.type === "note") {
        if (!isNoInformationItem(block.text)) {
          lines.push(block.text.trim());
        }
        continue;
      }

      if (block.type === "bullets") {
        lines.push(
          ...block.items
            .filter((item) => !isNoInformationItem(item))
            .map((item) => `- ${item}`)
        );
        continue;
      }

      if (block.type === "keyValue") {
        lines.push(
          ...block.rows
            .filter((row) => row.label.trim() || row.value.trim())
            .map((row) => `- ${row.label.trim()}: ${row.value.trim()}`)
        );
        continue;
      }

      for (const group of block.groups) {
        lines.push(group.label);
        if (group.intro?.trim() && !isNoInformationItem(group.intro)) {
          lines.push(group.intro.trim());
        }
        lines.push(
          ...group.items
            .filter((item) => !isNoInformationItem(item))
            .map((item) => `- ${item}`)
        );
      }
    }

    return lines;
  };
  const aboutSection = summary.sections.find((section) => /^about(?:\s+.+)?$/i.test(section.title.trim()));
  const sectionLines = summary.sections
    .filter((section) => section !== aboutSection)
    .flatMap(linesForSection);

  return [
    summary.title.trim(),
    ...(aboutSection ? linesForSection(aboutSection) : []),
    summary.overview.trim(),
    ...(insightLines.length > 0 ? ["Caregiver Insights", ...insightLines.map((item) => `- ${item}`)] : []),
    ...sectionLines
  ]
    .filter(Boolean)
    .join("\n");
}
