import { EMPTY_SUMMARY } from "@/lib/constants";
import { ConversationTurn, StructuredSummary, SummarySection, UiLanguage } from "@/lib/types";
import { hydrateStructuredSection } from "@/lib/summary-structured";

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
  semanticRepair?: boolean;
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
const TRANSCRIPT_ACKNOWLEDGEMENT_PATTERN =
  /^(?:um+[, ]+)?(?:yeah|yes|okay|ok|right|sure|mm-hmm|uh-huh|mhm|hmm|got it)(?:[.!?,\s]+)?$/i;
const LEADING_FILLER_PATTERN =
  /^(?:(?:well|so|and|but|um+|uh+|you know|like|i mean|actually|basically|sort of|kind of)\b[,\s]+)+/i;
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

  if (/\b(non speaking|non-speaking|can t say words|cannot say words|does not use words)\b/.test(normalized)) {
    concepts.add("non_speaking");
  }

  if (/\baac\b|\btouchchat\b|\bdevice on an ipad\b|\baac device\b/.test(normalized)) {
    concepts.add("aac_device");
  }

  if (
    /\b(happy sounds|angry sounds|singing like sounds|makes sounds|uses sounds|vocal sounds|singing and happy|happy noises|angry noises)\b/.test(
      normalized
    )
  ) {
    concepts.add("sound_expression");
  }

  if (/\b(press(?:es)? help|sign for help|use(?:s)? the word help)\b/.test(normalized)) {
    concepts.add("help_request_signal");
  }

  if (/\b(very visual|visual supports?|show (?:items?|pictures?)|visual timer|visual schedule)\b/.test(normalized)) {
    concepts.add("visual_support");
  }

  if (/\b(sensory seeker|sensory activities?|sensory toys?|sensory bins?)\b/.test(normalized)) {
    concepts.add("sensory_support");
  }

  if (/\b(two-step|first this then that|first this, then that|short directions?)\b/.test(normalized)) {
    concepts.add("two_step_support");
  }

  if (/\bask for help\b/.test(normalized) && /\b(?:aac|device)\b/.test(normalized)) {
    concepts.add("aac_help_request");
  }

  if (/\bselects? car\b/.test(normalized) && /\bcar ride\b/.test(normalized)) {
    concepts.add("car_selection_meaning");
  }

  if (/\b(selects? ipad|i want ipad)\b/.test(normalized)) {
    concepts.add("ipad_selection_meaning");
  }

  if (/\bselects? (?:a )?color\b/.test(normalized)) {
    concepts.add("color_selection_meaning");
  }

  if (/\b(fridge|grabbing cheese)\b/.test(normalized)) {
    concepts.add("hunger_sign");
  }

  if (/\bipad time\b/.test(normalized)) {
    concepts.add("preference_ipad_time");
  }

  if (/\bvideos?\b/.test(normalized)) {
    concepts.add("preference_videos");
  }

  if (/\bmini bus(?: toy| toys)?\b/.test(normalized)) {
    concepts.add("preference_mini_bus_toys");
  }

  if (/\bwalks?\b/.test(normalized) && !/\bregulat|calm|sooth|safety\b/.test(normalized)) {
    concepts.add("preference_walks");
  }

  if (/\bcar rides?\b/.test(normalized) && !/\bregulat|calm|sooth|safety\b/.test(normalized)) {
    concepts.add("preference_car_rides");
  }

  if (/\bikea\b/.test(normalized)) {
    concepts.add("preference_ikea");
  }

  if (/\bbass pro shops?(?: in foxborough)?\b/.test(normalized)) {
    concepts.add("preference_bass_pro_shops");
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

  if (
    /\b(stop(?:ping)?|transition(?:ing)?)\b/.test(normalized) &&
    /\b(activity|doing|bathroom|prompted)\b/.test(normalized)
  ) {
    concepts.add("transition_trigger");
  }

  if (/\b(lights?|shades?|out of place|things moved|moved)\b/.test(normalized)) {
    concepts.add("environment_rigidity_trigger");
  }

  if (/\b(loud noise|bright lights?|crowded places?|too many people|chaotic|overstimulating)\b/.test(normalized)) {
    concepts.add("sensory_trigger");
  }

  if (/\b(giv(?:e|ing)(?:\s+him)? space|time alone|moment to himself|do not crowd|reduce stimulation|keep (?:it|things|the area) quiet)\b/.test(normalized)) {
    concepts.add("space_and_quiet_support");
  }

  if (/\b(squeeze and release|deep breath|count to 10)\b/.test(normalized)) {
    concepts.add("calming_prompt");
  }

  if (/\b(agitated|agitation|overwhelmed|too dysregulated)\b/.test(normalized)) {
    concepts.add("agitation_sign");
  }

  if (/\b(usually has a lot of energy|high energy|can t sit still|cannot sit still)\b/.test(normalized)) {
    concepts.add("high_energy_baseline");
  }

  if (/\b(open|opening)\b/.test(normalized) && /\b(low muscle tone|unable|can t|cannot|help)\b/.test(normalized)) {
    concepts.add("opening_items");
  }

  if (/\b(preferred item|preferred toy|toy|object)\b/.test(normalized) && /\b(find|finding|cannot|can t|difficulty)\b/.test(normalized)) {
    concepts.add("missing_preferred_item_trigger");
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

  if (
    /\b(ipad|internet|search history)\b/.test(normalized) &&
    /\b(check|working|not working|find what he wants|video)\b/.test(normalized)
  ) {
    concepts.add("ipad_troubleshoot_action");
  }

  if (/\b(food|hungry|hunger)\b/.test(normalized) && /\b(offer|get|help|part of the problem)\b/.test(normalized)) {
    concepts.add("food_response");
  }

  if (/\b(remind|prompt)\b/.test(normalized) && /\b(bathroom|toilet)\b/.test(normalized)) {
    concepts.add("bathroom_response");
  }

  if (/\b(needs something opened|open(?:ed)?|help opening)\b/.test(normalized)) {
    concepts.add("opening_response");
  }

  if (/\b(find|trying to find|specific item|toy|video)\b/.test(normalized) && /\b(check|help)\b/.test(normalized)) {
    concepts.add("find_item_response");
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

const LEISURE_PREFERENCE_ORDER = [
  "preference_ipad_time",
  "preference_videos",
  "preference_mini_bus_toys",
  "preference_walks",
  "preference_car_rides"
] as const;

const OUTING_PREFERENCE_ORDER = [
  "preference_ikea",
  "preference_bass_pro_shops"
] as const;

const PREFERENCE_LABELS: Record<(typeof LEISURE_PREFERENCE_ORDER)[number] | (typeof OUTING_PREFERENCE_ORDER)[number], string> = {
  preference_ipad_time: "iPad time",
  preference_videos: "videos",
  preference_mini_bus_toys: "mini bus toys",
  preference_walks: "walks",
  preference_car_rides: "car rides",
  preference_ikea: "IKEA",
  preference_bass_pro_shops: "Bass Pro Shops in Foxborough"
};

function extractPreferenceConcepts(value: string) {
  const concepts = extractSummaryConcepts(value);
  return new Set(
    [...LEISURE_PREFERENCE_ORDER, ...OUTING_PREFERENCE_ORDER].filter((concept) => concepts.has(concept))
  );
}

function isSimplePreferenceItem(item: string) {
  const normalized = normalizeComparisonText(item);
  if (!/\b(likes?|enjoys?)\b/.test(normalized)) {
    return false;
  }

  if (/\b(help|helps|soothe|soothing|regulat|prevent|support)\b/.test(normalized)) {
    return false;
  }

  return extractPreferenceConcepts(item).size > 0;
}

function buildPreferenceSummaryItems(items: string[]) {
  const preferenceConcepts = new Set<string>();

  for (const item of items) {
    for (const concept of extractPreferenceConcepts(item)) {
      preferenceConcepts.add(concept);
    }
  }

  const leisureLabels = LEISURE_PREFERENCE_ORDER.filter((concept) =>
    preferenceConcepts.has(concept)
  ).map((concept) => PREFERENCE_LABELS[concept]);
  const outingLabels = OUTING_PREFERENCE_ORDER.filter((concept) =>
    preferenceConcepts.has(concept)
  ).map((concept) => PREFERENCE_LABELS[concept]);

  const summaryItems: string[] = [];

  if (leisureLabels.length > 0) {
    summaryItems.push(`He enjoys ${formatList(leisureLabels)}.`);
  }

  if (outingLabels.length > 0) {
    summaryItems.push(`He enjoys outings such as ${formatList(outingLabels)}.`);
  }

  return summaryItems;
}

function extractPreferenceFragments(item: string) {
  const trimmed = item.trim().replace(/[.!?]+$/, "");
  const directPreferenceMatch = trimmed.match(
    /^(?:he|she|they|gavin)\s+(?:really\s+)?(?:likes?|loves?|enjoys?|especially enjoys)\s+(.+)$/i
  );
  const favoritesMatch = trimmed.match(
    /^(?:his|her|their)\s+biggest favorites are\s+(.+)$/i
  );
  const source = directPreferenceMatch?.[1] ?? favoritesMatch?.[1];

  if (!source) {
    return [];
  }

  return source
    .split(/\s*,\s*|\s+and\s+/i)
    .map((part) => part.trim())
    .filter((part) => part.length > 1)
    .map((part) => part.replace(/^(?:his|her|their)\s+/i, "").trim())
    .filter(Boolean);
}

function isPreferenceMicroItem(item: string) {
  if (lookLikeSupportAction(item)) {
    return false;
  }

  return extractPreferenceFragments(item).length > 0;
}

function condensePreferenceMicroItems(items: string[]) {
  const preferenceMicroItems = items.filter((item) => isPreferenceMicroItem(item));
  if (preferenceMicroItems.length < 6) {
    return items;
  }

  const preferenceFragments = dedupe(
    preferenceMicroItems
      .flatMap((item) => extractPreferenceFragments(item))
      .map((fragment) => fragment.replace(/\s+/g, " ").trim())
      .filter(Boolean)
  );

  if (preferenceFragments.length < 4) {
    return items;
  }

  const retained = items.filter((item) => !isPreferenceMicroItem(item));
  const primaryList = preferenceFragments.slice(0, 8);
  const secondaryList = preferenceFragments.slice(8, 14);
  const summaryItems = [`Preferred activities include ${formatList(primaryList)}.`];

  if (secondaryList.length > 0) {
    summaryItems.push(`Other favorites include ${formatList(secondaryList)}.`);
  }

  return [...retained, ...summaryItems];
}

function lookLikeSupportAction(item: string) {
  return /\b(help(?:ing)?|check(?:ing)?|find(?:ing)?|offer|redirect|do not|don't|prevent|reduce|reduces|calm|soothe|regulate)\b/i.test(
    item
  );
}

function isHandBitingResponseItem(item: string) {
  if (/\b(hand biting|biting (?:his|her|their) hand|may bite you|bite you)\b/i.test(item)) {
    return true;
  }

  if (/\bdo not (?:physically )?stop\b/i.test(item) && /\b(hand|biting|bite)\b/i.test(item)) {
    return true;
  }

  if (/\bdo not block\b/i.test(item) && /\b(hand|biting|bite)\b/i.test(item)) {
    return true;
  }

  if (/\bredirect\b/i.test(item) && /\b(hand|biting|bite)\b/i.test(item)) {
    return true;
  }

  return false;
}

function isMedicationOrConditionItem(item: string) {
  return /\b(abilify|aripiprazole|miralax|polyethylene glycol|multivitamin|gummy vites|diagnos|autism|impairment|apraxia|regression|delay|disorder|pica|cvi)\b/i.test(
    item
  );
}

function isEquipmentSupportItem(item: string) {
  return /\b(equipment includes|equipment\/supports|assistive equipment|aac on an ipad|aac device|touchchat|noise-?cancel(?:ing)? headphones?|headphones?|buckle buddy|fidgets?|pull-?ups?|white cane|equipment)\b/i.test(
    item
  );
}

function isPhysicalOrBehaviorSignItem(item: string) {
  return /\b(limping|avoid(?:ing)? (?:a )?body part|not eating|not drinking|low energy|letharg|elop|run(?:ning)? away|hand biting|angry (?:yelling|sounds?|vocalizations?)|yelling|hiding|grunting|go(?:ing)? to the fridge|grabbing cheese|press(?:es|ing)?\s+"?help"?|sign for help|dysregulated|agitated|agitation|overwhelmed)\b/i.test(
    item
  );
}

function isCommunicationMeaningSignal(item: string) {
  return /\b(?:selects?|select)\s+["']?(?:car|ipad|i want ipad|color)["']?\b|\b(?:selects?|select)\s+a color\b|\b(?:use|uses|using)\s+(?:his|her|their)\s+aac device to ask for help\b|\baac device to ask for help\b/i.test(
    item
  );
}

function isCommunicationMethodItem(item: string) {
  if (
    isPhysicalOrBehaviorSignItem(item) ||
    /\b(bathroom|toilet|pull-up|bowel movement|limping|not eating|not drinking|low energy|letharg|Abilify|Aripiprazole|MiraLax|polyethylene glycol|multivitamin)\b/i.test(
      item
    )
  ) {
    return false;
  }

  if (
    isEquipmentSupportItem(item) &&
    !/\b(communicat|ask for help|label what (?:he|she|they) wants|non-speaking|sounds?|body language|gestures?|touch you|lead you|sit very close|attention)\b/i.test(
      item
    )
  ) {
    return false;
  }

  return /\b(non-speaking|cannot use words|uses?(?: an)? AAC device|uses TouchChat|AAC app|communicates with sounds|body language|gestures?|uses sounds|singing-like sounds?|happy sounds?|angry sounds?|touch you|lead you|sit very close|wants attention)\b/i.test(
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

function isDirectCaregiverActionItem(item: string) {
  const concepts = extractSummaryConcepts(item);
  if (
    concepts.has("space_and_quiet_support") ||
    concepts.has("calming_prompt") ||
    concepts.has("offer_car_ride") ||
    concepts.has("help_ipad_access") ||
    concepts.has("ipad_troubleshoot_action") ||
    concepts.has("food_response") ||
    concepts.has("bathroom_response") ||
    concepts.has("opening_response") ||
    concepts.has("find_item_response") ||
    concepts.has("do_not_block_hand_biting")
  ) {
    return true;
  }

  return /^(?:back off|check|do not|don't|follow|give|help|keep|let|make sure|offer|prompt|reduce|redirect|remind|support|take|turn on|use)\b/i.test(
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
    canonicalTitle === "Communication" ||
    canonicalTitle === "What helps the day go well" ||
    canonicalTitle === "What can upset or overwhelm them" ||
    canonicalTitle === "Signs they need help" ||
    canonicalTitle === "What helps when they are having a hard time" ||
    canonicalTitle === "Health & Safety";

  if (sectionUsesConceptDedupe) {
    const leftConcepts = extractSummaryConcepts(left);
    const rightConcepts = extractSummaryConcepts(right);
    const overlappingConcepts = [...leftConcepts].filter((concept) => rightConcepts.has(concept));

    if (canonicalTitle === "Communication") {
      if (overlappingConcepts.some((concept) => concept !== "aac_device")) {
        return true;
      }
    } else if (overlappingConcepts.length > 0) {
      return true;
    }
  }

  const leftTokens = comparisonTokens(left);
  const rightTokens = comparisonTokens(right);

  if (leftTokens.length < 4 || rightTokens.length < 4) {
    return false;
  }

  const overlapCount = leftTokens.filter((token) => rightTokens.includes(token)).length;
  const leftCoverage = overlapCount / leftTokens.length;
  const rightCoverage = overlapCount / rightTokens.length;

  if (
    canonicalTitle === "Communication" &&
    extractSummaryConcepts(left).has("aac_device") &&
    extractSummaryConcepts(right).has("aac_device") &&
    (leftCoverage >= 0.7 || rightCoverage >= 0.7)
  ) {
    return true;
  }

  const unionCount = new Set([...leftTokens, ...rightTokens]).size;
  const jaccard = unionCount === 0 ? 0 : overlapCount / unionCount;

  if (canonicalTitle === "Signs they need help") {
    const signSymptoms = [
      "limping",
      "avoiding",
      "favoring",
      "not eating",
      "not drinking",
      "low energy",
      "letharg",
      "elop",
      "run away",
      "hand biting",
      "yelling",
      "angry",
      "hiding",
      "grunting"
    ];
    const matchingSymptomCount = signSymptoms.filter(
      (symptom) => normalizedLeft.includes(symptom) && normalizedRight.includes(symptom)
    ).length;

    if (matchingSymptomCount > 0) {
      return true;
    }
  }

  return jaccard >= 0.78;
}

function itemSpecificityScore(item: string, title?: string) {
  const canonicalTitle = canonicalizeSectionTitle(title ?? "");
  let score = comparisonTokens(item).length + normalizeComparisonText(item).length / 60;

  if (/\b(because|including|such as|usually|when|if|especially|for safety)\b/i.test(item)) {
    score += 1;
  }

  if (
    canonicalTitle === "Signs they need help" &&
    /\b(pain|illness|sick|dysregulated|hungry|hunger)\b/i.test(item)
  ) {
    score += 1;
  }

  if (
    canonicalTitle === "What helps the day go well" &&
    /^(?:he|she|they|gavin)\s+(?:likes?|loves?|enjoys?)\s+[a-z0-9][^.,]*\.?$/i.test(item)
  ) {
    score -= 0.75;
  }

  return score;
}

function preferMoreSpecificItem(
  existing: string,
  candidate: string,
  title?: string
) {
  const existingScore = itemSpecificityScore(existing, title);
  const candidateScore = itemSpecificityScore(candidate, title);

  if (candidateScore > existingScore + 0.2) {
    return candidate;
  }

  if (existingScore > candidateScore + 0.2) {
    return existing;
  }

  return candidate.length > existing.length ? candidate : existing;
}

const SECTION_ITEM_LIMITS: Record<PreferredSummarySectionTitle, number> = {
  Communication: 14,
  "Daily Needs & Routines": 24,
  "What helps the day go well": 14,
  "What can upset or overwhelm them": 12,
  "Signs they need help": 14,
  "What helps when they are having a hard time": 12,
  "Health & Safety": 18,
  "Who to contact (and when)": 8
};

function sectionItemLimit(title?: string) {
  if (!title) {
    return undefined;
  }

  const canonicalTitle = canonicalizeSectionTitle(title) as PreferredSummarySectionTitle;
  return SECTION_ITEM_LIMITS[canonicalTitle];
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

  if (TRANSCRIPTION_NOISE_PATTERN.test(trimmed) || TRANSCRIPT_ACKNOWLEDGEMENT_PATTERN.test(trimmed)) {
    return null;
  }

  const withoutLeadingFiller = trimmed.replace(LEADING_FILLER_PATTERN, "").trim();
  const normalized = withoutLeadingFiller || trimmed;

  if (
    TRANSCRIPTION_NOISE_PATTERN.test(normalized) ||
    TRANSCRIPT_ACKNOWLEDGEMENT_PATTERN.test(normalized)
  ) {
    return null;
  }

  const alphanumericCount = (normalized.match(/[A-Za-z0-9]/g) ?? []).length;
  if (alphanumericCount < 3) {
    return null;
  }

  if (/^(?:that|this)\s+usually\s+helps\.?$/i.test(normalized)) {
    return null;
  }

  if (/^other signs .* can be physical\.?$/i.test(normalized)) {
    return null;
  }

  if (/^it'?s more about redirecting\.?$/i.test(normalized)) {
    return null;
  }

  return normalized.replace(/\s+/g, " ");
}

function polishSummaryItem(title: string, value: string) {
  let item = value.trim();

  if (!item || isNoInformationItem(item)) {
    return item;
  }

  const canonicalTitle = canonicalizeSectionTitle(title);

  if (canonicalTitle === "Communication") {
    item = item.replace(
      /^He uses an AAC device on an iPad with TouchChat\.?$/i,
      "He uses an AAC device on an iPad with TouchChat to communicate"
    );
    item = item.replace(
      /^He is non-speaking as part of his disability\.?$/i,
      "He is non-speaking and does not use words"
    );
    item = item.replace(
      /^His AAC device helps him communicate what he needs\.?$/i,
      "He uses an AAC device on an iPad with TouchChat to communicate"
    );
    item = item.replace(
      /^He may touch you, lead you to what he wants or needs help with, or sit very close when he wants attention\.?$/i,
      "He may touch you, lead you, or sit very close to show he wants something or needs help"
    );
    item = item.replace(
      /^He may touch you, lead you to show what he needs, or sit very close when he wants attention\.?$/i,
      "He may touch you, lead you, or sit very close to show he wants something or needs help"
    );
    item = item.replace(
      /^He makes sounds to express himself\.?$/i,
      "He uses sounds to express himself"
    );
    item = item.replace(
      /^He may touch you to express himself\.?$/i,
      "He may touch you to communicate"
    );
    item = item.replace(
      /^He may touch you to communicate\.?$/i,
      "He may touch you to communicate"
    );
    item = item.replace(
      /^Leading you means he needs help\.?$/i,
      "Leading you usually means he wants something or needs help"
    );
    item = item.replace(
      /^Leading you means he wants something\.?$/i,
      "Leading you usually means he wants something or needs help"
    );
    item = item.replace(
      /^When he leads you somewhere, it means he wants something or needs help\.?$/i,
      "Leading you usually means he wants something or needs help"
    );
    item = item.replace(
      /^Sitting very close means he wants attention\.?$/i,
      "Sitting very close usually means he wants attention"
    );
    item = item.replace(
      /^When he sits very close, he is usually seeking attention\.?$/i,
      "Sitting very close usually means he wants attention"
    );
    item = item.replace(
      /^He does seek out caregivers for attention by sitting close\.?$/i,
      "Sitting very close usually means he wants attention"
    );
  }

  if (canonicalTitle === "What helps the day go well") {
    item = item.replace(
      /^Help him find what he is looking for on his iPad,? and check his search history if needed to figure out what he wants\.?$/i,
      "Helping him find items on his iPad can prevent frustration"
    );
    item = item.replace(
      /^Help him find what he wants on his iPad,? and check his search history if needed\.?$/i,
      "Helping him find items on his iPad can prevent frustration"
    );
    item = item.replace(
      /^Help him find what he wants on his iPad,? and check his search history if needed to figure out what he is trying to access\.?$/i,
      "Helping him find items on his iPad can prevent frustration"
    );
    item = item.replace(
      /^Help him find what he is looking for on his iPad,? and check search history if needed to figure out what he wants\.?$/i,
      "Helping him find items on his iPad can prevent frustration"
    );
    item = item.replace(
      /^Check his iPad search history and help him find what he is trying to access before frustration builds\.?$/i,
      "Helping him find items on his iPad can prevent frustration"
    );
    item = item.replace(
      /^Help him find what he is looking for on his iPad before frustration builds\.?$/i,
      "Helping him find items on his iPad can prevent frustration"
    );
    item = item.replace(
      /^Help him find what he is looking for on his iPad before frustration builds,? and check his search history if needed\.?$/i,
      "Helping him find items on his iPad can prevent frustration"
    );
    item = item.replace(
      /^If he is trying to use the iPad, check whether the internet is working\.?$/i,
      "Helping him find items on his iPad can prevent frustration"
    );
    item = item.replace(
      /^If he is trying to use the iPad, check whether the internet is working\.?$/i,
      "Helping him find what he wants on the iPad can prevent frustration"
    );
    item = item.replace(
      /^If he is trying to use the iPad, check whether the internet is working\.?$/i,
      "Helping him find what he wants on the iPad can prevent frustration"
    );
    item = item.replace(
      /^Check his iPad search history to help figure out what he is trying to access\.?$/i,
      "Checking his iPad search history can help you find what he wants and prevent frustration"
    );
    item = item.replace(
      /^Checking his search history can help identify what he is trying to access(?: on his iPad)?\.?$/i,
      "Helping him find items on his iPad can prevent frustration"
    );
    item = item.replace(
      /^Checking his iPad search history can help identify what he is trying to access\.?$/i,
      "Helping him find items on his iPad can prevent frustration"
    );
    item = item.replace(
      /^Checking his iPad search history can help figure out what he is trying to access\.?$/i,
      "Helping him find items on his iPad can prevent frustration"
    );
    item = item.replace(
      /^If he is trying to use the iPad, check whether the internet is working\.?$/i,
      "Helping him find items on his iPad can prevent frustration"
    );
    item = item.replace(
      /^Treat his AAC choices as meaningful and respond to them\.?$/i,
      "Treating his AAC choices as meaningful helps the day go more smoothly"
    );
    item = item.replace(
      /^Treat his AAC communication as meaningful and respond to what he is telling you\.?$/i,
      "Treating his AAC choices as meaningful helps the day go more smoothly"
    );
    item = item.replace(
      /^Follow where he leads you because this often shows what he wants or needs\.?$/i,
      "Following where he leads you can help you understand what he wants or needs"
    );
    item = item.replace(
      /^Help open items when needed\.?$/i,
      "Helping open items when needed can prevent frustration"
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
      /^Regular bathroom reminders support smoother transitions\.?$/i,
      "Consistent bathroom reminders help the day go more smoothly"
    );
    item = item.replace(
      /^Car rides help regulate him when he is upset\.?$/i,
      "Car rides can help with regulation"
    );
    item = item.replace(
      /^Car rides can help him stay regulated\.?$/i,
      "Car rides can help with regulation"
    );
    item = item.replace(
      /^Car rides can help him regulate\.?$/i,
      "Car rides can help with regulation"
    );
    item = item.replace(
      /^Walks can help regulate him too(?:,? but only with at least two caregivers for safety)?\.?$/i,
      "Walks can help with regulation"
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
      /^Walks can help him regulate\.?$/i,
      "Walks can help with regulation"
    );
    item = item.replace(
      /^Car rides are especially soothing for him\.?$/i,
      "Car rides can help with regulation"
    );
    item = item.replace(
      /^Car rides seem especially soothing for him\.?$/i,
      "Car rides can help with regulation"
    );
    item = item.replace(
      /^Going for a car ride helps soothe him\.?$/i,
      "Car rides can help with regulation"
    );
    item = item.replace(
      /^Walks can be soothing too, but only when there are at least two people for safety\.?$/i,
      "Walks can help with regulation"
    );
    item = item.replace(
      /^Walks can also soothe him if there are enough people for safety\.?$/i,
      "Walks can help with regulation"
    );
    item = item.replace(
      /^Walks can help too\.?$/i,
      "Walks can help with regulation"
    );
    item = item.replace(
      /^Helping him find items on his iPad reduces frustration\.?$/i,
      "Helping him find items on his iPad can prevent frustration"
    );
    item = item.replace(
      /^His mini bus toys may help\.?$/i,
      "Mini bus toys are one of his preferred activities"
    );
    item = item.replace(
      /^Checking his search history can help identify what he is trying to access\.?$/i,
      "Checking his search history can help you find what he is trying to access"
    );
  }

  if (canonicalTitle === "What can upset or overwhelm them") {
    item = item.replace(
      /^Stopping an activity can be hard for him\.?$/i,
      "Stopping an activity or transitioning away from what he is doing can be hard for him"
    );
    item = item.replace(
      /^Having to stop what he is doing can be hard\.?$/i,
      "Stopping an activity or transitioning away from what he is doing can be hard for him"
    );
    item = item.replace(
      /^Stopping another activity to go to the bathroom when prompted can be hard for him\.?$/i,
      "Stopping an activity or transitioning away from what he is doing can be hard for him"
    );
    item = item.replace(
      /^Problems with the iPad can upset him\.?$/i,
      "Problems with the iPad or finding the video he wants can upset him"
    );
    item = item.replace(
      /^The internet being down can upset him\.?$/i,
      "Problems with the iPad or finding the video he wants can upset him"
    );
    item = item.replace(
      /^Not being able to find the video he wants can upset him\.?$/i,
      "Problems with the iPad or finding the video he wants can upset him"
    );
    item = item.replace(
      /^Hunger affects him a lot\.?$/i,
      "Hunger or not having food available can upset him"
    );
  }

  if (canonicalTitle === "Signs they need help") {
    item = item.replace(
      /^Making loud or angry vocalizations can mean he needs help\.?$/i,
      "Loud or angry vocalizations can mean he needs help"
    );
    item = item.replace(
      /^When upset, he may make angry or yelling sounds\.?$/i,
      "Loud or angry vocalizations can mean he needs help"
    );
    item = item.replace(
      /^He often hides behind furniture or curtains and grunts when having a bowel movement\.?$/i,
      "Hiding behind furniture or curtains and grunting usually means he is having a bowel movement"
    );
    item = item.replace(
      /^He may hide behind furniture or a curtain, or grunt, when he needs to have a bowel movement\.?$/i,
      "Hiding behind furniture or a curtain and grunting usually means he is having a bowel movement"
    );
    item = item.replace(
      /^Grunting can mean he is having a bowel movement\.?$/i,
      "Hiding behind furniture or curtains and grunting usually means he is having a bowel movement"
    );
    item = item.replace(
      /^Repeated trips to the fridge or grabbing cheese usually means he is hungry\.?$/i,
      "Repeated trips to the fridge or grabbing cheese usually mean he is hungry"
    );
    item = item.replace(
      /^He may make angry or yelling sounds when upset\.?$/i,
      "Loud or angry vocalizations can mean he needs help"
    );
    item = item.replace(
      /^He may run off when upset\.?$/i,
      "Running away or eloping is a sign he needs help"
    );
    item = item.replace(
      /^When upset, he may run away or elope\.?$/i,
      "Running away or eloping is a sign he needs help"
    );
    item = item.replace(
      /^When very dysregulated, he may bite his hand\.?$/i,
      "Biting his hand when very dysregulated is a sign he needs help"
    );
    item = item.replace(
      /^When hungry, he may go to the fridge repeatedly or grab cheese\.?$/i,
      "Repeated trips to the fridge or grabbing cheese usually mean he is hungry"
    );
    item = item.replace(
      /^If food runs out, he grabs cheese\.?$/i,
      "Repeated trips to the fridge or grabbing cheese usually mean he is hungry"
    );
    item = item.replace(
      /^If food runs out, he goes to the fridge often\.?$/i,
      "Repeated trips to the fridge or grabbing cheese usually mean he is hungry"
    );
  }

  if (canonicalTitle === "What helps when they are having a hard time") {
    item = item.replace(
      /^Follow what he leads you to and first check whether he needs help with something specific\.?$/i,
      "Follow where he leads you to see what he wants or needs help with"
    );
    item = item.replace(
      /^Check whether he needs something opened, whether the iPad or internet is not working, or whether he is trying to find a specific item, toy, or video\.?$/i,
      "Check whether he needs help opening something"
    );
    item = item.replace(
      /^Offer a car ride, and consider a walk if enough people are available for safety\.?$/i,
      "Offer a car ride to help him calm down"
    );
    item = item.replace(
      /^First check whether the iPad is not working\.?$/i,
      "Help him find what he wants on the iPad"
    );
    item = item.replace(
      /^First check whether the internet is not working\.?$/i,
      "Help him find what he wants on the iPad"
    );
    item = item.replace(
      /^If the problem is the iPad, check the internet and search history\.?$/i,
      "Help him find what he wants on the iPad"
    );
    item = item.replace(
      /^Help him access what he is trying to find on his iPad\.?$/i,
      "Help him find what he wants on the iPad"
    );
    item = item.replace(
      /^Help him access or find what he is trying to get on his iPad\.?$/i,
      "Help him find what he wants on the iPad"
    );
    item = item.replace(
      /^Help him find what he is trying to get on his iPad\.?$/i,
      "Help him find what he wants on the iPad"
    );
    item = item.replace(
      /^Help him find what he is trying to find on his iPad\.?$/i,
      "Help him find what he wants on the iPad"
    );
    item = item.replace(
      /^Check whether the iPad or internet is not working\.?$/i,
      "Help him find what he wants on the iPad"
    );
    item = item.replace(
      /^First check whether he is trying to find a specific item(?: or toy|, toy, or video|,? toy,? or video)?\.?$/i,
      "Check whether he is trying to find a specific item, toy, or video"
    );
    item = item.replace(
      /^Whether he is trying to find a specific item, toy, or video\.?$/i,
      "Check whether he is trying to find a specific item, toy, or video"
    );
    item = item.replace(
      /^If hunger may be part of the problem, offer food\.?$/i,
      "If hunger may be part of the problem, offer food"
    );
    item = item.replace(
      /^Food can also help if hunger is part of the problem\.?$/i,
      "If hunger may be part of the problem, offer food"
    );
    item = item.replace(
      /^If he is hungry, get him more food\.?$/i,
      "If hunger may be part of the problem, offer food"
    );
    item = item.replace(
      /^If he needs the bathroom, remind and prompt him to go\.?$/i,
      "If he may need the bathroom, remind and prompt him to go"
    );
    item = item.replace(
      /^Offer a car ride to help soothe him\.?$/i,
      "Offer a car ride to help him calm down"
    );
    item = item.replace(
      /^If he is biting his hand, redirect him instead of trying to physically stop him\.?$/i,
      "Do not physically stop him from biting his hand because he may bite you, and redirect him instead"
    );
    item = item.replace(
      /^Use redirection instead of blocking (?:his )?behavior\.?$/i,
      "Do not physically stop him from biting his hand because he may bite you, and redirect him instead"
    );
    item = item.replace(
      /^Redirect him instead of blocking behaviors\.?$/i,
      "Do not physically stop him from biting his hand because he may bite you, and redirect him instead"
    );
    item = item.replace(
      /^Redirect him instead of blocking hand biting\.?$/i,
      "Do not physically stop him from biting his hand because he may bite you, and redirect him instead"
    );
    item = item.replace(
      /^Do not physically stop him from biting his hand\.?$/i,
      "Do not physically stop him from biting his hand because he may bite you, and redirect him instead"
    );
    item = item.replace(
      /^Do not physically stop him from biting his hand, because he may bite you\.?$/i,
      "Do not physically stop him from biting his hand because he may bite you, and redirect him instead"
    );
  }

  if (canonicalTitle === "Health & Safety") {
    item = item.replace(
      /^Walks can help too, but only with at least two people for safety\.?$/i,
      "Outings such as walks or car rides require at least two caregivers for safety"
    );
    item = item.replace(
      /^Walks can help, but only if at least two people are present for safety\.?$/i,
      "Outings such as walks or car rides require at least two caregivers for safety"
    );
    item = item.replace(
      /^Walks should only be done with at least two people(?: present)? for safety\.?$/i,
      "Outings such as walks or car rides require at least two caregivers for safety"
    );
    item = item.replace(
      /^Walks should only happen with at least two people for safety\.?$/i,
      "Outings such as walks or car rides require at least two caregivers for safety"
    );
    item = item.replace(
      /^Hand biting is a safety risk to Gavin\.?$/i,
      "Hand biting is a safety risk to Gavin and to others if someone tries to block it"
    );
    item = item.replace(
      /^Hand biting is also a safety risk to others if someone tries to block it\.?$/i,
      "Hand biting is a safety risk to Gavin and to others if someone tries to block it"
    );
  }

  item = item
    .replace(/\bTouchchat\b/gi, "TouchChat")
    .replace(/\bi pad\b/gi, "iPad")
    .replace(/\baac\b/gi, "AAC")
    .replace(/\b(\d{1,2}:\d{2})\s*a\.(?=\s|$)/gi, "$1 a.m.")
    .replace(/\b(\d{1,2}:\d{2})\s*p\.(?=\s|$)/gi, "$1 p.m.")
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
    .reduce<string[]>((accumulator, item) => {
      const duplicateIndices = accumulator
        .map((existing, index) => (itemsAreNearDuplicate(existing, item, title) ? index : -1))
        .filter((index) => index >= 0);

      if (duplicateIndices.length === 0) {
        accumulator.push(item);
        return accumulator;
      }

      const candidates = [item, ...duplicateIndices.map((index) => accumulator[index])];
      const chosen = candidates.reduce((best, candidate) =>
        preferMoreSpecificItem(best, candidate, title)
      );

      const indicesToRemove = [...duplicateIndices].sort((left, right) => right - left);
      for (const index of indicesToRemove) {
        accumulator.splice(index, 1);
      }

      accumulator.push(chosen);
      return accumulator;
    }, []);
  const filteredItems = deduped.some((item) => !isNoInformationItem(item))
    ? deduped.filter((item) => !isNoInformationItem(item))
    : deduped;

  const effectiveLimit = typeof limit === "number" ? limit : sectionItemLimit(title);
  return typeof effectiveLimit === "number" ? filteredItems.slice(0, effectiveLimit) : filteredItems;
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

function splitSentenceAware(value: string) {
  const protectedText = value
    .replace(/\bDr\./g, "Dr<prd>")
    .replace(/\ba\.m\./gi, (match) => match.replace(/\./g, "<prd>"))
    .replace(/\bp\.m\./gi, (match) => match.replace(/\./g, "<prd>"));

  return protectedText
    .split(/(?<=[.!?])\s+(?=[A-Z(])/)
    .map((segment) => segment.replace(/<prd>/g, "."));
}

function normalizeSummaryItems(items: string[], limit?: number) {
  const expanded = items.flatMap((item) =>
    item
      .replace(/\r/g, "\n")
      .split(/\n+/)
      .flatMap((line) => line.split(/\s*[•*]\s*/u))
      .flatMap((line) => line.split(/;\s+/))
      .flatMap((line) => splitSentenceAware(line))
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
      .flatMap((line) => splitSentenceAware(line))
      .map(cleanSummaryItem)
      .filter((line): line is string => Boolean(line))
      .flatMap((line) => {
        if (
          canonicalizeSectionTitle(title) === "What helps when they are having a hard time" &&
          /^Check whether he needs something opened, whether the iPad or internet is not working, or whether he is trying to find a specific item, toy, or video\.?$/i.test(
            line
          )
        ) {
          return [
            "Check whether he needs help opening something",
            "Help him find what he wants on the iPad",
            "Check whether he is trying to find a specific item, toy, or video"
          ];
        }

        if (
          canonicalizeSectionTitle(title) === "What helps when they are having a hard time" &&
          /^Offer a car ride, and consider a walk if enough people are available for safety\.?$/i.test(
            line
          )
        ) {
          return [
            "Offer a car ride to help him calm down",
            "A walk may help too if at least two people are available for safety"
          ];
        }

        if (
          canonicalizeSectionTitle(title) === "What helps the day go well" &&
          /\b(?:car rides?\s+and\s+walks?|walks?\s+and\s+car rides?)\b/i.test(line) &&
          /\b(help|regulated?|regulation|calm|soothe)\b/i.test(line)
        ) {
          return ["Car rides can help him regulate", "Walks can help him regulate"];
        }

        if (
          canonicalizeSectionTitle(title) === "What helps the day go well" &&
          /\b(bathroom|toilet)\b/i.test(line) &&
          /\b(food|hungry|hunger)\b/i.test(line) &&
          /\b(reminder|prompt|available|access|prevent|distress|smooth)\b/i.test(line)
        ) {
          return [
            "Consistent bathroom reminders help the day go more smoothly",
            "Regular access to food helps prevent distress"
          ];
        }

        return [line];
      })
      .map((line) => polishSummaryItem(title, line))
      .filter((line): line is string => Boolean(line))
  );

  return refineSectionItems(title, expanded, limit);
}

function refineSectionItems(title: string, items: string[], limit?: number) {
  const canonicalTitle = canonicalizeSectionTitle(title);
  let refinedItems = [...items];

  if (canonicalTitle === "Daily Needs & Routines") {
    const toiletingCommunicationItems = refinedItems.filter(
      (item) =>
        /\b(independently communicate toileting needs|independently communicate when he needs the bathroom|independently tell others when he needs the bathroom|tell others when he needs the bathroom)\b/i.test(
          item
        ) ||
        (/\b(bathroom|toilet|toileting)\b/i.test(item) &&
          /\b(independently|communicat|tell others|tell you|let others know)\b/i.test(item))
    );
    const bathroomReminderItems = refinedItems.filter(
      (item) =>
        /\b(bathroom|toilet)\b/i.test(item) && /\b(reminder|reminders|prompt|prompts|hourly)\b/i.test(item)
    );

    if (toiletingCommunicationItems.length > 0 && bathroomReminderItems.length > 0) {
      const hasHourlyPrompt = bathroomReminderItems.some((item) => /\bhourly|prompt\b/i.test(item));
      refinedItems = refinedItems.filter(
        (item) =>
          !toiletingCommunicationItems.includes(item) && !bathroomReminderItems.includes(item)
      );
      refinedItems.unshift(
        hasHourlyPrompt
          ? "Give regular bathroom reminders, with hourly prompts as the home routine, because he does not independently communicate toileting needs."
          : "Give regular bathroom reminders, because he does not independently communicate toileting needs."
      );
    }

    const extraReminderItems = refinedItems.filter((item) =>
      /\bextra reminders?\b/i.test(item) &&
      /\b(transition|doing another activity|doing something else|keep doing|preferred activity)\b/i.test(
        item
      )
    );

    if (extraReminderItems.length > 0) {
      refinedItems = refinedItems.filter((item) => !extraReminderItems.includes(item));
      refinedItems.push("He may need extra reminders when a transition interrupts a preferred activity.");
    }
  }

  if (canonicalTitle === "Signs they need help") {
    const bowelItems = refinedItems.filter((item) =>
      /\b(hiding|hide|grunting|grunt|bowel movement|pull-?up|privacy)\b/i.test(item)
    );
    if (bowelItems.length > 1) {
      refinedItems = refinedItems.filter((item) => !bowelItems.includes(item));
      refinedItems.push(
        "Hiding for privacy with grunting usually means he is having a bowel movement in his pull-up."
      );
    }

    const elopementItems = refinedItems.filter((item) =>
      /\b(elope|elopement|running away|run away)\b/i.test(item)
    );
    if (elopementItems.length > 1) {
      refinedItems = refinedItems.filter((item) => !elopementItems.includes(item));
      refinedItems.push("Running away or elopement is a sign he needs immediate support.");
    }

    const handBitingItems = refinedItems.filter((item) =>
      /\b(hand biting|biting his hand|self-injury)\b/i.test(item)
    );
    if (handBitingItems.length > 1) {
      refinedItems = refinedItems.filter((item) => !handBitingItems.includes(item));
      refinedItems.push("Hand biting or self-injury when very dysregulated is a sign he needs support.");
    }

    const illnessItems = refinedItems.filter((item) =>
      /\b(limping|favoring|avoiding a body part|not eating|not drinking|low energy|letharg|sick)\b/i.test(
        item
      )
    );
    if (illnessItems.length > 1) {
      refinedItems = refinedItems.filter((item) => !illnessItems.includes(item));
      refinedItems.push(
        "Limping, favoring a body part, not eating or drinking, or unusual low energy can signal illness or pain."
      );
    }

    const painCommunicationItems = refinedItems.filter((item) =>
      /\b(does not (?:reliably )?(?:tell|communicate).*pain|hurt or in pain|doesn't let you know if he's hurt)\b/i.test(
        item
      )
    );
    if (painCommunicationItems.length > 1) {
      refinedItems = refinedItems.filter((item) => !painCommunicationItems.includes(item));
      refinedItems.push("He may not communicate pain, so watch physical and behavior changes closely.");
    }

    const agitationItems = refinedItems.filter((item) =>
      /\b(agitated|agitation|overwhelmed|too dysregulated to ask for help)\b/i.test(item)
    );
    if (agitationItems.length > 1) {
      refinedItems = refinedItems.filter((item) => !agitationItems.includes(item));
      refinedItems.push(
        "Agitation can mean he is overwhelmed and too dysregulated to ask for help."
      );
    }

    const highEnergyItems = refinedItems.filter((item) =>
      /\b(usually has a lot of energy|high energy|can't sit still|cannot sit still)\b/i.test(item)
    );
    if (highEnergyItems.length > 1) {
      refinedItems = refinedItems.filter((item) => !highEnergyItems.includes(item));
      refinedItems.push("His baseline is high energy, so unusual lethargy is a concern.");
    }
  }

  if (canonicalTitle === "Communication") {
    const hasCombinedCueItem = refinedItems.some(
      (item) =>
        /\btouch\b/i.test(item) &&
        /\blead\b/i.test(item) &&
        /\b(sit very close|attention|needs help|wants something)\b/i.test(item)
    );

    if (hasCombinedCueItem) {
      refinedItems = refinedItems.filter(
        (item) =>
          !/^He may touch you to communicate\.?$/i.test(item) &&
          !/^Leading you usually means he wants something or needs help\.?$/i.test(item) &&
          !/^Sitting very close usually means he wants attention\.?$/i.test(item)
      );
    }

    refinedItems = refinedItems.filter(
      (item) =>
        !/\b(lights?|shades?|out of place|things moved|crowded|chaotic|bright lights?|loud noise)\b/i.test(
          item
        )
    );

    refinedItems = refinedItems.filter(
      (item) =>
        !/\b(deodorant|grooming|dressing|shoes?|school van|backpack|breakfast)\b/i.test(item)
    );

    refinedItems = refinedItems.filter(
      (item) => !/\b(tap(?:ping)? (?:his|her|their) foot|lift (?:his|her|their) foot)\b/i.test(item)
    );
  }

  if (canonicalTitle === "What helps the day go well") {
    const ipadSupportItems = refinedItems.filter((item) =>
      /\b(ipad|search history|internet|video)\b/i.test(item) &&
      /\b(help|find|access|prevent|reduce|frustration|trying|not working|cannot find|can t find)\b/i.test(
        item
      )
    );

    if (ipadSupportItems.length > 0) {
      refinedItems = refinedItems.filter((item) => !ipadSupportItems.includes(item));
      refinedItems.push("Helping him find items on his iPad can prevent frustration.");
    }

    const preferenceItems = refinedItems.filter((item) => isSimplePreferenceItem(item));
    if (preferenceItems.length > 0) {
      refinedItems = refinedItems.filter((item) => !isSimplePreferenceItem(item));
      const preferenceSummaryItems = buildPreferenceSummaryItems(preferenceItems);
      if (preferenceSummaryItems.some((item) => /\bmini bus toys\b/i.test(item))) {
        refinedItems = refinedItems.filter(
          (item) => !/\bmini bus toys are one of his preferred activities\b/i.test(item)
        );
      }
      refinedItems.push(...preferenceSummaryItems);
    }

    const visualSupportItems = refinedItems.filter((item) =>
      /\b(very visual|visual supports?|show (?:items?|pictures?)|visual choices?)\b/i.test(item)
    );
    if (visualSupportItems.length > 1) {
      refinedItems = refinedItems.filter((item) => !visualSupportItems.includes(item));
      refinedItems.unshift(
        "He is very visual; showing pictures or real items helps him understand choices."
      );
    }

    const twoStepItems = refinedItems.filter((item) =>
      /\b(two-step|first this, then that|first this then that|short directions?)\b/i.test(item)
    );
    if (twoStepItems.length > 1) {
      refinedItems = refinedItems.filter((item) => !twoStepItems.includes(item));
      refinedItems.push(
        "He does best with short two-step directions such as \"first this, then that.\""
      );
    }

    const regulationItems = refinedItems.filter((item) =>
      /\b(car rides?|walks?)\b/i.test(item) && /\b(help|regulat|sooth|calm)\b/i.test(item)
    );
    if (regulationItems.length > 1) {
      refinedItems = refinedItems.filter((item) => !regulationItems.includes(item));
      refinedItems.push("Car rides and walks can help with regulation.");
    }

    refinedItems = condensePreferenceMicroItems(refinedItems);
  }

  if (canonicalTitle === "What can upset or overwhelm them") {
    const hardTimeMisplacedItems = refinedItems.filter((item) =>
      /\b(giv(?:e|ing)(?:\s+him)? space|reduce stimulation|keep (?:it|things|the area) quiet|time alone|deep breath|count to 10|squeeze and release)\b/i.test(
        item
      )
    );
    if (hardTimeMisplacedItems.length > 0) {
      refinedItems = refinedItems.filter((item) => !hardTimeMisplacedItems.includes(item));
    }

    const lightingItems = refinedItems.filter((item) =>
      /\b(overhead lighting|bright lights?|lights?|shades?)\b/i.test(item)
    );
    if (lightingItems.length > 1) {
      refinedItems = refinedItems.filter((item) => !lightingItems.includes(item));
      refinedItems.push(
        "Bright or overhead lighting, changes to lights, and unexpected shade positions can overwhelm him."
      );
    }

    const noiseCrowdItems = refinedItems.filter((item) =>
      /\b(loud|noise|crowded|too many people|chaotic)\b/i.test(item)
    );
    if (noiseCrowdItems.length > 1) {
      refinedItems = refinedItems.filter((item) => !noiseCrowdItems.includes(item));
      refinedItems.push("Loud, chaotic, or crowded environments can overwhelm him.");
    }
  }

  if (canonicalTitle === "What helps when they are having a hard time") {
    const troubleshootingItems = refinedItems.filter((item) =>
      /\b(needs help opening something|find what he wants on the ipad|specific item, toy, or video)\b/i.test(
        item
      )
    );

    if (troubleshootingItems.length > 0) {
      const needsOpeningCheck = troubleshootingItems.some((item) => /\bopening something\b/i.test(item));
      const needsIpadCheck = troubleshootingItems.some((item) => /\bfind what he wants on the ipad\b/i.test(item));
      const needsFindItemCheck = troubleshootingItems.some(
        (item) => /\bspecific item, toy, or video\b/i.test(item)
      );

      refinedItems = refinedItems.filter((item) => !troubleshootingItems.includes(item));

      if (needsOpeningCheck) {
        refinedItems.push("Check whether he needs help opening something.");
      }

      if (needsIpadCheck) {
        refinedItems.push("Help him find what he wants on the iPad.");
      }

      if (needsFindItemCheck) {
        refinedItems.push("Check whether he is trying to find a specific item, toy, or video.");
      }
    }

    const handBitingResponseItems = refinedItems.filter((item) => isHandBitingResponseItem(item));

    if (handBitingResponseItems.length > 0) {
      refinedItems = refinedItems.filter((item) => !handBitingResponseItems.includes(item));
      refinedItems.push(
        "Do not physically stop him from biting his hand because he may bite you, and redirect him instead."
      );
    }

    const spaceAndQuietItems = refinedItems.filter((item) =>
      !isHandBitingResponseItem(item) &&
      /\b(giv(?:e|ing)(?:\s+him)? space|time alone|moment to himself|do not crowd|reduce stimulation|keep (?:it|things|the area) quiet|going up to him.*worse|redirect|cannot hurt himself|can't hurt himself|make sure.*safe|most important thing)\b/i.test(
        item
      )
    );

    if (spaceAndQuietItems.length > 1) {
      refinedItems = refinedItems.filter((item) => !spaceAndQuietItems.includes(item));
      refinedItems.push(
        "Give him space, reduce stimulation, and keep the environment quiet while redirecting and maintaining safety."
      );
    }

    const showerSupportItems = refinedItems.filter((item) =>
      /\b(showerhead|shower)\b/i.test(item) && /\b(void|urinat|pee)\b/i.test(item)
    );
    if (showerSupportItems.length > 1) {
      refinedItems = refinedItems.filter((item) => !showerSupportItems.includes(item));
      refinedItems.push(
        "If he does not urinate in the morning, turn on the showerhead and have him hold it to help him void."
      );
    }

    const candySupportItems = refinedItems.filter((item) =>
      /\b(swedish fish|gumm(?:y|ies)|candy)\b/i.test(item) &&
      /\b(help(?:s|ed|ing)?|calm(?:s|ed|ing)?|redirect(?:s|ed|ing)?|motivat(?:e|es|ed|ing|ion))\b/i.test(
        item
      )
    );
    if (candySupportItems.length > 1) {
      refinedItems = refinedItems.filter((item) => !candySupportItems.includes(item));
      refinedItems.push(
        "Swedish Fish, gummies, or other candy can sometimes help motivate transitions or redirect him."
      );
    }
  }

  if (canonicalTitle === "Who to contact (and when)") {
    const contacts = new Map<string, string>();

    for (const item of refinedItems) {
      const contactWithPhoneMatch = item.match(
        /([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})[^0-9]*(\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})/
      );

      if (!contactWithPhoneMatch) {
        continue;
      }

      const name = contactWithPhoneMatch[1].replace(/^(?:Contact\s+)+/, "").trim();
      const phoneDigits = contactWithPhoneMatch[2].replace(/\D/g, "");
      if (phoneDigits.length !== 10) {
        continue;
      }
      const phone = `(${phoneDigits.slice(0, 3)}) ${phoneDigits.slice(3, 6)}-${phoneDigits.slice(6)}`;
      contacts.set(`${name.toLowerCase()}::${phone}`, `Contact ${name} at ${phone}.`);
    }

    if (contacts.size > 0) {
      refinedItems = [...contacts.values()];
    }
  }

  if (canonicalTitle === "Health & Safety") {
    refinedItems = refinedItems.filter((item) =>
      /\b(supervision|safety|unsafe|risk|elopement|run away|self-injury|hand biting|pica|low muscle tone|two caregivers?|two people|2 adults?|allerg|diagnos|autism|impairment|regression|delay|apraxia|syndrome|cvi|condition|abilify|aripiprazole|miralax|polyethylene glycol|clearlax|gavilax|healthylax|multivitamin|gummy vites|dose|mg\b|once a day|daily at|aac device|touchchat|ipad|headphones|noise-?cancel|fidgets?|buckle buddy|pull-?ups?|white cane|may bite you|caregiver harm|caregiver injury)\b/i.test(
        item
      )
    );
  }

  return limitItems(refinedItems, limit, title);
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
  if (Array.isArray(candidate?.blocks) || typeof candidate?.intro === "string") {
    return hydrateStructuredSection(candidate ?? {}, index);
  }

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
    generatedAt: "",
    pipelineVersion: "",
    layoutVersion: "",
    sourceTurnsHash: ""
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
  const concepts = extractSummaryConcepts(item);

  if (CONTACT_PATTERN.test(item)) {
    return "Who to contact (and when)";
  }

  if (isMedicationOrConditionItem(item) || isEquipmentSupportItem(item)) {
    return "Health & Safety";
  }

  if (
    /^(?:offer|redirect|do not|don't|help (?:him|her|them)|check (?:whether|if|the)|take (?:him|her|them)|support communication|stay with (?:him|her|them)|give (?:him|her|them))\b/i.test(
      item
    )
  ) {
    return "What helps when they are having a hard time";
  }

  if (concepts.has("space_and_quiet_support") || concepts.has("calming_prompt")) {
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

  if (isCommunicationMeaningSignal(item)) {
    return "Communication";
  }

  if (isPhysicalOrBehaviorSignItem(item)) {
    return "Signs they need help";
  }

  if (
    /\b(run(?:ning)? away|elope|biting (?:his|her|their) hand|angry sounds?|yelling|hiding|hides|grunt(?:ing|s)?|go(?:ing)? to the fridge|grabbing cheese|repeatedly going to the fridge|pulling)\b/i.test(
      item
    )
  ) {
    return "Signs they need help";
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
    concepts.has("visual_support") ||
    concepts.has("two_step_support") ||
    concepts.has("car_ride_regulation") ||
    concepts.has("walk_regulation")
  ) {
    return "What helps the day go well";
  }

  if (
    /\b(independently communicate|independently tell|tell others|tell you|let others know|communicate when he needs|communicate when she needs|communicate when they need)\b/i.test(
      item
    ) &&
    /\b(bathroom|toilet)\b/i.test(item)
  ) {
    return "Daily Needs & Routines";
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

  if (/\b(lights?|shades?|out of place|things moved|moved|crowded|chaotic|bright lights?|loud noise)\b/i.test(item)) {
    return "What can upset or overwhelm them";
  }

  if (looksLikeCommunicationItem(item)) {
    return "Communication";
  }

  if (/\b(van|school|morning routine|breakfast)\b/i.test(item)) {
    return "Daily Needs & Routines";
  }

  if (
    /^(?:he|she|they|gavin)\s+(?:really\s+)?(?:likes?|loves?|enjoys?|especially enjoys)\b/i.test(
      item
    ) ||
    /^(?:his|her|their)\s+biggest favorites are\b/i.test(item)
  ) {
    return "What helps the day go well";
  }

  return currentTitle;
}

export function inferAuthoritativeSectionTitle(
  item: string,
  currentTitle: PreferredSummarySectionTitle
): PreferredSummarySectionTitle {
  const concepts = extractSummaryConcepts(item);

  if (CONTACT_PATTERN.test(item)) {
    return "Who to contact (and when)";
  }

  if (
    isMedicationOrConditionItem(item) ||
    /\b(two caregivers?|two people|2 adults?|close supervision|supervision needs?|safety risk|low muscle tone|may bite you|bite you|unsafe|for safety reasons?|does not communicate pain|cannot communicate pain)\b/i.test(
      item
    ) ||
    CAREGIVER_HARM_PATTERN.test(item)
  ) {
    return "Health & Safety";
  }

  if (isCommunicationMeaningSignal(item)) {
    return "Communication";
  }

  if (isCommunicationMethodItem(item)) {
    return "Communication";
  }

  if (
    isPhysicalOrBehaviorSignItem(item) ||
    concepts.has("help_request_signal") ||
    concepts.has("hunger_sign") ||
    concepts.has("vocalization_sign") ||
    concepts.has("elopement") ||
    concepts.has("hand_biting") ||
    concepts.has("bowel_movement_sign") ||
    concepts.has("agitation_sign")
  ) {
    return "Signs they need help";
  }

  if (
    /\b(bathroom|toilet|pull-up|bowel movement|hourly prompt|hourly reminder|regular reminders?|go when prompted|void|showerhead|breakfast|van|water bottle|sippy cup|limited diet|bite-sized|grazes|meals?|snacks?|dress(?:ing)?|deodorant|socks|teeth brushing|hair|routine|school days?|non-school days?)\b/i.test(
      item
    )
  ) {
    return "Daily Needs & Routines";
  }

  if (
    concepts.has("visual_support") ||
    concepts.has("two_step_support") ||
    concepts.has("car_ride_regulation") ||
    concepts.has("walk_regulation") ||
    concepts.has("ipad_help") ||
    concepts.has("food_access") ||
    /\b(visual timer|visual schedule|preferred item|preferred activity|structured routine|regular access to food|prevent frustration|favorite person|spending time with family|downtime|watch tv|watch television)\b/i.test(
      item
    ) ||
    /^(?:he|she|they|gavin|mom)\s+(?:really\s+)?(?:likes?|loves?|enjoys?|especially enjoys)\b/i.test(
      item
    ) ||
    /^(?:his|her|their)\s+biggest favorites are\b/i.test(item)
  ) {
    return "What helps the day go well";
  }

  if (
    concepts.has("ipad_trigger") ||
    concepts.has("transition_trigger") ||
    concepts.has("environment_rigidity_trigger") ||
    concepts.has("sensory_trigger") ||
    concepts.has("opening_items") ||
    concepts.has("missing_preferred_item_trigger") ||
    /\b(hunger|not having food available|out of place|things moved|lights?|shades?|crowded|chaotic|bright lights?|loud noise|too many people|internet is down|cannot find|can't find|not working)\b/i.test(
      item
    )
  ) {
    return "What can upset or overwhelm them";
  }

  if (isDirectCaregiverActionItem(item)) {
    return "What helps when they are having a hard time";
  }

  if (isEquipmentSupportItem(item)) {
    return "Health & Safety";
  }

  return currentTitle;
}

function itemsAreAuthoritativeCrossDuplicates(left: string, right: string) {
  const normalizedLeft = normalizeComparisonText(left);
  const normalizedRight = normalizeComparisonText(right);

  if (!normalizedLeft || !normalizedRight) {
    return false;
  }

  if (normalizedLeft === normalizedRight) {
    return true;
  }

  return (
    normalizedLeft.length >= 24 &&
    normalizedRight.length >= 24 &&
    (normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft))
  );
}

function enforceAuthoritativeSectionPlacement(sections: SummarySection[]) {
  const byTitle = new Map<PreferredSummarySectionTitle, SummarySection>(
    ensurePreferredSections(sections).map((section) => [
      canonicalizeSectionTitle(section.title) as PreferredSummarySectionTitle,
      {
        ...section,
        items: section.items.filter((item) => !isNoInformationItem(item))
      }
    ])
  );

  for (const title of PREFERRED_SUMMARY_SECTION_ORDER) {
    const section = byTitle.get(title);
    if (!section) {
      continue;
    }

    const retained: string[] = [];
    for (const item of section.items) {
      const preferredTitle = inferAuthoritativeSectionTitle(item, title);
      if (preferredTitle !== title) {
        const destination = byTitle.get(preferredTitle);
        if (destination) {
          destination.items.push(item);
          continue;
        }
      }

      retained.push(item);
    }

    section.items = retained;
  }

  const seen: string[] = [];

  return PREFERRED_SUMMARY_SECTION_ORDER.map((title, index) => {
    const section = byTitle.get(title) ?? createPlaceholderSection(title, index);
    const uniqueItems: string[] = [];

    for (const item of section.items) {
      if (seen.some((existing) => itemsAreAuthoritativeCrossDuplicates(existing, item))) {
        continue;
      }

      uniqueItems.push(item);
      seen.push(item);
    }

    const normalizedItems = normalizeSectionItems(title, uniqueItems);

    return {
      ...section,
      title,
      items:
        normalizedItems.length > 0
          ? title === "Health & Safety"
            ? orderHealthSafetyItems(normalizedItems)
            : normalizedItems
          : [NO_INFORMATION_PLACEHOLDER]
    };
  });
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

  if (
    !dayGoWellSection.items.some((item) =>
      /\b(find items on (?:his|her|their) ipad|helping (?:him|her|them) find items|ipad searches can prevent frustration|prevent frustration|reduces frustration)\b/i.test(
        item
      )
    ) &&
    allItems.some(
      (item) =>
        /\b(ipad|search history|internet|video)\b/i.test(item) &&
        /\b(help|find|access|prevent|reduce|frustration|trying|not working|cannot find|can t find)\b/i.test(
          item
        )
    )
  ) {
    dayGoWellSection.items.push("Helping him find items on his iPad can prevent frustration.");
  }

  return nextSections;
}

function surfaceHardTimeSupports(sections: SummarySection[]) {
  const nextSections = sections.map((section) => ({
    ...section,
    items: [...section.items]
  }));
  const hardTimeSection = nextSections.find(
    (section) => section.title === "What helps when they are having a hard time"
  );

  if (!hardTimeSection) {
    return nextSections;
  }

  const allItems = nextSections.flatMap((section) => section.items);

  if (
    !hardTimeSection.items.some((item) =>
      /\b(help him find what he wants on the ipad|access what he is trying to find|find on his ipad)\b/i.test(
        item
      )
    ) &&
    allItems.some(
      (item) =>
        /\b(ipad|search history|internet|video)\b/i.test(item) &&
        /\b(help|find|access|trying|not working|cannot find|can t find)\b/i.test(item)
    )
  ) {
    hardTimeSection.items.push("Help him find what he wants on the iPad.");
  }

  if (
    !hardTimeSection.items.some((item) =>
      /\b(do not physically stop|may bite you|do not block)\b/i.test(item)
    ) &&
    allItems.some(
      (item) =>
        isHandBitingResponseItem(item)
    )
  ) {
    hardTimeSection.items.push(
      "Do not physically stop him from biting his hand because he may bite you, and redirect him instead."
    );
  }

  return nextSections;
}

function surfaceUpsetTriggers(sections: SummarySection[]) {
  const nextSections = sections.map((section) => ({
    ...section,
    items: [...section.items]
  }));
  const upsetSection = nextSections.find(
    (section) => section.title === "What can upset or overwhelm them"
  );

  if (!upsetSection) {
    return nextSections;
  }

  const allItems = nextSections.flatMap((section) => section.items);

  if (
    !upsetSection.items.some((item) => /\b(open items|opening items|low muscle tone)\b/i.test(item)) &&
    allItems.some(
      (item) =>
        /\b(open|opening)\b/i.test(item) &&
        /\b(low muscle tone|unable|cannot|can t|help)\b/i.test(item)
    )
  ) {
    upsetSection.items.push("Not being able to open items because of low muscle tone can upset him.");
  }

  return nextSections;
}

function rehomeObviousCommunicationItems(sections: SummarySection[]) {
  const nextSections = sections.map((section) => ({
    ...section,
    items: [...section.items]
  }));
  const communicationSection = nextSections.find((section) => section.title === "Communication");
  const signsSection = nextSections.find((section) => section.title === "Signs they need help");

  if (!communicationSection || !signsSection) {
    return nextSections;
  }

  const movedItems = signsSection.items.filter((item) => isCommunicationMeaningSignal(item));
  if (movedItems.length === 0) {
    return nextSections;
  }

  signsSection.items = signsSection.items.filter((item) => !isCommunicationMeaningSignal(item));
  communicationSection.items.push(...movedItems);

  return nextSections;
}

function rehomeObviousDailyNeedsItems(sections: SummarySection[]) {
  const nextSections = sections.map((section) => ({
    ...section,
    items: [...section.items]
  }));
  const communicationSection = nextSections.find((section) => section.title === "Communication");
  const dailyNeedsSection = nextSections.find((section) => section.title === "Daily Needs & Routines");

  if (!communicationSection || !dailyNeedsSection) {
    return nextSections;
  }

  const bathroomCommunicationItems = communicationSection.items.filter(
    (item) =>
      /\b(bathroom|toilet|toileting)\b/i.test(item) &&
      /\b(independently|communicat|tell others|tell you|let others know)\b/i.test(item)
  );

  if (bathroomCommunicationItems.length === 0) {
    return nextSections;
  }

  communicationSection.items = communicationSection.items.filter(
    (item) => !bathroomCommunicationItems.includes(item)
  );

  for (const item of bathroomCommunicationItems) {
    dailyNeedsSection.items.push(
      polishSummaryItem(
        "Daily Needs & Routines",
        "Give regular bathroom reminders, because he does not independently communicate toileting needs"
      )
    );
  }

  return nextSections;
}

function rehomeHealthSafetyCommunicationItems(sections: SummarySection[]) {
  const nextSections = sections.map((section) => ({
    ...section,
    items: [...section.items]
  }));
  const communicationSection = nextSections.find((section) => section.title === "Communication");
  const healthSafetySection = nextSections.find((section) => section.title === "Health & Safety");

  if (!communicationSection || !healthSafetySection) {
    return nextSections;
  }

  const movedItems = healthSafetySection.items.filter(
    (item) =>
      looksLikeCommunicationItem(item) &&
      !isEquipmentSupportItem(item) &&
      !isMedicationOrConditionItem(item) &&
      !isPhysicalOrBehaviorSignItem(item) &&
      !/\b(two caregivers?|two people|close supervision|supervision|safety risk|low muscle tone|bite you|hand biting|elopement|elope|run away|for safety)\b/i.test(
        item
      )
  );

  if (movedItems.length === 0) {
    return nextSections;
  }

  healthSafetySection.items = healthSafetySection.items.filter((item) => !movedItems.includes(item));
  communicationSection.items.push(...movedItems);

  return nextSections;
}

function healthSafetySortCategory(item: string) {
  if (
    /\b(may bite you|bite caregiver|hurt caregiver|harm caregiver|injure caregiver|do not block|do not physically stop)\b/i.test(
      item
    )
  ) {
    return 4;
  }

  if (
    /\b(abilify|aripiprazole|miralax|polyethylene glycol|clearlax|gavilax|healthylax|multivitamin|gummy vites|dose|mg\b|once a day|daily at)\b/i.test(
      item
    )
  ) {
    return 2;
  }

  if (
    /\b(aac device|touchchat|ipad|headphones|noise-?cancel|fidgets?|buckle buddy|pull-?ups?|white cane|equipment|supports?)\b/i.test(
      item
    )
  ) {
    return 3;
  }

  if (
    /\b(supervision|safety|unsafe|risk|elopement|run away|self-injury|hand biting|pica|low muscle tone|two caregivers?|two people|2 adults?|does not communicate pain|cannot communicate pain)\b/i.test(
      item
    )
  ) {
    return 0;
  }

  if (
    /\b(autism|diagnos|disorder|impairment|regression|delay|apraxia|syndrome|cvi|condition)\b/i.test(
      item
    )
  ) {
    return 1;
  }

  return 1;
}

function orderHealthSafetyItems(items: string[]) {
  const entries = items.map((item, index) => ({
    item,
    index,
    category: healthSafetySortCategory(item)
  }));

  entries.sort((left, right) => {
    if (left.category !== right.category) {
      return left.category - right.category;
    }

    if (left.index !== right.index) {
      return left.index - right.index;
    }

    return left.item.localeCompare(right.item);
  });

  return entries.map((entry) => entry.item);
}

function enforceCrossSectionDeconfliction(sections: SummarySection[]) {
  const byTitle = new Map<PreferredSummarySectionTitle, SummarySection>(
    ensurePreferredSections(sections).map((section) => [
      canonicalizeSectionTitle(section.title) as PreferredSummarySectionTitle,
      {
        ...section,
        items: section.items.filter((item) => !isNoInformationItem(item))
      }
    ])
  );

  for (const title of PREFERRED_SUMMARY_SECTION_ORDER) {
    const section = byTitle.get(title);
    if (!section) {
      continue;
    }

    const retained: string[] = [];
    for (const item of section.items) {
      const preferredTitle = inferNormalizedSectionTitle(item, title);
      if (preferredTitle !== title) {
        const destination = byTitle.get(preferredTitle);
        if (destination) {
          destination.items.push(item);
          continue;
        }
      }

      retained.push(item);
    }

    section.items = retained;
  }

  const seen: Array<{ title: PreferredSummarySectionTitle; item: string }> = [];

  for (const title of PREFERRED_SUMMARY_SECTION_ORDER) {
    const section = byTitle.get(title);
    if (!section) {
      continue;
    }

    const uniqueItems: string[] = [];
    for (const item of section.items) {
      if (seen.some((entry) => itemsAreNearDuplicate(entry.item, item, title))) {
        continue;
      }

      uniqueItems.push(item);
      seen.push({ title, item });
    }

    section.items = title === "Health & Safety" ? orderHealthSafetyItems(uniqueItems) : uniqueItems;
  }

  return PREFERRED_SUMMARY_SECTION_ORDER.map((title, index) => {
    const section = byTitle.get(title);
    if (section) {
      return section;
    }

    return createPlaceholderSection(title, index);
  });
}

function refinePreferredSections(sections: SummarySection[]) {
  const normalizedSections = ensurePreferredSections(
    sections.map((section, index) => ({
      ...section,
      id: section.id || `${slugify(section.title) || "section"}-${index + 1}`,
      items: normalizeSectionItems(section.title, section.items)
    }))
  );
  const rehomedSections = rehomeObviousCommunicationItems(normalizedSections);
  const dailyNeedsRehomedSections = rehomeObviousDailyNeedsItems(rehomedSections);
  const healthSafetyRehomedSections = rehomeHealthSafetyCommunicationItems(
    dailyNeedsRehomedSections
  );
  const surfacedSupportSections = surfaceDayGoWellSupports(healthSafetyRehomedSections);
  const hardTimeSurfacedSections = surfaceHardTimeSupports(surfacedSupportSections);
  const surfacedSections = surfaceUpsetTriggers(hardTimeSurfacedSections);
  const deconflictedSections = enforceCrossSectionDeconfliction(surfacedSections);

  return ensurePreferredSections(
    deconflictedSections.map((section, index) => {
      const title = canonicalizeSectionTitle(section.title);
      const normalizedItems = normalizeSectionItems(title, section.items);

      return {
        ...section,
        id: section.id || `${slugify(title) || "section"}-${index + 1}`,
        items: title === "Health & Safety" ? orderHealthSafetyItems(normalizedItems) : normalizedItems,
        title
      };
    })
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
  { reclassify = true, semanticRepair = true }: SummaryNormalizationOptions = {}
) {
  const preferredSections = ensurePreferredSections(sections);
  if (!semanticRepair) {
    return enforceAuthoritativeSectionPlacement(preferredSections);
  }

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
      sections: ensurePreferredSections([]),
      pipelineVersion: "",
      layoutVersion: "",
      sourceTurnsHash: ""
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
        : "",
    pipelineVersion: "",
    layoutVersion: "",
    sourceTurnsHash: ""
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
    generatedAt: "",
    pipelineVersion: "",
    layoutVersion: "",
    sourceTurnsHash: ""
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
  return normalizeStructuredSummaryWithOptions(input, nameHint, {
    reclassify: false,
    semanticRepair: false
  });
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
      title: defaultSummaryTitle(nameHint),
      pipelineVersion: "",
      layoutVersion: "",
      sourceTurnsHash: ""
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
    const containsStructuredBlocks = sections.some(
      (section) => Array.isArray(section.blocks) && section.blocks.length > 0
    );

    const orderedSections = containsStructuredBlocks ? sections : sortAndMergeSections(sections);
    const finalSections = containsStructuredBlocks
      ? orderedSections
      : usesPreferredSectionStructure(orderedSections)
        ? normalizePreferredSections(orderedSections, options)
        : orderedSections;
    const summaryTitle =
      typeof candidate.title === "string" && candidate.title.trim()
        ? candidate.title.trim()
        : defaultSummaryTitle(nameHint);

    return {
      title: summaryTitle,
      overview:
        containsStructuredBlocks && typeof candidate.overview === "string"
          ? shortenOverview(candidate.overview)
          : containsStructuredBlocks
            ? ""
          : typeof candidate.overview === "string" && !shouldRewriteOverview(candidate.overview)
          ? shortenOverview(candidate.overview)
          : buildOverview(summaryTitle, finalSections),
      sections: finalSections,
      generatedAt:
        typeof candidate.generatedAt === "string" && candidate.generatedAt.trim()
          ? candidate.generatedAt.trim()
          : "",
      pipelineVersion:
        typeof candidate.pipelineVersion === "string" ? candidate.pipelineVersion.trim() : "",
      layoutVersion:
        typeof candidate.layoutVersion === "string" ? candidate.layoutVersion.trim() : "",
      sourceTurnsHash:
        typeof candidate.sourceTurnsHash === "string" ? candidate.sourceTurnsHash.trim() : ""
    };
  }

  return normalizeLegacySummary(candidate, nameHint);
}
