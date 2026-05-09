import {
  PREFERRED_SUMMARY_SECTION_ORDER,
  buildFallbackSummary,
  normalizeAuthoritativeStructuredSummary,
  normalizeGeneratedSummaryWithOptions
} from "./summary";
import {
  collectRepairHintsFromAuditReport,
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
  StructuredSummary,
  SummaryAuditIssue,
  SummaryAuditReport
} from "./types";

const NO_INFORMATION_PLACEHOLDER = "(No information provided)";
const OPENAI_CHAT_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions";
const DEFAULT_SUMMARY_MODEL = "gpt-5.5";
const DEFAULT_OPENAI_TIMEOUT_MS = 75_000;
const CAPTURE_ENTRY_TARGET_CHARS = 800;
const CAPTURE_BATCH_TARGET_CHARS = 3200;
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

type SummarySectionTitle = (typeof SUMMARY_SECTION_TITLES)[number];

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

type StructuredFactKind =
  | "communication_method"
  | "communication_signal"
  | "support_strategy"
  | "routine"
  | "trigger"
  | "help_sign"
  | "caregiver_action"
  | "condition"
  | "medication"
  | "equipment"
  | "safety_risk"
  | "contact"
  | "preference";

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
      const content = normalizeSummarySourceText(turn.content);
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

  return [...deduped.values()];
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

function formatStructuredCaptureForPrompt(capture: StructuredCapture) {
  return SUMMARY_SECTION_TITLES.map((title) => {
    const sectionFacts = capture.facts.filter((fact) => fact.section === title);
    if (sectionFacts.length === 0) {
      return `[${title}]\n- ${NO_INFORMATION_PLACEHOLDER}`;
    }

    const grouped = new Map<StructuredFactKind, StructuredCaptureFact[]>();

    for (const fact of sectionFacts) {
      const items = grouped.get(fact.factKind) ?? [];
      items.push(fact);
      grouped.set(fact.factKind, items);
    }

    const lines = [`[${title}]`];

    for (const factKind of STRUCTURED_FACT_KINDS) {
      const factsForKind = grouped.get(factKind);
      if (!factsForKind) {
        continue;
      }

      lines.push(`Fact kind: ${factKind}`);
      for (const fact of factsForKind) {
        lines.push(
          `- [${fact.factId}] ${fact.statement}${fact.safetyRelevant ? " [safety]" : ""} (${fact.sourceEntryIds.join(", ")})`
        );
      }
    }

    return lines.join("\n");
  }).join("\n\n");
}

function clusterSignature(fact: StructuredCaptureFact) {
  const conceptSignature =
    fact.conceptKeys.length > 0 ? fact.conceptKeys.join("|") : normalizeCoverageText(fact.statement);
  return `${fact.section}::${fact.factKind}::${conceptSignature}`;
}

function buildFactClusters(capture: StructuredCapture) {
  const clusters = new Map<string, FactCluster>();

  for (const fact of capture.facts) {
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

function groupFactsForRewritePrompt(capture: StructuredCapture) {
  const clusters = buildFactClusters(capture)
    .slice()
    .sort((left, right) => {
      const [leftRank, leftStatement] = clusterSortKey(left);
      const [rightRank, rightStatement] = clusterSortKey(right);
      if (left.section !== right.section) {
        return SUMMARY_SECTION_TITLES.indexOf(left.section) - SUMMARY_SECTION_TITLES.indexOf(right.section);
      }
      if (leftRank !== rightRank) {
        return leftRank - rightRank;
      }
      return leftStatement.localeCompare(rightStatement);
    });

  return SUMMARY_SECTION_TITLES.map((title) => {
    const sectionClusters = clusters.filter((cluster) => cluster.section === title);
    if (sectionClusters.length === 0) {
      return `[${title}]\n- ${NO_INFORMATION_PLACEHOLDER}`;
    }

    const lines = [`[${title}]`];

    for (const cluster of sectionClusters) {
      lines.push(`Fact kind: ${cluster.factKind}`);
      for (const fact of cluster.facts) {
        lines.push(
          `- [${fact.factId}] ${fact.statement}${fact.safetyRelevant ? " [safety]" : ""}`
        );
      }
    }

    return lines.join("\n");
  }).join("\n\n");
}

function bulletSpecificityScore(item: string, expectedSection: SummarySectionTitle, actualSection: SummarySectionTitle) {
  let score = coverageTokens(item).length + item.length / 80;

  if (actualSection === expectedSection) {
    score += 3;
  }

  if (/\b(because|if|when|usually|especially|for safety|daily|every hour|a\.m\.|p\.m\.)\b/i.test(item)) {
    score += 1;
  }

  return score;
}

function selectBestBulletForCluster(cluster: FactCluster, summary: StructuredSummary) {
  const candidates = summary.sections.flatMap((section) =>
    section.items
      .filter((item) => normalizeCoverageText(item) !== normalizeCoverageText(NO_INFORMATION_PLACEHOLDER))
      .filter((item) => cluster.facts.some((fact) => factLooksCoveredByItem(fact, item)))
      .map((item) => ({
        section: section.title as SummarySectionTitle,
        item
      }))
  );

  if (candidates.length === 0) {
    return null;
  }

  return candidates.sort((left, right) => {
    const scoreDifference =
      bulletSpecificityScore(right.item, cluster.section, right.section) -
      bulletSpecificityScore(left.item, cluster.section, left.section);
    if (scoreDifference !== 0) {
      return scoreDifference;
    }

    if (left.section !== right.section) {
      return left.section === cluster.section ? -1 : right.section === cluster.section ? 1 : 0;
    }

    return right.item.length - left.item.length;
  })[0];
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
    SUMMARY_SECTION_TITLES.map((title) => [title, []])
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
    const selected = selectBestBulletForCluster(cluster, summary);
    if (!selected) {
      continue;
    }

    buckets.get(cluster.section)?.push(selected.item);
  }

  const composed: StructuredSummary = {
    ...summary,
    sections: SUMMARY_SECTION_TITLES.map((title, index) => ({
      id: `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${index + 1}`,
      title,
      items: buckets.get(title) ?? [NO_INFORMATION_PLACEHOLDER]
    }))
  };

  return normalizeAuthoritativeStructuredSummary(composed, nameHint);
}

function summaryItemsBySection(
  summary: StructuredSummary,
) {
  return new Map(
    summary.sections.map((section) => [
      section.title,
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
  }
): SummaryAuditIssue {
  const visibility = factNeedsUserVisibleWarning(fact) ? "user" : "internal";

  return {
    code,
    message: options.message,
    factId: fact.factId,
    expectedSection: fact.section,
    actualSection: options.actualSection,
    severity: visibility === "user" ? "hard" : "soft",
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

  for (const fact of capture.facts) {
    const expectedItems = itemsBySection.get(fact.section) ?? [];
    const matchedInExpected = expectedItems.some((item) => factLooksCoveredByItem(fact, item));

    if (matchedInExpected) {
      continue;
    }

    const matchedElsewhere = SUMMARY_SECTION_TITLES.find((title) => {
      if (title === fact.section) {
        return false;
      }

      return (itemsBySection.get(title) ?? []).some((item) => factLooksCoveredByItem(fact, item));
    });

    if (matchedElsewhere) {
      issues.push(
        createCaptureAuditIssue(fact, "section_leakage", {
          message: `${fact.factId} is only represented in ${matchedElsewhere} but belongs in ${fact.section}.`,
          actualSection: matchedElsewhere
        })
      );
      continue;
    }

    issues.push(
      createCaptureAuditIssue(fact, "missing_coverage", {
        message: `${fact.factId} is missing from ${fact.section}: ${fact.statement}`
      })
    );
  }

  return issues;
}

function mergeRepairHints(...hintGroups: string[][]) {
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

      if (merged.length >= 8) {
        return merged;
      }
    }
  }

  return merged;
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

  let response: Response;

  try {
    response = await fetch(OPENAI_CHAT_COMPLETIONS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        store: false,
        temperature,
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
          type: "json_schema",
          json_schema: {
            name: schemaName,
            strict: true,
            schema
          }
        }
      }),
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
  return (
    error instanceof SummaryModelRequestError &&
    (error.kind === "truncation" || error.kind === "parse")
  );
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
  const entries = buildSummaryEntries(turns, { chunkLongEntries: true });
  const entryMetadata = new Map<string, SummarySourceEntry>();
  for (const entry of entries) {
    if (!entryMetadata.has(entry.entryId)) {
      entryMetadata.set(entry.entryId, entry);
    }
  }
  const captures: StructuredCaptureFact[] = [];
  const diagnostics: string[] = [];

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

  for (const batch of buildCaptureEntryBatches(entries)) {
    captures.push(
      ...(await captureChunkWithRetry(batch, requestCapture, entryMetadata, diagnostics))
    );
  }

  return {
    facts: dedupeCaptureFacts(captures)
  } satisfies StructuredCapture;
}

async function rewriteStructuredCapture(
  apiKey: string,
  model: string,
  capture: StructuredCapture,
  nameHint?: string,
  auditFailures: string[] = []
) {
  const repairPrompt =
    auditFailures.length > 0
      ? `\n\nAudit issues to fix before finalizing:\n${auditFailures
          .map((failure) => `- ${failure}`)
          .join("\n")}`
      : "";
  const rawSummary = await requestStructuredCompletion<object>({
    apiKey,
    model,
    schemaName: "caregiver_handoff_summary",
    schema: summarySchema,
    systemPrompt:
      "You are the final caregiver handoff writer. Use the structured capture to write a complete, organized, caregiver-ready handoff that preserves safety details and avoids duplication.",
    userPrompt: `${summarySchemaDescription}\n\n${stepTwoRewriteRules}\n\n${buildTitleInstruction(
      nameHint
    )}\n\nStructured capture:\n${groupFactsForRewritePrompt(capture)}${repairPrompt}`,
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

  const initialRepairHints = mergeRepairHints(repairHints);
  const rewrittenSummary = await rewriteStructuredCapture(
    apiKey,
    model,
    capture,
    nameHint,
    initialRepairHints
  );
  if (!rewrittenSummary) {
    return null;
  }

  const firstPass = auditAndFinalizeSummary(rewrittenSummary, capture, nameHint);
  if (firstPass.report.issues.length === 0) {
    return firstPass;
  }
  const candidates: AuditedSummaryCandidate[] = [firstPass];

  const softRepairHints = mergeRepairHints(
    collectRepairHintsFromAuditReport(firstPass.report, "soft")
  );

  if (softRepairHints.length > 0) {
    const softRepairedSummary = await rewriteStructuredCapture(
      apiKey,
      model,
      capture,
      nameHint,
      softRepairHints
    );

    if (softRepairedSummary) {
      candidates.push(auditAndFinalizeSummary(softRepairedSummary, capture, nameHint));
    }
  }

  const bestAfterSoftPass = candidates.reduce(choosePreferredCandidate);
  const hardRepairHints = mergeRepairHints(
    collectRepairHintsFromAuditReport(bestAfterSoftPass.report, "hard")
  );

  if (hardRepairHints.length > 0) {
    const hardRepairedSummary = await rewriteStructuredCapture(
      apiKey,
      model,
      capture,
      nameHint,
      hardRepairHints
    );

    if (hardRepairedSummary) {
      candidates.push(auditAndFinalizeSummary(hardRepairedSummary, capture, nameHint));
    }
  }

  return candidates.reduce(choosePreferredCandidate);
}

export function buildSummarySource(turns: ConversationTurn[]) {
  return buildSummaryEntries(turns).map((entry) => renderSummaryEntryText(entry)).join("\n\n");
}

export const __summaryGenerationTestUtils = {
  parseStructuredJson,
  looksLikeTruncatedStructuredOutput,
  normalizeSummarySourceText,
  splitCaptureEntriesForRetry,
  buildCaptureEntryBatches,
  createSummarySourceEntry,
  captureChunkWithRetry
};

function finalizeGeneratedSummary(
  summary: StructuredSummary,
  turns: ConversationTurn[],
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
      sourceTurnsHash: computeTurnsHash(turns)
    } satisfies StructuredSummary,
    auditReport: report
  };
}

export async function generateCaregiverSummaryWithQa(
  turns: ConversationTurn[],
  nameHint?: string,
  mode: SummaryGenerationMode = "two-step",
  options: SummaryGenerationOptions = {}
): Promise<{ summary: StructuredSummary; auditReport: SummaryAuditReport }> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return finalizeGeneratedSummary(buildFallbackSummary(turns, nameHint), turns, nameHint);
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
      return finalizeGeneratedSummary(summary, turns, nameHint);
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
    return finalizeGeneratedSummary(result.summary, turns, nameHint, result.report);
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

export async function generateCaregiverSummary(
  turns: ConversationTurn[],
  nameHint?: string,
  mode: SummaryGenerationMode = "two-step"
) {
  const result = await generateCaregiverSummaryWithQa(turns, nameHint, mode);
  return result.summary;
}
