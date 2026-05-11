import {
  PREFERRED_SUMMARY_SECTION_ORDER,
  buildFallbackSummary,
  normalizeAuthoritativeStructuredSummary,
  normalizeGeneratedSummaryWithOptions
} from "./summary";
import {
  finalizeSummaryWithQa,
  normalizeSummaryAuditReport
} from "./summary-audit";
import {
  SUMMARY_LAYOUT_VERSION,
  SUMMARY_PIPELINE_VERSION,
  computeTurnsHash
} from "./summary-structured";
import {
  ConversationTurn,
  ReflectionStepId,
  StructuredFactKind,
  StructuredSectionSummary,
  StructuredSummary,
  StructuredSummaryFact,
  SummaryAuditIssue,
  SummaryAuditReport,
  SummarySectionTitle
} from "./types";

const NO_INFORMATION_PLACEHOLDER = "(No information provided)";
const OPENAI_CHAT_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions";
const DEFAULT_SUMMARY_MODEL = "gpt-5.5";
const DEFAULT_OPENAI_TIMEOUT_MS = 600_000;
const CAPTURE_ENTRY_TARGET_CHARS = 800;
const CAPTURE_BATCH_TARGET_CHARS = 3200;
const DEFAULT_CAPTURE_CONCURRENCY = 3;
const MAX_CAPTURE_CONCURRENCY = 4;
const LONG_ANSWER_PRECOMPRESSION_THRESHOLD_CHARS = 2_000;
const LONG_ANSWER_PRECOMPRESSION_TARGET_CHARS = 1_800;
const REWRITE_RETRY_DELAYS_MS = [2_000, 5_000];
const REWRITE_MAX_COMPLETION_TOKENS = 12_000;
const SECTION_REWRITE_MAX_COMPLETION_TOKENS = 6_000;
const SECTION_REWRITE_CONCURRENCY = 2;
const MAX_SECTION_REPAIR_HINTS = 16;
const HEALTH_AND_SAFETY_TITLE = "Health & Safety";
const WHO_TO_CONTACT_TITLE = "Who to contact (and when)";

const SUMMARY_SECTION_TITLES = [...PREFERRED_SUMMARY_SECTION_ORDER];

const MEDICATION_PORTAL_MARKERS = [
  /\bcurrent medications\b/i,
  /\brequest refills and renewals\b/i,
  /\bif you need a refill\b/i,
  /\brequest renewal\b/i,
  /\bmanage my pharmacies\b/i,
  /\bprescription details\b/i,
  /\bpharmacy details\b/i,
  /\blearn more\b/i
];

const MEDICATION_PORTAL_IGNORED_LINE_PATTERNS = [
  /^medications$/i,
  /^current medications$/i,
  /^you can report new medications/i,
  /^how to request refills and renewals:?$/i,
  /^if you need a refill/i,
  /^click "request renewal"/i,
  /^if your medication cannot be renewed/i,
  /^need to update your list of pharmacies\?/i,
  /^go to manage my pharmacies\.?$/i,
  /^learn more$/i,
  /^prescription details$/i,
  /^prescribed/i,
  /^approved by/i,
  /^quantity$/i,
  /^day supply/i,
  /^pharmacy details$/i,
  /^map$/i,
  /^\d+\s+refills?\s+before\b/i,
  /^\d+\s*(?:g|mg|mcg|mL|ml|tablets?|tabs?|capsules?|caps?)$/i,
  /^\d{3}-\d{3}-\d{4}$/i
];

const LOW_SIGNAL_SUMMARY_UNIT_PATTERNS = [
  /^(?:yeah|yes|no|okay|ok|alright|right|sorry|anyway|well)\b/i,
  /^\s*(?:oh my god|oh my gosh|holy kitten)\b/i,
  /\byou know what i mean\b/i,
  /\bthat totally makes sense\b/i,
  /\bif you will\b/i
];

const HIGH_SIGNAL_SUMMARY_HINT_PATTERN =
  /\b(aac|access|affirma|allerg|ambul|angry|anxiety|appetite|bathroom|bedtime|behavior|blood pressure|breakfast|broke|calm|car|choice|communicat|compression stockings|condition|constipat|contact|danger|dentist|diagnos|diet|dinner|direction|dysreg|eczema|elop|emergency|fall|food|frustrat|glasses|hair|hand|harm|headphone|hearing aid|help|hit|hospital|hydrated|hygiene|ipad|leg|limp|mad|medicat|melatonin|mouthwash|night|pain|phone|prescription|pull-?up|rage|read|redirect|remind|responds best|risk|routine|safe|safety|schedule|school|self-?injur|shout|shower|sleep|snack|space|stimulation|support|swear|teeth|timer|toilet|toileting|transition|trigger|upset|visit|walk|weighted blanket|yell)\b/i;

type ChatCompletionContentPart = {
  type?: string;
  text?: string;
};

type ChatCompletionMessage = {
  content?: string | ChatCompletionContentPart[];
  refusal?: string | null;
};

type SummaryModelErrorKind =
  | "timeout"
  | "transport"
  | "provider"
  | "refusal"
  | "empty"
  | "parse"
  | "truncation"
  | "unexpected";

type SummaryEntrySplitStrategy = "entry" | "paragraph" | "line" | "sentence" | "chars";

type RawStructuredCaptureFact = {
  entryId: string;
  section: SummarySectionTitle;
  factKind: StructuredFactKind;
  statement: string;
  safetyRelevant: boolean;
};

type RawStructuredCapture = {
  facts: RawStructuredCaptureFact[];
};

type StructuredCaptureFact = {
  factId: string;
  entryId: string;
  section: SummarySectionTitle;
  factKind: StructuredFactKind;
  statement: string;
  safetyRelevant: boolean;
  conceptKeys: string[];
  sourceEntryIds: string[];
};

type StructuredCapture = {
  facts: StructuredCaptureFact[];
};

type FactCluster = {
  clusterId: string;
  section: SummarySectionTitle;
  factKind: StructuredFactKind;
  conceptKeys: string[];
  facts: StructuredCaptureFact[];
};

type FactAuditStatus = {
  factId: string;
  clusterId: string;
  expectedSection: SummarySectionTitle;
  factKind: StructuredFactKind;
  status: "covered" | "leaked" | "missing" | "duplicated";
  actualSection?: SummarySectionTitle;
  matchedBullet?: string;
};

type AuditedSummaryCandidate = {
  summary: StructuredSummary;
  report: SummaryAuditReport;
};

type SectionRewriteScope = "all" | "soft" | "hard";

type SectionRiskTier = "tier1" | "tier2" | "tier3";

type SectionCoverageRequirement = {
  key: string;
  description: string;
  matcher: RegExp;
};

type StructuredSectionRepairInput = {
  tier: SectionRiskTier;
  softTargetCount: number;
  mustInclude: string[];
  mustExclude: string[];
  shapeRules: string[];
};

type ClusterCoverageStatus = {
  cluster: FactCluster;
  status: "covered" | "leaked" | "missing";
  actualSection?: SummarySectionTitle;
  matchedBullet?: string;
};

type RequirementCoverageStatus = {
  requirement: SectionCoverageRequirement;
  status: "covered" | "leaked" | "missing";
  actualSection?: SummarySectionTitle;
  clusterStatements: string[];
};

type SectionRepairHintIndex = {
  global: string[];
  bySection: Map<SummarySectionTitle, string[]>;
};

export class SummaryQualityError extends Error {
  issues: SummaryAuditIssue[];
  diagnostics: string[];

  constructor(message: string, issues: SummaryAuditIssue[], diagnostics: string[] = []) {
    super(message);
    this.name = "SummaryQualityError";
    this.issues = issues;
    this.diagnostics = diagnostics;
  }
}

export class SummaryModelRequestError extends Error {
  status?: number;
  kind: SummaryModelErrorKind;
  diagnostics: string[];

  constructor(
    message: string,
    options: {
      status?: number;
      kind?: SummaryModelErrorKind;
      diagnostics?: string[];
    } = {}
  ) {
    super(message);
    this.name = "SummaryModelRequestError";
    this.status = options.status;
    this.kind = options.kind ?? "unexpected";
    this.diagnostics = options.diagnostics ?? [];
  }
}

type SummarySourceEntry = {
  internalEntryId: string;
  entryId: string;
  content: string;
  sectionTitle?: string;
  stepId?: ReflectionStepId;
  stepTitle?: string;
  promptLabel?: string;
  splitDepth: number;
  splitStrategy: SummaryEntrySplitStrategy;
};

type RawPromptDefinition = {
  sectionTitle: string;
  stepId: ReflectionStepId;
  stepTitle: string;
  promptLabel: string;
  aliases: string[];
};

type EntryPromptRouting = {
  preferredSection: SummarySectionTitle;
  defaultFactKind: StructuredFactKind;
};

type GeneratedSummarySectionField = {
  key:
    | "communication"
    | "dailyNeedsRoutines"
    | "whatHelpsTheDayGoWell"
    | "whatCanUpsetOrOverwhelmThem"
    | "signsTheyNeedHelp"
    | "whatHelpsWhenTheyAreHavingAHardTime"
    | "healthAndSafety"
    | "whoToContactAndWhen";
  title: SummarySectionTitle;
};

export type SummaryGenerationMode = "one-step" | "two-step";
type SummaryGenerationOptions = {
  repairHints?: string[];
};

export type GeneratedSummaryArtifacts = {
  summary: StructuredSummary;
  auditReport: SummaryAuditReport;
  facts: StructuredSummaryFact[];
  sectionSummaries: StructuredSectionSummary[];
};

const GENERATED_SUMMARY_SECTION_FIELDS: GeneratedSummarySectionField[] = [
  { key: "communication", title: "Communication" },
  { key: "dailyNeedsRoutines", title: "Daily Needs & Routines" },
  { key: "whatHelpsTheDayGoWell", title: "What helps the day go well" },
  { key: "whatCanUpsetOrOverwhelmThem", title: "What can upset or overwhelm them" },
  { key: "signsTheyNeedHelp", title: "Signs they need help" },
  {
    key: "whatHelpsWhenTheyAreHavingAHardTime",
    title: "What helps when they are having a hard time"
  },
  { key: "healthAndSafety", title: "Health & Safety" },
  { key: "whoToContactAndWhen", title: "Who to contact (and when)" }
];

const GENERATED_SUMMARY_FIELD_BY_TITLE = new Map(
  GENERATED_SUMMARY_SECTION_FIELDS.map((field) => [field.title, field] as const)
);

const HIGH_RISK_SECTION_TITLES = new Set<SummarySectionTitle>([
  "Signs they need help",
  HEALTH_AND_SAFETY_TITLE,
  WHO_TO_CONTACT_TITLE
]);

const SECTION_RISK_TIERS: Record<SummarySectionTitle, SectionRiskTier> = {
  Communication: "tier2",
  "Daily Needs & Routines": "tier2",
  "What helps the day go well": "tier3",
  "What can upset or overwhelm them": "tier3",
  "Signs they need help": "tier1",
  "What helps when they are having a hard time": "tier2",
  "Health & Safety": "tier1",
  "Who to contact (and when)": "tier1"
};

const SECTION_SHAPE_RULES: Record<SummarySectionTitle, string[]> = {
  Communication: [
    "Include communication methods, recurring meanings, decoding patterns, and communication supports only.",
    "Generalize one-off anecdotes into reusable communication guidance when possible."
  ],
  "Daily Needs & Routines": [
    "Include routine, timing, toileting, hygiene, sleep, feeding, hydration, and medication-with-food steps only.",
    "Keep concrete care steps and timing details."
  ],
  "What helps the day go well": [
    "Include preferred supports, activities, and regulation patterns only.",
    "Compress repeated examples into theme bullets instead of inventories."
  ],
  "What can upset or overwhelm them": [
    "Include triggers and precipitating conditions only.",
    "Do not include caregiver responses in this section."
  ],
  "Signs they need help": [
    "Use observable physical, behavioral, or communication signs only.",
    "Do not include caregiver actions, instructions, or interpretation-heavy narration."
  ],
  "What helps when they are having a hard time": [
    "Use caregiver actions and environment adjustments only.",
    "Do not include trigger-only or sign-only bullets."
  ],
  "Health & Safety": [
    "Preserve all supported medications, conditions, equipment, supervision needs, overnight monitoring, mobility limits, and safety warnings.",
    "Keep distinct high-risk details separate when the meaning changes."
  ],
  "Who to contact (and when)": [
    "List named contacts first, then concise when-to-call guidance.",
    "Preserve names, relationships, phone numbers, and escalation order when supported."
  ]
};

const SECTION_SOFT_TARGETS: Record<SummarySectionTitle, number> = {
  Communication: 7,
  "Daily Needs & Routines": 10,
  "What helps the day go well": 6,
  "What can upset or overwhelm them": 5,
  "Signs they need help": 7,
  "What helps when they are having a hard time": 6,
  "Health & Safety": 10,
  "Who to contact (and when)": 5
};

const CAREGIVER_ACTION_LEAD_PATTERN =
  /^(?:ask|call|check|give|help|listen|offer|redirect|remind|say|speak|stay|stop|take|tell|turn|wait|watch)\b/i;
const GENERIC_CONTACT_GUIDANCE_PATTERN =
  /^(?:call|contact)\b.*\b(?:any time|day or night|even if|question|small)\b/i;
const LEADING_FRAGMENT_PATTERN =
  /^(?:One|Two|Three|Another|The other|This part|That part)\b/i;
const QUOTED_ALTERNATIVE_PATTERN = /[”"]\s+(?:or|and)\s+[“"]/i;
const HARD_TIME_HEALTH_LEAK_PATTERN =
  /\b(Band-Aids?|transport tape|compression stockings?|vulva|vagina|eczema|boils?|melatonin|quetiapine|Depakote|blood clot|thrombosis|embolism|left leg|hearing aids?|glasses|toothpaste|mouthwash|shampoo|body soaps?)\b/i;
const CHOICE_SUPPORT_PATTERN =
  /\b(two choices|multiple options|pick the last one|meaningful(?:ly)? choos)\b/i;
const SIGNS_META_PATTERN =
  /\b(stop, look, and listen|antecedent|antecedents|environment(?:al)? cues?|pick up any cues|observe|observant|eyes on her at all times)\b/i;
const SIGN_LIKE_PATTERN =
  /\b(yell(?:ing)?|shout(?:ing)?|swear(?:ing)?|angry|mad|rage|enraged|aggressive|hitting herself|self-?injur|flare(?:s|d)? her arms|flail(?:ing)?|limp(?:ing)?|favoring a body part|low energy|not eating|not drinking|dragging a chair|grab(?:bing)? a face cloth|ask(?:s|ing)? for help|quiet|internal|sleepy|lie down|wants to self-soothe|unreachable|respond|dysregulated|trouble)\b/i;
const TRIGGER_LIKE_PATTERN =
  /\b(upset|overwhelm|dysregulat|angry|mad|rage|enraged|tailspin|break down|hungry|hunger|tired|sleepy|not feeling well|quiet and internal|plan|routine|cancel|weather|rain|car problems|adult(?:['’]s)? idea|self-directed|wait for the walk signal|cross the street|control|agency|delay|interrupt|switch(?:ing)? activities|unexpected)\b/i;
const NON_TRIGGER_LEAK_PATTERN =
  /\b(teeth?|floss|toothbrush|water pick|bottle open|help me|crowded|rotor rooted|rooted)\b/i;
const SIGNS_HISTORY_LEAK_PATTERN =
  /\b(going on for \d+|\b\d+\s*(?:or|-)\s*\d+\s+years|swallow studies?|brain review|GI review|nobody can find anything wrong|cycle)\b/i;
const HARD_TIME_ROUTINE_LEAK_PATTERN =
  /\b(morning\b.*\bmedicine|vaginal area|blood pressure drops|starts falling|runs constipated|do not rush her)\b/i;

const SECTION_COVERAGE_REQUIREMENTS: Partial<
  Record<SummarySectionTitle, SectionCoverageRequirement[]>
> = {
  Communication: [
    {
      key: "communication_method",
      description: "how the person communicates",
      matcher:
        /\b(spoken language|speech|communicat|understand|repeat|slow down|speak louder|enunciat)\b/i
    },
    {
      key: "choice_support",
      description: "how to support choices and clarify meaning",
      matcher: /\b(choice|choices|options?|clarify|fill in|context|decode|glossary)\b/i
    }
  ],
  "Daily Needs & Routines": [
    {
      key: "fall_balance_support",
      description: "fall or balance support in the routine",
      matcher: /\b(fall|balance|rush to her side|hold her hand|arm around)\b/i
    },
    {
      key: "toileting_support",
      description: "toileting support",
      matcher: /\b(bathroom|toilet|toileting|toilet paper|wipe|face cloth)\b/i
    },
    {
      key: "hygiene_support",
      description: "hygiene steps",
      matcher:
        /\b(brush(?:ing)?(?: your)? teeth|toothbrush|mouthwash|wash(?:ing)? (?:your )?(?:hands|face)|cleaning|pat dry|underwear|depends|pajamas)\b/i
    },
    {
      key: "medication_food_support",
      description: "medication-with-food routine",
      matcher: /\b(food in (?:her|his|their) stomach|after breakfast|medicine|medications)\b/i
    },
    {
      key: "hydration_support",
      description: "hydration support",
      matcher: /\b(hydrat|drink|straw|cup|pea protein|blood pressure)\b/i
    }
  ],
  "What helps when they are having a hard time": [
    {
      key: "stop_and_attend",
      description: "stop and attend to the person",
      matcher: /\b(stop everything|100% attention|dead stop|turn background noise off)\b/i
    },
    {
      key: "space_and_distance",
      description: "give space or distance",
      matcher: /\b(space|leave (?:you|him|her|them) alone|distance|stand over to the side)\b/i
    },
    {
      key: "validation_support",
      description: "validation or empathy",
      matcher: /\b(what happened|what'?s the matter|you'?re mad|you'?re so sad|empathy|affirm)\b/i
    }
  ]
};

const RAW_SECTION_PATTERNS: Array<{
  sectionTitle: string;
  stepId: ReflectionStepId;
  stepTitle: string;
  aliases: string[];
}> = [
  {
    sectionTitle: "Communication",
    stepId: "communication",
    stepTitle: "Communication",
    aliases: ["Communication"]
  },
  {
    sectionTitle: "Health & Safety",
    stepId: "health_safety",
    stepTitle: "Health & Safety",
    aliases: ["Health & Safety", "Health and Safety"]
  },
  {
    sectionTitle: "Daily Needs & Routines",
    stepId: "daily_schedule",
    stepTitle: "Daily Schedule",
    aliases: ["Daily Schedule", "Daily Needs & Routines"]
  },
  {
    sectionTitle: "What helps the day go well",
    stepId: "activities_preferences",
    stepTitle: "Activities & Preferences",
    aliases: ["Activities & Preferences", "Activities and Preferences"]
  },
  {
    sectionTitle: "What can upset or overwhelm them",
    stepId: "upset_overwhelm",
    stepTitle: "What Can Upset or Overwhelm Them",
    aliases: ["What Can Upset or Overwhelm Them", "What changes in plans or routine tend to upset or overwhelm them"]
  },
  {
    sectionTitle: "Signs they need help",
    stepId: "signs_need_help",
    stepTitle: "Signs They May Need Help",
    aliases: ["Signs They May Need Help", "Signs they need help"]
  },
  {
    sectionTitle: "What helps when they are having a hard time",
    stepId: "hard_time_support",
    stepTitle: "What Helps When They Are Having a Hard Time",
    aliases: ["What Helps When They Are Having a Hard Time"]
  },
  {
    sectionTitle: "Who to contact (and when)",
    stepId: "who_to_contact",
    stepTitle: "Who To Contact",
    aliases: ["Who To Contact", "Who to contact", "Emergency contacts", "Emergency Contacts"]
  }
];

const RAW_PROMPT_DEFINITIONS: RawPromptDefinition[] = [
  {
    sectionTitle: "Communication",
    stepId: "communication",
    stepTitle: "Communication",
    promptLabel: "How do they communicate?",
    aliases: ["How do they communicate?"]
  },
  {
    sectionTitle: "Communication",
    stepId: "communication",
    stepTitle: "Communication",
    promptLabel: "Are there things they say or do that mean something specific? What do they mean?",
    aliases: [
      "Are there things they say or do that mean something specific? What do they mean?"
    ]
  },
  {
    sectionTitle: "Communication",
    stepId: "communication",
    stepTitle: "Communication",
    promptLabel: "What helps you communicate with them?",
    aliases: ["What helps you communicate with them?"]
  },
  {
    sectionTitle: "Communication",
    stepId: "communication",
    stepTitle: "Communication",
    promptLabel: "How can you tell when they need help, and what should you check first?",
    aliases: ["How can you tell when they need help, and what should you check first?"]
  },
  {
    sectionTitle: "Health & Safety",
    stepId: "health_safety",
    stepTitle: "Health & Safety",
    promptLabel: "Are there any allergies?",
    aliases: ["Are there any allergies?"]
  },
  {
    sectionTitle: "Health & Safety",
    stepId: "health_safety",
    stepTitle: "Health & Safety",
    promptLabel: "Do they have any health conditions?",
    aliases: ["Do they have any health conditions?"]
  },
  {
    sectionTitle: "Health & Safety",
    stepId: "health_safety",
    stepTitle: "Health & Safety",
    promptLabel: "Do they take any medication? What should others know?",
    aliases: ["Do they take any medication? What should others know?"]
  },
  {
    sectionTitle: "Health & Safety",
    stepId: "health_safety",
    stepTitle: "Health & Safety",
    promptLabel: "Do they use any equipment or supports?",
    aliases: ["Do they use any equipment or supports?"]
  },
  {
    sectionTitle: "Daily Needs & Routines",
    stepId: "daily_schedule",
    stepTitle: "Daily Schedule",
    promptLabel: "What is their typical morning routine?",
    aliases: ["What is their typical morning routine?"]
  },
  {
    sectionTitle: "Daily Needs & Routines",
    stepId: "daily_schedule",
    stepTitle: "Daily Schedule",
    promptLabel: "What are meals and snacks like?",
    aliases: ["What are meals and snacks like?"]
  },
  {
    sectionTitle: "Daily Needs & Routines",
    stepId: "daily_schedule",
    stepTitle: "Daily Schedule",
    promptLabel: "What helps with transitions during the day?",
    aliases: ["What helps with transitions during the day?"]
  },
  {
    sectionTitle: "Daily Needs & Routines",
    stepId: "daily_schedule",
    stepTitle: "Daily Schedule",
    promptLabel: "What do they like to do during the day?",
    aliases: ["What do they like to do during the day?"]
  },
  {
    sectionTitle: "Daily Needs & Routines",
    stepId: "daily_schedule",
    stepTitle: "Daily Schedule",
    promptLabel: "What is their bedtime routine?",
    aliases: ["What is their bedtime routine?"]
  },
  {
    sectionTitle: "What helps the day go well",
    stepId: "activities_preferences",
    stepTitle: "Activities & Preferences",
    promptLabel: "What do they enjoy doing during the day?",
    aliases: ["What do they enjoy doing during the day?"]
  },
  {
    sectionTitle: "What helps the day go well",
    stepId: "activities_preferences",
    stepTitle: "Activities & Preferences",
    promptLabel: "What do they enjoy doing outside the home?",
    aliases: ["What do they enjoy doing outside the home?"]
  },
  {
    sectionTitle: "What helps the day go well",
    stepId: "activities_preferences",
    stepTitle: "Activities & Preferences",
    promptLabel: "What activities do they enjoy most?",
    aliases: ["What activities do they enjoy most?"]
  },
  {
    sectionTitle: "What helps the day go well",
    stepId: "activities_preferences",
    stepTitle: "Activities & Preferences",
    promptLabel: "Who do they enjoy spending time with?",
    aliases: ["Who do they enjoy spending time with?"]
  },
  {
    sectionTitle: "What helps the day go well",
    stepId: "activities_preferences",
    stepTitle: "Activities & Preferences",
    promptLabel: "What does quiet or downtime look like for them?",
    aliases: ["What does quiet or downtime look like for them?"]
  },
  {
    sectionTitle: "What can upset or overwhelm them",
    stepId: "upset_overwhelm",
    stepTitle: "What Can Upset or Overwhelm Them",
    promptLabel: "What changes in plans or routine tend to upset or overwhelm them?",
    aliases: ["What changes in plans or routine tend to upset or overwhelm them?"]
  },
  {
    sectionTitle: "What can upset or overwhelm them",
    stepId: "upset_overwhelm",
    stepTitle: "What Can Upset or Overwhelm Them",
    promptLabel: "What places or things around them can feel overwhelming?",
    aliases: ["What places or things around them can feel overwhelming?"]
  },
  {
    sectionTitle: "What can upset or overwhelm them",
    stepId: "upset_overwhelm",
    stepTitle: "What Can Upset or Overwhelm Them",
    promptLabel: "What things like hunger, tiredness, or not feeling well can affect them?",
    aliases: ["What things like hunger, tiredness, or not feeling well can affect them?"]
  },
  {
    sectionTitle: "Signs they need help",
    stepId: "signs_need_help",
    stepTitle: "Signs They May Need Help",
    promptLabel: "What signs in their body show they need help?",
    aliases: ["What signs in their body show they need help?"]
  },
  {
    sectionTitle: "Signs they need help",
    stepId: "signs_need_help",
    stepTitle: "Signs They May Need Help",
    promptLabel: "What changes in their behavior show they need help?",
    aliases: ["What changes in their behavior show they need help?"]
  },
  {
    sectionTitle: "Signs they need help",
    stepId: "signs_need_help",
    stepTitle: "Signs They May Need Help",
    promptLabel: "What changes in how they communicate show they need help?",
    aliases: ["What changes in how they communicate show they need help?"]
  },
  {
    sectionTitle: "What helps when they are having a hard time",
    stepId: "hard_time_support",
    stepTitle: "What Helps When They Are Having a Hard Time",
    promptLabel: "What changes to the environment help?",
    aliases: ["What changes to the environment help?"]
  },
  {
    sectionTitle: "What helps when they are having a hard time",
    stepId: "hard_time_support",
    stepTitle: "What Helps When They Are Having a Hard Time",
    promptLabel: "What calming items help them?",
    aliases: ["What calming items help them?"]
  },
  {
    sectionTitle: "What helps when they are having a hard time",
    stepId: "hard_time_support",
    stepTitle: "What Helps When They Are Having a Hard Time",
    promptLabel: "What can you do in the moment to help?",
    aliases: ["What can you do in the moment to help?"]
  },
  {
    sectionTitle: "Who to contact (and when)",
    stepId: "who_to_contact",
    stepTitle: "Who To Contact",
    promptLabel: "Who should be contacted in an emergency?",
    aliases: ["Who should be contacted in an emergency?", "Emergency contacts:"]
  }
];

const PROMPT_ROUTING_BY_LABEL = new Map<string, EntryPromptRouting>([
  ["how do they communicate?", { preferredSection: "Communication", defaultFactKind: "communication_method" }],
  [
    "are there things they say or do that mean something specific? what do they mean?",
    { preferredSection: "Communication", defaultFactKind: "communication_signal" }
  ],
  ["what helps you communicate with them?", { preferredSection: "What helps the day go well", defaultFactKind: "support_strategy" }],
  [
    "how can you tell when they need help, and what should you check first?",
    { preferredSection: "Signs they need help", defaultFactKind: "help_sign" }
  ],
  ["are there any allergies?", { preferredSection: "Health & Safety", defaultFactKind: "condition" }],
  ["do they have any health conditions?", { preferredSection: "Health & Safety", defaultFactKind: "condition" }],
  ["do they take any medication? what should others know?", { preferredSection: "Health & Safety", defaultFactKind: "medication" }],
  ["do they use any equipment or supports?", { preferredSection: "Health & Safety", defaultFactKind: "equipment" }],
  ["what is their typical morning routine?", { preferredSection: "Daily Needs & Routines", defaultFactKind: "routine" }],
  ["what are meals and snacks like?", { preferredSection: "Daily Needs & Routines", defaultFactKind: "routine" }],
  ["what helps with transitions during the day?", { preferredSection: "What helps the day go well", defaultFactKind: "support_strategy" }],
  ["what do they like to do during the day?", { preferredSection: "What helps the day go well", defaultFactKind: "preference" }],
  ["what is their bedtime routine?", { preferredSection: "Daily Needs & Routines", defaultFactKind: "routine" }],
  ["what do they enjoy doing during the day?", { preferredSection: "What helps the day go well", defaultFactKind: "preference" }],
  ["what do they enjoy doing outside the home?", { preferredSection: "What helps the day go well", defaultFactKind: "preference" }],
  ["what activities do they enjoy most?", { preferredSection: "What helps the day go well", defaultFactKind: "preference" }],
  ["who do they enjoy spending time with?", { preferredSection: "What helps the day go well", defaultFactKind: "preference" }],
  ["what does quiet or downtime look like for them?", { preferredSection: "What helps the day go well", defaultFactKind: "preference" }],
  ["what changes in plans or routine tend to upset or overwhelm them?", { preferredSection: "What can upset or overwhelm them", defaultFactKind: "trigger" }],
  ["what places or things around them can feel overwhelming?", { preferredSection: "What can upset or overwhelm them", defaultFactKind: "trigger" }],
  ["what things like hunger, tiredness, or not feeling well can affect them?", { preferredSection: "What can upset or overwhelm them", defaultFactKind: "trigger" }],
  ["what signs in their body show they need help?", { preferredSection: "Signs they need help", defaultFactKind: "help_sign" }],
  ["what changes in their behavior show they need help?", { preferredSection: "Signs they need help", defaultFactKind: "help_sign" }],
  ["what changes in how they communicate show they need help?", { preferredSection: "Signs they need help", defaultFactKind: "help_sign" }],
  ["what changes to the environment help?", { preferredSection: "What helps when they are having a hard time", defaultFactKind: "caregiver_action" }],
  ["what calming items help them?", { preferredSection: "What helps when they are having a hard time", defaultFactKind: "caregiver_action" }],
  ["what can you do in the moment to help?", { preferredSection: "What helps when they are having a hard time", defaultFactKind: "caregiver_action" }],
  ["who should be contacted in an emergency?", { preferredSection: "Who to contact (and when)", defaultFactKind: "contact" }],
  ["emergency contacts:", { preferredSection: "Who to contact (and when)", defaultFactKind: "contact" }]
]);

const STRUCTURED_FACT_KINDS: StructuredFactKind[] = [
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
];

const QUESTION_ECHO_PATTERN =
  /^(?:what|who|how|when|where|why|are|do|does|did|is|can|could|should|would)\b.*\?$/i;
const NON_ANSWER_PATTERN =
  /^(?:use skip|skip|n\/a|na|none|unknown|not sure|not clearly stated(?: in the raw input)?|not stated|not provided|no information)$/i;
const TRANSCRIPTION_NOISE_PATTERN =
  /^(?:um+|uh+|hmm+|mm+|eh+|ah+|ha+|heh+|eheh+|haha+|huh+|mmm+|uh-huh|mm-hmm)$/i;
const TRANSCRIPT_ACKNOWLEDGEMENT_PATTERN =
  /^(?:(?:um+|uh+|mm-hmm|uh-huh|yeah|yes|yep|ok(?:ay)?|right|sure|you know|well|so|i mean|basically|got it)[,\s.-]*)+$/i;
const LEADING_FILLER_PATTERN =
  /^(?:(?:um+|uh+|mm-hmm|uh-huh|yeah|yes|yep|ok(?:ay)?|right|sure|you know|well|so|i mean|basically|first of all)\b\s*[,.-]?\s*)+/i;
const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
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
  "its",
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
  "with",
  "you"
]);

const summarySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: {
      type: "string"
    },
    overview: {
      type: "string"
    },
    communication: {
      type: "array",
      items: {
        type: "string"
      }
    },
    dailyNeedsRoutines: {
      type: "array",
      items: {
        type: "string"
      }
    },
    whatHelpsTheDayGoWell: {
      type: "array",
      items: {
        type: "string"
      }
    },
    whatCanUpsetOrOverwhelmThem: {
      type: "array",
      items: {
        type: "string"
      }
    },
    signsTheyNeedHelp: {
      type: "array",
      items: {
        type: "string"
      }
    },
    whatHelpsWhenTheyAreHavingAHardTime: {
      type: "array",
      items: {
        type: "string"
      }
    },
    healthAndSafety: {
      type: "array",
      items: {
        type: "string"
      }
    },
    whoToContactAndWhen: {
      type: "array",
      items: {
        type: "string"
      }
    }
  },
  required: [
    "title",
    "overview",
    "communication",
    "dailyNeedsRoutines",
    "whatHelpsTheDayGoWell",
    "whatCanUpsetOrOverwhelmThem",
    "signsTheyNeedHelp",
    "whatHelpsWhenTheyAreHavingAHardTime",
    "healthAndSafety",
    "whoToContactAndWhen"
  ]
} as const;

const sectionItemsSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    items: {
      type: "array",
      items: {
        type: "string"
      }
    }
  },
  required: ["items"]
} as const;

const captureSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    facts: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          entryId: {
            type: "string"
          },
          section: {
            type: "string",
            enum: SUMMARY_SECTION_TITLES
          },
          factKind: {
            type: "string",
            enum: STRUCTURED_FACT_KINDS
          },
          statement: {
            type: "string"
          },
          safetyRelevant: {
            type: "boolean"
          }
        },
        required: ["entryId", "section", "factKind", "statement", "safetyRelevant"]
      }
    }
  },
  required: ["facts"]
} as const;

const summarySchemaDescription = `Return JSON with exactly these keys and no others:
{
  "title": "string",
  "overview": "string",
  "communication": ["string"],
  "dailyNeedsRoutines": ["string"],
  "whatHelpsTheDayGoWell": ["string"],
  "whatCanUpsetOrOverwhelmThem": ["string"],
  "signsTheyNeedHelp": ["string"],
  "whatHelpsWhenTheyAreHavingAHardTime": ["string"],
  "healthAndSafety": ["string"],
  "whoToContactAndWhen": ["string"]
}`;

const sectionItemsSchemaDescription = `Return JSON with exactly this shape and no other keys:
{
  "items": ["string"]
}`;

const oneStepSynthesisRules = `You are an assistant that transforms caregiver input into a clear, structured caregiver handoff.

Your role is NOT to summarize.
Your role is to:
1. Extract ALL meaningful information
2. Categorize information correctly
3. Present it in a clear, concise, and actionable format

Core rule
- Include ALL meaningful information from the caregiver input.
- Do NOT omit behaviors, needs, risks, or supports.
- Do NOT simplify away important details.
- If in doubt, include it.
- Ignore copied question text, worksheet instructions, skip notes, testing notes, transcription filler, and obvious non-answer noise unless they clearly contain care information.

Step 1: Extract all information
- Carefully review the caregiver input.
- Break it into a complete list of individual statements.
- Each statement must represent one idea only.
- Each statement must be clear and complete.
- Do not skip meaningful information.

Step 2: Categorize by meaning, not location
- Assign each statement to the single best category based on meaning.
- Use these section titles, in this order, every time:
  1. Communication
  2. Daily Needs & Routines
  3. What helps the day go well
  4. What can upset or overwhelm them
  5. Signs they need help
  6. What helps when they are having a hard time
  7. Health & Safety
  8. Who to contact (and when)
- Category definitions:
  - Communication: how the person expresses themselves and how to understand them.
  - Daily Needs & Routines: schedules, toileting, eating, daily structure, and care routines.
  - What helps the day go well: preventative supports that keep the person regulated and successful.
  - What can upset or overwhelm them: environmental, situational, or internal triggers.
  - Signs they need help: observable behaviors or changes that indicate a need.
  - What helps when they are having a hard time: what a caregiver should do in response.
  - Health & Safety: medical needs, supervision needs, risks, equipment, and physical limitations.
  - Who to contact (and when): emergency and non-emergency contacts or call guidance.
- Strict categorization rules:
  - Categorize based on meaning, not where it was written.
  - Each statement appears in only one category.
  - Choose the most actionable category.
  - Running away, aggression, self-injury, and withdrawal belong in Signs they need help.
  - What the caregiver should do belongs in What helps when they are having a hard time.
  - Supervision needs, physical risks, and medical information belong in Health & Safety.
  - Preventative strategies belong in What helps the day go well.
  - Toileting, eating, and schedules belong in Daily Needs & Routines.
  - Communication methods, AAC device use, sounds, gestures, leading, touching, attention-seeking, and what device selections mean belong in Communication.
- Do not repeat the same fact across sections unless omitting it would create a safety risk.

Step 3: Prioritize safety
- You must clearly include and highlight self-injury, elopement, supervision needs, medical needs, and situations where the caregiver could be harmed when that information is present.

Step 4: Generate output
- Always write the final output in English.
- Build a useful caregiver handoff, not a worksheet recap.
- Include all eight sections, even when no information is available.
- Every section field must be an array of bullet strings.
- If a section has no supported information, return exactly ["${NO_INFORMATION_PLACEHOLDER}"] for that section.
- Rewrite the information into caregiver-ready bullet points. Do not echo the worksheet wording.
- Use bullet points only.
- Each bullet must be one clear, complete sentence.
- Keep language short, direct, and easy to scan.
- Combine similar ideas only when nothing is lost.
- No duplicate information.
- No run-on sentences.
- Do not output question fragments, skip markers, uncertainty notes, or filler/noise such as "Use Skip", "Skip", "Not clearly stated in the raw input", "What do they mean?", "um", or "eheheh".
- Prefer a 6th-8th grade reading level.
- Avoid jargon, meta commentary, process notes, or unsupported assumptions.
- overview must be a short 1-2 sentence summary of the most important themes, not a transcript recap.
- If possible, the overview should briefly state how the person communicates and the most important safety or supervision risks.
- Keep overview under 80 words.

Step 5: Final validation
- Check that all meaningful caregiver input is included.
- Check that no behaviors, needs, or safety risks are missing.
- Check that every item is in the best category.
- Check that the output is easy to scan quickly and tells a new caregiver what to do.
- Fix anything missing, duplicated, misplaced, or unclear before finalizing.`;

const stepOneCaptureRules = `You are Step 1 of a caregiver handoff pipeline.

Goal:
- Capture ALL meaningful caregiver information before any rewriting happens.

You must:
- Capture all meaningful caregiver information from the input.
- Break the information into atomic facts: one idea per fact.
- Preserve the original meaning and wording as much as possible.
- Assign each fact to the single best section based on meaning, not where it was originally entered.
- Assign each fact a factKind from the allowed enum. Use the most specific kind.
- Mark safetyRelevant as true for self-injury, elopement, supervision needs, medical needs, or situations where a caregiver could be harmed.

You must not:
- Omit meaningful behaviors, needs, risks, supports, or routines.
- Rewrite for polish or combine separate ideas into one fact.
- Invent facts or infer details that are not supported by the input.
- Include copied question text, worksheet instructions, skip markers, testing notes, or obvious non-answer filler unless they clearly contain care information.

Section guidance:
- Communication
- Daily Needs & Routines
- What helps the day go well
- What can upset or overwhelm them
- Signs they need help
- What helps when they are having a hard time
- Health & Safety
- Who to contact (and when)

Allowed factKind values:
- communication_method: how the person communicates
- communication_signal: what a signal, AAC selection, gesture, or cue means
- support_strategy: proactive supports that help the day go well
- routine: schedules, toileting, meals, daily care, transitions
- trigger: what can upset or overwhelm them
- help_sign: physical, behavioral, or communication signs that they need help
- caregiver_action: what the caregiver should do in the moment
- condition: diagnoses, allergies, physical limitations, or health conditions
- medication: medicines, doses, and medication instructions
- equipment: devices, supplies, or supports
- safety_risk: supervision needs, elopement, self-injury, or caregiver-harm cautions
- contact: who to contact
- preference: favorite people, activities, places, or downtime preferences

Strict categorization rules:
- Running away, aggression, self-injury, and withdrawal belong in Signs they need help.
- What the caregiver should do belongs in What helps when they are having a hard time.
- Supervision needs, physical risks, and medical information belong in Health & Safety.
- Preventative strategies belong in What helps the day go well.
- Toileting, eating, and schedules belong in Daily Needs & Routines.
- Communication methods, AAC device use, sounds, gestures, leading, touching, attention-seeking, and what device selections mean belong in Communication.
- General regulation supports such as car rides, walks, preferred activities, and environmental supports belong in What helps the day go well even if the caregiver mentions that they help when the person is upset.
- Direct caregiver actions such as offer, take, help, redirect, check, move, or stay with belong in What helps when they are having a hard time.
- If a device selection explains what the person is trying to communicate, keep it in Communication.
- If the device not working or inability to access content causes distress, place it in What can upset or overwhelm them.
- If checking search history or helping find content is a preventative support, place it in What helps the day go well.
- If helping find content is phrased as an in-the-moment caregiver action, place it in What helps when they are having a hard time.
- Use communication only for how Gavin expresses himself and what his signals mean.
- Do not place proactive supports, triggers, signs of distress, or caregiver instructions in Communication.
- The factKind must agree with the section. For example, medication belongs in Health & Safety with factKind=medication, not help_sign.

Use the provided Entry labels in entryId exactly, such as "Entry 1".`;

const stepTwoRewriteRules = `You are Step 2 of a caregiver handoff pipeline.

Goal:
- Turn the structured capture into a final caregiver-ready handoff summary.

You must:
- Ensure every meaningful fact from the structured capture appears in the final output, either directly or as part of a carefully combined bullet.
- Combine duplicate or near-duplicate facts only when nothing important is lost.
- Rewrite for clarity, readability, and actionability.
- Prioritize safety, supervision, behavioral signals, and what caregivers should do.
- Keep the output easy to scan in under 2 minutes.

Output rules:
- Always write the final output in English.
- Include all eight sections, even when no information is available.
- Every section field must be an array of bullet strings.
- If a section has no supported information, return exactly ["${NO_INFORMATION_PLACEHOLDER}"] for that section.
- Use bullet points only.
- Each bullet must be one clear, complete sentence.
- Keep language short, direct, and respectful.
- No duplicate information.
- No run-on sentences.
- No question fragments, worksheet wording, or filler/noise.
- The section assignments in the structured capture are authoritative. Keep each fact in its assigned section.
- The factKind assignments in the structured capture are authoritative. Use them to keep bullets in the right role within each section.
- Do not move facts into Communication just because they mention an iPad, AAC device, attention, or help.
- Use this distinction:
  - meaning of a device selection or communication method -> Communication
  - a trigger caused by device/content access problems -> What can upset or overwhelm them
  - a proactive support such as helping find content before distress escalates -> What helps the day go well
  - an in-the-moment caregiver action during distress -> What helps when they are having a hard time
- AAC selection meanings, AAC help requests, and what device buttons mean must stay in Communication, not Signs they need help.
- Keep general regulation supports such as car rides, walks, or preferred activities in What helps the day go well.
- Keep direct action bullets such as "offer a car ride" or "help him access" in What helps when they are having a hard time.
- Keep bathroom reminders and regular food access in What helps the day go well when they are presented as proactive supports.
- Keep repeated trips to the fridge, grabbing cheese, hiding, grunting, angry vocalizations, elopement, and hand biting in Signs they need help.
- Keep inability to open items, inability to access iPad content, hunger, and missing preferred items in What can upset or overwhelm them.
- Do not place equipment inventories, diagnoses, medications, toileting routines, hunger/fridge signs, or physical illness signs in Communication.
- Keep diagnoses, medications, equipment/supports, supervision risks, and caregiver-harm cautions in Health & Safety when present.
- Keep bullets atomic and concise so they can be reorganized into a richer final handoff layout after rewriting.
- Prefer short fact statements such as "Uses AAC to ask for help", "Leads you to what he needs", "Give space immediately", or "Abilify at 3pm daily" over long transcript-style sentences.
- Keep medications, equipment, contacts, and health conditions as separate bullets.
- In What helps the day go well, collapse preferred activities into 1-2 concise bullets. Do not repeat the same preference in separate "likes" or "enjoys" bullets.
- In What helps the day go well, do not produce long runs of one-item preference bullets like "He likes X."
- In What helps the day go well, if a preferred activity helps regulation or keeps the day steady, phrase it as a support statement such as "Walks and car rides help him regulate," not just "He enjoys walks and car rides."
- If many favorite activities are listed, collapse them into broad categories instead of an exhaustive inventory. Prefer one concise bullet over a long comma-separated list.
- Avoid additive filler such as "He also enjoys" at the start of bullets.
- In Communication, do not repeat the same cue twice in different wording.
- In Signs they need help, keep only one phrasing per symptom (for example, keep either "Not eating can mean illness" or "Not eating is a sign", not both).
- In What can upset or overwhelm them, collapse repeated transition or stop-activity triggers into one bullet.
- In What can upset or overwhelm them, prefer direct trigger wording such as "Crowded settings or too many people can feel overwhelming."
- In What helps when they are having a hard time, collapse repeated troubleshooting steps into one clean caregiver action bullet.
- overview must be a short 1-2 sentence summary of the most important themes.
- If possible, the overview should briefly state how the person communicates and the most important safety or supervision risks.
- Keep overview under 80 words.`;

function extractChatCompletionText(content?: string | ChatCompletionContentPart[]) {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .map((part) => (part?.type === "text" && typeof part.text === "string" ? part.text : ""))
    .join("")
    .trim();
}

function compactWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function isSummarySectionTitle(value?: string): value is SummarySectionTitle {
  return Boolean(value) && SUMMARY_SECTION_TITLES.includes(value as SummarySectionTitle);
}

function generatedSummaryFieldForSection(title: SummarySectionTitle) {
  const field = GENERATED_SUMMARY_FIELD_BY_TITLE.get(title);
  if (!field) {
    throw new Error(`Unsupported summary section title: ${title}`);
  }

  return field;
}

function isHighRiskSection(title: SummarySectionTitle) {
  return HIGH_RISK_SECTION_TITLES.has(title);
}

function sectionRiskTier(title: SummarySectionTitle): SectionRiskTier {
  return SECTION_RISK_TIERS[title];
}

function mergeRepairHintsWithLimit(maxHints: number, ...hintGroups: string[][]) {
  const merged: string[] = [];
  const seen = new Set<string>();

  for (const group of hintGroups) {
    for (const rawHint of group) {
      const hint = compactWhitespace(String(rawHint ?? ""));
      const key = hint.toLowerCase();

      if (!hint || seen.has(key)) {
        continue;
      }

      seen.add(key);
      merged.push(hint);

      if (merged.length >= maxHints) {
        return merged;
      }
    }
  }

  return merged;
}

function sanitizeRewrittenSectionItems(items: unknown) {
  if (!Array.isArray(items)) {
    return [NO_INFORMATION_PLACEHOLDER];
  }

  const normalized = [...new Set(
    items
      .map((item) => compactWhitespace(String(item ?? "")))
      .filter(Boolean)
  )];

  return normalized.length > 0 ? normalized : [NO_INFORMATION_PLACEHOLDER];
}

function renderSummaryEntryText(entry: SummarySourceEntry) {
  const lines = [
    entry.entryId,
    entry.sectionTitle ? `Original main category: ${compactWhitespace(entry.sectionTitle)}` : "",
    entry.stepTitle && entry.stepTitle !== entry.sectionTitle
      ? `Original subsection: ${compactWhitespace(entry.stepTitle)}`
      : "",
    entry.promptLabel ? `Question asked: ${compactWhitespace(entry.promptLabel)}` : "",
    `Caregiver input:\n${entry.content}`
  ].filter(Boolean);

  return lines.join("\n");
}

function uniqueNonEmpty(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function looksLikeTruncatedStructuredOutput(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }

  const openBraces = (trimmed.match(/{/g) ?? []).length;
  const closeBraces = (trimmed.match(/}/g) ?? []).length;
  const openBrackets = (trimmed.match(/\[/g) ?? []).length;
  const closeBrackets = (trimmed.match(/]/g) ?? []).length;

  if (openBraces > closeBraces || openBrackets > closeBrackets) {
    return true;
  }

  return /^[\[{]/.test(trimmed) && !/[\]}]\s*$/.test(trimmed);
}

function extractJsonCandidates(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return [];
  }

  const codeFenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  const firstBracket = trimmed.indexOf("[");
  const lastBracket = trimmed.lastIndexOf("]");

  return uniqueNonEmpty([
    trimmed,
    codeFenceMatch?.[1] ?? "",
    firstBrace >= 0 && lastBrace > firstBrace ? trimmed.slice(firstBrace, lastBrace + 1) : "",
    firstBracket >= 0 && lastBracket > firstBracket
      ? trimmed.slice(firstBracket, lastBracket + 1)
      : ""
  ]);
}

function parseStructuredJson<T>(value: string) {
  for (const candidate of extractJsonCandidates(value)) {
    try {
      return JSON.parse(candidate) as T;
    } catch {
      // Try the next candidate.
    }
  }

  return null;
}

function normalizeSummarySourceText(value: string) {
  const normalized = value
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => (line.trim() ? compactWhitespace(line) : ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return compactMedicationPortalDump(normalized);
}

function looksLikeMedicationPortalDump(value: string) {
  const markerHits = MEDICATION_PORTAL_MARKERS.reduce(
    (count, pattern) => count + (pattern.test(value) ? 1 : 0),
    0
  );

  return markerHits >= 3;
}

function isMedicationPortalIgnoredLine(line: string) {
  if (MEDICATION_PORTAL_IGNORED_LINE_PATTERNS.some((pattern) => pattern.test(line))) {
    return true;
  }

  if (/\b(?:walgreens|cvs|rite aid|pharmacy|drugstore)\b/i.test(line)) {
    return true;
  }

  if (
    /^\d+\s+.+\b(?:street|st|road|rd|avenue|ave|boulevard|blvd|drive|dr|lane|ln|way|ma)\b/i.test(
      line
    )
  ) {
    return true;
  }

  return false;
}

function compactMedicationPortalDump(value: string) {
  if (!looksLikeMedicationPortalDump(value)) {
    return value;
  }

  const lines = value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const cleaned = lines.filter((line) => !isMedicationPortalIgnoredLine(line)).join("\n").trim();
  if (!cleaned) {
    return value;
  }

  return /^current medications\b/i.test(cleaned) ? cleaned : `Current medications\n${cleaned}`;
}

function captureBatchConcurrency() {
  const raw = Number.parseInt(process.env.OPENAI_SUMMARY_CAPTURE_CONCURRENCY ?? "", 10);
  if (!Number.isFinite(raw) || raw <= 0) {
    return DEFAULT_CAPTURE_CONCURRENCY;
  }

  return Math.max(1, Math.min(MAX_CAPTURE_CONCURRENCY, raw));
}

function normalizeCompressionKey(value: string) {
  return compactWhitespace(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function isLowSignalSummaryUnit(value: string) {
  return LOW_SIGNAL_SUMMARY_UNIT_PATTERNS.some((pattern) => pattern.test(value));
}

type CompressedSummaryUnit = {
  order: number;
  key: string;
  text: string;
  score: number;
};

function compressionUnitsOverlap(leftKey: string, rightKey: string) {
  return leftKey === rightKey || leftKey.includes(rightKey) || rightKey.includes(leftKey);
}

function shouldPreferCompressionUnit(
  candidate: Pick<CompressedSummaryUnit, "text" | "score">,
  existing: Pick<CompressedSummaryUnit, "text" | "score">
) {
  if (candidate.score !== existing.score) {
    return candidate.score > existing.score;
  }

  if (candidate.text.length !== existing.text.length) {
    return candidate.text.length > existing.text.length;
  }

  return false;
}

function scoreSummaryCompressionUnit(value: string) {
  if (!cleanCaptureStatement(value)) {
    return 0;
  }

  if (
    statementLooksLikeContact(value) ||
    statementLooksLikeMedication(value) ||
    statementLooksLikeEquipment(value) ||
    statementLooksLikeCondition(value) ||
    statementLooksLikeSafetyRisk(value) ||
    statementLooksLikeDirectCaregiverAction(value) ||
    statementLooksLikeHelpSign(value) ||
    statementLooksLikeRoutine(value) ||
    statementLooksLikeTrigger(value) ||
    statementLooksLikeCommunication(value) ||
    statementLooksLikePreference(value)
  ) {
    return 3;
  }

  if (
    HIGH_SIGNAL_SUMMARY_HINT_PATTERN.test(value) ||
    /\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/.test(value) ||
    /\b\d{1,2}:\d{2}\s*(?:a\.m\.|p\.m\.|am|pm)?\b/i.test(value) ||
    /\b\d+\s*(?:mg|mcg|mL|ml|g|tablets?|capsules?)\b/i.test(value)
  ) {
    return 2;
  }

  return value.length >= 80 ? 1 : 0;
}

function splitLongAnswerIntoCompressionUnits(content: string) {
  return content
    .split(/\n{2,}/)
    .flatMap((paragraph) => {
      const trimmedParagraph = paragraph.trim();
      if (!trimmedParagraph) {
        return [];
      }

      const lines = trimmedParagraph
        .split(/\n+/)
        .map((line) => compactWhitespace(line))
        .filter(Boolean);

      if (lines.length > 1) {
        return lines;
      }

      return trimmedParagraph
        .split(/(?<=[.!?])\s+(?=[A-Z0-9"“])/)
        .map((sentence) => compactWhitespace(sentence))
        .filter(Boolean);
    })
    .filter(Boolean);
}

function compressLongSummaryAnswer(content: string) {
  if (content.length <= LONG_ANSWER_PRECOMPRESSION_THRESHOLD_CHARS) {
    return content;
  }

  const units = splitLongAnswerIntoCompressionUnits(content);
  if (units.length <= 1) {
    return content;
  }

  const filteredUnits: CompressedSummaryUnit[] = [];

  for (const [index, unit] of units.entries()) {
    const normalizedUnit = compactWhitespace(unit);
    if (!normalizedUnit) {
      continue;
    }

    const key = normalizeCompressionKey(normalizedUnit);
    if (!key) {
      continue;
    }

    const score = scoreSummaryCompressionUnit(normalizedUnit);
    if (score === 0 && isLowSignalSummaryUnit(normalizedUnit)) {
      continue;
    }

    const overlappingIndex = filteredUnits.findIndex((existing) =>
      compressionUnitsOverlap(existing.key, key)
    );

    if (overlappingIndex >= 0) {
      const existing = filteredUnits[overlappingIndex];
      if (shouldPreferCompressionUnit({ text: normalizedUnit, score }, existing)) {
        filteredUnits[overlappingIndex] = {
          ...existing,
          key,
          text: normalizedUnit,
          score
        };
      }
      continue;
    }

    filteredUnits.push({
      order: index,
      key,
      text: normalizedUnit,
      score
    });
  }

  const filteredText = filteredUnits.map((unit) => unit.text).join("\n");
  if (
    filteredText.length === 0 ||
    filteredText.length >= content.length ||
    filteredText.length <= LONG_ANSWER_PRECOMPRESSION_TARGET_CHARS
  ) {
    return filteredText || content;
  }

  const selectedOrders = new Set<number>();
  let selectedLength = 0;
  let selectedCount = 0;

  const trySelect = (unit: CompressedSummaryUnit, limit: number) => {
    const nextLength = selectedLength + (selectedCount > 0 ? 1 : 0) + unit.text.length;
    if (nextLength > limit && selectedCount >= 8) {
      return;
    }

    selectedOrders.add(unit.order);
    selectedLength = nextLength;
    selectedCount += 1;
  };

  for (const score of [3, 2, 1, 0]) {
    for (const unit of filteredUnits) {
      if (unit.score !== score || selectedOrders.has(unit.order)) {
        continue;
      }

      trySelect(unit, LONG_ANSWER_PRECOMPRESSION_TARGET_CHARS);
    }
  }

  const selectedText = filteredUnits
    .filter((unit) => selectedOrders.has(unit.order))
    .map((unit) => unit.text)
    .join("\n")
    .trim();

  if (!selectedText || selectedText.length >= filteredText.length) {
    return filteredText;
  }

  return selectedText;
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function rawPromptRegex(prompt: RawPromptDefinition) {
  return new RegExp(
    `(?:^|\\n)\\s*(?:${prompt.aliases.map((alias) => escapeRegex(alias)).join("|")})\\s*`,
    "gi"
  );
}

function rawSectionRegex() {
  return new RegExp(
    `(?:^|\\n)\\s*(?:${RAW_SECTION_PATTERNS.flatMap((pattern) => pattern.aliases)
      .map((alias) => escapeRegex(alias))
      .join("|")})\\s*(?=\\n|$)`,
    "gi"
  );
}

function looksLikeRawInputDocument(content: string) {
  const normalized = normalizeSummarySourceText(content);
  if (!normalized) {
    return false;
  }

  const promptHits = RAW_PROMPT_DEFINITIONS.reduce((count, definition) => {
    const match = normalized.match(rawPromptRegex(definition));
    return count + (match?.length ?? 0);
  }, 0);
  const sectionHits = normalized.match(rawSectionRegex())?.length ?? 0;

  return promptHits >= 3 || (promptHits >= 2 && sectionHits >= 1);
}

function findPromptAtStart(
  content: string,
  startIndex: number
) {
  const slice = content.slice(startIndex);

  for (const definition of RAW_PROMPT_DEFINITIONS) {
    for (const alias of definition.aliases) {
      const regex = new RegExp(`^\\s*${escapeRegex(alias)}\\s*`, "i");
      const match = slice.match(regex);
      if (match) {
        return {
          definition,
          length: match[0].length
        };
      }
    }
  }

  return null;
}

export function expandTurnsForSummaryCapture(turns: ConversationTurn[]) {
  const expanded: ConversationTurn[] = [];

  for (const turn of turns) {
    if (turn.role !== "user" || turn.skipped || !looksLikeRawInputDocument(turn.content)) {
      expanded.push(turn);
      continue;
    }

    const normalized = normalizeSummarySourceText(turn.content);
    const matches = Array.from(
      new Set(
        RAW_PROMPT_DEFINITIONS.flatMap((definition) =>
          [...normalized.matchAll(rawPromptRegex(definition))].map((match) => match.index ?? -1)
        ).filter((index) => index >= 0)
      )
    ).sort((left, right) => left - right);
    const sectionBoundaries = [...normalized.matchAll(rawSectionRegex())]
      .map((match) => match.index ?? -1)
      .filter((index) => index >= 0);
    const boundaries = Array.from(new Set([...matches, ...sectionBoundaries])).sort(
      (left, right) => left - right
    );

    if (matches.length === 0) {
      expanded.push(turn);
      continue;
    }

    const parsedTurns: ConversationTurn[] = [];

    for (let index = 0; index < matches.length; index += 1) {
      const start = matches[index];
      const promptMatch = findPromptAtStart(normalized, start);
      if (!promptMatch) {
        continue;
      }

      const end =
        boundaries.find((boundary) => boundary > start) ??
        normalized.length;
      const answer = normalized.slice(start + promptMatch.length, end).trim();
      if (!answer) {
        continue;
      }

      parsedTurns.push({
        ...turn,
        id: `${turn.id}-parsed-${parsedTurns.length + 1}`,
        content: answer,
        sectionTitle: promptMatch.definition.sectionTitle,
        stepId: promptMatch.definition.stepId,
        stepTitle: promptMatch.definition.stepTitle,
        promptLabel: promptMatch.definition.promptLabel
      });
    }

    if (parsedTurns.length === 0) {
      expanded.push(turn);
      continue;
    }

    expanded.push(...parsedTurns);
  }

  return expanded;
}

function splitSummaryEntryContent(content: string, maxChars: number) {
  if (content.length <= maxChars) {
    return [content];
  }

  const paragraphs = content
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  const chunks: string[] = [];
  let current = "";

  const pushChunk = () => {
    if (current.trim()) {
      chunks.push(current.trim());
      current = "";
    }
  };

  const appendPiece = (piece: string) => {
    if (!piece.trim()) {
      return;
    }

    const separator = current ? "\n\n" : "";
    if ((current + separator + piece).length <= maxChars) {
      current = `${current}${separator}${piece}`;
      return;
    }

    pushChunk();

    if (piece.length <= maxChars) {
      current = piece;
      return;
    }

    const lines = piece
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean);

    if (lines.length > 1) {
      let lineChunk = "";

      for (const line of lines) {
        const lineSeparator = lineChunk ? "\n" : "";
        if ((lineChunk + lineSeparator + line).length <= maxChars) {
          lineChunk = `${lineChunk}${lineSeparator}${line}`;
          continue;
        }

        if (lineChunk) {
          chunks.push(lineChunk.trim());
        }
        lineChunk = line;
      }

      if (lineChunk.trim()) {
        current = lineChunk.trim();
      }
      return;
    }

    const sentences = piece
      .split(/(?<=[.!?])\s+(?=[A-Z0-9"“])/)
      .map((sentence) => sentence.trim())
      .filter(Boolean);

    if (sentences.length <= 1) {
      for (let index = 0; index < piece.length; index += maxChars) {
        chunks.push(piece.slice(index, index + maxChars).trim());
      }
      current = "";
      return;
    }

    let sentenceChunk = "";
    for (const sentence of sentences) {
      const sentenceSeparator = sentenceChunk ? " " : "";
      if ((sentenceChunk + sentenceSeparator + sentence).length <= maxChars) {
        sentenceChunk = `${sentenceChunk}${sentenceSeparator}${sentence}`;
        continue;
      }

      if (sentenceChunk) {
        chunks.push(sentenceChunk.trim());
      }
      sentenceChunk = sentence;
    }

    if (sentenceChunk.trim()) {
      current = sentenceChunk.trim();
    }
  };

  for (const paragraph of paragraphs) {
    appendPiece(paragraph);
  }

  pushChunk();

  return chunks.filter(Boolean);
}

function createSummarySourceEntry(
  turn: Pick<
    ConversationTurn,
    "sectionTitle" | "stepId" | "stepTitle" | "promptLabel"
  >,
  entryId: string,
  content: string,
  options: Partial<Pick<SummarySourceEntry, "internalEntryId" | "splitDepth" | "splitStrategy">> = {}
): SummarySourceEntry {
  return {
    internalEntryId:
      options.internalEntryId ??
      `${entryId.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "entry"}-${Math.random().toString(36).slice(2, 8)}`,
    entryId,
    content,
    sectionTitle: turn.sectionTitle,
    stepId: turn.stepId,
    stepTitle: turn.stepTitle,
    promptLabel: turn.promptLabel,
    splitDepth: options.splitDepth ?? 0,
    splitStrategy: options.splitStrategy ?? "entry"
  };
}

function splitPiecesIntoBalancedGroups(pieces: string[], separator: string) {
  if (pieces.length < 2) {
    return null;
  }

  const totalLength = pieces.reduce((sum, piece) => sum + piece.length, 0);
  const target = totalLength / 2;
  let running = 0;
  let splitIndex = 1;

  for (let index = 0; index < pieces.length - 1; index += 1) {
    running += pieces[index]?.length ?? 0;
    if (running >= target) {
      splitIndex = index + 1;
      break;
    }
  }

  const left = pieces.slice(0, splitIndex).join(separator).trim();
  const right = pieces.slice(splitIndex).join(separator).trim();

  if (!left || !right) {
    return null;
  }

  return [left, right] as const;
}

function splitEntryByParagraphGroups(entry: SummarySourceEntry) {
  const paragraphs = entry.content
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  const groups = splitPiecesIntoBalancedGroups(paragraphs, "\n\n");
  if (!groups) {
    return null;
  }

  return groups.map((content, index) =>
    createSummarySourceEntry(entry, entry.entryId, content, {
      internalEntryId: `${entry.internalEntryId}.p${index + 1}`,
      splitDepth: entry.splitDepth + 1,
      splitStrategy: "paragraph"
    })
  );
}

function splitEntryByLineGroups(entry: SummarySourceEntry) {
  const lines = entry.content
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const groups = splitPiecesIntoBalancedGroups(lines, "\n");
  if (!groups) {
    return null;
  }

  return groups.map((content, index) =>
    createSummarySourceEntry(entry, entry.entryId, content, {
      internalEntryId: `${entry.internalEntryId}.l${index + 1}`,
      splitDepth: entry.splitDepth + 1,
      splitStrategy: "line"
    })
  );
}

function splitEntryBySentenceGroups(entry: SummarySourceEntry) {
  const sentences = entry.content
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"“])/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  const groups = splitPiecesIntoBalancedGroups(sentences, " ");
  if (!groups) {
    return null;
  }

  return groups.map((content, index) =>
    createSummarySourceEntry(entry, entry.entryId, content, {
      internalEntryId: `${entry.internalEntryId}.s${index + 1}`,
      splitDepth: entry.splitDepth + 1,
      splitStrategy: "sentence"
    })
  );
}

function splitEntryByHardChars(entry: SummarySourceEntry) {
  const content = entry.content.trim();
  if (content.length < 2) {
    return null;
  }

  const midpoint = Math.floor(content.length / 2);
  let splitIndex = midpoint;

  for (let offset = 0; offset < Math.min(120, content.length - 1); offset += 1) {
    const rightIndex = midpoint + offset;
    if (rightIndex < content.length && /\s/.test(content[rightIndex] ?? "")) {
      splitIndex = rightIndex;
      break;
    }

    const leftIndex = midpoint - offset;
    if (leftIndex > 0 && /\s/.test(content[leftIndex] ?? "")) {
      splitIndex = leftIndex;
      break;
    }
  }

  const left = content.slice(0, splitIndex).trim();
  const right = content.slice(splitIndex).trim();
  if (!left || !right) {
    return null;
  }

  return [left, right].map((piece, index) =>
    createSummarySourceEntry(entry, entry.entryId, piece, {
      internalEntryId: `${entry.internalEntryId}.c${index + 1}`,
      splitDepth: entry.splitDepth + 1,
      splitStrategy: "chars"
    })
  );
}

type CaptureRetrySplit = {
  strategy: SummaryEntrySplitStrategy;
  chunks: SummarySourceEntry[][];
};

function splitCaptureEntriesForRetry(chunkEntries: SummarySourceEntry[]): CaptureRetrySplit | null {
  if (chunkEntries.length > 1) {
    const midpoint = Math.ceil(chunkEntries.length / 2);
    return {
      strategy: "entry",
      chunks: [chunkEntries.slice(0, midpoint), chunkEntries.slice(midpoint)].filter(
        (chunk) => chunk.length > 0
      )
    };
  }

  const [entry] = chunkEntries;
  if (!entry) {
    return null;
  }

  const paragraphSplit = splitEntryByParagraphGroups(entry);
  if (paragraphSplit) {
    return {
      strategy: "paragraph",
      chunks: paragraphSplit.map((part) => [part])
    };
  }

  const lineSplit = splitEntryByLineGroups(entry);
  if (lineSplit) {
    return {
      strategy: "line",
      chunks: lineSplit.map((part) => [part])
    };
  }

  const sentenceSplit = splitEntryBySentenceGroups(entry);
  if (sentenceSplit) {
    return {
      strategy: "sentence",
      chunks: sentenceSplit.map((part) => [part])
    };
  }

  const charSplit = splitEntryByHardChars(entry);
  if (charSplit) {
    return {
      strategy: "chars",
      chunks: charSplit.map((part) => [part])
    };
  }

  return null;
}

function buildSummaryEntries(turns: ConversationTurn[], options?: { chunkLongEntries?: boolean }) {
  return expandTurnsForSummaryCapture(turns)
    .filter((turn) => turn.role === "user" && !turn.skipped)
    .flatMap((turn, index) => {
      const entryId = `Entry ${index + 1}`;
      const content = compressLongSummaryAnswer(normalizeSummarySourceText(turn.content));
      const parts = options?.chunkLongEntries
        ? splitSummaryEntryContent(content, CAPTURE_ENTRY_TARGET_CHARS)
        : [content];

      return parts.map((part, partIndex) =>
        createSummarySourceEntry(turn, entryId, part, {
          internalEntryId: `${entryId.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "entry"}-part-${partIndex + 1}`,
          splitDepth: 0,
          splitStrategy: "entry"
        })
      );
    });
}

function normalizePromptKey(value?: string) {
  return compactWhitespace(String(value ?? "")).toLowerCase();
}

function entryRouting(entry?: SummarySourceEntry): EntryPromptRouting | null {
  if (!entry) {
    return null;
  }

  const byPrompt = PROMPT_ROUTING_BY_LABEL.get(normalizePromptKey(entry.promptLabel));
  if (byPrompt) {
    return byPrompt;
  }

  switch (entry.stepId) {
    case "communication":
      return { preferredSection: "Communication", defaultFactKind: "communication_method" };
    case "health_safety":
      return { preferredSection: "Health & Safety", defaultFactKind: "condition" };
    case "daily_schedule":
      return { preferredSection: "Daily Needs & Routines", defaultFactKind: "routine" };
    case "activities_preferences":
      return { preferredSection: "What helps the day go well", defaultFactKind: "preference" };
    case "upset_overwhelm":
      return { preferredSection: "What can upset or overwhelm them", defaultFactKind: "trigger" };
    case "signs_need_help":
      return { preferredSection: "Signs they need help", defaultFactKind: "help_sign" };
    case "hard_time_support":
      return {
        preferredSection: "What helps when they are having a hard time",
        defaultFactKind: "caregiver_action"
      };
    case "who_to_contact":
      return { preferredSection: "Who to contact (and when)", defaultFactKind: "contact" };
    default:
      return null;
  }
}

function defaultModel() {
  return process.env.OPENAI_MODEL ?? DEFAULT_SUMMARY_MODEL;
}

function summaryRequestTimeoutMs() {
  const raw = Number.parseInt(process.env.OPENAI_SUMMARY_TIMEOUT_MS ?? "", 10);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_OPENAI_TIMEOUT_MS;
}

function buildTitleInstruction(nameHint?: string) {
  return nameHint
    ? `The product already displays the overall heading "Caregiver Handoff". For the JSON "title" field, use exactly "Caring for ${nameHint}".`
    : 'The product already displays the overall heading "Caregiver Handoff". For the JSON "title" field, use "Caring for <Name>" if the name is clear and reliable in the transcript. Otherwise use "Caregiver Handoff Summary".';
}

function sanitizeTranscriptFragment(value: string) {
  const trimmed = value
    .replace(/^[\-\u2022*]+\s*/u, "")
    .replace(/^["'“”]+|["'“”]+$/gu, "")
    .trim();

  if (!trimmed) {
    return null;
  }

  const withoutLeadingFiller = trimmed.replace(LEADING_FILLER_PATTERN, "").trim();
  const candidate = withoutLeadingFiller || trimmed;

  if (
    !candidate ||
    TRANSCRIPT_ACKNOWLEDGEMENT_PATTERN.test(candidate) ||
    TRANSCRIPTION_NOISE_PATTERN.test(candidate)
  ) {
    return null;
  }

  const alphanumericCount = (candidate.match(/[A-Za-z0-9]/g) ?? []).length;
  if (alphanumericCount < 3) {
    return null;
  }

  return candidate.replace(/\s+/g, " ");
}

function cleanCaptureStatement(value: string) {
  const trimmed = sanitizeTranscriptFragment(value);
  if (!trimmed) {
    return null;
  }

  if (NON_ANSWER_PATTERN.test(trimmed) || QUESTION_ECHO_PATTERN.test(trimmed)) {
    return null;
  }

  if (/^(?:that|this)\s+usually\s+helps\.?$/i.test(trimmed)) {
    return null;
  }

  if (/^other signs .* can be physical\.?$/i.test(trimmed)) {
    return null;
  }

  if (/^it'?s more about redirecting\.?$/i.test(trimmed)) {
    return null;
  }

  return trimmed;
}

function statementLooksLikeMedication(value: string) {
  return /\b(abilify|aripiprazole|miralax|polyethylene glycol|clearlax|gavilax|healthylax|multivitamin|gummy vites|mg\b|dose|once a day|daily at|3pm|3 p\.m\.)\b/i.test(
    value
  );
}

function statementLooksLikeEquipment(value: string) {
  return /\b(aac on an ipad|aac device|touchchat|noise-?cancel(?:ing)? headphones?|headphones?|buckle buddy|fidgets?|pull-?ups?|white cane)\b/i.test(
    value
  );
}

function statementLooksLikeCondition(value: string) {
  return /\b(no allergies|allerg|autism|cerebral visual impairment|cvi|language regression|mixed receptive-expressive language disorder|sensory processing difficulty|global developmental delay|apraxia of speech|diagnos|condition|low muscle tone)\b/i.test(
    value
  );
}

function statementLooksLikeSafetyRisk(value: string) {
  return /\b(two caregivers?|two people|2 adults?|close supervision|supervision|safety risk|unsafe|pica|elopement|run away|hand biting|self-injury|may bite you|caregiver injury|for safety reasons?)\b/i.test(
    value
  );
}

function statementLooksLikeDirectCaregiverAction(value: string) {
  return /^(?:back off|check|do not|don't|follow|give|help|keep|let|make sure|offer|prompt|reduce|redirect|remind|support|take|turn on|use)\b/i.test(
    value
  );
}

function statementLooksLikeHelpSign(value: string) {
  return /\b(press(?:es)? help|sign for help|limping|avoid(?:ing)? (?:a )?body part|not eating|not drinking|low energy|letharg|elop|run(?:ning)? away|hand biting|angry (?:sounds?|vocalizations?|yelling)|yelling|hiding|grunting|fridge|grabbing cheese|hungry|dysregulated|agitated|overwhelmed|pain|illness)\b/i.test(
    value
  );
}

function statementLooksLikeRoutine(value: string) {
  return /\b(bathroom|toilet|toileting|pull-?up|bowel movement|routine|morning|breakfast|meal|meals|snack|snacks|school|van|water bottle|sippy cup|diet|bite-sized|grazes|showerhead|dress(?:ing)?|deodorant|socks|teeth brushing|hair)\b/i.test(
    value
  );
}

function statementLooksLikeTrigger(value: string) {
  return /\b(out of place|things moved|lights?|shades?|loud noise|bright lights?|crowded places?|too many people|chaotic|overstimulating|hunger|not having food available|internet is down|cannot find|can't find|not working|stop(?:ping)? an activity|transition(?:ing)?)\b/i.test(
    value
  );
}

function statementLooksLikeCommunication(value: string) {
  return /\b(non-speaking|cannot say words|uses? (?:an )?aac|touchchat|communicates? with sounds|body language|gestures?|happy sounds?|angry sounds?|singing|lead(?:ing)? you|touch(?:ing)? you|sit(?:ting)? very close|wants attention|selects? (?:car|i want ipad|ipad|a color)|ask for help)\b/i.test(
    value
  );
}

function statementLooksLikePreference(value: string) {
  return /^(?:he|she|they|gavin|mom)\s+(?:really\s+)?(?:likes?|loves?|enjoys?|especially enjoys)\b/i.test(
    value
  ) || /^(?:his|her|their)\s+biggest favorites are\b/i.test(value);
}

function inferCaptureRouting(
  statement: string,
  rawSection: SummarySectionTitle,
  rawFactKind: StructuredFactKind,
  entry?: SummarySourceEntry
) {
  const routing = entryRouting(entry);
  const preferredSection = routing?.preferredSection ?? rawSection;
  const defaultFactKind = routing?.defaultFactKind ?? rawFactKind;

  if (statementLooksLikeContact(statement)) {
    return { section: "Who to contact (and when)" as SummarySectionTitle, factKind: "contact" as StructuredFactKind };
  }

  if (statementLooksLikeMedication(statement)) {
    return { section: "Health & Safety" as SummarySectionTitle, factKind: "medication" as StructuredFactKind };
  }

  if (statementLooksLikeEquipment(statement)) {
    return { section: "Health & Safety" as SummarySectionTitle, factKind: "equipment" as StructuredFactKind };
  }

  if (statementLooksLikeCondition(statement)) {
    return { section: "Health & Safety" as SummarySectionTitle, factKind: "condition" as StructuredFactKind };
  }

  if (statementLooksLikeSafetyRisk(statement)) {
    return { section: "Health & Safety" as SummarySectionTitle, factKind: "safety_risk" as StructuredFactKind };
  }

  if (statementLooksLikeDirectCaregiverAction(statement)) {
    if (preferredSection === "What helps the day go well" && !/\b(give him space|reduce stimulation|keep things quiet|do not|offer a car ride|make sure.*safe|back off)\b/i.test(statement)) {
      return { section: preferredSection, factKind: "support_strategy" as StructuredFactKind };
    }

    return {
      section: "What helps when they are having a hard time" as SummarySectionTitle,
      factKind: "caregiver_action" as StructuredFactKind
    };
  }

  if (statementLooksLikeHelpSign(statement)) {
    return { section: "Signs they need help" as SummarySectionTitle, factKind: "help_sign" as StructuredFactKind };
  }

  if (statementLooksLikeRoutine(statement)) {
    return { section: "Daily Needs & Routines" as SummarySectionTitle, factKind: "routine" as StructuredFactKind };
  }

  if (statementLooksLikeTrigger(statement)) {
    return { section: "What can upset or overwhelm them" as SummarySectionTitle, factKind: "trigger" as StructuredFactKind };
  }

  if (statementLooksLikeCommunication(statement)) {
    const factKind: StructuredFactKind =
      /\b(selects?|lead(?:ing)?|touch(?:ing)?|sit(?:ting)? very close|wants attention|ask for help)\b/i.test(statement)
        ? "communication_signal"
        : "communication_method";
    return { section: "Communication" as SummarySectionTitle, factKind };
  }

  if (statementLooksLikePreference(statement)) {
    return { section: "What helps the day go well" as SummarySectionTitle, factKind: "preference" as StructuredFactKind };
  }

  return {
    section: preferredSection,
    factKind: defaultFactKind
  };
}

function statementLooksLikeContact(value: string) {
  return /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3}).*\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/.test(value);
}

function normalizeCapture(input: unknown, entryMetadata = new Map<string, SummarySourceEntry>()) {
  const candidate = input as Partial<RawStructuredCapture> | undefined;
  const facts = Array.isArray(candidate?.facts) ? candidate.facts : [];

  return {
    facts: facts
      .map((fact, index) => {
        const section = SUMMARY_SECTION_TITLES.find((title) => title === fact.section);
        const factKind = STRUCTURED_FACT_KINDS.find(
          (kind) => kind === (fact as { factKind?: string }).factKind
        );
        const statement = cleanCaptureStatement(String(fact.statement ?? ""));
        if (!section || !factKind || !statement) {
          return null;
        }

        const entryId = compactWhitespace(String(fact.entryId ?? "")) || `Entry ${index + 1}`;
        const routing = inferCaptureRouting(statement, section, factKind, entryMetadata.get(entryId));
        const conceptKeys = [...extractCoverageConcepts(statement)].sort();
        const factIdPrefix = entryId.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

        return {
          factId: `${factIdPrefix || "entry"}-fact-${index + 1}`,
          entryId,
          section: routing.section,
          factKind: routing.factKind,
          statement,
          safetyRelevant: Boolean(fact.safetyRelevant),
          conceptKeys,
          sourceEntryIds: [entryId]
        } satisfies StructuredCaptureFact;
      })
      .filter((fact): fact is StructuredCaptureFact => Boolean(fact))
  } satisfies StructuredCapture;
}

function factIdPrefixForEntry(entryId: string) {
  return entryId
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function reindexCaptureFacts(facts: StructuredCaptureFact[]) {
  const nextIndexByPrefix = new Map<string, number>();

  return facts
    .slice()
    .sort((left, right) => {
      if (left.section !== right.section) {
        return SUMMARY_SECTION_TITLES.indexOf(left.section) - SUMMARY_SECTION_TITLES.indexOf(right.section);
      }

      if (left.entryId !== right.entryId) {
        return left.entryId.localeCompare(right.entryId);
      }

      if (left.factKind !== right.factKind) {
        return left.factKind.localeCompare(right.factKind);
      }

      return left.statement.localeCompare(right.statement);
    })
    .map((fact) => {
      const prefix = factIdPrefixForEntry(fact.entryId) || "entry";
      const nextIndex = (nextIndexByPrefix.get(prefix) ?? 0) + 1;
      nextIndexByPrefix.set(prefix, nextIndex);

      return {
        ...fact,
        factId: `${prefix}-fact-${nextIndex}`
      };
    });
}

function dedupeCaptureFacts(facts: StructuredCaptureFact[]) {
  const deduped = new Map<string, StructuredCaptureFact>();

  for (const fact of facts) {
    const key = `${fact.section}::${fact.factKind}::${normalizeCoverageText(fact.statement)}`;
    const existing = deduped.get(key);

    if (!existing) {
      const nearDuplicate = [...deduped.entries()].find(([, entry]) => {
        if (entry.section !== fact.section || entry.factKind !== fact.factKind) {
          return false;
        }

        const existingConcepts = extractCoverageConcepts(entry.statement);
        const factConcepts = extractCoverageConcepts(fact.statement);

        if (existingConcepts.size === 0 || factConcepts.size === 0) {
          return false;
        }

        return [...existingConcepts].some((concept) => factConcepts.has(concept));
      });

      if (!nearDuplicate) {
        deduped.set(key, fact);
        continue;
      }

      const [nearDuplicateKey, nearDuplicateFact] = nearDuplicate;
      const merged =
        coverageTokens(fact.statement).length > coverageTokens(nearDuplicateFact.statement).length
          ? fact
          : nearDuplicateFact;
      deduped.set(nearDuplicateKey, {
        ...merged,
        factId: nearDuplicateFact.factId,
        safetyRelevant: nearDuplicateFact.safetyRelevant || fact.safetyRelevant,
        conceptKeys: [...new Set([...nearDuplicateFact.conceptKeys, ...fact.conceptKeys])].sort(),
        sourceEntryIds: [...new Set([...nearDuplicateFact.sourceEntryIds, ...fact.sourceEntryIds])]
      });
      continue;
    }

    deduped.set(key, {
      ...existing,
      entryId: existing.entryId || fact.entryId,
      factKind: existing.factKind,
      safetyRelevant: existing.safetyRelevant || fact.safetyRelevant,
      conceptKeys: [...new Set([...existing.conceptKeys, ...fact.conceptKeys])].sort(),
      sourceEntryIds: [...new Set([...existing.sourceEntryIds, ...fact.sourceEntryIds])]
    });
  }

  return reindexCaptureFacts([...deduped.values()]);
}

function normalizeCoverageText(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function coverageTokens(value: string) {
  return normalizeCoverageText(value)
    .split(" ")
    .filter((token) => token.length > 2 && !STOPWORDS.has(token));
}

function extractCoverageConcepts(value: string) {
  const concepts = new Set<string>();
  const normalized = normalizeCoverageText(value);

  if (!normalized) {
    return concepts;
  }

  if (
    /\b(bathroom|toilet)\b/.test(normalized) &&
    /\b(reminder|reminders|prompt|prompts|hourly|prompted)\b/.test(normalized)
  ) {
    concepts.add("bathroom_reminders");
  }

  if (/\b(non speaking|non speaking|cannot say words|can t say words|does not use words)\b/.test(normalized)) {
    concepts.add("non_speaking");
  }

  if (/\b(aac|touchchat|communication device|device on an ipad|aac device)\b/.test(normalized)) {
    concepts.add("aac_device");
  }

  if (/\b(happy sounds|angry sounds|happy noises|angry noises|singing|vocal sounds|uses sounds)\b/.test(normalized)) {
    concepts.add("sound_expression");
  }

  if (/\b(very visual|visual supports?|show (?:items?|pictures?)|visual timer|visual schedule)\b/.test(normalized)) {
    concepts.add("visual_support");
  }

  if (/\b(two-step|first this then that|first this, then that|short directions?)\b/.test(normalized)) {
    concepts.add("two_step_support");
  }

  if (/\b(sensory seeker|sensory activities?|sensory toys?|sensory bins?)\b/.test(normalized)) {
    concepts.add("sensory_support");
  }

  if (
    /\b(food|fridge|cheese|hungry|hunger)\b/.test(normalized) &&
    /\b(access|often|regular|frequent|prevent|distress|available)\b/.test(normalized)
  ) {
    concepts.add("food_access");
  }

  if (/\bcar ride|car rides\b/.test(normalized) && /\b(help|regulat|calm|sooth)\b/.test(normalized)) {
    concepts.add("car_ride_regulation");
  }

  if (/\bwalk|walks\b/.test(normalized) && /\b(help|regulat|calm|sooth)\b/.test(normalized)) {
    concepts.add("walk_regulation");
  }

  if (
    /\b(ipad|search history)\b/.test(normalized) &&
    /\b(help|find|access|prevent|reduce|frustration|trying)\b/.test(normalized)
  ) {
    concepts.add("ipad_help");
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

  if (/\b(loud|angry) vocalizations?\b/.test(normalized) || /\bangry sounds?\b/.test(normalized)) {
    concepts.add("vocalization_sign");
  }

  if (/\b(fridge|grabbing cheese)\b/.test(normalized)) {
    concepts.add("hunger_sign");
  }

  if (/\b(press(?:es)? help|sign for help|word help on (?:his|her|their) ipad)\b/.test(normalized)) {
    concepts.add("help_request_signal");
  }

  if (/\b(pulling|leading a caregiver|lead you)\b/.test(normalized)) {
    concepts.add("caregiver_leading_sign");
  }

  if (/\b(sitting very close|sit very close|extra attention|wants attention)\b/.test(normalized)) {
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

  return concepts;
}

function statementLooksCovered(statement: string, existingItems: string[]) {
  const normalizedStatement = normalizeCoverageText(statement);
  const statementTokens = coverageTokens(statement);
  const statementConcepts = extractCoverageConcepts(statement);

  if (!normalizedStatement || statementTokens.length === 0) {
    return false;
  }

  return existingItems.some((item) => {
    const normalizedItem = normalizeCoverageText(item);
    if (!normalizedItem || normalizedItem === normalizeCoverageText(NO_INFORMATION_PLACEHOLDER)) {
      return false;
    }

    if (
      normalizedItem.includes(normalizedStatement) ||
      normalizedStatement.includes(normalizedItem)
    ) {
      return true;
    }

    const itemConcepts = extractCoverageConcepts(item);
    if (statementConcepts.size > 0 && [...statementConcepts].some((concept) => itemConcepts.has(concept))) {
      return true;
    }

    const itemTokens = coverageTokens(item);
    if (itemTokens.length === 0) {
      return false;
    }

    const overlapCount = statementTokens.filter((token) => itemTokens.includes(token)).length;
    const statementCoverage = overlapCount / statementTokens.length;
    const itemCoverage = overlapCount / itemTokens.length;

    return statementCoverage >= 0.75 || itemCoverage >= 0.75;
  });
}

function factLooksCoveredByItem(fact: StructuredCaptureFact, item: string) {
  if (statementLooksCovered(fact.statement, [item])) {
    return true;
  }

  if (fact.conceptKeys.length === 0) {
    return false;
  }

  const itemConcepts = extractCoverageConcepts(item);
  return fact.conceptKeys.some((concept) => itemConcepts.has(concept));
}

function clusterSignature(fact: StructuredCaptureFact) {
  const conceptSignature =
    fact.conceptKeys.length > 0 ? fact.conceptKeys.join("|") : normalizeCoverageText(fact.statement);
  return `${fact.section}::${fact.factKind}::${conceptSignature}`;
}

function buildFactClusters(capture: StructuredCapture) {
  const clusters = new Map<string, FactCluster>();

  for (const fact of capture.facts) {
    if (!sectionFactIsAdmissible(fact)) {
      continue;
    }

    const signature = clusterSignature(fact);
    const existing = clusters.get(signature);

    if (existing) {
      existing.facts.push(fact);
      existing.conceptKeys = [...new Set([...existing.conceptKeys, ...fact.conceptKeys])].sort();
      continue;
    }

    clusters.set(signature, {
      clusterId: signature,
      section: fact.section,
      factKind: fact.factKind,
      conceptKeys: [...fact.conceptKeys],
      facts: [fact]
    });
  }

  return [...clusters.values()];
}

function factWordCount(statement: string) {
  return statement.trim().split(/\s+/).filter(Boolean).length;
}

function signsFactIsAdmissible(fact: StructuredCaptureFact) {
  if (fact.factKind !== "help_sign" && fact.factKind !== "communication_signal") {
    return false;
  }

  const statement = fact.statement.trim();

  if (
    /^(?:As a practice|If a caregiver|If caregivers|Her caretakers|This question|The question)\b/i.test(
      statement
    ) ||
    /\b(caregiver|caretaker)s?\b/i.test(statement) ||
    SIGNS_META_PATTERN.test(statement) ||
    /\bshould\b/i.test(statement) ||
    /\bcaregiver says\b/i.test(statement) ||
    /\bare you getting something\??/i.test(statement) ||
    /\bcan I help\??/i.test(statement) ||
    /\bvisual schedules?\b/i.test(statement) ||
    /\bdetectives?\b/i.test(statement) ||
    /\bpod has left the spaceship\b/i.test(statement) ||
    /^Sometimes (?:she )?(?:asks for help|can respond)(?: when [^.]+)?\.?$/i.test(statement) ||
    /\bthere is something that has dysregulated her\b/i.test(statement) ||
    SIGNS_HISTORY_LEAK_PATTERN.test(statement) ||
    !SIGN_LIKE_PATTERN.test(statement)
  ) {
    return false;
  }

  return true;
}

function hardTimeFactIsAdmissible(fact: StructuredCaptureFact) {
  if (fact.factKind !== "caregiver_action" && fact.factKind !== "support_strategy") {
    return false;
  }

  const statement = fact.statement.trim();
  const wordCount = factWordCount(statement);

  if (
    GENERIC_CONTACT_GUIDANCE_PATTERN.test(statement) ||
    /\b(no question is too small|questions are welcome|day or night)\b/i.test(statement) ||
    HARD_TIME_HEALTH_LEAK_PATTERN.test(statement) ||
    HARD_TIME_ROUTINE_LEAK_PATTERN.test(statement) ||
    CHOICE_SUPPORT_PATTERN.test(statement) ||
    /\bdo not hesitate to call\b/i.test(statement) ||
    (/\b(?:Laurie|Lauri|Selena|Richie|mother|father|sister|brother)\b/i.test(statement) &&
      /\b(call|contact)\b/i.test(statement)) ||
    /^(?:Do you (?:want|wanna) me to leave you alone|Do you wanna go|We can go|Come on\b|You don'?t have to stay\b)/i.test(
      statement
    ) ||
    (/^(?:Give|Take|Help|Use)\b/i.test(statement) &&
      wordCount <= 5 &&
      !/\b(space|drink|snack|blanket|iPad|noise|light|outside|room|car|attention|validation|comfort)\b/i.test(
        statement
      ))
  ) {
    return false;
  }

  return true;
}

function upsetFactIsAdmissible(fact: StructuredCaptureFact) {
  if (fact.factKind !== "trigger") {
    return false;
  }

  const statement = fact.statement.trim();

  if (
    !TRIGGER_LIKE_PATTERN.test(statement) ||
    NON_TRIGGER_LEAK_PATTERN.test(statement) ||
    (/\b(caregiver|caretaker)s?\b/i.test(statement) && /\b(need|needs|should|have to)\b/i.test(statement))
  ) {
    return false;
  }

  return true;
}

function dayGoWellFactIsAdmissible(fact: StructuredCaptureFact) {
  if (
    fact.factKind !== "support_strategy" &&
    fact.factKind !== "preference" &&
    fact.factKind !== "routine"
  ) {
    return false;
  }

  const statement = fact.statement.trim();

  if (
    HARD_TIME_HEALTH_LEAK_PATTERN.test(statement) ||
    /\b(call|contact)\b/i.test(statement) ||
    /\b(caregiver|caretaker)s?\b/i.test(statement) && /\b(need|needs|should|have to)\b/i.test(statement)
  ) {
    return false;
  }

  return true;
}

function sectionFactIsAdmissible(fact: StructuredCaptureFact) {
  switch (fact.section) {
    case "Signs they need help":
      return signsFactIsAdmissible(fact);
    case "What helps when they are having a hard time":
      return hardTimeFactIsAdmissible(fact);
    case "What can upset or overwhelm them":
      return upsetFactIsAdmissible(fact);
    case "What helps the day go well":
      return dayGoWellFactIsAdmissible(fact);
    default:
      return true;
  }
}

function sectionFactKindOrder(title: SummarySectionTitle, factKind: StructuredFactKind) {
  const order: Record<SummarySectionTitle, StructuredFactKind[]> = {
    Communication: [
      "communication_method",
      "communication_signal",
      "support_strategy"
    ],
    "Daily Needs & Routines": [
      "routine",
      "support_strategy"
    ],
    "What helps the day go well": [
      "support_strategy",
      "preference",
      "routine"
    ],
    "What can upset or overwhelm them": [
      "trigger"
    ],
    "Signs they need help": [
      "help_sign",
      "communication_signal"
    ],
    "What helps when they are having a hard time": [
      "caregiver_action",
      "support_strategy"
    ],
    "Health & Safety": [
      "safety_risk",
      "condition",
      "medication",
      "equipment"
    ],
    "Who to contact (and when)": [
      "contact"
    ]
  };

  const rank = order[title].indexOf(factKind);
  return rank >= 0 ? rank : order[title].length;
}

function clusterStatement(cluster: FactCluster) {
  return cluster.facts
    .slice()
    .sort((left, right) => right.statement.length - left.statement.length)[0]?.statement ?? "";
}

function clusterSortKey(cluster: FactCluster) {
  return [
    sectionFactKindOrder(cluster.section, cluster.factKind),
    clusterStatement(cluster)
  ] as const;
}

function evaluateClusterCoverageStatus(
  cluster: FactCluster,
  itemsBySection: Map<SummarySectionTitle, string[]>
): ClusterCoverageStatus {
  const expectedItems = itemsBySection.get(cluster.section) ?? [];
  const matchedInExpected = expectedItems.find((item) =>
    cluster.facts.some((fact) => factLooksCoveredByItem(fact, item))
  );

  if (matchedInExpected) {
    return {
      cluster,
      status: "covered",
      matchedBullet: matchedInExpected
    };
  }

  const matchedElsewhere = SUMMARY_SECTION_TITLES.find((title) => {
    if (title === cluster.section) {
      return false;
    }

    return (itemsBySection.get(title) ?? []).some((item) =>
      cluster.facts.some((fact) => factLooksCoveredByItem(fact, item))
    );
  });

  if (matchedElsewhere) {
    const matchedBullet = (itemsBySection.get(matchedElsewhere) ?? []).find((item) =>
      cluster.facts.some((fact) => factLooksCoveredByItem(fact, item))
    );

    return {
      cluster,
      status: "leaked",
      actualSection: matchedElsewhere,
      matchedBullet
    };
  }

  return {
    cluster,
    status: "missing"
  };
}

function clusterMatchesCoverageRequirement(
  cluster: FactCluster,
  requirement: SectionCoverageRequirement
) {
  const source = [clusterStatement(cluster), ...cluster.facts.map((fact) => fact.statement)].join(" ");
  return requirement.matcher.test(source);
}

function evaluateRequirementCoverageStatuses(
  title: SummarySectionTitle,
  capture: StructuredCapture,
  itemsBySection: Map<SummarySectionTitle, string[]>
): RequirementCoverageStatus[] {
  const requirements = SECTION_COVERAGE_REQUIREMENTS[title] ?? [];
  const sectionClusters = buildFactClusters(capture).filter((cluster) => cluster.section === title);
  const statuses: RequirementCoverageStatus[] = [];

  for (const requirement of requirements) {
    const relevantClusters = sectionClusters.filter((cluster) =>
      clusterMatchesCoverageRequirement(cluster, requirement)
    );

    if (relevantClusters.length === 0) {
      continue;
    }

    const clusterStatuses = relevantClusters.map((cluster) =>
      evaluateClusterCoverageStatus(cluster, itemsBySection)
    );

    if (clusterStatuses.some((status) => status.status === "covered")) {
      statuses.push({
        requirement,
        status: "covered",
        clusterStatements: relevantClusters.map(clusterStatement)
      });
      continue;
    }

    const leakedStatus = clusterStatuses.find((status) => status.status === "leaked");
    if (leakedStatus) {
      statuses.push({
        requirement,
        status: "leaked",
        actualSection: leakedStatus.actualSection,
        clusterStatements: relevantClusters.map(clusterStatement)
      });
      continue;
    }

    statuses.push({
      requirement,
      status: "missing",
      clusterStatements: relevantClusters.map(clusterStatement)
    });
  }

  return statuses;
}

function formatSectionFactsForRewritePrompt(
  capture: StructuredCapture,
  title: SummarySectionTitle
) {
  const sectionClusters = buildFactClusters(capture)
    .filter((cluster) => cluster.section === title)
    .sort((left, right) => {
      const [leftRank, leftStatement] = clusterSortKey(left);
      const [rightRank, rightStatement] = clusterSortKey(right);
      if (leftRank !== rightRank) {
        return leftRank - rightRank;
      }
      return leftStatement.localeCompare(rightStatement);
    });

  if (sectionClusters.length === 0) {
    return `[${title}]\n- ${NO_INFORMATION_PLACEHOLDER}`;
  }

  const lines = [`[${title}]`];

  for (const cluster of sectionClusters) {
    lines.push(`Fact kind: ${cluster.factKind}`);
    for (const fact of cluster.facts) {
      lines.push(`- [${fact.factId}] ${fact.statement}${fact.safetyRelevant ? " [safety]" : ""}`);
    }
  }

  return lines.join("\n");
}

function buildSectionRewriteRules(title: SummarySectionTitle) {
  const tier = sectionRiskTier(title);
  const commonRules = [
    `You are writing only the "${title}" section of a caregiver handoff.`,
    "Use only the facts assigned to this section below.",
    tier === "tier1"
      ? "Every supported fact must appear directly or as part of a careful combined bullet."
      : "Preserve the important supported facts, but merge repetition instead of listing every variant.",
    "Do not move facts to another section or refer to other sections.",
    "Each bullet must be one clear, complete, caregiver-ready sentence.",
    "Keep language direct, concrete, and easy to scan.",
    "Do not repeat the same fact in multiple bullets.",
    `Aim for about ${SECTION_SOFT_TARGETS[title]} bullets when you can do so without dropping required details.`,
    `If no supported facts are listed, return exactly ["${NO_INFORMATION_PLACEHOLDER}"].`
  ];

  const sectionSpecificRules: Record<SummarySectionTitle, string[]> = {
    Communication: [
      "Explain how the person communicates and what specific words, gestures, or behaviors mean.",
      "Keep communication meanings and communication methods separate when they are distinct."
    ],
    "Daily Needs & Routines": [
      "Preserve concrete routines for eating, toileting, hygiene, sleep, transitions, and medication-with-food needs.",
      "Keep actionable care steps and timing details when they are supported."
    ],
    "What helps the day go well": [
      "Phrase regulating activities and supports as things that help the day go well.",
      "Collapse long preference inventories into broad categories so nothing meaningful is lost."
    ],
    "What can upset or overwhelm them": [
      "List triggers only, not caregiver responses.",
      "Collapse repeated versions of the same trigger into one stronger bullet."
    ],
    "Signs they need help": [
      "List observable physical, behavioral, or communication signs only, not caregiver actions.",
      "Do not omit self-injury, aggression, limping, low energy, refusal, or other supported signs."
    ],
    "What helps when they are having a hard time": [
      "List caregiver actions only.",
      "Preserve clear in-the-moment instructions, especially anything about stopping, waiting, offering space, reducing stimulation, or honoring a request not to be touched."
    ],
    "Health & Safety": [
      "This is a loss-resistant section. Do not omit any supported medication, condition, equipment/support, supervision need, physical limitation, overnight monitoring need, or safety warning.",
      "Keep distinct medications, conditions, equipment/supports, and safety rules as separate bullets when they are meaningfully different.",
      "If a caregiver-harm caution, fall risk, sleep risk, blood clot history, or supervision requirement is supported, it must appear."
    ],
    "Who to contact (and when)": [
      "This is a loss-resistant section. Keep each supported contact or call instruction.",
      "Preserve names, phone numbers, and when-to-call guidance when they are supported."
    ]
  };

  const emphasisRules = tier === "tier1"
    ? [
        "Do not trade completeness for brevity in this section. If details are distinct and supported, keep them."
      ]
    : [];

  return [...commonRules, ...sectionSpecificRules[title], ...SECTION_SHAPE_RULES[title], ...emphasisRules]
    .map((rule) => `- ${rule}`)
    .join("\n");
}

function buildGeneratedSummaryPayload(
  sectionItems: Map<SummarySectionTitle, string[]>,
  options: {
    title?: string;
    overview?: string;
  } = {}
) {
  const payload: Record<string, unknown> = {
    title: options.title ?? "",
    overview: options.overview ?? ""
  };

  for (const field of GENERATED_SUMMARY_SECTION_FIELDS) {
    payload[field.key] = sectionItems.get(field.title) ?? [NO_INFORMATION_PLACEHOLDER];
  }

  return payload;
}

function replaceSummarySections(
  summary: StructuredSummary,
  replacements: Map<SummarySectionTitle, string[]>,
  nameHint?: string
) {
  const merged = new Map<SummarySectionTitle, string[]>();

  for (const title of SUMMARY_SECTION_TITLES) {
    const existingItems =
      summary.sections.find((section) => section.title === title)?.items ?? [NO_INFORMATION_PLACEHOLDER];
    merged.set(title, replacements.get(title) ?? existingItems);
  }

  return normalizeGeneratedSummaryWithOptions(
    buildGeneratedSummaryPayload(merged, {
      title: summary.title,
      overview: ""
    }),
    nameHint,
    {
      reclassify: false,
      semanticRepair: false
    }
  );
}

function buildAuditDiagnostics(statuses: FactAuditStatus[]) {
  return statuses.map((status) => {
    const detail = status.matchedBullet ? ` -> ${status.matchedBullet}` : "";
    const actual = status.actualSection && status.actualSection !== status.expectedSection ? ` actual=${status.actualSection}` : "";
    return `[${status.status}] ${status.factId} expected=${status.expectedSection}${actual} kind=${status.factKind}${detail}`;
  });
}

function composeSummaryFromCapture(
  summary: StructuredSummary,
  capture: StructuredCapture,
  nameHint?: string
) {
  const buckets = new Map<SummarySectionTitle, string[]>(
    SUMMARY_SECTION_TITLES.map((title) => [
      title,
      (summary.sections.find((section) => section.title === title)?.items ?? [])
        .filter((item) => normalizeCoverageText(item) !== normalizeCoverageText(NO_INFORMATION_PLACEHOLDER))
    ])
  );
  const clusters = buildFactClusters(capture)
    .slice()
    .sort((left, right) => {
      if (left.section !== right.section) {
        return SUMMARY_SECTION_TITLES.indexOf(left.section) - SUMMARY_SECTION_TITLES.indexOf(right.section);
      }

      const [leftRank, leftStatement] = clusterSortKey(left);
      const [rightRank, rightStatement] = clusterSortKey(right);
      if (leftRank !== rightRank) {
        return leftRank - rightRank;
      }

      return leftStatement.localeCompare(rightStatement);
    });

  for (const cluster of clusters) {
    if (!isHighRiskSection(cluster.section)) {
      continue;
    }

    const expectedItems = buckets.get(cluster.section) ?? [];
    const matchedInExpected = expectedItems.some((item) =>
      cluster.facts.some((fact) => factLooksCoveredByItem(fact, item))
    );

    if (matchedInExpected) {
      continue;
    }

    const matchedElsewhere = SUMMARY_SECTION_TITLES.some((title) => {
      if (title === cluster.section) {
        return false;
      }

      return (buckets.get(title) ?? []).some((item) =>
        cluster.facts.some((fact) => factLooksCoveredByItem(fact, item))
      );
    });

    if (matchedElsewhere) {
      continue;
    }

    expectedItems.push(clusterStatement(cluster));
    buckets.set(cluster.section, expectedItems);
  }

  const composed: StructuredSummary = {
    ...summary,
    overview: "",
    sections: SUMMARY_SECTION_TITLES.map((title, index) => ({
      id: `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${index + 1}`,
      title,
      items:
        buckets.get(title)?.filter(Boolean).length
          ? (buckets.get(title) ?? [])
          : [NO_INFORMATION_PLACEHOLDER]
    }))
  };

  return normalizeAuthoritativeStructuredSummary(composed, nameHint);
}

function summaryItemsBySection(
  summary: StructuredSummary,
) : Map<SummarySectionTitle, string[]> {
  return new Map<SummarySectionTitle, string[]>(
    summary.sections.map((section) => [
      section.title as SummarySectionTitle,
      section.items.filter((item) => normalizeCoverageText(item) !== normalizeCoverageText(NO_INFORMATION_PLACEHOLDER))
    ] as const)
  );
}

function factNeedsUserVisibleWarning(fact: StructuredCaptureFact) {
  return (
    fact.safetyRelevant ||
    fact.factKind === "medication" ||
    fact.factKind === "contact" ||
    fact.section === HEALTH_AND_SAFETY_TITLE ||
    fact.section === WHO_TO_CONTACT_TITLE
  );
}

function buildCaptureIssueUserMessage(
  fact: StructuredCaptureFact,
  code: SummaryAuditIssue["code"]
) {
  if (fact.factKind === "contact" || fact.section === WHO_TO_CONTACT_TITLE) {
    return code === "missing_coverage"
      ? "A contact detail may be missing from the summary."
      : "A contact detail may be in the wrong section and should be reviewed.";
  }

  if (fact.factKind === "medication") {
    return code === "missing_coverage"
      ? "A medication detail may be missing from the summary."
      : "A medication detail may be in the wrong section and should be reviewed.";
  }

  if (
    fact.section === HEALTH_AND_SAFETY_TITLE ||
    fact.factKind === "condition" ||
    fact.factKind === "equipment" ||
    fact.factKind === "safety_risk"
  ) {
    return code === "missing_coverage"
      ? "A health or safety detail may be missing from the summary."
      : "A health or safety detail may be in the wrong section and should be reviewed.";
  }

  if (fact.safetyRelevant) {
    return code === "missing_coverage"
      ? "An important safety-related detail may be missing from the summary."
      : "An important safety-related detail may be in the wrong section and should be reviewed.";
  }

  return undefined;
}

function createCaptureAuditIssue(
  fact: StructuredCaptureFact,
  code: "missing_coverage" | "section_leakage",
  options: {
    message: string;
    actualSection?: SummarySectionTitle;
    severity?: "hard" | "soft";
    visibility?: "user" | "internal";
  }
): SummaryAuditIssue {
  const visibility = options.visibility ?? (factNeedsUserVisibleWarning(fact) ? "user" : "internal");
  const severity = options.severity ?? (visibility === "user" ? "hard" : "soft");

  return {
    code,
    message: options.message,
    factId: fact.factId,
    expectedSection: fact.section,
    actualSection: options.actualSection,
    severity,
    visibility,
    userMessage:
      visibility === "user" ? buildCaptureIssueUserMessage(fact, code) : undefined
  };
}

function countIssuesBySeverity(report: SummaryAuditReport, severity: "hard" | "soft") {
  return report.issues.filter((issue) => issue.severity === severity).length;
}

function auditIssueSummaryLength(report: SummaryAuditReport) {
  return [...new Set(report.issues.map((issue) => issue.message))].join(" | ").length;
}

function choosePreferredCandidate(
  left: AuditedSummaryCandidate,
  right: AuditedSummaryCandidate
) {
  const leftHardCount = countIssuesBySeverity(left.report, "hard");
  const rightHardCount = countIssuesBySeverity(right.report, "hard");
  if (leftHardCount !== rightHardCount) {
    return leftHardCount < rightHardCount ? left : right;
  }

  const leftSoftCount = countIssuesBySeverity(left.report, "soft");
  const rightSoftCount = countIssuesBySeverity(right.report, "soft");
  if (leftSoftCount !== rightSoftCount) {
    return leftSoftCount < rightSoftCount ? left : right;
  }

  return auditIssueSummaryLength(left.report) <= auditIssueSummaryLength(right.report)
    ? left
    : right;
}

function auditSummaryAgainstCapture(summary: StructuredSummary, capture: StructuredCapture) {
  const issues: SummaryAuditIssue[] = [];
  const itemsBySection = summaryItemsBySection(summary);

  for (const cluster of buildFactClusters(capture)) {
    const tier = sectionRiskTier(cluster.section);

    if (tier === "tier1") {
      const status = evaluateClusterCoverageStatus(cluster, itemsBySection);
      if (status.status === "covered") {
        continue;
      }

      const representativeFact = cluster.facts[0];
      if (!representativeFact) {
        continue;
      }

      issues.push(
        createCaptureAuditIssue(representativeFact, status.status === "leaked" ? "section_leakage" : "missing_coverage", {
          message:
            status.status === "leaked"
              ? `${representativeFact.factId} is only represented in ${status.actualSection} but belongs in ${cluster.section}.`
              : `${representativeFact.factId} is missing from ${cluster.section}: ${clusterStatement(cluster)}`,
          actualSection: status.actualSection,
          severity: "hard",
          visibility:
            cluster.section === HEALTH_AND_SAFETY_TITLE || cluster.section === WHO_TO_CONTACT_TITLE
              ? "user"
              : "internal"
        })
      );
    }
  }

  for (const title of SUMMARY_SECTION_TITLES) {
    if (sectionRiskTier(title) !== "tier2") {
      continue;
    }

    for (const requirementStatus of evaluateRequirementCoverageStatuses(title, capture, itemsBySection)) {
      if (requirementStatus.status === "covered") {
        continue;
      }

      issues.push({
        code: requirementStatus.status === "leaked" ? "section_leakage" : "missing_coverage",
        message:
          requirementStatus.status === "leaked"
            ? `${title} is missing ${requirementStatus.requirement.description}; that detail is only represented in ${requirementStatus.actualSection}.`
            : `${title} is missing ${requirementStatus.requirement.description}.`,
        expectedSection: title,
        actualSection: requirementStatus.actualSection,
        sectionTitle: title,
        severity: requirementStatus.status === "missing" ? "hard" : "soft",
        visibility: "internal"
      });
    }
  }

  return issues;
}

function mergeRepairHints(...hintGroups: string[][]) {
  return mergeRepairHintsWithLimit(8, ...hintGroups);
}

function issueRelatedSections(issue: SummaryAuditIssue) {
  const sections = new Set<SummarySectionTitle>();

  if (isSummarySectionTitle(issue.expectedSection)) {
    sections.add(issue.expectedSection);
  }

  if (isSummarySectionTitle(issue.actualSection)) {
    sections.add(issue.actualSection);
  }

  if (isSummarySectionTitle(issue.sectionTitle)) {
    sections.add(issue.sectionTitle);
  }

  return [...sections];
}

function indexRepairHintsBySection(hints: string[]) {
  const indexed: SectionRepairHintIndex = {
    global: [],
    bySection: new Map(SUMMARY_SECTION_TITLES.map((title) => [title, []] as const))
  };

  for (const rawHint of hints) {
    const hint = compactWhitespace(String(rawHint ?? ""));
    if (!hint) {
      continue;
    }

    const matchedSections = SUMMARY_SECTION_TITLES.filter((title) =>
      hint.toLowerCase().includes(title.toLowerCase())
    );

    if (matchedSections.length === 0) {
      indexed.global = mergeRepairHintsWithLimit(MAX_SECTION_REPAIR_HINTS, indexed.global, [hint]);
      continue;
    }

    for (const title of matchedSections) {
      indexed.bySection.set(
        title,
        mergeRepairHintsWithLimit(
          MAX_SECTION_REPAIR_HINTS,
          indexed.bySection.get(title) ?? [],
          [hint]
        )
      );
    }
  }

  return indexed;
}

function collectSectionRepairHints(
  report: SummaryAuditReport,
  scope: SectionRewriteScope
) {
  const normalized = normalizeSummaryAuditReport(report);
  const bySection = new Map<SummarySectionTitle, string[]>(
    SUMMARY_SECTION_TITLES.map((title) => [title, []] as const)
  );

  const relevantIssues = normalized.issues.filter((issue) => {
    if (scope === "soft") {
      return (
        issue.severity === "soft" &&
        (issue.code === "awkward_item" || issue.code === "duplicate_item")
      );
    }

    if (scope === "hard") {
      return issue.severity === "hard";
    }

    return true;
  });

  for (const issue of relevantIssues) {
    const sections = issueRelatedSections(issue);
    const hint = compactWhitespace(issue.message);
    if (!hint || sections.length === 0) {
      continue;
    }

    for (const section of sections) {
      bySection.set(
        section,
        mergeRepairHintsWithLimit(
          MAX_SECTION_REPAIR_HINTS,
          bySection.get(section) ?? [],
          [hint]
        )
      );
    }
  }

  return bySection;
}

function auditAndFinalizeSummary(
  summary: StructuredSummary,
  capture: StructuredCapture,
  nameHint?: string
) {
  const composed = composeSummaryFromCapture(summary, capture, nameHint);
  const clusters = buildFactClusters(capture);
  const captureIssues = auditSummaryAgainstCapture(composed, capture);
  const { summary: normalized, report: rawReport } = finalizeSummaryWithQa(composed, {
    source: "generated",
    nameHint,
    issues: captureIssues,
    diagnostics: []
  });
  const report = normalizeSummaryAuditReport(rawReport);
  const sectionItems = new Map(
    normalized.sections.map((section) => [
      section.title as SummarySectionTitle,
      section.items.filter((item) => normalizeCoverageText(item) !== normalizeCoverageText(NO_INFORMATION_PLACEHOLDER))
    ] as const)
  );
  const statuses: FactAuditStatus[] = [];

  for (const cluster of clusters) {
    const expectedItems = sectionItems.get(cluster.section) ?? [];
    const matchedInExpected = expectedItems.find((item) =>
      cluster.facts.some((fact) => factLooksCoveredByItem(fact, item))
    );

    if (matchedInExpected) {
      statuses.push(
        ...cluster.facts.map((fact) => ({
          factId: fact.factId,
          clusterId: cluster.clusterId,
          expectedSection: cluster.section,
          factKind: cluster.factKind,
          status: "covered" as const,
          matchedBullet: matchedInExpected
        }))
      );
      continue;
    }

    const matchedElsewhere = SUMMARY_SECTION_TITLES.find((title) => {
      if (title === cluster.section) {
        return false;
      }

      return (sectionItems.get(title) ?? []).some((item) =>
        cluster.facts.some((fact) => factLooksCoveredByItem(fact, item))
      );
    });

    if (matchedElsewhere) {
      const matchedBullet = (sectionItems.get(matchedElsewhere) ?? []).find((item) =>
        cluster.facts.some((fact) => factLooksCoveredByItem(fact, item))
      );
      statuses.push(
        ...cluster.facts.map((fact) => ({
          factId: fact.factId,
          clusterId: cluster.clusterId,
          expectedSection: cluster.section,
          factKind: cluster.factKind,
          status: "leaked" as const,
          actualSection: matchedElsewhere,
          matchedBullet
        }))
      );
      continue;
    }

    statuses.push(
      ...cluster.facts.map((fact) => ({
        factId: fact.factId,
        clusterId: cluster.clusterId,
        expectedSection: cluster.section,
        factKind: cluster.factKind,
        status: "missing" as const
      }))
    );
  }

  return {
    summary: normalized,
    report: normalizeSummaryAuditReport({
      ...report,
      diagnostics: [...report.diagnostics, ...buildAuditDiagnostics(statuses)]
    })
  };
}

type StructuredCompletionRequest = {
  apiKey: string;
  model: string;
  schemaName: string;
  schema: object;
  systemPrompt: string;
  userPrompt: string;
  temperature: number;
  maxCompletionTokens: number;
};

function supportsCustomTemperature(model: string) {
  return !/^gpt-5\.5(?:$|-)/i.test(model.trim());
}

async function requestStructuredCompletion<T>({
  apiKey,
  model,
  schemaName,
  schema,
  systemPrompt,
  userPrompt,
  temperature,
  maxCompletionTokens
}: StructuredCompletionRequest) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), summaryRequestTimeoutMs());
  const requestBody = {
    model,
    store: false,
    ...(supportsCustomTemperature(model) ? { temperature } : {}),
    max_completion_tokens: maxCompletionTokens,
    messages: [
      {
        role: "system",
        content: systemPrompt
      },
      {
        role: "user",
        content: userPrompt
      }
    ],
    response_format: {
      type: "json_schema" as const,
      json_schema: {
        name: schemaName,
        strict: true,
        schema
      }
    }
  };

  let response: Response;

  try {
    response = await fetch(OPENAI_CHAT_COMPLETIONS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal
    });
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === "AbortError") {
      throw new SummaryModelRequestError(
        "Summary generation timed out while waiting for the model.",
        { kind: "timeout" }
      );
    }

    throw new SummaryModelRequestError(
      "Summary generation could not reach the model provider.",
      { kind: "transport" }
    );
  }

  clearTimeout(timeoutId);

  if (!response.ok) {
    const rawError = await response.text();
    let message = `Summary generation failed with model status ${response.status}.`;

    try {
      const parsed = JSON.parse(rawError) as {
        error?: {
          message?: string;
          code?: string | null;
        };
      };
      const providerMessage = compactWhitespace(String(parsed.error?.message ?? ""));

      if (providerMessage) {
        message = providerMessage;
      }
    } catch {
      const fallbackMessage = compactWhitespace(rawError);
      if (fallbackMessage) {
        message = fallbackMessage;
      }
    }

    throw new SummaryModelRequestError(message, {
      status: response.status,
      kind: "provider"
    });
  }

  const data = (await response.json()) as {
    choices?: Array<{
      finish_reason?: string | null;
      message?: ChatCompletionMessage;
    }>;
  };

  const choice = data.choices?.[0];
  const message = choice?.message;
  const refusal = compactWhitespace(String(message?.refusal ?? ""));
  if (refusal) {
    throw new SummaryModelRequestError(`Model refused structured summary generation: ${refusal}`, {
      kind: "refusal"
    });
  }

  const content = extractChatCompletionText(message?.content);
  if (!content) {
    throw new SummaryModelRequestError(
      "Summary generation returned an empty structured response.",
      {
        kind: choice?.finish_reason === "length" ? "truncation" : "empty"
      }
    );
  }

  const parsed = parseStructuredJson<T>(content);
  if (parsed) {
    return parsed;
  }

  const truncated =
    choice?.finish_reason === "length" || looksLikeTruncatedStructuredOutput(content);

  throw new SummaryModelRequestError(
    `Summary generation returned invalid structured JSON${
      truncated ? " because the model output was truncated." : "."
    } Raw model output: ${compactWhitespace(content).slice(0, 280)}`,
    {
      kind: truncated ? "truncation" : "parse"
    }
  );
}

function isRetryableCaptureError(error: unknown): error is SummaryModelRequestError {
  const summaryError = toSummaryModelRequestError(error);
  if (!summaryError) {
    return false;
  }

  return summaryError.kind === "truncation" || summaryError.kind === "parse";
}

function toSummaryModelRequestError(error: unknown): SummaryModelRequestError | null {
  if (error instanceof SummaryModelRequestError) {
    return error;
  }

  if (typeof error !== "object" || error === null) {
    return null;
  }

  const maybeError = error as Partial<SummaryModelRequestError>;
  return typeof maybeError.kind === "string" ? (maybeError as SummaryModelRequestError) : null;
}

function isRetryableRewriteError(error: unknown): error is SummaryModelRequestError {
  const summaryError = toSummaryModelRequestError(error);
  if (!summaryError) {
    const message = error instanceof Error ? error.message : String(error);
    return /empty structured response/i.test(message);
  }

  if (
    summaryError.kind === "timeout" ||
    summaryError.kind === "transport" ||
    summaryError.kind === "empty" ||
    summaryError.kind === "truncation" ||
    summaryError.kind === "parse"
  ) {
    return true;
  }

  if (summaryError.kind !== "provider") {
    return false;
  }

  return (
    summaryError.status === 429 ||
    typeof summaryError.status !== "number" ||
    summaryError.status >= 500
  );
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function chunkTextFromEntries(entries: SummarySourceEntry[]) {
  return entries.map((entry) => renderSummaryEntryText(entry)).join("\n\n");
}

function chunkCharacterCount(entries: SummarySourceEntry[]) {
  return chunkTextFromEntries(entries).length;
}

function buildCaptureEntryBatches(entries: SummarySourceEntry[]) {
  const batches: SummarySourceEntry[][] = [];
  let currentBatch: SummarySourceEntry[] = [];
  let currentBatchChars = 0;

  for (const entry of entries) {
    const entryChars = renderSummaryEntryText(entry).length;
    const nextBatchChars = currentBatchChars + (currentBatch.length > 0 ? 2 : 0) + entryChars;

    if (currentBatch.length > 0 && nextBatchChars > CAPTURE_BATCH_TARGET_CHARS) {
      batches.push(currentBatch);
      currentBatch = [entry];
      currentBatchChars = entryChars;
      continue;
    }

    currentBatch.push(entry);
    currentBatchChars = nextBatchChars;
  }

  if (currentBatch.length > 0) {
    batches.push(currentBatch);
  }

  return batches;
}

function formatCaptureRetryDiagnostic(
  entries: SummarySourceEntry[],
  depth: number,
  reason: string,
  strategy?: SummaryEntrySplitStrategy
) {
  return [
    `[capture-retry]`,
    `depth=${depth}`,
    strategy ? `strategy=${strategy}` : "",
    `reason=${reason}`,
    `entries=${entries.length}`,
    `chars=${chunkCharacterCount(entries)}`,
    `entryIds=${[...new Set(entries.map((entry) => entry.entryId))].join(",")}`
  ]
    .filter(Boolean)
    .join(" ");
}

function logSummaryTiming(phase: string, metadata: Record<string, unknown>) {
  console.info("[summary-timing]", {
    phase,
    ...metadata
  });
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>
) {
  if (items.length === 0) {
    return [] as R[];
  }

  const results = new Array<R>(items.length);
  let nextIndex = 0;
  let firstError: unknown = null;

  const runner = async () => {
    while (firstError === null && nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      try {
        results[currentIndex] = await worker(items[currentIndex] as T, currentIndex);
      } catch (error) {
        if (firstError === null) {
          firstError = error;
        }
        return;
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(Math.max(concurrency, 1), items.length) }, () => runner())
  );

  if (firstError !== null) {
    throw firstError;
  }

  return results;
}

type CaptureRequestFn = (chunkText: string) => Promise<RawStructuredCapture>;

async function captureChunkWithRetry(
  chunkEntries: SummarySourceEntry[],
  requestCapture: CaptureRequestFn,
  entryMetadata: Map<string, SummarySourceEntry>,
  diagnostics: string[],
  retryDepth = 0
): Promise<StructuredCaptureFact[]> {
  const chunk = chunkTextFromEntries(chunkEntries);

  try {
    const rawCapture = await requestCapture(chunk);
    return normalizeCapture(rawCapture, entryMetadata).facts;
  } catch (error) {
    if (!isRetryableCaptureError(error)) {
      throw error;
    }

    const nextSplit = splitCaptureEntriesForRetry(chunkEntries);
    if (!nextSplit) {
      const failureDiagnostics = [
        ...error.diagnostics,
        formatCaptureRetryDiagnostic(chunkEntries, retryDepth, error.kind)
      ];
      throw new SummaryModelRequestError(
        `Summary capture was still truncated at the smallest retry unit. ${error.message}`,
        {
          status: error.status,
          kind: error.kind,
          diagnostics: failureDiagnostics
        }
      );
    }

    diagnostics.push(
      formatCaptureRetryDiagnostic(chunkEntries, retryDepth, error.kind, nextSplit.strategy)
    );

    const nestedResults = await Promise.all(
      nextSplit.chunks.map((nextChunk) =>
        captureChunkWithRetry(
          nextChunk,
          requestCapture,
          entryMetadata,
          diagnostics,
          retryDepth + 1
        )
      )
    );

    return nestedResults.flat();
  }
}

async function generateSummaryOneStep(
  apiKey: string,
  model: string,
  turns: ConversationTurn[],
  nameHint?: string
) {
  const rawSummary = await requestStructuredCompletion<object>({
    apiKey,
    model,
    schemaName: "caregiver_handoff_summary",
    schema: summarySchema,
    systemPrompt:
      "You are a classifier and organizer for caregiver handoff notes. Read nonlinear caregiver input, extract individual facts, place each fact into the best handoff category based on meaning, prioritize safety and actionability, deduplicate overlap, and never invent facts.",
    userPrompt: `${summarySchemaDescription}\n\n${oneStepSynthesisRules}\n\n${buildTitleInstruction(
      nameHint
    )}\n\nCaregiver input:\n${buildSummarySource(turns)}`,
    temperature: 0,
    maxCompletionTokens: 5000
  });

  if (!rawSummary) {
    return null;
  }

  return normalizeGeneratedSummaryWithOptions(rawSummary, nameHint, {
    reclassify: false,
    semanticRepair: false
  });
}

async function captureSummaryFacts(
  apiKey: string,
  model: string,
  turns: ConversationTurn[]
) {
  const preprocessStartedAt = Date.now();
  const entries = buildSummaryEntries(turns, { chunkLongEntries: true });
  const preprocessDurationMs = Date.now() - preprocessStartedAt;
  const entryMetadata = new Map<string, SummarySourceEntry>();
  for (const entry of entries) {
    if (!entryMetadata.has(entry.entryId)) {
      entryMetadata.set(entry.entryId, entry);
    }
  }
  const diagnostics: string[] = [];
  const batches = buildCaptureEntryBatches(entries);
  const concurrency = captureBatchConcurrency();

  logSummaryTiming("preprocess", {
    durationMs: preprocessDurationMs,
    turnCount: turns.length,
    totalChars: turns.reduce((sum, turn) => sum + (turn.content?.length ?? 0), 0),
    entryCount: entries.length,
    batchCount: batches.length,
    concurrency
  });

  const requestCapture = (chunk: string) =>
    requestStructuredCompletion<RawStructuredCapture>({
      apiKey,
      model,
      schemaName: "caregiver_handoff_structured_capture",
      schema: captureSchema,
      systemPrompt:
        "You are a structured capture step for caregiver handoff notes. Preserve facts, split them into atomic statements, assign each one to the best section, and never drop meaningful care information.",
      userPrompt: `${stepOneCaptureRules}\n\nCaregiver input:\n${chunk}`,
      temperature: 0.1,
      maxCompletionTokens: 6000
    });

  const captureStartedAt = Date.now();
  const batchResults = await mapWithConcurrency(batches, concurrency, async (batch, batchIndex) => {
    const batchStartedAt = Date.now();
    try {
      const facts = await captureChunkWithRetry(batch, requestCapture, entryMetadata, diagnostics);
      logSummaryTiming("capture-batch", {
        batchIndex: batchIndex + 1,
        batchCount: batches.length,
        durationMs: Date.now() - batchStartedAt,
        entries: batch.length,
        chars: chunkCharacterCount(batch),
        factCount: facts.length,
        status: "success"
      });
      return facts;
    } catch (error) {
      logSummaryTiming("capture-batch", {
        batchIndex: batchIndex + 1,
        batchCount: batches.length,
        durationMs: Date.now() - batchStartedAt,
        entries: batch.length,
        chars: chunkCharacterCount(batch),
        status: "error",
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  });

  const captures = batchResults.flat();

  logSummaryTiming("capture-total", {
    durationMs: Date.now() - captureStartedAt,
    batchCount: batches.length,
    concurrency,
    factCount: captures.length,
    diagnosticsCount: diagnostics.length
  });

  return {
    facts: dedupeCaptureFacts(captures)
  } satisfies StructuredCapture;
}

async function rewriteStructuredCaptureSection(
  apiKey: string,
  model: string,
  capture: StructuredCapture,
  title: SummarySectionTitle,
  repairInput?: StructuredSectionRepairInput,
  phaseLabel = "rewrite-section"
) {
  const sectionFacts = capture.facts.filter((fact) => fact.section === title);
  if (sectionFacts.length === 0) {
    logSummaryTiming(phaseLabel, {
      sectionTitle: title,
      factCount: 0,
      repairHintCount: repairInput?.mustInclude.length ?? 0,
      status: "no-data"
    });
    return [NO_INFORMATION_PLACEHOLDER];
  }

  const repairPrompt = buildSectionRepairPrompt(repairInput);
  const requestSection = () =>
    requestStructuredCompletion<{ items?: string[] }>({
      apiKey,
      model,
      schemaName: `caregiver_handoff_${generatedSummaryFieldForSection(title).key}_section`,
      schema: sectionItemsSchema,
      systemPrompt:
        "You are the final caregiver handoff writer for one section. Preserve the assigned facts, keep the bullets caregiver-ready, and do not drop supported safety details.",
      userPrompt: `${sectionItemsSchemaDescription}\n\n${buildSectionRewriteRules(
        title
      )}\n\nSection facts:\n${formatSectionFactsForRewritePrompt(capture, title)}${repairPrompt}`,
      temperature: 0,
      maxCompletionTokens: SECTION_REWRITE_MAX_COMPLETION_TOKENS
    });

  for (let attemptIndex = 0; attemptIndex <= REWRITE_RETRY_DELAYS_MS.length; attemptIndex += 1) {
    const rewriteStartedAt = Date.now();

    try {
      const rawSection = await requestSection();

      logSummaryTiming(phaseLabel, {
        sectionTitle: title,
        attempt: attemptIndex + 1,
        maxAttempts: REWRITE_RETRY_DELAYS_MS.length + 1,
        durationMs: Date.now() - rewriteStartedAt,
        factCount: sectionFacts.length,
        repairHintCount:
          (repairInput?.mustInclude.length ?? 0) + (repairInput?.mustExclude.length ?? 0),
        status: "success"
      });

      return sanitizeRewrittenSectionItems(rawSection?.items);
    } catch (error) {
      const retryable = isRetryableRewriteError(error);
      const nextDelayMs = retryable ? REWRITE_RETRY_DELAYS_MS[attemptIndex] : undefined;

      logSummaryTiming(phaseLabel, {
        sectionTitle: title,
        attempt: attemptIndex + 1,
        maxAttempts: REWRITE_RETRY_DELAYS_MS.length + 1,
        durationMs: Date.now() - rewriteStartedAt,
        factCount: sectionFacts.length,
        repairHintCount:
          (repairInput?.mustInclude.length ?? 0) + (repairInput?.mustExclude.length ?? 0),
        status: retryable && typeof nextDelayMs === "number" ? "retrying" : "error",
        error: error instanceof Error ? error.message : String(error),
        errorKind: toSummaryModelRequestError(error)?.kind,
        errorStatus: toSummaryModelRequestError(error)?.status,
        retryable,
        nextDelayMs
      });

      if (!retryable || typeof nextDelayMs !== "number") {
        throw error;
      }

      await delay(nextDelayMs);
    }
  }

  return [NO_INFORMATION_PLACEHOLDER];
}

async function rewriteStructuredCaptureSections(
  apiKey: string,
  model: string,
  capture: StructuredCapture,
  sectionTitles: SummarySectionTitle[],
  repairInputForSection: (title: SummarySectionTitle) => StructuredSectionRepairInput | undefined,
  phaseLabelPrefix: string
) {
  const results = await mapWithConcurrency(
    sectionTitles,
    Math.min(SECTION_REWRITE_CONCURRENCY, sectionTitles.length),
    async (title) => [
      title,
      await rewriteStructuredCaptureSection(
        apiKey,
        model,
        capture,
        title,
        repairInputForSection(title),
        `${phaseLabelPrefix}:${generatedSummaryFieldForSection(title).key}`
      )
    ] as const
  );

  return new Map(results);
}

function buildSummaryFromSectionItems(
  sectionItems: Map<SummarySectionTitle, string[]>,
  nameHint?: string,
  title = ""
) {
  return normalizeGeneratedSummaryWithOptions(
    buildGeneratedSummaryPayload(sectionItems, {
      title,
      overview: ""
    }),
    nameHint,
    {
      reclassify: false,
      semanticRepair: false
    }
  );
}

function summarySectionItemsMap(summary: StructuredSummary): Map<SummarySectionTitle, string[]> {
  return new Map<SummarySectionTitle, string[]>(
    SUMMARY_SECTION_TITLES.map((title) => [
      title,
      summary.sections.find((section) => section.title === title)?.items ?? [NO_INFORMATION_PLACEHOLDER]
    ])
  );
}

function dedupeStrings(values: string[], maxLength?: number) {
  const limit = maxLength !== undefined ? maxLength : values.length > 0 ? values.length : 1;
  const deduped = mergeRepairHintsWithLimit(limit, values);
  return maxLength ? deduped.slice(0, maxLength) : deduped;
}

function sectionIssues(report: SummaryAuditReport, title: SummarySectionTitle) {
  return normalizeSummaryAuditReport(report).issues.filter((issue) =>
    issueRelatedSections(issue).includes(title)
  );
}

function shouldHardRepairSection(report: SummaryAuditReport, title: SummarySectionTitle) {
  const tier = sectionRiskTier(title);
  if (tier === "tier3") {
    return false;
  }

  const issues = sectionIssues(report, title);
  if (tier === "tier1") {
    return issues.some((issue) => issue.severity === "hard");
  }

  return issues.some(
    (issue) =>
      issue.code === "missing_coverage" ||
      (issue.code === "wrong_section" && issue.expectedSection === title)
  );
}

function shouldSoftRepairSection(report: SummaryAuditReport, title: SummarySectionTitle) {
  return sectionIssues(report, title).some((issue) => {
    if (issue.code === "awkward_item" || issue.code === "duplicate_item") {
      return true;
    }

    if (issue.code === "wrong_section") {
      return true;
    }

    return issue.severity === "soft";
  });
}

function buildBaselineSectionRepairInput(
  title: SummarySectionTitle,
  extraHints: string[] = []
): StructuredSectionRepairInput {
  return {
    tier: sectionRiskTier(title),
    softTargetCount: SECTION_SOFT_TARGETS[title],
    mustInclude: [],
    mustExclude: [],
    shapeRules: dedupeStrings([...SECTION_SHAPE_RULES[title], ...extraHints], MAX_SECTION_REPAIR_HINTS)
  };
}

function buildStructuredRepairInput(
  title: SummarySectionTitle,
  summary: StructuredSummary,
  capture: StructuredCapture,
  report: SummaryAuditReport,
  scope: "soft" | "hard",
  extraHints: string[] = [],
  explicitMustExclude: string[] = []
): StructuredSectionRepairInput {
  const itemsBySection = summarySectionItemsMap(summary);
  const issues = sectionIssues(report, title);
  const mustExclude = dedupeStrings(
    [
      ...explicitMustExclude,
      ...issues
        .filter((issue) => issue.code === "awkward_item" || issue.code === "duplicate_item")
        .map((issue) => issue.item ?? ""),
      ...issues
        .filter((issue) => issue.code === "wrong_section" && issue.actualSection === title)
        .map((issue) => issue.item ?? "")
    ].filter(Boolean),
    MAX_SECTION_REPAIR_HINTS
  );

  if (scope === "soft") {
    return {
      ...buildBaselineSectionRepairInput(title, extraHints),
      mustExclude
    };
  }

  const tier = sectionRiskTier(title);
  const mustInclude =
    tier === "tier1"
      ? buildFactClusters(capture)
          .filter((cluster) => cluster.section === title)
          .map((cluster) => evaluateClusterCoverageStatus(cluster, itemsBySection))
          .filter((status) => status.status !== "covered")
          .map((status) => clusterStatement(status.cluster))
      : tier === "tier2"
        ? evaluateRequirementCoverageStatuses(title, capture, itemsBySection)
            .filter((status) => status.status !== "covered")
            .map((status) =>
              status.clusterStatements.length > 0
                ? `${status.requirement.description}: ${status.clusterStatements[0]}`
                : status.requirement.description
            )
        : [];

  return {
    ...buildBaselineSectionRepairInput(title, extraHints),
    mustInclude: dedupeStrings(mustInclude, MAX_SECTION_REPAIR_HINTS),
    mustExclude
  };
}

function buildSectionRepairPrompt(repairInput?: StructuredSectionRepairInput) {
  if (!repairInput) {
    return "";
  }

  const lines: string[] = [];

  if (repairInput.mustInclude.length > 0) {
    lines.push("Must include if supported:");
    lines.push(...repairInput.mustInclude.map((item) => `- ${item}`));
  }

  if (repairInput.mustExclude.length > 0) {
    lines.push("Must exclude:");
    lines.push(...repairInput.mustExclude.map((item) => `- ${item}`));
  }

  if (repairInput.shapeRules.length > 0) {
    lines.push("Section shape rules:");
    lines.push(...repairInput.shapeRules.map((item) => `- ${item}`));
  }

  lines.push(
    `Soft target: aim for about ${repairInput.softTargetCount} bullets unless this would drop supported details.`
  );

  return lines.length > 0 ? `\n\nSection repair constraints:\n${lines.join("\n")}` : "";
}

function subjectLooksFemale(capture: StructuredCapture) {
  const text = capture.facts.map((fact) => fact.statement).join(" ");
  const femaleSignals = (text.match(/\b(she|her|Ashley)\b/gi) ?? []).length;
  const maleSignals = (text.match(/\b(he|him|his)\b/gi) ?? []).length;
  return femaleSignals > 0 && femaleSignals > maleSignals;
}

function hasUnmatchedQuotes(item: string) {
  const straight = (item.match(/"/g) ?? []).length;
  const curlyOpen = (item.match(/[“]/g) ?? []).length;
  const curlyClose = (item.match(/[”]/g) ?? []).length;
  return straight % 2 === 1 || curlyOpen !== curlyClose;
}

function itemLooksNamedContact(item: string) {
  return /\b(?:Laurie|Lauri|Selena|Richie|mother|father|sister|brother)\b/i.test(item);
}

function itemLooksLikeHardTimeAction(item: string) {
  return CAREGIVER_ACTION_LEAD_PATTERN.test(item) || /\b(reduce|honor|leave|give|offer|turn|stop|change the environment|take her|stand over to the side)\b/i.test(item);
}

function itemLooksLikeSignOrTrigger(item: string) {
  return /\b(yelling|screaming|swearing|mad|angry|rage|limping|low energy|trigger|upset|overwhelm|self-injury|hitting herself)\b/i.test(
    item
  );
}

function rejectedBulletReason(
  title: SummarySectionTitle,
  item: string,
  capture: StructuredCapture,
  sectionItems: string[]
) {
  const wordCount = item.trim().split(/\s+/).filter(Boolean).length;

  if (hasUnmatchedQuotes(item)) {
    return "unmatched_quotes";
  }

  if (
    LEADING_FRAGMENT_PATTERN.test(item) ||
    /^Instead\b/i.test(item) ||
    /^(?:and|but|or)\b/i.test(item) ||
    (/^(?:we|you|i)\b/i.test(item) && wordCount <= 4) ||
    QUOTED_ALTERNATIVE_PATTERN.test(item) ||
    /(?:,\s*|:\s*|;\s*)$/i.test(item)
  ) {
    return "fragment";
  }

  if (
    subjectLooksFemale(capture) &&
    /\b(he|him|his)\b/i.test(item) &&
    !/\b(father|brother|Richie)\b/i.test(item)
  ) {
    return "pronoun_contamination";
  }

  if (
    title === "Signs they need help" &&
    (CAREGIVER_ACTION_LEAD_PATTERN.test(item) ||
      /\b(caregiver|caretaker)s?\b/i.test(item) ||
      /^(?:As a practice|Her caretakers|If caregivers do not|If a caregiver)\b/i.test(item) ||
      /\bcaregiver says\b/i.test(item) ||
      SIGNS_META_PATTERN.test(item) ||
      /^Sometimes (?:she )?(?:asks for help|can respond)(?: when [^.]+)?\.?$/i.test(item) ||
      /\bthere is something that has dysregulated her\b/i.test(item) ||
      SIGNS_HISTORY_LEAK_PATTERN.test(item) ||
      /\?/.test(item) ||
      /\bshould\b/i.test(item))
  ) {
    return "signs_shape";
  }

  if (
    title === WHO_TO_CONTACT_TITLE &&
    sectionItems.some((candidate) => candidate !== item && itemLooksNamedContact(candidate)) &&
    GENERIC_CONTACT_GUIDANCE_PATTERN.test(item)
  ) {
    return "generic_contact";
  }

  if (
    title === "What helps the day go well" &&
    /\b(hard days?|rage|hitting herself|hit herself|frustration tolerance|no reliable strategy|hours hitting|swear(?:ing)?|angry or frustrated)\b/i.test(
      item
    )
  ) {
    return "day_shape";
  }

  if (
    title === "What helps when they are having a hard time" &&
    (/^(?:We can go|You don'?t have to stay)\.?$/i.test(item) ||
      GENERIC_CONTACT_GUIDANCE_PATTERN.test(item) ||
      /\bdo not hesitate to call\b/i.test(item) ||
      HARD_TIME_HEALTH_LEAK_PATTERN.test(item) ||
      HARD_TIME_ROUTINE_LEAK_PATTERN.test(item) ||
      CHOICE_SUPPORT_PATTERN.test(item) ||
      (!itemLooksLikeHardTimeAction(item) && itemLooksLikeSignOrTrigger(item)))
  ) {
    return "hard_time_shape";
  }

  if (
    title === "What can upset or overwhelm them" &&
    (!TRIGGER_LIKE_PATTERN.test(item) || NON_TRIGGER_LEAK_PATTERN.test(item))
  ) {
    return "trigger_shape";
  }

  return null;
}

function canDropSectionItems(
  title: SummarySectionTitle,
  currentSummary: StructuredSummary,
  replacementItems: string[],
  capture: StructuredCapture
) {
  if (replacementItems.length === 0) {
    return false;
  }

  const itemsBySection = summarySectionItemsMap(
    replaceSummarySections(currentSummary, new Map([[title, replacementItems]]))
  );
  const tier = sectionRiskTier(title);

  if (tier === "tier1") {
    return buildFactClusters(capture)
      .filter((cluster) => cluster.section === title)
      .every((cluster) => evaluateClusterCoverageStatus(cluster, itemsBySection).status === "covered");
  }

  if (tier === "tier2") {
    return evaluateRequirementCoverageStatuses(title, capture, itemsBySection).every(
      (status) => status.status === "covered"
    );
  }

  return true;
}

function persistedFactsFromCapture(
  capture: StructuredCapture,
  sourceTurnsHash: string
) {
  return capture.facts.map(
    (fact) =>
      ({
        factId: fact.factId,
        entryId: fact.entryId,
        sectionTitle: fact.section,
        factKind: fact.factKind,
        statement: fact.statement,
        safetyRelevant: fact.safetyRelevant,
        conceptKeys: [...fact.conceptKeys],
        sourceEntryIds: [...fact.sourceEntryIds],
        sourceTurnsHash
      }) satisfies StructuredSummaryFact
  );
}

function captureFromPersistedFacts(facts: StructuredSummaryFact[]) {
  return {
    facts: facts.map(
      (fact) =>
        ({
          factId: fact.factId,
          entryId: fact.entryId,
          section: fact.sectionTitle,
          factKind: fact.factKind,
          statement: fact.statement,
          safetyRelevant: fact.safetyRelevant,
          conceptKeys: [...fact.conceptKeys],
          sourceEntryIds: [...fact.sourceEntryIds]
        }) satisfies StructuredCaptureFact
    )
  } satisfies StructuredCapture;
}

function sectionSummariesFromSummary(
  summary: StructuredSummary,
  sourceTurnsHash: string
) {
  const itemsBySection = summarySectionItemsMap(summary);

  return SUMMARY_SECTION_TITLES.map(
    (sectionTitle) =>
      ({
        sectionTitle,
        items: itemsBySection.get(sectionTitle) ?? [NO_INFORMATION_PLACEHOLDER],
        sourceTurnsHash
      }) satisfies StructuredSectionSummary
  );
}

async function applyFinalSectionQualityGate(
  apiKey: string,
  model: string,
  summary: StructuredSummary,
  capture: StructuredCapture,
  report: SummaryAuditReport,
  nameHint: string | undefined,
  indexedInitialHints: SectionRepairHintIndex
) {
  let workingSummary = summary;
  const rerunSections = new Map<SummarySectionTitle, string[]>();

  for (const title of SUMMARY_SECTION_TITLES) {
    const currentItems =
      workingSummary.sections.find((section) => section.title === title)?.items ?? [NO_INFORMATION_PLACEHOLDER];
    const meaningfulItems = currentItems.filter(
      (item) => normalizeCoverageText(item) !== normalizeCoverageText(NO_INFORMATION_PLACEHOLDER)
    );

    if (meaningfulItems.length === 0) {
      continue;
    }

    let acceptedItems = [...meaningfulItems];
    const rejectedItems: string[] = [];

    for (const item of meaningfulItems) {
      const reason = rejectedBulletReason(title, item, capture, meaningfulItems);
      if (!reason) {
        continue;
      }

      const candidateItems = acceptedItems.filter((candidate) => candidate !== item);
      if (canDropSectionItems(title, workingSummary, candidateItems, capture)) {
        acceptedItems = candidateItems;
        continue;
      }

      rejectedItems.push(item);
    }

    if (acceptedItems.length !== meaningfulItems.length) {
      workingSummary = replaceSummarySections(
        workingSummary,
        new Map([[title, acceptedItems.length > 0 ? acceptedItems : [NO_INFORMATION_PLACEHOLDER]]]),
        nameHint
      );
    }

    if (rejectedItems.length > 0) {
      rerunSections.set(title, rejectedItems);
    }
  }

  if (rerunSections.size === 0) {
    return auditAndFinalizeSummary(workingSummary, capture, nameHint);
  }

  const rerunReplacements = await rewriteStructuredCaptureSections(
    apiKey,
    model,
    capture,
    [...rerunSections.keys()],
    (title) =>
      buildStructuredRepairInput(
        title,
        workingSummary,
        capture,
        report,
        "hard",
        mergeRepairHintsWithLimit(
          MAX_SECTION_REPAIR_HINTS,
          indexedInitialHints.global,
          indexedInitialHints.bySection.get(title) ?? []
        ),
        rerunSections.get(title) ?? []
      ),
    "rewrite-quality-gate"
  );

  let rerunSummary = replaceSummarySections(workingSummary, rerunReplacements, nameHint);

  for (const title of rerunSections.keys()) {
    const currentItems =
      rerunSummary.sections.find((section) => section.title === title)?.items ?? [NO_INFORMATION_PLACEHOLDER];
    const meaningfulItems = currentItems.filter(
      (item) => normalizeCoverageText(item) !== normalizeCoverageText(NO_INFORMATION_PLACEHOLDER)
    );
    let acceptedItems = [...meaningfulItems];

    for (const item of meaningfulItems) {
      const reason = rejectedBulletReason(title, item, capture, meaningfulItems);
      if (!reason) {
        continue;
      }

      const candidateItems = acceptedItems.filter((candidate) => candidate !== item);
      if (canDropSectionItems(title, rerunSummary, candidateItems, capture)) {
        acceptedItems = candidateItems;
      }
    }

    if (acceptedItems.length !== meaningfulItems.length) {
      rerunSummary = replaceSummarySections(
        rerunSummary,
        new Map([[title, acceptedItems.length > 0 ? acceptedItems : [NO_INFORMATION_PLACEHOLDER]]]),
        nameHint
      );
    }
  }

  return auditAndFinalizeSummary(rerunSummary, capture, nameHint);
}

async function generateSummaryTwoStepFromCapture(
  apiKey: string,
  model: string,
  capture: StructuredCapture,
  nameHint?: string,
  repairHints: string[] = []
) {
  if (capture.facts.length === 0) {
    return null;
  }

  const indexedInitialHints = indexRepairHintsBySection(mergeRepairHints(repairHints));
  const initialSectionItems = await rewriteStructuredCaptureSections(
    apiKey,
    model,
    capture,
    SUMMARY_SECTION_TITLES,
    (title) =>
      buildBaselineSectionRepairInput(
        title,
        mergeRepairHintsWithLimit(
          MAX_SECTION_REPAIR_HINTS,
          indexedInitialHints.global,
          indexedInitialHints.bySection.get(title) ?? []
        )
      ),
    "rewrite-initial"
  );
  const rewrittenSummary = buildSummaryFromSectionItems(
    initialSectionItems,
    nameHint
  );

  const firstPass = auditAndFinalizeSummary(rewrittenSummary, capture, nameHint);
  if (firstPass.report.issues.length === 0) {
    return firstPass;
  }
  const candidates: AuditedSummaryCandidate[] = [firstPass];

  const softSections = SUMMARY_SECTION_TITLES.filter((title) =>
    shouldSoftRepairSection(firstPass.report, title)
  );

  if (softSections.length > 0) {
    const softReplacements = await rewriteStructuredCaptureSections(
      apiKey,
      model,
      capture,
      softSections,
      (title) =>
        buildStructuredRepairInput(
          title,
          firstPass.summary,
          capture,
          firstPass.report,
          "soft",
          mergeRepairHintsWithLimit(
            MAX_SECTION_REPAIR_HINTS,
            indexedInitialHints.global,
            indexedInitialHints.bySection.get(title) ?? []
          )
        ),
      "rewrite-soft-repair"
    );

    candidates.push(
      auditAndFinalizeSummary(
        replaceSummarySections(firstPass.summary, softReplacements, nameHint),
        capture,
        nameHint
      )
    );
  }

  const bestAfterSoftPass = candidates.reduce(choosePreferredCandidate);
  const hardSections = SUMMARY_SECTION_TITLES.filter((title) =>
    shouldHardRepairSection(bestAfterSoftPass.report, title)
  );

  if (hardSections.length > 0) {
    const hardReplacements = await rewriteStructuredCaptureSections(
      apiKey,
      model,
      capture,
      hardSections,
      (title) =>
        buildStructuredRepairInput(
          title,
          bestAfterSoftPass.summary,
          capture,
          bestAfterSoftPass.report,
          "hard",
          mergeRepairHintsWithLimit(
            MAX_SECTION_REPAIR_HINTS,
            indexedInitialHints.global,
            indexedInitialHints.bySection.get(title) ?? []
          )
        ),
      "rewrite-hard-repair"
    );

    candidates.push(
      auditAndFinalizeSummary(
        replaceSummarySections(bestAfterSoftPass.summary, hardReplacements, nameHint),
        capture,
        nameHint
      )
    );
  }

  const bestCandidate = candidates.reduce(choosePreferredCandidate);
  return applyFinalSectionQualityGate(
    apiKey,
    model,
    bestCandidate.summary,
    capture,
    bestCandidate.report,
    nameHint,
    indexedInitialHints
  );
}

async function generateSummaryTwoStep(
  apiKey: string,
  model: string,
  turns: ConversationTurn[],
  nameHint?: string,
  repairHints: string[] = []
) {
  const capture = await captureSummaryFacts(apiKey, model, turns);
  if (capture.facts.length === 0) {
    return null;
  }

  const result = await generateSummaryTwoStepFromCapture(
    apiKey,
    model,
    capture,
    nameHint,
    repairHints
  );
  if (!result) {
    return null;
  }

  return {
    capture,
    summary: result.summary,
    report: result.report
  };
}

export function buildSummarySource(turns: ConversationTurn[]) {
  return buildSummaryEntries(turns).map((entry) => renderSummaryEntryText(entry)).join("\n\n");
}

export const __summaryGenerationTestUtils = {
  parseStructuredJson,
  looksLikeTruncatedStructuredOutput,
  normalizeSummarySourceText,
  compressLongSummaryAnswer,
  isRetryableRewriteError,
  splitCaptureEntriesForRetry,
  buildCaptureEntryBatches,
  createSummarySourceEntry,
  captureChunkWithRetry,
  dedupeCaptureFacts,
  mapWithConcurrency,
  indexRepairHintsBySection,
  collectSectionRepairHints,
  auditSummaryAgainstCapture,
  sectionRiskTier,
  sectionFactIsAdmissible,
  rejectedBulletReason,
  persistedFactsFromCapture,
  captureFromPersistedFacts,
  sectionSummariesFromSummary
};

function finalizeGeneratedSummary(
  summary: StructuredSummary,
  sourceTurnsHash: string,
  nameHint?: string,
  existingReport?: SummaryAuditReport
) {
  const finalized = existingReport
    ? {
        summary,
        report: normalizeSummaryAuditReport(existingReport)
      }
    : finalizeSummaryWithQa(summary, {
        source: "generated",
        nameHint
      });
  const normalized = finalized.summary;
  const report = finalized.report;

  return {
    summary: {
      ...normalized,
      pipelineVersion: SUMMARY_PIPELINE_VERSION,
      layoutVersion: SUMMARY_LAYOUT_VERSION,
      sourceTurnsHash
    } satisfies StructuredSummary,
    auditReport: report
  };
}

function buildGeneratedArtifacts(
  summary: StructuredSummary,
  auditReport: SummaryAuditReport,
  capture: StructuredCapture | null,
  sourceTurnsHash: string
): GeneratedSummaryArtifacts {
  return {
    summary,
    auditReport,
    facts: capture ? persistedFactsFromCapture(capture, sourceTurnsHash) : [],
    sectionSummaries: sectionSummariesFromSummary(summary, sourceTurnsHash)
  };
}

export async function generateCaregiverSummaryArtifactsWithQa(
  turns: ConversationTurn[],
  nameHint?: string,
  mode: SummaryGenerationMode = "two-step",
  options: SummaryGenerationOptions = {}
): Promise<GeneratedSummaryArtifacts> {
  const sourceTurnsHash = computeTurnsHash(turns);
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    const finalized = finalizeGeneratedSummary(
      buildFallbackSummary(turns, nameHint),
      sourceTurnsHash,
      nameHint
    );
    return buildGeneratedArtifacts(finalized.summary, finalized.auditReport, null, sourceTurnsHash);
  }

  const model = defaultModel();

  try {
    if (mode === "one-step") {
      const summary = await generateSummaryOneStep(apiKey, model, turns, nameHint);
      if (!summary) {
        throw new SummaryQualityError(
          "Summary generation returned no structured one-step summary.",
          []
        );
      }
      const finalized = finalizeGeneratedSummary(summary, sourceTurnsHash, nameHint);
      return buildGeneratedArtifacts(finalized.summary, finalized.auditReport, null, sourceTurnsHash);
    }

    const result = await generateSummaryTwoStep(
      apiKey,
      model,
      turns,
      nameHint,
      options.repairHints ?? []
    );
    if (!result) {
      throw new SummaryQualityError(
        "Summary generation returned no structured two-step summary.",
        []
      );
    }
    const finalized = finalizeGeneratedSummary(
      result.summary,
      sourceTurnsHash,
      nameHint,
      result.report
    );
    return buildGeneratedArtifacts(
      finalized.summary,
      finalized.auditReport,
      result.capture,
      sourceTurnsHash
    );
  } catch (error) {
    if (
      error instanceof SummaryQualityError ||
      error instanceof SummaryModelRequestError
    ) {
      throw error;
    }

    if (error instanceof Error) {
      throw error;
    }

    throw new SummaryModelRequestError("Summary generation failed unexpectedly.", {
      kind: "unexpected"
    });
  }
}

export async function generateCaregiverSummaryArtifactsFromFactsWithQa(
  facts: StructuredSummaryFact[],
  turns: ConversationTurn[],
  nameHint?: string,
  options: SummaryGenerationOptions = {}
): Promise<GeneratedSummaryArtifacts> {
  const sourceTurnsHash =
    facts[0]?.sourceTurnsHash?.trim() || computeTurnsHash(turns);
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    const finalized = finalizeGeneratedSummary(
      buildFallbackSummary(turns, nameHint),
      sourceTurnsHash,
      nameHint
    );
    return buildGeneratedArtifacts(finalized.summary, finalized.auditReport, null, sourceTurnsHash);
  }

  const capture = captureFromPersistedFacts(facts);
  if (capture.facts.length === 0) {
    const finalized = finalizeGeneratedSummary(
      buildFallbackSummary(turns, nameHint),
      sourceTurnsHash,
      nameHint
    );
    return buildGeneratedArtifacts(finalized.summary, finalized.auditReport, null, sourceTurnsHash);
  }

  const model = defaultModel();
  const result = await generateSummaryTwoStepFromCapture(
    apiKey,
    model,
    capture,
    nameHint,
    options.repairHints ?? []
  );

  if (!result) {
    throw new SummaryQualityError(
      "Summary regeneration returned no structured two-step summary from persisted facts.",
      []
    );
  }

  const finalized = finalizeGeneratedSummary(
    result.summary,
    sourceTurnsHash,
    nameHint,
    result.report
  );

  return buildGeneratedArtifacts(
    finalized.summary,
    finalized.auditReport,
    capture,
    sourceTurnsHash
  );
}

export async function generateCaregiverSummaryWithQa(
  turns: ConversationTurn[],
  nameHint?: string,
  mode: SummaryGenerationMode = "two-step",
  options: SummaryGenerationOptions = {}
): Promise<{ summary: StructuredSummary; auditReport: SummaryAuditReport }> {
  const result = await generateCaregiverSummaryArtifactsWithQa(turns, nameHint, mode, options);
  return {
    summary: result.summary,
    auditReport: result.auditReport
  };
}

export async function generateCaregiverSummary(
  turns: ConversationTurn[],
  nameHint?: string,
  mode: SummaryGenerationMode = "two-step"
) {
  const result = await generateCaregiverSummaryWithQa(turns, nameHint, mode);
  return result.summary;
}
