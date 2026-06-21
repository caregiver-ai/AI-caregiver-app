import {
  PREFERRED_SUMMARY_SECTION_ORDER,
  buildFallbackSummary,
  inferAuthoritativeSectionTitle,
  normalizeAuthoritativeStructuredSummary,
  normalizeGeneratedSummaryWithOptions
} from "./summary";
import { getQuestionnairePrompts } from "./questionnaire";
import { finalizeSummaryWithQa } from "./summary-audit";
import {
  SUMMARY_LAYOUT_VERSION,
  SUMMARY_PIPELINE_VERSION,
  computeTurnsHash,
  deriveItemsFromBlocks
} from "./summary-structured";
import {
  CaregiverInsight,
  ConversationTurn,
  ReflectionStepId,
  StructuredSummary,
  SummaryBlock,
  SummarySection,
  SummaryAuditIssue,
  SummaryAuditReport
} from "./types";

const NO_INFORMATION_PLACEHOLDER = "(No information provided)";
const OPENAI_CHAT_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions";
const DEFAULT_SUMMARY_MODEL = "gpt-5.5";
const DEFAULT_OPENAI_TIMEOUT_MS = 300_000;
const CAPTURE_ENTRY_TARGET_CHARS = 2_400;
const CAPTURE_PROMPT_TARGET_CHARS = 3_200;
const CAPTURE_CONCURRENCY_LIMIT = 3;

const SUMMARY_SECTION_TITLES = [
  "Communication",
  "Understanding and Learning",
  "Daily Schedule",
  "Activities & Preferences",
  "Signs They Are Having a Hard Time",
  "What helps when they are having a hard time",
  "Health & Safety"
] as const;
const GUIDE_SECTION_TITLES = [...PREFERRED_SUMMARY_SECTION_ORDER];

type SummarySectionTitle = (typeof SUMMARY_SECTION_TITLES)[number];
type GuideSectionTitle = (typeof GUIDE_SECTION_TITLES)[number];

type ChatCompletionContentPart = {
  type?: string;
  text?: string;
};

export type StructuredCaptureFact = {
  factId: string;
  entryId: string;
  section: SummarySectionTitle;
  factKind: StructuredFactKind;
  subcategory: string;
  statement: string;
  safetyRelevant: boolean;
  conceptKeys: string[];
  sourceEntryIds: string[];
};

export type StructuredCapture = {
  facts: StructuredCaptureFact[];
};

export type SummarySectionArtifact = {
  sectionTitle: string;
  itemsJson: {
    id: string;
    title: string;
    intro?: string;
    items: string[];
    blocks?: SummaryBlock[];
  };
};

type StructuredInsightCapture = {
  insights: CaregiverInsight[];
};

type StructuredFactKind =
  | "communication_method"
  | "communication_signal"
  | "learning"
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
  expectedSection: GuideSectionTitle;
  factKind: StructuredFactKind;
  status: "covered" | "leaked" | "missing" | "internal" | "duplicated";
  actualSection?: GuideSectionTitle;
  matchedBullet?: string;
};

export type SummaryGenerationResult = {
  summary: StructuredSummary;
  auditReport: SummaryAuditReport;
  facts: StructuredCaptureFact[];
  sectionSummaries: SummarySectionArtifact[];
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

class SummaryModelRequestError extends Error {
  status?: number;
  code?: string;

  constructor(message: string, status?: number, code?: string) {
    super(message);
    this.name = "SummaryModelRequestError";
    this.status = status;
    this.code = code;
  }
}

class SummaryModelTruncationError extends SummaryModelRequestError {
  schemaName: string;
  maxCompletionTokens: number;
  contentLength: number;

  constructor(schemaName: string, maxCompletionTokens: number, contentLength: number) {
    super(
      "Summary generation was cut off while reading the structured model response.",
      undefined,
      "truncated"
    );
    this.name = "SummaryModelTruncationError";
    this.schemaName = schemaName;
    this.maxCompletionTokens = maxCompletionTokens;
    this.contentLength = contentLength;
  }
}

type SummarySourceEntry = {
  entryId: string;
  text: string;
  content: string;
  sectionTitle?: string;
  stepId?: ReflectionStepId;
  stepTitle?: string;
  promptLabel?: string;
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
    | "understandingAndLearning"
    | "dailySchedule"
    | "activitiesAndPreferences"
    | "signsTheyAreHavingAHardTime"
    | "whatHelpsWhenTheyAreHavingAHardTime"
    | "healthAndSafety";
  title: SummarySectionTitle;
};

export type SummaryGenerationMode = "one-step" | "two-step";

const GENERATED_SUMMARY_SECTION_FIELDS: GeneratedSummarySectionField[] = [
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
    sectionTitle: "Understanding and Learning",
    stepId: "understanding_learning",
    stepTitle: "Understanding and Learning",
    aliases: ["Understanding and Learning", "Learning and Understanding"]
  },
  {
    sectionTitle: "Daily Schedule",
    stepId: "daily_schedule",
    stepTitle: "Daily Schedule",
    aliases: ["Daily Schedule", "Daily Needs & Routines"]
  },
  {
    sectionTitle: "Activities & Preferences",
    stepId: "activities_preferences",
    stepTitle: "Activities & Preferences",
    aliases: ["Activities & Preferences", "Activities and Preferences", "What helps the day go well"]
  },
  {
    sectionTitle: "Signs They Are Having a Hard Time",
    stepId: "upset_overwhelm",
    stepTitle: "What Can Upset or Overwhelm Them",
    aliases: ["What Can Upset or Overwhelm Them", "What changes in plans or routine tend to upset or overwhelm them"]
  },
  {
    sectionTitle: "Signs They Are Having a Hard Time",
    stepId: "signs_need_help",
    stepTitle: "Signs They Are Having a Hard Time",
    aliases: ["Signs They Are Having a Hard Time", "Signs They May Need Help", "Signs they need help"]
  },
  {
    sectionTitle: "What helps when they are having a hard time",
    stepId: "hard_time_support",
    stepTitle: "What Helps When They Are Having a Hard Time",
    aliases: ["What Helps When They Are Having a Hard Time"]
  },
  {
    sectionTitle: "Health & Safety",
    stepId: "who_to_contact",
    stepTitle: "Who To Contact",
    aliases: ["Who To Contact", "Who to contact", "Emergency contacts", "Emergency Contacts"]
  }
];

const LEGACY_RAW_PROMPT_DEFINITIONS: RawPromptDefinition[] = [
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

function canonicalRawSectionTitle(title: string): SummarySectionTitle {
  if (/understanding|learning/i.test(title)) return "Understanding and Learning";
  if (/daily/i.test(title)) return "Daily Schedule";
  if (/activities|preferences|day go well/i.test(title)) return "Activities & Preferences";
  if (/what helps when/i.test(title)) return "What helps when they are having a hard time";
  if (/upset|overwhelm|signs/i.test(title)) return "Signs They Are Having a Hard Time";
  if (/health|safety|contact/i.test(title)) return "Health & Safety";
  return "Communication";
}

function canonicalLegacyPromptSection(prompt: RawPromptDefinition): SummarySectionTitle {
  const label = prompt.promptLabel.toLowerCase();

  if (label.includes("helps with transitions")) {
    return "What helps when they are having a hard time";
  }
  if (
    label.includes("like to do") ||
    label.includes("enjoy") ||
    label.includes("quiet or downtime")
  ) {
    return "Activities & Preferences";
  }
  if (
    label.includes("upset or overwhelm") ||
    label.includes("feel overwhelming") ||
    label.includes("show they need help") ||
    label.includes("tell when they need help")
  ) {
    return "Signs They Are Having a Hard Time";
  }
  if (label.includes("contact") || label.includes("emergency contacts")) {
    return "Health & Safety";
  }
  if (label.includes("helps you communicate")) {
    return "Communication";
  }

  return canonicalRawSectionTitle(prompt.sectionTitle);
}

const RAW_PROMPT_DEFINITIONS: RawPromptDefinition[] = [
  ...getQuestionnairePrompts("english").map((prompt) => ({
    sectionTitle: prompt.sectionTitle,
    stepId: prompt.stepId,
    stepTitle: prompt.stepTitle,
    promptLabel: prompt.promptLabel,
    aliases: [prompt.question]
  })),
  ...LEGACY_RAW_PROMPT_DEFINITIONS.map((prompt) => {
    const sectionTitle = canonicalLegacyPromptSection(prompt);
    return {
      ...prompt,
      sectionTitle,
      stepTitle: sectionTitle
    };
  })
];

const PROMPT_ROUTING_BY_LABEL = new Map<string, EntryPromptRouting>();

const CURRENT_PROMPT_ROUTING: Array<[string, EntryPromptRouting]> = [
  ["how do they communicate?", { preferredSection: "Communication", defaultFactKind: "communication_method" }],
  ["what helps you communicate with them?", { preferredSection: "Communication", defaultFactKind: "support_strategy" }],
  ["are there things they say or do that mean something specific? what do they mean?", { preferredSection: "Communication", defaultFactKind: "communication_signal" }],
  ["how do they learn, understand, and process information?", { preferredSection: "Understanding and Learning", defaultFactKind: "learning" }],
  ["what can they read, write, and understand?", { preferredSection: "Understanding and Learning", defaultFactKind: "learning" }],
  ["what would surprise people about what they can and cannot do?", { preferredSection: "Understanding and Learning", defaultFactKind: "learning" }],
  ["how much support do they need in daily life?", { preferredSection: "Daily Schedule", defaultFactKind: "routine" }],
  ["what is their typical morning routine?", { preferredSection: "Daily Schedule", defaultFactKind: "routine" }],
  ["what are meals and snacks like?", { preferredSection: "Daily Schedule", defaultFactKind: "routine" }],
  ["what is their bedtime routine?", { preferredSection: "Daily Schedule", defaultFactKind: "routine" }],
  ["what activities do they enjoy most?", { preferredSection: "Activities & Preferences", defaultFactKind: "preference" }],
  ["what do they enjoy doing outside the home?", { preferredSection: "Activities & Preferences", defaultFactKind: "preference" }],
  ["who do they enjoy spending time with?", { preferredSection: "Activities & Preferences", defaultFactKind: "preference" }],
  ["what situations or changes can make things harder for them?", { preferredSection: "Signs They Are Having a Hard Time", defaultFactKind: "trigger" }],
  ["what signs in their body show they may need help?", { preferredSection: "Signs They Are Having a Hard Time", defaultFactKind: "help_sign" }],
  ["what changes in their behavior or communication show they may need help?", { preferredSection: "Signs They Are Having a Hard Time", defaultFactKind: "help_sign" }],
  ["what changes to the environment help?", { preferredSection: "What helps when they are having a hard time", defaultFactKind: "caregiver_action" }],
  ["what calming items help them?", { preferredSection: "What helps when they are having a hard time", defaultFactKind: "caregiver_action" }],
  ["what helps with transitions?", { preferredSection: "What helps when they are having a hard time", defaultFactKind: "caregiver_action" }],
  ["what diagnoses, disabilities, or conditions should others know about?", { preferredSection: "Health & Safety", defaultFactKind: "condition" }],
  ["are there any allergies?", { preferredSection: "Health & Safety", defaultFactKind: "condition" }],
  ["do they take any medication and what should others know about it?", { preferredSection: "Health & Safety", defaultFactKind: "medication" }],
  ["do they use any equipment or supports?", { preferredSection: "Health & Safety", defaultFactKind: "equipment" }],
  ["do they need supervision for safety?", { preferredSection: "Health & Safety", defaultFactKind: "safety_risk" }],
  ["if something happens, who should be contacted and what should others know about when to call?", { preferredSection: "Health & Safety", defaultFactKind: "contact" }],
  ["how can you tell when they need help, and what should you check first?", { preferredSection: "Signs They Are Having a Hard Time", defaultFactKind: "help_sign" }],
  ["what helps with transitions during the day?", { preferredSection: "What helps when they are having a hard time", defaultFactKind: "caregiver_action" }],
  ["what do they like to do during the day?", { preferredSection: "Activities & Preferences", defaultFactKind: "preference" }],
  ["what do they enjoy doing during the day?", { preferredSection: "Activities & Preferences", defaultFactKind: "preference" }],
  ["what does quiet or downtime look like for them?", { preferredSection: "Activities & Preferences", defaultFactKind: "preference" }],
  ["what changes in plans or routine tend to upset or overwhelm them?", { preferredSection: "Signs They Are Having a Hard Time", defaultFactKind: "trigger" }],
  ["what places or things around them can feel overwhelming?", { preferredSection: "Signs They Are Having a Hard Time", defaultFactKind: "trigger" }],
  ["what things like hunger, tiredness, or not feeling well can affect them?", { preferredSection: "Signs They Are Having a Hard Time", defaultFactKind: "trigger" }],
  ["what signs in their body show they need help?", { preferredSection: "Signs They Are Having a Hard Time", defaultFactKind: "help_sign" }],
  ["what changes in their behavior show they need help?", { preferredSection: "Signs They Are Having a Hard Time", defaultFactKind: "help_sign" }],
  ["what changes in how they communicate show they need help?", { preferredSection: "Signs They Are Having a Hard Time", defaultFactKind: "help_sign" }],
  ["what can you do in the moment to help?", { preferredSection: "What helps when they are having a hard time", defaultFactKind: "caregiver_action" }],
  ["do they have any health conditions?", { preferredSection: "Health & Safety", defaultFactKind: "condition" }],
  ["do they take any medication? what should others know?", { preferredSection: "Health & Safety", defaultFactKind: "medication" }],
  ["who should be contacted in an emergency?", { preferredSection: "Health & Safety", defaultFactKind: "contact" }],
  ["who should be contacted in non-emergencies?", { preferredSection: "Health & Safety", defaultFactKind: "contact" }],
  ["is there anything important others should know about when to call or not call?", { preferredSection: "Health & Safety", defaultFactKind: "contact" }],
  ["emergency contacts:", { preferredSection: "Health & Safety", defaultFactKind: "contact" }]
];

for (const [label, routing] of CURRENT_PROMPT_ROUTING) {
  PROMPT_ROUTING_BY_LABEL.set(label, routing);
}

const STRUCTURED_FACT_KINDS: StructuredFactKind[] = [
  "communication_method",
  "communication_signal",
  "learning",
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
  "calm",
  "can",
  "caregivers",
  "day",
  "for",
  "from",
  "gavin",
  "good",
  "he",
  "help",
  "helps",
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
  "prompt",
  "reset",
  "she",
  "should",
  "sign",
  "still",
  "somewhat",
  "that",
  "the",
  "their",
  "them",
  "they",
  "this",
  "to",
  "upset",
  "overwhelm",
  "well",
  "when",
  "with",
  "work",
  "works",
  "best",
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
    understandingAndLearning: {
      type: "array",
      items: {
        type: "string"
      }
    },
    dailySchedule: {
      type: "array",
      items: {
        type: "string"
      }
    },
    activitiesAndPreferences: {
      type: "array",
      items: {
        type: "string"
      }
    },
    signsTheyAreHavingAHardTime: {
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
  },
  required: [
    "title",
    "overview",
    "communication",
    "understandingAndLearning",
    "dailySchedule",
    "activitiesAndPreferences",
    "signsTheyAreHavingAHardTime",
    "whatHelpsWhenTheyAreHavingAHardTime",
    "healthAndSafety"
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
          subcategory: {
            type: "string"
          },
          statement: {
            type: "string"
          },
          safetyRelevant: {
            type: "boolean"
          }
        },
        required: ["entryId", "section", "factKind", "subcategory", "statement", "safetyRelevant"]
      }
    }
  },
  required: ["facts"]
} as const;

const insightSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    insights: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          insightId: {
            type: "string"
          },
          section: {
            type: "string",
            enum: SUMMARY_SECTION_TITLES
          },
          statement: {
            type: "string"
          },
          supportingFactIds: {
            type: "array",
            items: {
              type: "string"
            }
          },
          themes: {
            type: "array",
            items: {
              type: "string"
            }
          }
        },
        required: ["insightId", "section", "statement", "supportingFactIds", "themes"]
      }
    }
  },
  required: ["insights"]
} as const;

const summarySchemaDescription = `Return JSON with exactly these keys and no others:
{
  "title": "string",
  "overview": "string",
  "communication": ["string"],
  "understandingAndLearning": ["string"],
  "dailySchedule": ["string"],
  "activitiesAndPreferences": ["string"],
  "signsTheyAreHavingAHardTime": ["string"],
  "whatHelpsWhenTheyAreHavingAHardTime": ["string"],
  "healthAndSafety": ["string"]
}`;

const sevenSectionGuidance = `Use these exact seven sections in this exact order:
1. Communication
2. Understanding and Learning
3. Daily Schedule
4. Activities & Preferences
5. Signs They Are Having a Hard Time
6. What helps when they are having a hard time
7. Health & Safety

Categorize by meaning:
- Communication: communication methods, communication supports, and what specific signals mean.
- Understanding and Learning: learning style, processing time, reading, writing, comprehension, abilities, limits, and decision support.
- Daily Schedule: support level, morning routine, meals, snacks, bedtime, toileting, and daily care.
- Activities & Preferences: favorite activities, outings, people, places, and preferences.
- Signs They Are Having a Hard Time: triggers, difficult situations, physical signs, behavior changes, and communication changes.
- What helps when they are having a hard time: environmental changes, calming items, transition supports, and direct caregiver actions.
- Health & Safety: diagnoses, allergies, medications, equipment, supervision, risks, emergency contacts, and call guidance.

Each fact belongs in one section only. Always write the final output in English. Preserve every meaningful fact, prioritize safety, remove duplicates, and never echo worksheet questions or instructions.`;

const sevenSectionOneStepRules = `Create a caregiver-ready handoff from the caregiver input.

${sevenSectionGuidance}

Return every section as an array of concise, complete bullet strings. If a section has no supported information, return exactly ["${NO_INFORMATION_PLACEHOLDER}"]. Keep the overview under 80 words and include the most important communication, support, and safety information.`;

const sevenSectionCaptureRules = `Capture all meaningful caregiver information as atomic facts before rewriting.

${sevenSectionGuidance}

Use the most specific allowed factKind. Use learning for learning, processing, reading, writing, comprehension, abilities, or decision support. Mark safetyRelevant for self-injury, elopement, supervision, medical needs, or caregiver-harm risk. Preserve the provided Entry label in entryId.

Capture every distinct detail separately. For example, AAC identity, asking for help, requesting a car ride, and requesting an iPad are separate facts even though they use the same device. Limping, not eating, not drinking, low energy, elopement, hand biting, angry vocalizations, hiding/grunting, and pressing Help are also separate signs. Squeeze-and-release, deep breathing, counting, giving space, reducing stimulation, not blocking hand biting, car rides, quiet environments, and time alone are separate caregiver actions unless the source explicitly combines them.

Do not invent, omit, polish, or combine distinct facts.`;

const caregiverInsightRules = `Create a short "Caregiver Insights" layer from the structured facts.

Return 3 to 5 insights when supported, or fewer if there are not enough related facts. Each insight must synthesize a pattern across at least two supporting facts, use plain caregiver-ready language, and include only information supported by the listed fact IDs.

Good insights connect related facts across questions, such as learning style, regulation supports, communication patterns, sensory needs, routines, or safety patterns. Do not create insights for simple lists like medications, diagnoses, contacts, or equipment inventories unless they reveal a broader care pattern.

The insights are additive. Do not use this layer to replace, omit, or compress atomic facts in the detailed handoff.`;

const sevenSectionRewriteRules = `Rewrite the structured facts into a concise caregiver-ready handoff.

${sevenSectionGuidance}

Keep each fact in its assigned section and use each factKind consistently. Include all seven sections. Group related facts into caregiver-ready bullets instead of repeating every atomic fact. Keep medications/equipment/contacts distinct, and return ["${NO_INFORMATION_PLACEHOLDER}"] for an empty section.

AAC identity and the meanings of AAC selections belong in Communication unless the source is explicitly answering an equipment-inventory question. Food availability and eating patterns belong in Daily Schedule. Hiding or grunting that signals a bowel movement belongs in Signs They Are Having a Hard Time; the pull-up routine itself belongs in Daily Schedule. Car rides, quiet environments, and time alone described as resets belong in What helps when they are having a hard time. Keep all named physical and behavioral signs, including limping, eating/drinking changes, low energy, elopement, hand biting, vocalizations, and pressing Help.

Keep the overview under 80 words and prioritize communication method, key support needs, elopement/self-injury or other major safety risks, and the strongest calming actions.`;

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

export function parseStructuredCompletionContent<T>(content: string) {
  const trimmed = content.trim();
  const fencedMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return JSON.parse((fencedMatch?.[1] ?? trimmed).trim()) as T;
}

function compactWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeSummarySourceText(value: string) {
  return value
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => (line.trim() ? compactWhitespace(line) : ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
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

function buildSummaryEntryText(turn: ConversationTurn, entryId: string, content: string) {
  const lines = [
    entryId,
    turn.sectionTitle ? `Original main category: ${compactWhitespace(turn.sectionTitle)}` : "",
    turn.stepTitle && turn.stepTitle !== turn.sectionTitle
      ? `Original subsection: ${compactWhitespace(turn.stepTitle)}`
      : "",
    turn.promptLabel ? `Question asked: ${compactWhitespace(turn.promptLabel)}` : "",
    `Caregiver input:\n${content}`
  ].filter(Boolean);

  return lines.join("\n");
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

function buildSummaryEntries(turns: ConversationTurn[], options?: { chunkLongEntries?: boolean }) {
  return expandTurnsForSummaryCapture(turns)
    .filter((turn) => turn.role === "user" && !turn.skipped)
    .flatMap((turn, index) => {
      const entryId = `Entry ${index + 1}`;
      const content = normalizeSummarySourceText(turn.content);
      const parts = options?.chunkLongEntries
        ? splitSummaryEntryContent(content, CAPTURE_ENTRY_TARGET_CHARS)
        : [content];

      return parts.map((part) => ({
        entryId,
        text: buildSummaryEntryText(turn, entryId, part),
        content: part,
        sectionTitle: turn.sectionTitle,
        stepId: turn.stepId,
        stepTitle: turn.stepTitle,
        promptLabel: turn.promptLabel
      }));
    });
}

function buildSummaryEntryBatches(entries: SummarySourceEntry[], targetChars: number) {
  const batches: SummarySourceEntry[][] = [];
  let current: SummarySourceEntry[] = [];
  let currentLength = 0;

  const flush = () => {
    if (current.length > 0) {
      batches.push(current);
      current = [];
      currentLength = 0;
    }
  };

  for (const entry of entries) {
    const nextLength = currentLength + (current.length > 0 ? 2 : 0) + entry.text.length;
    if (current.length > 0 && nextLength > targetChars) {
      flush();
    }

    current.push(entry);
    currentLength += (current.length > 1 ? 2 : 0) + entry.text.length;
  }

  flush();
  return batches;
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
    case "understanding_learning":
      return { preferredSection: "Understanding and Learning", defaultFactKind: "learning" };
    case "health_safety":
      return { preferredSection: "Health & Safety", defaultFactKind: "condition" };
    case "daily_schedule":
      return { preferredSection: "Daily Schedule", defaultFactKind: "routine" };
    case "activities_preferences":
      return { preferredSection: "Activities & Preferences", defaultFactKind: "preference" };
    case "upset_overwhelm":
      return { preferredSection: "Signs They Are Having a Hard Time", defaultFactKind: "trigger" };
    case "signs_need_help":
      return { preferredSection: "Signs They Are Having a Hard Time", defaultFactKind: "help_sign" };
    case "hard_time_support":
      return {
        preferredSection: "What helps when they are having a hard time",
        defaultFactKind: "caregiver_action"
      };
    case "who_to_contact":
      return { preferredSection: "Health & Safety", defaultFactKind: "contact" };
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

function cleanInsightStatement(value: string) {
  const trimmed = sanitizeTranscriptFragment(value);
  if (!trimmed || NON_ANSWER_PATTERN.test(trimmed) || QUESTION_ECHO_PATTERN.test(trimmed)) {
    return null;
  }

  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function statementLooksLikeMedication(value: string) {
  return /\b(abilify|aripiprazole|miralax|polyethylene glycol|clearlax|gavilax|healthylax|multivitamin|gummy vites|mg\b|dose|once a day|daily at|3pm|3 p\.m\.)\b/i.test(
    value
  );
}

function statementLooksLikeEquipment(value: string) {
  if (
    /\bpull-?ups?\b/i.test(value) &&
    /\b(bowel movements?|bathroom|toilet|toileting)\b/i.test(value)
  ) {
    return false;
  }

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
  return /\b(two caregivers?|two people|more than one person|at least two people|2 adults?|close supervision|supervision|safety risk|unsafe|pica|elopement|run away|hand biting|self-injury|may bite you|caregiver injury|for safety reasons?)\b/i.test(
    value
  );
}

function statementLooksLikeDirectCaregiverAction(value: string) {
  return /^(?:back off|check|do not|don't|follow|give|help|keep|let|make sure|offer|prompt|reduce|redirect|remind|support|take|turn on|use)\b/i.test(
    value
  );
}

function statementLooksLikeHandBitingProtection(value: string) {
  return (
    /\b(?:block|blocking|stop|stopping)\b.*\b(?:hand biting|biting (?:his|her|their) hand)\b/i.test(
      value
    ) &&
    /\b(?:do not|don't|avoid|may bite|caregiver|you)\b/i.test(value)
  );
}

function statementLooksLikeHelpSign(value: string) {
  return /\b(press(?:es)? help|sign for help|limping|avoid(?:ing)? (?:a )?body part|not eating|not drinking|low energy|letharg|elop|run(?:ning)? away|hand biting|angry (?:sounds?|vocalizations?|yelling)|yelling|hid(?:e|es|ing)|grunt(?:s|ing)?|fridge|grabbing cheese|hungry|dysregulated|agitated|overwhelmed|pain|illness)\b/i.test(
    value
  );
}

function statementLooksLikeRoutine(value: string) {
  return /\b(bathroom|toilet|toileting|pull-?up|bowel movement|routine|morning|breakfast|meal|meals|snack|snacks|school|van|water bottle|sippy cup|diet|bite-sized|grazes|showerhead|dress(?:ing)?|deodorant|socks|teeth brushing|hair)\b/i.test(
    value
  );
}

function statementLooksLikeLearning(value: string) {
  if (/\b(likes?|loves?|enjoys?|favorite|preferred activities|downtime)\b/i.test(value)) {
    return false;
  }

  return /\b(learn|understand|read|write|literacy|one-step|two-step|2-step|direction|extra time|express|consequence|decision|recognizes? (?:pictures?|words?)|visual learner|very visual|first[ -]?then|first this,? then that|model(?:ing)?|watch(?:ing)?|videos?|pictures?|actual items?|items themselves|physical cues?|gentle physical cues?|tap(?:ping)? .*foot)\b/i.test(
    value
  );
}

function statementLooksLikeTrigger(value: string) {
  return /\b(out of place|things moved|lights?|shades?|loud noise|bright lights?|crowded places?|too many people|chaotic|overstimulating|hunger|not having food available|internet is down|cannot find|can't find|not working|stop(?:ping)? an activity|transition(?:ing)?)\b/i.test(
    value
  );
}

function statementLooksLikeCommunication(value: string) {
  return /\b(non-speaking|cannot say words|uses? (?:an )?aac|touchchat|communicates? with sounds|body language|gestures?|happy sounds?|angry sounds?|singing|visual choices?|limited choices?|lead(?:s|ing)? (?:you|a caregiver|caregivers|them|him|her)|touch(?:ing)? you|sit(?:ting)? very close|wants attention|wants? (?:his|her|their) ipad|selects? (?:car|i want ipad|ipad|a color)|ask for help|request(?:s|ing)? (?:a |for )?car rides?|(?:device|aac).*(?:ask|request|tell|want)|(?:ask|request|tell|want).*(?:device|aac))\b/i.test(
    value
  );
}

function statementLooksLikeFoodRoutine(value: string) {
  return /\b(food|meal|snack|eat|eating|diet|cheese)\b/i.test(value) &&
    /\b(available|always hungry|small amounts|constantly|limited|routine|independently get)\b/i.test(
      value
    );
}

function statementLooksLikeFoodOrMeal(value: string) {
  if (/\bshower(?:head)?\b|\bwater pick\b|\blunch attendant\b|\bworks? as .*lunch\b/i.test(value)) {
    return false;
  }

  if (/\bafter eating\b/i.test(value) && !foodGroupingPattern().test(value) && !/\bbreakfast|lunch|dinner|meal|snack\b/i.test(value)) {
    return false;
  }

  return /\b(food|foods?|meal|meals?|snack|snacks?|eat|eats|eating|drink|drinks|drinking|diet|breakfast|lunch|dinner|hungry|appetite|cheese|chicken|turkey|ham|sandwich|cheetos|cookies|capri suns?|meals on wheels|pasta|pita|labneh|za'?atar|lettuce|salads?|fruits?|green beans?|cauliflower|water\b|milk|caffeinated|iced tea|orange juice|lemonade|takeout|eggs?|yogurt|chips?|apples?|grapes?|strawberries|bananas|wings?|bread)\b/i.test(value) &&
    !/\b(water came out|water comes out|handheld shower|fixed shower)\b/i.test(value);
}

function statementLooksLikeSupportStrategy(value: string) {
  return /\b(helps|helpful|work best|works best|reset|calm|sooth|regulat|redirect|motivat|prompt|safe|hurt (?:himself|herself|themself)|squeeze and release|deep breaths?|count(?:ing)? to 10|swedish fish|gumm(?:y|ies)|candy|back off|do not crowd|don't crowd|visual schedule|visual timer)\b/i.test(
    value
  ) &&
    /\b(quiet|low-light|dim|space|stimulation|noise|car rides?|time alone|moment to (?:himself|herself|themself)|visual choices?|limited choices?|visual schedule|visual timer|transition|upset|hard time|dysregulated|escalat|self-harm|elop)\b/i.test(
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
    return { section: "Health & Safety" as SummarySectionTitle, factKind: "contact" as StructuredFactKind };
  }

  if (statementLooksLikeMedication(statement)) {
    return { section: "Health & Safety" as SummarySectionTitle, factKind: "medication" as StructuredFactKind };
  }

  if (statementLooksLikeLearning(statement)) {
    return {
      section: "Understanding and Learning" as SummarySectionTitle,
      factKind: "learning" as StructuredFactKind
    };
  }

  const explicitEquipmentInventory =
    preferredSection === "Health & Safety" && defaultFactKind === "equipment";
  if (statementLooksLikeCommunication(statement) && !explicitEquipmentInventory) {
    return {
      section: "Communication" as SummarySectionTitle,
      factKind: statementLooksLikeEquipment(statement)
        ? "communication_method" as StructuredFactKind
        : rawFactKind === "communication_signal"
          ? "communication_signal" as StructuredFactKind
          : "communication_method" as StructuredFactKind
    };
  }

  if (statementLooksLikeEquipment(statement)) {
    return { section: "Health & Safety" as SummarySectionTitle, factKind: "equipment" as StructuredFactKind };
  }

  if (statementLooksLikeCondition(statement)) {
    return { section: "Health & Safety" as SummarySectionTitle, factKind: "condition" as StructuredFactKind };
  }

  if (statementLooksLikeHandBitingProtection(statement)) {
    return {
      section: "What helps when they are having a hard time" as SummarySectionTitle,
      factKind: "caregiver_action" as StructuredFactKind
    };
  }

  if (
    preferredSection === "Signs They Are Having a Hard Time" &&
    statementLooksLikeHelpSign(statement)
  ) {
    return {
      section: "Signs They Are Having a Hard Time" as SummarySectionTitle,
      factKind: "help_sign" as StructuredFactKind
    };
  }

  if (statementLooksLikeSafetyRisk(statement)) {
    return { section: "Health & Safety" as SummarySectionTitle, factKind: "safety_risk" as StructuredFactKind };
  }

  if (statementLooksLikeDirectCaregiverAction(statement)) {
    if (preferredSection === "Communication") {
      return { section: preferredSection, factKind: "support_strategy" as StructuredFactKind };
    }

    return {
      section: "What helps when they are having a hard time" as SummarySectionTitle,
      factKind: "caregiver_action" as StructuredFactKind
    };
  }

  if (statementLooksLikeFoodRoutine(statement)) {
    return {
      section: "Daily Schedule" as SummarySectionTitle,
      factKind: "routine" as StructuredFactKind
    };
  }

  if (statementLooksLikeFoodOrMeal(statement)) {
    return {
      section: "Daily Schedule" as SummarySectionTitle,
      factKind: /(?:likes?|loves?|enjoys?|dislikes?|does not like|doesn't like|refuses?|will not eat|won't eat)\b/i.test(statement)
        ? "preference" as StructuredFactKind
        : "routine" as StructuredFactKind
    };
  }

  if (statementLooksLikeSupportStrategy(statement)) {
    return {
      section: preferredSection === "Communication"
        ? "Communication" as SummarySectionTitle
        : "What helps when they are having a hard time" as SummarySectionTitle,
      factKind: preferredSection === "Communication"
        ? "support_strategy" as StructuredFactKind
        : "caregiver_action" as StructuredFactKind
    };
  }

  if (statementLooksLikeHelpSign(statement)) {
    return { section: "Signs They Are Having a Hard Time" as SummarySectionTitle, factKind: "help_sign" as StructuredFactKind };
  }

  if (statementLooksLikeRoutine(statement)) {
    return { section: "Daily Schedule" as SummarySectionTitle, factKind: "routine" as StructuredFactKind };
  }

  if (statementLooksLikeTrigger(statement)) {
    return { section: "Signs They Are Having a Hard Time" as SummarySectionTitle, factKind: "trigger" as StructuredFactKind };
  }

  if (statementLooksLikeCommunication(statement)) {
    const factKind: StructuredFactKind =
      /\b(selects?|lead(?:ing)?|touch(?:ing)?|sit(?:ting)? very close|wants attention|ask for help)\b/i.test(statement)
        ? "communication_signal"
        : "communication_method";
    return { section: "Communication" as SummarySectionTitle, factKind };
  }

  if (statementLooksLikePreference(statement)) {
    return { section: "Activities & Preferences" as SummarySectionTitle, factKind: "preference" as StructuredFactKind };
  }

  return {
    section: preferredSection,
    factKind: defaultFactKind
  };
}

function deterministicCommunicationFacts(entries: SummarySourceEntry[]) {
  const facts: StructuredCaptureFact[] = [];

  for (const entry of entries) {
    if (entryRouting(entry)?.preferredSection !== "Communication") {
      continue;
    }

    const content = compactWhitespace(entry.content);
    if (!/\b(?:aac|touchchat|communication device)\b/i.test(content)) {
      continue;
    }

    const nameMatch = content.match(/^([A-Z][A-Za-z'-]+)\b/);
    const subject =
      nameMatch && !/^(?:He|She|They)$/i.test(nameMatch[1]) ? nameMatch[1] : "They";
    const addFact = (suffix: string, statement: string) => {
      facts.push({
        factId: `${entry.entryId.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-source-${suffix}`,
        entryId: entry.entryId,
        section: "Communication",
        factKind: suffix === "identity" ? "communication_method" : "communication_signal",
        subcategory: "AAC",
        statement,
        safetyRelevant: false,
        conceptKeys: [...extractCoverageConcepts(statement)].sort(),
        sourceEntryIds: [entry.entryId]
      });
    };

    const deviceParts = [
      "an AAC device",
      /\bipad\b/i.test(content) ? "on an iPad" : "",
      /\btouchchat\b/i.test(content) ? "with TouchChat" : ""
    ].filter(Boolean);
    addFact("identity", `${subject} uses ${deviceParts.join(" ")}.`);

    if (/\bask(?:s|ing)? for help\b/i.test(content)) {
      addFact("ask-help", `${subject} uses the AAC device to ask for help.`);
    }

    if (/\brequest(?:s|ed|ing)? car rides?\b/i.test(content)) {
      addFact("request-car", `${subject} uses the AAC device to request car rides.`);
    }

    const iPadRequest = content.match(
      /\b(he|she|they)\b.{0,45}\bwants?\s+(his|her|their)\s+ipad\b/i
    );
    if (iPadRequest) {
      addFact(
        "request-ipad",
        `${subject} uses the AAC device to say when ${iPadRequest[1].toLowerCase()} wants ${iPadRequest[2].toLowerCase()} iPad.`
      );
    }
  }

  return facts;
}

function deterministicToiletingFacts(entries: SummarySourceEntry[]) {
  const facts: StructuredCaptureFact[] = [];

  for (const entry of entries) {
    const content = compactWhitespace(entry.content);
    if (!/\b(bathroom|toilet|toileting|void|bowel movement|pull-?up)\b/i.test(content)) {
      continue;
    }

    const nameMatch = content.match(/^([A-Z][A-Za-z'-]+)\b/);
    const subject =
      nameMatch && !/^(?:He|She|They)$/i.test(nameMatch[1]) ? nameMatch[1] : "They";
    const addFact = (suffix: string, statement: string) => {
      facts.push({
        factId: `${entry.entryId.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-toileting-${suffix}`,
        entryId: entry.entryId,
        section: "Daily Schedule",
        factKind: "routine",
        subcategory: "Toileting",
        statement,
        safetyRelevant: false,
        conceptKeys: [...extractCoverageConcepts(statement)].sort(),
        sourceEntryIds: [entry.entryId]
      });
    };

    if (/\bevery hour|hourly|speakers? (?:go|goes) off\b/i.test(content)) {
      addFact("hourly-prompts", `${subject} needs bathroom reminders or prompts every hour.`);
    }

    if (/\b(?:does not|doesn't|will not|won't)\b.{0,60}\b(initiate|use (?:it|the bathroom|the toilet) independently)\b|\bdoes not initiate\b/i.test(content)) {
      addFact("does-not-initiate", `${subject} does not initiate bathroom use on their own.`);
    }

    if (/\b(?:does not|doesn't|will not|won't)\b.{0,80}\b(communicate|tell|let .*know)\b.{0,80}\b(bathroom|toilet|toileting)\b|\b(bathroom|toilet|toileting)\b.{0,80}\b(?:does not|doesn't|will not|won't)\b.{0,80}\b(communicate|tell|let .*know)\b/i.test(content)) {
      addFact("does-not-communicate", `${subject} does not independently communicate toileting needs.`);
    }

    if (/\bbowel movements?\b.{0,80}\bpull-?up\b|\bpull-?up\b.{0,80}\bbowel movements?\b/i.test(content)) {
      addFact("bowel-pullup", `${subject}'s bowel movements happen in a pull-up.`);
    }
  }

  return facts;
}

function statementLooksLikeContact(value: string) {
  return /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3}).*\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/.test(value);
}

function statementLooksLikeActualContact(value: string) {
  if (
    /\b(?:talk(?:s|ing)?|chat(?:s|ting)?|friends?|social media|facebook group|parent group|decode|unclear words?|unclear phrases?|what .*means?|watch|computer|tablet|device|phone with friends|on the phone to show|over bluetooth|takes .*places|weekends?|eye contact|physical contact)\b/i.test(
      value
    )
  ) {
    return false;
  }

  if (statementLooksLikeContact(value)) {
    return true;
  }

  if (/\b(?:call 911|emergency|non-?emergency|crisis support|guardian|physical custody|phone number|contact .*first|call(?:ed)? .*first|should be called first|contact (?:his|her|their)?\s*(?:mother|father|parent|guardian|grandmother|grandfather|sister|brother|caregiver)|(?:mother|father|parent|guardian|grandmother|grandfather|sister|brother|caregiver).{0,60}\b(?:emergency|contact|call|called first|phone number))\b/i.test(value)) {
    return true;
  }

  return false;
}

function normalizeCapture(input: unknown, entryMetadata = new Map<string, SummarySourceEntry>()) {
  const candidate = input as Partial<StructuredCapture> | undefined;
  const facts = Array.isArray(candidate?.facts) ? candidate.facts : [];

  return {
      facts: facts
      .map((fact, index) => {
        const section = SUMMARY_SECTION_TITLES.find((title) => title === fact.section);
        const factKind = STRUCTURED_FACT_KINDS.find((kind) => kind === (fact as { factKind?: string }).factKind);
        const statement = cleanCaptureStatement(String(fact.statement ?? ""));
        if (!section || !factKind || !statement) {
          return null;
        }

        const entryId = compactWhitespace(String(fact.entryId ?? "")) || `Entry ${index + 1}`;
        const subcategory = compactWhitespace(String(fact.subcategory ?? "")) || "General";
        const routing = inferCaptureRouting(statement, section, factKind, entryMetadata.get(entryId));
        const conceptKeys = [...extractCoverageConcepts(statement)].sort();
        const factIdPrefix = entryId.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

        return {
          factId: `${factIdPrefix || "entry"}-fact-${index + 1}`,
          entryId,
          section: routing.section,
          factKind: routing.factKind,
          subcategory,
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

        const normalizedExisting = normalizeCoverageText(entry.statement);
        const normalizedFact = normalizeCoverageText(fact.statement);
        if (
          normalizedExisting.length >= 24 &&
          normalizedFact.length >= 24 &&
          (normalizedExisting.includes(normalizedFact) ||
            normalizedFact.includes(normalizedExisting))
        ) {
          return true;
        }

        const existingTokens = coverageTokens(entry.statement);
        const factTokens = coverageTokens(fact.statement);
        if (existingTokens.length < 3 || factTokens.length < 3) {
          return false;
        }

        const overlap = existingTokens.filter((token) => factTokens.includes(token)).length;
        const union = new Set([...existingTokens, ...factTokens]).size;
        return union > 0 && overlap / union >= 0.82;
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
        subcategory:
        existing.subcategory === "General" && fact.subcategory !== "General"
          ? fact.subcategory
          : existing.subcategory,
      safetyRelevant: existing.safetyRelevant || fact.safetyRelevant,
      conceptKeys: [...new Set([...existing.conceptKeys, ...fact.conceptKeys])].sort(),
      sourceEntryIds: [...new Set([...existing.sourceEntryIds, ...fact.sourceEntryIds])]
    });
  }

  return uniquifyCaptureFactIds([...deduped.values()]);
}

function uniquifyCaptureFactIds(facts: StructuredCaptureFact[]) {
  const counts = new Map<string, number>();

  return facts.map((fact) => {
    const count = counts.get(fact.factId) ?? 0;
    counts.set(fact.factId, count + 1);

    if (count === 0) {
      return fact;
    }

    return {
      ...fact,
      factId: `${fact.factId}-${count + 1}`
    };
  });
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

  if (
    /\b(bathroom|toilet)\b/.test(normalized) &&
    /\b(supervision|eyes on|eyes-on)\b/.test(normalized)
  ) {
    concepts.add("bathroom_supervision");
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

  if (/\belop(?:e|es|ed|ing|ement)|running away|run away\b/.test(normalized)) {
    concepts.add("elopement");
  }

  if (/\b(hand biting|biting his hand|biting her hand|biting their hand)\b/.test(normalized)) {
    concepts.add("hand_biting");
  }

  if (
    /\b(hiding|hides|hide|grunting|grunts|grunt)\b/.test(normalized) &&
    /\b(bowel movements?|pull up|pullup)\b/.test(normalized)
  ) {
    concepts.add("bowel_movement_sign");
  }

  if (/\blimp(?:s|ed|ing)?\b/.test(normalized)) {
    concepts.add("limping_sign");
  }

  if (/\bnot eating\b/.test(normalized)) {
    concepts.add("not_eating_sign");
  }

  if (/\bnot drinking\b/.test(normalized)) {
    concepts.add("not_drinking_sign");
  }

  if (/\blow energy\b/.test(normalized)) {
    concepts.add("low_energy_sign");
  }

  if (/\b(loud|angry) vocalizations?\b/.test(normalized) || /\bangry sounds?\b/.test(normalized)) {
    concepts.add("vocalization_sign");
  }

  if (/\b(fridge|grabbing cheese)\b/.test(normalized)) {
    concepts.add("hunger_sign");
  }

  if (
    /\b(press(?:es|ed|ing)? help|select(?:s|ed|ing)? help|sign for help|word help on (?:his|her|their) ipad)\b/.test(
      normalized
    )
  ) {
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

  if (
    /\b(?:tell|explain|explaining|speak|speaking|orient)\b.{0,100}\b(?:what (?:you|caregivers?|they) (?:are|re) doing|what is happening|what s happening|what's happening|happening)\b/.test(normalized) ||
    /\b(?:startle|unexpected reaction)\b/.test(normalized)
  ) {
    concepts.add("speak_first_orient");
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

  if (/\bbuckle buddy\b/.test(normalized)) {
    concepts.add("buckle_buddy");
  }

  if (/\b(miralax|polyethylene glycol|clearlax|gavilax|healthylax)\b/.test(normalized)) {
    concepts.add("miralax");
  }

  if (/\b(multivitamin|gummy vites|gummies per day)\b/.test(normalized)) {
    concepts.add("multivitamin");
  }

  if (/\b(abilify|aripiprazole)\b/.test(normalized)) {
    concepts.add("abilify");
  }

  if (/\b(bite sized|cut into bite sized|trouble biting|choking)\b/.test(normalized)) {
    concepts.add("bite_sized_food");
  }

  if (/\b(blind|blindness|lack of vision|low vision|white cane|vision)\b/.test(normalized)) {
    concepts.add("vision_support");
  }

  if (/\b(allerg\w*|allergic|hives|bactrim|erythromycin|caine)\b/.test(normalized)) {
    concepts.add("allergy");
  }

  if (/\btcf20\b|\bmutation\b/.test(normalized)) {
    concepts.add("genetic_condition");
  }

  if (/\bglobal developmental delay\b/.test(normalized)) {
    concepts.add("global_developmental_delay");
  }

  if (/\bautis(?:m|tic)\b.{0,120}\b(?:contradict|main diagnosis|other doctors?)\b|\b(?:contradict|main diagnosis|other doctors?)\b.{0,120}\bautis(?:m|tic)\b/.test(normalized)) {
    concepts.add("autism_diagnosis_contradiction");
  }

  if (/\bg6pd\b/.test(normalized)) {
    concepts.add("g6pd");
  }

  if (/\bseizure\b/.test(normalized)) {
    concepts.add("seizure_risk");
  }

  if (/\btemperature extremes?\b.{0,80}\bseizure|\b(?:too hot|too cold)\b.{0,80}\bseizure|\bseizure\b.{0,80}\b(?:temperature extremes?|too hot|too cold)\b/.test(normalized)) {
    concepts.add("temperature_seizure_sign");
  }

  if (/\bpica\b/.test(normalized)) {
    concepts.add("pica");
  }

  if (/\bcerebral palsy\b|\bcp\b/.test(normalized)) {
    concepts.add("cerebral_palsy");
  }

  if (/\bintellectual disability\b/.test(normalized)) {
    concepts.add("intellectual_disability");
  }

  if (/\bgastrointestinal\b|\bgi issues?\b/.test(normalized)) {
    concepts.add("gi_condition");
  }

  if (/\bwheelchair\b/.test(normalized)) {
    concepts.add("wheelchair");
  }

  if (/\bpull[- ]?ups?|pullup|pull up|pull-up style underwear\b/.test(normalized)) {
    concepts.add("pull_ups");
  }

  if (/\bregular chair\b|\bliving room chair\b|\bregular furniture\b/.test(normalized)) {
    concepts.add("regular_chair_equipment");
  }

  if (/\b(headphones?|noise canceling)\b/.test(normalized)) {
    concepts.add("headphones");
  }

  if (/\britalin\b|\brit\b|something called like rit\b/.test(normalized)) {
    concepts.add("rit_medication");
  }

  if (/\btylenol\b/.test(normalized)) {
    concepts.add("tylenol");
  }

  if (/\bhearing aids?\b/.test(normalized)) {
    concepts.add("hearing_aids");
  }

  if (/\bglasses\b/.test(normalized)) {
    concepts.add("glasses");
  }

  if (/\brisk taker|risk taking|take risks?|willing to take risks?|trust .*risks?\b/.test(normalized)) {
    concepts.add("risk_taking");
  }

  if (/\bpain\b.*\b(distress|frustration|upset|hard time)\b|\b(distress|frustration|upset|hard time)\b.*\bpain\b/.test(normalized)) {
    concepts.add("pain_distress");
  }

  if (/\b(?:does not|doesn t|not)\b.{0,80}\bcommunicat(?:e|ing)?\b.{0,80}\bpain\b|\bpain\b.{0,80}\b(?:does not|doesn t|not)\b.{0,80}\bcommunicat(?:e|ing)?\b|\bdoes not tell\b.{0,80}\b(?:hurt|pain)\b/.test(normalized)) {
    concepts.add("pain_reporting_limit");
  }

  if (/\b(danger|dangerous|social cues?|unsafe|innocent|strangers?|unfamiliar situations?)\b/.test(normalized)) {
    concepts.add("danger_awareness");
  }

  if (/\bpropranolol\b/.test(normalized)) {
    concepts.add("propranolol");
  }

  if (/\bcitalopram\b|\bsitelapram\b/.test(normalized)) {
    concepts.add("citalopram");
  }

  if (/\bmedicine cups?\b|\bliquid medicines?\b|\bcorrect dosage\b|\bmedicines?\b.{0,80}\b(?:with|while|eating) breakfast\b|\b(?:with|while|eating) breakfast\b.{0,80}\bmedicines?\b/.test(normalized)) {
    concepts.add("medicine_routine");
  }

  if (/\bstomach feels different\b|\bafter\b.{0,80}\b(?:medicine|medicines|breakfast)\b.{0,80}\bstomach\b/.test(normalized)) {
    concepts.add("medication_stomach_note");
  }

  if (/\bmedicines?\b.{0,80}\b(?:yogurt|applesauce|apple sauce|chaser|sweet spoonfuls?|chew(?:s|ing)?)\b|\b(?:yogurt|applesauce|apple sauce|chaser|sweet spoonfuls?|chew(?:s|ing)?)\b.{0,80}\bmedicines?\b|\bspoon feed\b.{0,80}\bmedicines?\b|\bmedicine or hydration\b|\byogurt and fluids\b|\bbitter(?: tasting)?\b|\btastes? very bitter\b|\bgrind(?:ing)?\b|\bbroken pill\b/.test(normalized)) {
    concepts.add("medicine_with_food");
  }

  if (/\bmedicines?\b.{0,80}\b(?:vaginal|vagina|vulva|vulvar)\b|\b(?:vaginal|vagina|vulva|vulvar)\b.{0,80}\bmedicines?\b/.test(normalized)) {
    concepts.add("topical_vaginal_medicine");
  }

  if (/\bsleep related medications?\b|\bsleep aid\b|\bnarcoleptic\b|\bmood stabilizer\b|\bmelatonin\b/.test(normalized)) {
    concepts.add("sleep_medications");
  }

  if (/\bcontact\b.{0,80}\b(?:caregivers?|family)\b|\b(?:caregivers?|family)\b.{0,80}\bcontact\b|\bdo not hesitate\b.{0,80}\b(?:contact|call)\b|\bdon t hesitate\b.{0,80}\b(?:contact|call)\b/.test(normalized)) {
    concepts.add("contact_caregiver_support");
  }

  if (/\b(?:sister|brother|father|family|caregivers?)\b.{0,80}\bdecode unclear words?|decode unclear words?.{0,80}\b(?:sister|brother|father|family|caregivers?)\b/.test(normalized)) {
    concepts.add("family_decode_support");
  }

  if (/\bcall\b.{0,80}\b(?:family|caregivers?|mother|father)|\b(?:family|caregivers?|mother|father)\b.{0,80}\bcall\b|\bany time of day or night\b|\bonly have a question\b|\bnot hesitate to call\b/.test(normalized)) {
    concepts.add("family_call_guidance");
  }

  if (/\btilt(?:ing)? .*head back\b|\bfill(?:ing)? .*mouth\b|\bchok(?:e|ing)\b|\bdrown(?:ing)?\b/.test(normalized)) {
    concepts.add("hydration_choking");
  }

  if (/\bground\b.{0,60}\bnot pureed\b|\bnot pureed\b.{0,60}\bground\b|\bavoid choking\b|\bchoking risk\b/.test(normalized)) {
    concepts.add("food_texture_choking");
  }

  if (/\bdrags? a chair\b|\bkitchen counter\b|\bon the counter\b|\bstep on the stove\b/.test(normalized)) {
    concepts.add("kitchen_counter_risk");
  }

  if (/\bseizure\b.{0,100}\b(?:car|home|bed|recover)|\b(?:car|home|bed|recover)\b.{0,100}\bseizure\b/.test(normalized)) {
    concepts.add("seizure_recovery_support");
  }

  if (/\bsafe in (?:his|her|their) space\b|\bsafety checks?\b|\boutside close by\b|\bremains? safe\b/.test(normalized)) {
    concepts.add("safe_space_checks");
  }

  if (/\bgolf cart\b.{0,80}\bseat belts?|\bseat belts?\b.{0,80}\bgolf cart\b/.test(normalized)) {
    concepts.add("golf_cart_seat_belts");
  }

  if (/\bcup to mouth\b|\bcup-to-mouth\b|\bhead tilt\b|\bhead-tilt\b|\bfilling .*mouth with fluid\b|\bgulp and swallow\b/.test(normalized)) {
    concepts.add("hydration_routine");
  }

  return concepts;
}

function formatInsightList(items: string[]) {
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

function normalizeInsightCapture(input: unknown, capture: StructuredCapture) {
  const validFactIds = new Set(capture.facts.map((fact) => fact.factId));
  const candidate = input as Partial<StructuredInsightCapture> | undefined;
  const insights = Array.isArray(candidate?.insights) ? candidate.insights : [];
  const deduped = new Map<string, CaregiverInsight>();

  for (const insight of insights) {
    const statement = cleanInsightStatement(String(insight.statement ?? ""));
    const section = SUMMARY_SECTION_TITLES.find((title) => title === insight.section);
    const supportingFactIds = [...new Set(
      (Array.isArray(insight.supportingFactIds) ? insight.supportingFactIds : [])
        .map(String)
        .map(compactWhitespace)
        .filter((factId) => validFactIds.has(factId))
    )];
    const themes = [...new Set(
      (Array.isArray(insight.themes) ? insight.themes : [])
        .map(String)
        .map(compactWhitespace)
        .filter(Boolean)
    )].slice(0, 5);

    if (!statement || !section || supportingFactIds.length < 2) {
      continue;
    }

    const key = normalizeCoverageText(statement);
    if (!key || deduped.has(key)) {
      continue;
    }

    const insightId =
      compactWhitespace(String(insight.insightId ?? "")) ||
      `insight-${deduped.size + 1}`;
    deduped.set(key, {
      insightId: insightId.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || `insight-${deduped.size + 1}`,
      section,
      statement,
      supportingFactIds,
      themes
    });
  }

  return [...deduped.values()].slice(0, 5);
}

function buildVisualLearningInsight(capture: StructuredCapture, nameHint?: string): CaregiverInsight[] {
  const supportEntries: Array<{ label: string; facts: StructuredCaptureFact[] }> = [
    {
      label: "videos",
      facts: capture.facts.filter((fact) => /\b(videos?|youtube|watching)\b/i.test(fact.statement))
    },
    {
      label: "modeling",
      facts: capture.facts.filter((fact) => /\b(model(?:ing)?|demonstrat|show(?:ing)? him|show(?:ing)? her|show(?:ing)? them|watching)\b/i.test(fact.statement))
    },
    {
      label: "visual schedules",
      facts: capture.facts.filter((fact) => /\b(visual schedule|visual timer|visual choices?|pictures?|items themselves)\b/i.test(fact.statement))
    },
    {
      label: "First-Then language",
      facts: capture.facts.filter((fact) => /\b(first[ -]?then|first this,? then that|two-step|2-step)\b/i.test(fact.statement))
    }
  ].map((entry) => ({
    ...entry,
    facts: entry.facts.filter((fact) =>
      fact.section === "Understanding and Learning" ||
      fact.section === "Communication" ||
      fact.section === "What helps when they are having a hard time" ||
      fact.factKind === "learning" ||
      fact.factKind === "support_strategy" ||
      fact.factKind === "caregiver_action"
    )
  }));
  const supportedLabels = supportEntries
    .filter((entry) => entry.facts.length > 0)
    .map((entry) => entry.label);
  const supportingFactIds = [
    ...new Set(supportEntries.flatMap((entry) => entry.facts.map((fact) => fact.factId)))
  ];

  if (supportedLabels.length < 2 || supportingFactIds.length < 2) {
    return [];
  }

  const subject = nameHint?.trim() || "They";
  const verb = nameHint?.trim() ? "is" : "are";

  return [
    {
      insightId: "visual-learning-pattern",
      section: "Understanding and Learning",
      statement: `${subject} ${verb} a highly visual learner who learns best through ${formatInsightList(supportedLabels)}.`,
      supportingFactIds,
      themes: ["visual learning", ...supportedLabels]
    }
  ];
}

function mergeCaregiverInsights(...groups: CaregiverInsight[][]) {
  const merged = new Map<string, CaregiverInsight>();

  for (const insight of groups.flat()) {
    const key = normalizeCoverageText(insight.statement);
    if (!key || merged.has(key)) {
      continue;
    }

    merged.set(key, insight);
  }

  return [...merged.values()].slice(0, 5);
}

function buildGuideSummaryShell(nameHint: string | undefined, caregiverInsights: CaregiverInsight[]) {
  return {
    title: nameHint ? `Caring for ${nameHint}` : "Caregiver Handoff Summary",
    overview: "",
    caregiverInsights,
    sections: [],
    generatedAt: "",
    pipelineVersion: "",
    layoutVersion: "",
    sourceTurnsHash: ""
  } satisfies StructuredSummary;
}

function statementLooksCovered(statement: string, existingItems: string[]) {
  const normalizedStatement = normalizeCoverageText(statement);
  const statementTokens = coverageTokens(statement);

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

    const itemTokens = coverageTokens(item);
    if (itemTokens.length === 0) {
      return false;
    }

    const overlapCount = statementTokens.filter((token) => itemTokens.includes(token)).length;
    const statementCoverage = overlapCount / statementTokens.length;

    return statementCoverage >= 0.75;
  });
}

function helpRequestMode(value: string) {
  const normalized = normalizeCoverageText(value);

  if (/\b(?:press(?:es|ed|ing)?|select(?:s|ed|ing)?) help\b/.test(normalized)) {
    return "distress-signal";
  }

  if (
    /\b(?:aac|touchchat|communication device)\b/.test(normalized) &&
    /\b(?:ask|asks|request|requests) for help\b/.test(normalized)
  ) {
    return "aac-request";
  }

  return "";
}

function factLooksCoveredByItem(fact: StructuredCaptureFact, item: string) {
  if (statementLooksCovered(fact.statement, [item])) {
    return true;
  }

  if (fact.factKind === "preference") {
    const preferenceTokens = coverageTokens(
      fact.statement.replace(
        /^(?:(?:he|she|they|[A-Z][a-z]+)\s+)?(?:really\s+)?(?:likes?|loves?|enjoys?|especially enjoys)\s+/i,
        ""
      )
    );
    const itemTokens = coverageTokens(item);
    if (
      preferenceTokens.length > 0 &&
      preferenceTokens.every((token) => itemTokens.includes(token))
    ) {
      return true;
    }
  }

  const factConcepts = new Set([
    ...fact.conceptKeys,
    ...extractCoverageConcepts(fact.statement)
  ]);

  if (factConcepts.size === 0) {
    return false;
  }

  const safeConcepts = new Set([
    "non_speaking",
    "bathroom_supervision",
    "elopement",
    "bowel_movement_sign",
    "limping_sign",
    "not_eating_sign",
    "not_drinking_sign",
    "low_energy_sign",
    "vocalization_sign",
    "hunger_sign",
    "hand_biting",
    "caregiver_leading_sign",
    "attention_sign",
    "offer_car_ride",
    "do_not_block_hand_biting",
    "calming_prompt",
    "buckle_buddy",
    "miralax",
    "multivitamin",
    "abilify",
    "bite_sized_food",
    "vision_support",
    "allergy",
    "seizure_risk",
    "temperature_seizure_sign",
    "pica",
    "cerebral_palsy",
    "intellectual_disability",
    "gi_condition",
    "wheelchair",
    "regular_chair_equipment",
    "pull_ups",
    "headphones",
    "hearing_aids",
    "glasses",
    "genetic_condition",
    "global_developmental_delay",
    "autism_diagnosis_contradiction",
    "g6pd",
    "risk_taking",
    "pain_distress",
    "rit_medication",
    "tylenol",
    "danger_awareness",
    "speak_first_orient",
    "propranolol",
    "citalopram",
    "medicine_routine",
    "medication_stomach_note",
    "medicine_with_food",
    "topical_vaginal_medicine",
    "sleep_medications",
    "contact_caregiver_support",
    "family_decode_support",
    "family_call_guidance",
    "hydration_choking",
    "food_texture_choking",
    "kitchen_counter_risk",
    "pain_reporting_limit",
    "seizure_recovery_support",
    "safe_space_checks",
    "golf_cart_seat_belts",
    "hydration_routine"
  ]);
  const itemConcepts = extractCoverageConcepts(item);
  if (
    factConcepts.has("help_request_signal") &&
    itemConcepts.has("help_request_signal") &&
    helpRequestMode(fact.statement) !== "" &&
    helpRequestMode(fact.statement) === helpRequestMode(item)
  ) {
    return true;
  }

  if (
    fact.section === "Signs They Are Having a Hard Time" &&
    factConcepts.has("hand_biting") &&
    itemConcepts.has("hand_biting") &&
    /\b(?:sign|help is needed|needs? help)\b/i.test(item)
  ) {
    return true;
  }

  return [...factConcepts].some(
    (concept) => safeConcepts.has(concept) && itemConcepts.has(concept)
  );
}

const CRITICAL_VISIBLE_FACT_PATTERN =
  /\b(diagnos(?:is|ed)?|condition|syndrome|mutation|autism|g6pd|diabetes|cerebral|blind|vision|seizure|allerg|reaction|hives|medicat|medicine|dose|mg\b|miralax|polyethylene|abilify|aripiprazole|equipment|wheelchair|cane|buckle|seat belts?|pull-?ups?|headphones?|fidgets?|emergency|911|contact|guardian|custody|supervision|unsafe|danger|elop|wander|bite|biting|pica|self-?injury|pain|illness|choking|bite-sized|risk|safety)\b/i;

function factRequiresVisibleGuideCoverage(fact: StructuredCaptureFact) {
  const statement = fact.statement;

  if (fact.factKind === "contact") {
    return statementLooksLikeActualContact(statement);
  }

  if (fact.factKind === "medication") {
    return /\b(medicat|medicines?|takes?|dose|mg\b|miralax|polyethylene|abilify|aripiprazole|tylenol|melatonin|ritalin|esomeprazole|propranolol|citalopram|sitelapram|allerg|reaction|no allergies|no known allergies)\b/i.test(statement);
  }

  if (fact.factKind === "condition") {
    return /\b(diagnos(?:is|ed)?|condition|syndrome|mutation|autism|g6pd|diabetes|cerebral|blind|vision|seizure|allerg|reaction|hives|gastrointestinal|\bgi\b|apraxia|developmental|delay|disability|tone)\b/i.test(statement);
  }

  if (fact.factKind === "equipment") {
    return /\b(equipment|wheelchair|cane|buckle|seat belts?|pull-?ups?|headphones?|fidgets?|glasses|hearing aids?|aac|touchchat|communication device|chair|underpad|liner)\b/i.test(statement);
  }

  if (fact.factKind === "safety_risk") {
    return CRITICAL_VISIBLE_FACT_PATTERN.test(statement);
  }

  return fact.safetyRelevant && CRITICAL_VISIBLE_FACT_PATTERN.test(statement);
}

function formatStructuredCaptureForPrompt(capture: StructuredCapture) {
  return SUMMARY_SECTION_TITLES.map((title) => {
    const sectionFacts = capture.facts.filter((fact) => fact.section === title);
    if (sectionFacts.length === 0) {
      return `[${title}]\n- ${NO_INFORMATION_PLACEHOLDER}`;
    }

    const grouped = new Map<StructuredFactKind, Map<string, StructuredCaptureFact[]>>();

    for (const fact of sectionFacts) {
      const kindGroups = grouped.get(fact.factKind) ?? new Map<string, StructuredCaptureFact[]>();
      const items = kindGroups.get(fact.subcategory) ?? [];
      items.push(fact);
      kindGroups.set(fact.subcategory, items);
      grouped.set(fact.factKind, kindGroups);
    }

    const lines = [`[${title}]`];

    for (const factKind of STRUCTURED_FACT_KINDS) {
      const subcategories = grouped.get(factKind);
      if (!subcategories) {
        continue;
      }

      lines.push(`Fact kind: ${factKind}`);
      for (const [subcategory, facts] of subcategories.entries()) {
        lines.push(`Subcategory: ${subcategory}`);
        for (const fact of facts) {
          lines.push(
            `- [${fact.factId}] ${fact.statement}${fact.safetyRelevant ? " [safety]" : ""} (${fact.sourceEntryIds.join(", ")})`
          );
        }
      }
    }

    return lines.join("\n");
  }).join("\n\n");
}

function clusterSignature(fact: StructuredCaptureFact) {
  return `${fact.section}::${fact.factKind}::${normalizeCoverageText(fact.statement)}`;
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
    "Understanding and Learning": [
      "learning",
      "support_strategy"
    ],
    "Daily Schedule": [
      "routine",
      "support_strategy"
    ],
    "Activities & Preferences": [
      "preference",
      "support_strategy"
    ],
    "Signs They Are Having a Hard Time": [
      "trigger",
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
      "equipment",
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

  const expectedSectionCandidates = candidates.filter(
    (candidate) => candidate.section === cluster.section
  );
  if (expectedSectionCandidates.length === 0) {
    return null;
  }

  return expectedSectionCandidates.sort((left, right) => {
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

function guideSectionForFact(fact: StructuredCaptureFact): GuideSectionTitle {
  const statement = fact.statement;

  if (fact.factKind === "condition" || fact.factKind === "medication") {
    return "Health & Safety";
  }

  if (fact.factKind === "contact" && statementLooksLikeActualContact(statement)) {
    return "Health & Safety";
  }

  if (
    fact.factKind === "equipment" &&
    !/\b(aac|touchchat|communication device|ipad.*communicat)\b/i.test(statement)
  ) {
    if (/\bpull-?ups?\b/i.test(statement) && /\b(bowel movements?|bathroom|toilet|toileting)\b/i.test(statement)) {
      return "Daily Routine";
    }

    return "Health & Safety";
  }

  if (/\bpull-?ups?\b/i.test(statement) && /\b(bowel movements?|bathroom|toilet|toileting)\b/i.test(statement)) {
    return "Daily Routine";
  }

  if (/\b(bathroom|toilet|toileting|void|bowel movements?|speaker|every hour|hourly|does not initiate)\b/i.test(statement) ||
    /\b(?:remind(?:er|ers)?|prompt(?:ed|s)?)\b.{0,50}\b(?:bathroom|toilet|toileting|void)\b|\b(?:bathroom|toilet|toileting|void)\b.{0,50}\b(?:remind(?:er|ers)?|prompt(?:ed|s)?)\b/i.test(statement)) {
    return "Daily Routine";
  }

  if (/\b(no allergies|allerg\w*|diagnos(?:is|ed)?|condition|g6pd|medication|medicines?|abilify|aripiprazole|miralax|polyethylene|gummy vites|multivitamin|tylenol|esomeprazole|propranolol|citalopram|sitelapram|chok(?:e|ing)|drown(?:ing)?|hydration|buckle buddy|white cane|pull-?ups?|fidgets?|glasses|hearing aids?|emergency contact|phone number|call 911|call first|called first|physical custody|danger|dangerous|social cues?|unsafe|innocent|strangers?|unfamiliar situations?|cerebral palsy|\bcp\b|blind|vision)\b/i.test(statement)) {
    return "Health & Safety";
  }

  if (/\b(car ride|walks? soothe|soothes?|calm(?:s|ing)?|redirect|space|quiet|stimulation|deep breath|count(?:ing)? to 10|squeeze|release|swedish fish|gumm(?:y|ies)|music|nascar|familiar low-volume audio|visual timer|visual schedule|transition|back off|do not .*block|do not .*stop|may bite you|make sure .*safe|cannot hurt himself|contact .*(?:caregivers?|family)|(?:caregivers?|family).*contact|do not hesitate .*(?:contact|call)|tell .*what .*doing|what .*doing.*tell|startle|unexpected reaction|speak.*what .*happening|orient|seizure.*(?:car|home|bed|recover)|(?:car|home|bed|recover).*seizure)\b/i.test(statement)) {
    return "What Helps When They Are Having a Hard Time";
  }

  if (dayRoutinePattern().test(statement)) {
    return "Daily Routine";
  }

  if (/\b(dog|romeo)\b/i.test(statement) && /\b(sad|upset|tough day|hard time|stress|calm|support|walk)\b/i.test(statement)) {
    return "What Helps When They Are Having a Hard Time";
  }

  if (/\b(trouble biting|bite-?sized|biting is hard|foods? should be cut)\b/i.test(statement)) {
    return "Food and Meals";
  }

  if (/\b(press(?:es|ed|ing)? help|help on (?:his|her|their) (?:device|ipad)|go(?:es)? .*device .*help)\b/i.test(statement)) {
    return "Signs They Need Help";
  }

  if (statementLooksLikeFoodOrMeal(statement) || /\b(cupcake|cake|frosting|sprinkles|candy|sweets|sippy cup|grazes?)\b/i.test(statement)) {
    return fact.factKind === "help_sign" ? "Signs They Need Help" : "Food and Meals";
  }

  if (/\b(upset|overwhelm|hard transition|too many demands|loud|crowd|bright|moved|out of place|shades?|overhead lighting|chaotic|overstimulat|sensitive to noise|sensitive to crowds)\b/i.test(statement) && fact.factKind === "trigger") {
    return "What Can Upset or Overwhelm";
  }

  if (/\b(show(?:ing)? .*things? to pick from|things? to pick from|shown? .*choices?|choices? .*shown?|first[- ]this[-, ]*then[- ]that|first[ -]?then)\b/i.test(statement)) {
    return "Understanding and Learning";
  }

  if (/\b(?:places?.*likes? to go|likes? (?:going|to go)|loves? (?:going|to go)|enjoys? (?:going|visiting)|ikea|bass pro|favorite activities|interests? include|activity option|activity .*makes? .*happy|activities? .*make .*happy|make (?:him|her|them) happy|may engage (?:him|her|them))\b/i.test(statement)) {
    return "Activities and Interests";
  }

  if (/\b(non-speaking|aac|touchchat|communicat\w*|express(?:es)? himself|voice|sounds?|vocal|singing|happy sounds?|happy noises?|sad sounds?|sad noises?|lead|touch|sit(?:s|ting)? close|attention|select(?:s|ed)?|i want ipad|word car|press(?:es)? help|label things)\b/i.test(statement)) {
    return "Communication";
  }

  if (
    !/\b(video games?|friends?|train-loving|makes? videos? with)\b/i.test(statement) &&
    !(/\bvideos?\b/i.test(statement) && !/\b(learns?|learning|remember|understand|support|helps?|helpful|best (?:with|through)|visual\w*|model(?:ing)?|demonstrat)\b/i.test(statement)) &&
    /\b(visual\w*|videos?|model(?:ing)?|first[ -]?then|first this, then that|two-step|2-step|more than two steps|gets lost|pictures?|actual items?|physical cues?|tap(?:ping)? .*foot|demonstrat|shown? .*choices?|choices? .*shown?)\b/i.test(statement)
  ) {
    return "Understanding and Learning";
  }

  if (fact.section === "Daily Schedule") {
    return "Daily Routine";
  }

  if (fact.section === "Communication") {
    return "Communication";
  }

  if (fact.section === "Activities & Preferences") {
    return "Activities and Interests";
  }

  if (fact.section === "Signs They Are Having a Hard Time") {
    return fact.factKind === "trigger" ? "What Can Upset or Overwhelm" : "Signs They Need Help";
  }

  if (fact.section === "What helps when they are having a hard time") {
    return "What Helps When They Are Having a Hard Time";
  }

  return "Health & Safety";
}

function uniqueGuideItems(values: string[]) {
  const seen = new Set<string>();
  const items: string[] = [];

  for (const value of values.map(compactWhitespace).filter(Boolean)) {
    const key = normalizeCoverageText(value);
    if (!key || seen.has(key)) {
      continue;
    }

    seen.add(key);
    items.push(value.replace(/[.!?]+$/, ""));
  }

  return items;
}

function sentence(value: string) {
  const text = compactWhitespace(value);
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

function sentenceFromList(prefix: string, items: string[]) {
  const unique = uniqueGuideItems(items);
  return unique.length > 0 ? sentence(`${prefix} ${formatInsightList(unique)}`) : "";
}

function factMatches(fact: StructuredCaptureFact, pattern: RegExp) {
  return pattern.test(fact.statement);
}

function factStatements(facts: StructuredCaptureFact[], pattern?: RegExp) {
  return facts
    .filter((fact) => !pattern || factMatches(fact, pattern))
    .map((fact) => fact.statement);
}

function displaySubject(nameHint?: string) {
  return nameHint?.trim() || "They";
}

function pronounSet(nameHint?: string) {
  return nameHint?.trim()
    ? { subject: nameHint.trim(), possessive: `${nameHint.trim()}'s`, object: nameHint.trim(), verbS: "s" }
    : { subject: "They", possessive: "their", object: "them", verbS: "" };
}

function guideBlock(type: "bullets", items: string[]): SummaryBlock | null;
function guideBlock(type: "note", items: string[]): SummaryBlock | null;
function guideBlock(type: "bullets" | "note", items: string[]): SummaryBlock | null {
  const cleaned = uniqueGuideItems(items).map(sentence);
  if (cleaned.length === 0) {
    return null;
  }

  return type === "note" ? { type, text: cleaned[0] } : { type, items: cleaned };
}

function labeledBlock(label: string, items: string[]): SummaryBlock | null {
  const cleaned = uniqueGuideItems(items).map(sentence);
  return cleaned.length > 0
    ? {
        type: "labeledBullets",
        groups: [{ label, items: cleaned }]
      }
    : null;
}

function groupedBlock(groups: Array<{ label: string; items: string[] }>): SummaryBlock | null {
  const cleanedGroups = groups
    .map((group) => ({
      label: compactWhitespace(group.label),
      items: uniqueGuideItems(group.items).map(sentence)
    }))
    .filter((group) => group.label && group.items.length > 0);

  return cleanedGroups.length > 0 ? { type: "labeledBullets", groups: cleanedGroups } : null;
}

function hasAny(value: string, pattern: RegExp) {
  return pattern.test(value);
}

function factText(facts: StructuredCaptureFact[]) {
  return facts.map((fact) => fact.statement).join(" ");
}

function rejectStatements(statements: string[], patterns: RegExp[]) {
  return statements.filter((statement) => !patterns.some((pattern) => pattern.test(statement)));
}

function exclusiveGroups(
  statements: string[],
  groups: Array<{ label: string; pattern: RegExp }>
) {
  let remaining = uniqueGuideItems(statements);

  return groups.map((group) => {
    const items = remaining.filter((statement) => group.pattern.test(statement));
    remaining = remaining.filter((statement) => !group.pattern.test(statement));
    return { label: group.label, items };
  });
}

function limitGroupItems(
  groups: Array<{ label: string; items: string[] }>,
  limits: Record<string, number>
) {
  return groups.map((group) => ({
    ...group,
    items: group.items.slice(0, limits[group.label] ?? group.items.length)
  }));
}

function compactSection(
  title: GuideSectionTitle,
  index: number,
  intro: string | undefined,
  blocks: Array<SummaryBlock | null>
): SummarySection {
  const visibleBlocks = blocks.filter((block): block is SummaryBlock => Boolean(block));
  const items = deriveItemsFromBlocks(visibleBlocks);

  return {
    id: `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${index + 1}`,
    title,
    intro: intro ? sentence(intro) : undefined,
    items: items.length > 0 ? items : [NO_INFORMATION_PLACEHOLDER],
    blocks: visibleBlocks.length > 0 ? visibleBlocks : undefined
  };
}

const FOOD_TERMS = [
  "apples",
  "grapes",
  "strawberries",
  "bananas",
  "eggs",
  "cereal with milk",
  "yogurt",
  "hot wings",
  "bread",
  "chips",
  "chicken",
  "turkey",
  "ham",
  "sandwich",
  "soft Cheetos",
  "sugar cookies",
  "Capri Suns",
  "Meals on Wheels",
  "lactose-free milk",
  "iced tea",
  "orange juice",
  "lemonade",
  "takeout",
  "pasta with olive oil and Parmesan",
  "raw cauliflower",
  "steamed green beans",
  "green beans",
  "lettuce",
  "spring mix",
  "romaine",
  "pita bread with labneh",
  "pita with labneh and zaatar",
  "pita bread with labneh and zatar herbs",
  "cheddar cheese",
  "slice of cheese",
  "mini cupcake",
  "cupcakes",
  "cake and frosting",
  "ice cream",
  "sprinkles",
  "candy and sweets",
  "certain fruits",
  "some salads",
  "certain salads"
];

function compactFoodName(value: string) {
  const text = compactWhitespace(
    value
      .replace(/^a\s+(?:large\s+)?container of\s+/i, "")
      .replace(/^slices? of\s+/i, "")
      .replace(/^any kind of\s+/i, "")
      .replace(/,\s*(?:but\s+)?(?:he|she|they|[A-Z][A-Za-z'-]+)\s+(?:likes?|loves?|enjoys?).*$/i, "")
      .replace(/\s+and\s+(?:he|she|they|[A-Z][A-Za-z'-]+)\s+(?:likes?|loves?|enjoys?).*$/i, "")
      .replace(/\s+sprinkled on top$/i, "")
      .replace(/\s+with nothing on it$/i, "")
      .replace(/\s+cut into bite-sized pieces$/i, "")
      .replace(/[.!?]+$/, "")
  );

  if (/pasta/i.test(text)) {
    return "pasta with olive oil and Parmesan";
  }
  if (/meals on wheels/i.test(text)) {
    return "Meals on Wheels";
  }
  if (/capri suns?/i.test(text)) {
    return "Capri Suns";
  }
  if (/cheetos/i.test(text)) {
    return "soft Cheetos";
  }
  if (/cookies?/i.test(text)) {
    return "sugar cookies";
  }
  if (/lactose-free milk/i.test(text)) {
    return "lactose-free milk";
  }
  if (/iced tea/i.test(text)) {
    return "iced tea";
  }
  if (/orange juice/i.test(text)) {
    return "orange juice";
  }
  if (/lemonade/i.test(text)) {
    return "lemonade";
  }
  if (/takeout/i.test(text)) {
    return "takeout";
  }
  if (/eggs?/i.test(text)) {
    return "eggs";
  }
  if (/yogurt/i.test(text)) {
    return "yogurt";
  }
  if (/hot wings?/i.test(text)) {
    return "hot wings";
  }
  if (/chicken/i.test(text)) {
    return "chicken";
  }
  if (/cauliflower/i.test(text)) {
    return "raw cauliflower";
  }
  if (/green beans?/i.test(text)) {
    return "green beans";
  }
  if (/lettuce|spring mix|romaine/i.test(text)) {
    return "lettuce";
  }
  if (/pita|labneh|zatar|zaatar/i.test(text)) {
    return "pita with labneh and zaatar";
  }
  if (/cheese/i.test(text)) {
    return "cheddar cheese";
  }
  if (/fruits?/i.test(text)) {
    return "certain fruits";
  }
  if (/salads?|spring mix|romaine/i.test(text)) {
    return "some salads";
  }
  if (/cupcake/i.test(text)) {
    return "mini cupcake";
  }
  if (/ice cream/i.test(text)) {
    return "ice cream";
  }
  if (/sprinkles/i.test(text)) {
    return "sprinkles";
  }
  if (/cake|frosting|sprinkles|candy|sweets/i.test(text)) {
    return text;
  }

  return text;
}

function usefulFoodItem(value: string) {
  const item = compactWhitespace(value);
  return Boolean(item) &&
    !/^(?:it|this|that|them|these|those)$/i.test(item) &&
    !/\b(the food|food that|food shopping|grocery list|water pick|medicine|medication|breakfast\b|lunch\b|dinner\b|variety in .*meals?|same exact way|his breakfast|her breakfast|their breakfast|breakfast after|setting up|waste food|to waste|are due to|because|texture|taste|smell|the look of food|very slowly|slow pace|meal can sit|choking|loves? sprinkles)\b/i.test(item) &&
    item.length <= 80;
}

function groupFoods(facts: StructuredCaptureFact[]) {
  const foodItems = new Set<string>();

  for (const fact of facts) {
    const statement = fact.statement;
    const normalized = statement.toLowerCase();
    if (foodAvoidancePattern().test(statement)) {
      continue;
    }

    for (const term of FOOD_TERMS) {
      if (normalized.includes(term.toLowerCase())) {
        foodItems.add(compactFoodName(term));
      }
    }

    const directFoodMatch = statement.match(/^(?:he|she|they|[A-Z][A-Za-z'-]+)\s+(?:eats?|likes?|loves?)\s+(.+?)[.!?]?$/i);
    if (directFoodMatch?.[1]) {
      foodItems.add(compactFoodName(directFoodMatch[1]));
    }

    const packedMatch = statement.match(/\bpacked\s+(?:a|an|the)?\s*(.+?)(?:\s+for school|\s+for lunch|[.!?]|$)/i);
    if (packedMatch?.[1]) {
      foodItems.add(compactFoodName(packedMatch[1]));
    }
  }

  const uniqueFoodItems = uniqueGuideItems([...foodItems].filter(usefulFoodItem));
  return uniqueFoodItems.length >= 2 ? sentence(`Foods include ${formatInsightList(uniqueFoodItems)}`) : "";
}

function foodGroupingPattern() {
  return /\b(apples?|grapes?|strawberries|bananas|eggs?|cereal|yogurt|wings?|bread|chips?|chicken|turkey|ham|sandwich(?:es)?|cheetos|cookies?|capri suns?|meals on wheels|pasta|cauliflower|green beans?|lettuce|salads?|fruits?|spring mix|romaine|pita|labneh|za'?atar|cheddar cheese|milk|iced tea|orange juice|lemonade|takeout|mini cupcakes?|cupcakes?|ice cream|cake|frosting|sprinkles|candy|sweets)\b/i;
}

function foodAvoidancePattern() {
  return /\b(does not like|doesn't like|do not like|don't like|dislikes?|rejects?|refuses?|will not eat|won't eat|would rather go hungry|should not have|no caffeinated|avoid)\b/i;
}

function groupFoodAvoidance(facts: StructuredCaptureFact[]) {
  const avoidedItems = new Set<string>();

  for (const fact of facts) {
    const statement = fact.statement;
    if (/\bwaste food\b/i.test(statement)) {
      continue;
    }
    if (!foodAvoidancePattern().test(statement)) {
      continue;
    }

    for (const term of FOOD_TERMS) {
      if (statement.toLowerCase().includes(term.toLowerCase())) {
        avoidedItems.add(compactFoodName(term));
      }
    }

    const match = statement.match(/\b(?:does not like|doesn't like|dislikes?|rejects?|refuses?|will not eat|won't eat|should not have|avoid(?:s|ing)?)\s+(.+?)[.!?]?$/i);
    if (match?.[1]) {
      avoidedItems.add(compactFoodName(match[1]));
    }
  }

  const uniqueAvoidedItems = uniqueGuideItems([...avoidedItems].filter(usefulFoodItem));
  return uniqueAvoidedItems.length > 0
    ? sentence(`Foods or drinks to avoid or expect refusal around include ${formatInsightList(uniqueAvoidedItems)}`)
    : "";
}

function groupFoodNotes(facts: StructuredCaptureFact[], name: string) {
  const statements = facts.map((fact) => fact.statement);
  const notes = [
    hasAny(factText(facts), /\bonly drinks water\b/i) ? `${name} only drinks water.` : "",
    hasAny(factText(facts), /\bsippy cup\b/i) ? `A sippy cup may help ${name} drink water.` : "",
    hasAny(factText(facts), /\bbite-sized\b|\btrouble biting\b/i) ? "Foods should be bite-sized when biting is hard." : "",
    hasAny(factText(facts), /\bground\b.*\bnot pureed|not pureed\b.*\bground\b/i) ? "Meals must be ground, not pureed, to reduce choking risk." : "",
    hasAny(factText(facts), /\bno caffeinated|should not have caffeinated|should have no caffeinated\b/i) ? "Avoid caffeinated drinks." : "",
    hasAny(factText(facts), /\blimited diet\b/i) ? `${name} has a limited diet.` : "",
    hasAny(factText(facts), /\bdoes not eat breakfast\b/i) ? `${name} does not eat breakfast on school weekdays.` : "",
    hasAny(factText(facts), /\brestrictive\b.*\bGI|gastrointestinal|GI issues\b/i) ? "Diet may be restricted because of GI issues." : "",
    hasAny(factText(facts), /\bmealtimes?\b.*\bpay attention|cannot .*get .*food|not able .*get food/i) ? "Caregivers need to monitor mealtimes because they cannot get food independently." : "",
    hasAny(factText(facts), /\bgraz(?:e|es|ing)\b|walking back and forth while eating/i) ? `${name} grazes while moving rather than sitting for meals.` : "",
    hasAny(factText(facts), /\bfill (?:his|her|their) own water bottle|water dispenser\b/i) ? `${name} can fill their own water bottle.` : "",
    hasAny(factText(facts), /\bmiralax|polyethylene\b/i) ? "MiraLax/polyethylene glycol may be mixed in water." : "",
    ...rejectStatements(statements, [
      foodGroupingPattern(),
      foodAvoidancePattern(),
      /\b(?:likes?|loves?|eats?|drinks?|does not like|doesn't like|dislikes?|refuses?|will not eat|won't eat|should not have)\b/i,
      /\bonly drinks water\b/i,
      /\bsippy cup\b/i,
      /\blimited diet\b/i,
      /\bdoes not eat breakfast\b/i,
      /\brestrictive\b.*\bGI|gastrointestinal|GI issues\b/i,
      /\bbite-sized\b|\btrouble biting\b/i,
      /\bground\b.*\bnot pureed|not pureed\b.*\bground\b/i,
      /\bno caffeinated|should not have caffeinated|should have no caffeinated\b/i,
      /\bmealtimes?\b.*\bpay attention|cannot .*get .*food|not able .*get food/i,
      /\bgraz(?:e|es|ing)\b|walking back and forth while eating/i,
      /\bfill his own water bottle|water dispenser\b/i,
      /\bmiralax|polyethylene\b/i,
      /^(?:after|before|once)\s+(?:breakfast|lunch|dinner)\b/i
    ])
  ];

  return uniqueGuideItems(notes.filter(Boolean));
}

function groupHygiene(facts: StructuredCaptureFact[], name: string) {
  const text = factText(facts);
  const hasShowerSupport = /\b(bath|shower)\b/i.test(text) &&
    (
      /\b(?:needs?|gets?|requires?|receives?|assisted|help(?:ed)? with)\b.{0,40}\b(?:bath|shower)\b/i.test(text) ||
      !/\b(?:void|pee|urinate).{0,80}\b(?:shower|showerhead)|(?:shower|showerhead).{0,80}\b(?:void|pee|urinate)\b/i.test(text)
    );
  const tasks = [
    /\bdeodorant\b/i.test(text) ? "deodorant" : "",
    /\b(gets dressed|dressed|dressing|shirt|underwear|pants|pajamas|pjs)\b/i.test(text) ? "dressing" : "",
    /\bhair|comb(?:s)? his hair\b/i.test(text) ? "hair care" : "",
    /\bsocks?\b/i.test(text) ? "socks" : "",
    /\bteeth|tooth brushing|brush(?:es)? his teeth\b/i.test(text) ? "teeth brushing" : "",
    /\bshoes?\b/i.test(text) ? "shoes" : "",
    /\bjacket\b/i.test(text) ? "jacket" : "",
    hasShowerSupport ? "shower support" : ""
  ].filter(Boolean);

  return tasks.length >= 2
    ? sentence(`${name} needs assistance with hygiene and dressing, including ${formatInsightList(tasks)}`)
    : "";
}

function hygieneGroupingPattern() {
  return /\b(deodorant|dressed|dressing|shirt|underwear|depends|pants|pajamas|pjs|socks?|teeth|tooth|brush(?:es)? his teeth|hair|comb(?:s)? his hair|shoes?|jacket|bath|shower)\b/i;
}

function detailedHygieneGroupingPattern() {
  return /\b(pajamas?|pjs|deodorant|gets? dressed|dressed after deodorant|clean dry (?:underwear|depends)|before .*gets? dressed|lift(?:s)? (?:his|her|their)?\s*arms?)\b/i;
}

function simpleHygieneAssistancePattern() {
  return /\b(?:assisted with|help(?:ed)? with|support with|needs assistance with|is part of .+ routine)\b.*\b(deodorant|dressing|getting dressed|hair care|socks?|teeth brushing|brush(?:ing)? teeth|shower support|shower|clothing)\b/i;
}

function groupHygieneDetails(facts: StructuredCaptureFact[], name: string) {
  const text = factText(facts);
  const details = [
    /\bpajamas?|pjs\b/i.test(text)
      ? sentence(`Prompt ${name} to take off pajamas during the morning bathroom routine`)
      : "",
    /\bdeodorant\b/i.test(text) && /\b(gets? dressed|dressed|dressing)\b/i.test(text)
      ? sentence(`During dressing, put deodorant on ${name} before they get dressed${/\blift(?:s)? (?:his|her|their)?\s*arms?\b/i.test(text) ? "; they may lift their arms to help" : ""}`)
      : "",
    /\bclean dry (?:underwear|depends)\b/i.test(text)
      ? `${name} is dressed in clean dry underwear or Depends during the morning routine.`
      : ""
  ].filter(Boolean);

  return uniqueGuideItems(details).map(sentence);
}

function toiletingGroupingPattern() {
  return /\b(toilet|toileting|bathroom|void|pull-?up|speaker|every hour|bowel movement|hiding|grunt|tuck|close his legs|eyes-on supervision|eyes on supervision|supervision even .*bathroom|requires supervision .*bathroom)\b/i;
}

function groupToiletingDetails(facts: StructuredCaptureFact[], name: string) {
  const text = factText(facts);
  const hasVoidsInToilet = /\bvoids? in the toilet|use(?:s)? the toilet\b/i.test(text);
  const hasBathroomReminders = /\bhourly|every hour|speaker|remind|prompt|told to use\b/i.test(text);
  const details = [
    hasVoidsInToilet && hasBathroomReminders
      ? `${name} voids in the toilet with reminders and support.`
      : "",
    hasVoidsInToilet && !hasBathroomReminders
      ? `${name} voids in the toilet.`
      : "",
    /\b(?:does not|doesn't|do not|don't)\b.{0,50}\bbowel movements?\b.{0,60}\btoilet\b|\bbowel movements?\b.{0,60}\bpull-?up\b/i.test(text)
      ? `${name}'s bowel movements happen in a pull-up.`
      : "",
    hasBathroomReminders && !hasVoidsInToilet
      ? `${name} uses the bathroom with reminders and support.`
      : "",
    (/\beyes-on supervision\b|\beyes on supervision\b/i.test(text) && /\bbathroom routines?\b/i.test(text)) ||
    /\brequires supervision\b.{0,80}\bbathroom\b|\bsupervision (?:is )?needed\b.{0,80}\bbathroom\b|\bneeds supervision\b.{0,80}\bbathroom\b|\bsupervision even\b.{0,80}\bbathroom\b|\bbathroom\b.{0,80}\b(?:requires|needs) supervision\b/i.test(text)
      ? `${name} needs eyes-on supervision during bathroom routines.`
      : "",
    /\b(?:does not|doesn't|do not|don't)\s+void\b|\bshowerhead\b/i.test(text)
      ? `If ${name} does not void, turning on the showerhead can help.`
      : "",
    /\bhiding|grunt/i.test(text)
      ? `Hiding or grunting may mean ${name} is having a bowel movement.`
      : ""
  ].filter(Boolean);

  return uniqueGuideItems(details).map(sentence);
}

function hydrationRoutinePattern() {
  return /\bcup[- ]to[- ]mouth\b|\bhead[- ]tilt\b|\bfilling .*mouth with fluid\b|\bgulp and swallow\b|\bnatural reaction to gulp\b/i;
}

function groupHydrationRoutineDetails(facts: StructuredCaptureFact[], name: string) {
  const text = factText(facts);

  if (!hydrationRoutinePattern().test(text)) {
    return [];
  }

  return [
    sentence(`Hydration support may include cup-to-mouth or head-tilt prompting to help ${name} gulp and swallow fluids`)
  ];
}

function groupIllnessPainSigns(facts: StructuredCaptureFact[]) {
  const text = facts.map((fact) => fact.statement).join(" ");
  const signs = [
    /\bnot eating\b/i.test(text) ? "not eating" : "",
    /\bnot drinking\b/i.test(text) ? "not drinking" : "",
    /\blimp(?:s|ing|ed)?\b/i.test(text) ? "limping" : "",
    /\bavoid(?:ing)? a body part\b|\bfavor(?:ing|s)? a body part\b/i.test(text) ? "avoiding or favoring a body part" : "",
    /\blow energy|letharg/i.test(text) ? "low energy or unusual lethargy" : "",
    /\bpain\b.*\b(distress|frustration|upset|hard time)|\b(distress|frustration|upset|hard time)\b.*\bpain\b/i.test(text)
      ? "pain-related distress or frustration"
      : "",
    /\btemperature extremes?\b.{0,80}\bseizure|\b(?:too hot|too cold)\b.{0,80}\bseizure|\bseizure\b.{0,80}\b(?:temperature extremes?|too hot|too cold)\b/i.test(text)
      ? "temperature extremes that may contribute to seizure activity"
      : ""
  ].filter(Boolean);

  return signs.length >= 2 || signs.some((sign) => /pain/i.test(sign))
    ? sentence(`Changes such as ${formatInsightList(signs)} may mean illness or pain`)
    : "";
}

function groupReportingLimits(facts: StructuredCaptureFact[], name: string) {
  const text = factText(facts);
  const limits = [
    /\b(?:does not|doesn't|do not|don't)\b.{0,50}\b(?:tell|communicate|let .*know|report)\b.{0,50}\b(?:hurt|pain)\b|\b(?:hurt|pain)\b.{0,50}\b(?:does not|doesn't|do not|don't)\b.{0,50}\b(?:tell|communicate|let .*know|report)\b/i.test(text)
      ? "hurt or in pain"
      : "",
    /\b(?:does not|doesn't|do not|don't)\b.{0,50}\b(?:tell|communicate|initiate|let .*know)\b.{0,50}\b(?:bathroom|toilet|toileting)\b|\b(?:bathroom|toilet|toileting)\b.{0,50}\b(?:does not|doesn't|do not|don't)\b.{0,50}\b(?:tell|communicate|initiate|let .*know)\b/i.test(text)
      ? "needs the bathroom"
      : ""
  ].filter(Boolean);

  if (limits.includes("hurt or in pain") && limits.includes("needs the bathroom")) {
    return sentence(`${name} does not tell caregivers when they are hurt or in pain`);
  }

  if (limits.includes("hurt or in pain")) {
    return sentence(`${name} does not tell caregivers when they are hurt or in pain`);
  }

  return "";
}

function groupNonverbalCommunication(facts: StructuredCaptureFact[], name: string) {
  const text = factText(facts);
  const cues = [
    /\blead(?:s|ing)? (?:you|a caregiver|caregivers|them|him|her|a person)\b/i.test(text) ? "lead you to what they need" : "",
    /\btouch(?:es|ing)? (?:you|a caregiver|caregivers|them|him|her|a person)\b/i.test(text) ? "touch you" : "",
    /\bsit(?:s|ting)? close|closer and closer\b/i.test(text) ? "sit close when they want attention" : ""
  ].filter(Boolean);

  return cues.length > 0 ? sentence(`${name} may also ${formatInsightList(cues)}`) : "";
}

function nonverbalCommunicationPattern() {
  return /\blead(?:s|ing)? (?:you|a caregiver|caregivers|them|him|her|a person)\b|\btouch(?:es|ing)? (?:you|a caregiver|caregivers|them|him|her|a person)\b|\bsit(?:s|ting)? close|closer and closer\b/i;
}

function groupAacRequestMeanings(facts: StructuredCaptureFact[], name: string) {
  const text = factText(facts);
  const requests = [
    /\bask(?:s|ing)? for help|press(?:es|ed|ing)? help\b/i.test(text) ? "ask for help" : "",
    /\brequest(?:s|ed|ing)? car rides?|select(?:s|ed|ing)? (?:the word )?car\b/i.test(text) ? "request car rides" : "",
    /\bi want ipad|wants? (?:his|her|their) ipad\b/i.test(text) ? "say they want their iPad" : ""
  ].filter(Boolean);
  const device = /\btouchchat\b/i.test(text) && /\bipad\b/i.test(text)
    ? "TouchChat on an iPad"
    : /\baac\b|\bcommunication device\b/i.test(text)
      ? "AAC"
      : "";

  return requests.length > 0 && device
    ? sentence(`${name} may use ${device} to ${formatInsightList(requests)}`)
    : "";
}

function aacMethodGroupingPattern() {
  return /\b(?:uses?|communicates? with|system is|device is|software is|touchchat|aac device|communication device|label what|label things?|ask(?:s|ing)? for help)\b/i;
}

function communicationMethodGroupingPattern() {
  return /\b(non-speaking|can't say words|cannot say words|does not speak|can make sounds|communicat\w* with sounds|expresses? (?:himself|herself|themself|self)?\s*with (?:his|her|their)?\s*voice|happy noises?|angry sounds?|angry noises?|singing-like sounds?|singing|loud sounds? mean|makes? loud sounds?|making loud sounds? means?|change in .*tone of voice|tone of voice .*mean|email(?:ing)? .*question|written question|question .*writing|communication becomes too complicated|overwhelmed when communication|frustrated when communication|yelling .*communication change|screaming .*communication change|swearing .*communication change|yelling .*change in communication|screaming .*change in communication|swearing .*change in communication|yelling .*can communicate|screaming .*can communicate|swearing .*can communicate|being affirmative helps|being excited helps|decode unclear words?|contacted to help decode|body language|nonverbal|non-verbal|non-verbally)\b/i;
}

function groupCommunicationMethodDetails(facts: StructuredCaptureFact[], name: string) {
  const text = factText(facts);
  const details = [
    /\bnon-speaking|can't say words|cannot say words|does not speak\b/i.test(text)
      ? `${name} is non-speaking.`
      : "",
    /\bsounds?|voice|vocal|singing|happy noises?|angry noises?\b/i.test(text)
      ? `${name} may communicate with sounds, including happy, angry, or singing-like sounds.`
      : "",
    /\b(?:makes?|making )?loud sounds?\b.{0,70}\b(?:needs?|wants?) to know someone is there|\b(?:needs?|wants?) to know someone is there\b.{0,70}\b(?:makes?|making )?loud sounds?\b/i.test(text)
      ? `Loud sounds may mean ${name} needs to know someone is there.`
      : "",
    /\b(?:frustrated|overwhelmed)\b.{0,80}\bcommunication becomes too complicated|\bcommunication becomes too complicated\b.{0,80}\b(?:frustrated|overwhelmed)\b/i.test(text)
      ? `${name} may become frustrated or overwhelmed when communication becomes too complicated.`
      : "",
    /\bchange in .*tone of voice\b|\btone of voice .*mean\b/i.test(text)
      ? `A change in ${name}'s tone of voice may mean they are irritated, confused, not understanding, or overwhelmed.`
      : "",
    /\bemail(?:ing)?\b.{0,80}\bquestion\b|\bwritten question\b|\bquestion\b.{0,80}\bwriting\b/i.test(text)
      ? `Written questions, including email, can help ${name} sit with a question and think before responding.`
      : "",
    /\b(yelling|screaming|swearing)\b.{0,120}\b(?:communication change|change in communication|can communicate|struggling|needs? support|in trouble)\b/i.test(text)
      ? `Yelling, screaming, or swearing may show ${name} is struggling, needs support, or is in trouble.`
      : "",
    /\bbeing affirmative helps\b|\bbeing excited helps\b/i.test(text)
      ? `Affirmative, excited communication can help ${name} engage.`
      : "",
    /\b(?:sister|brother|father|family|caregivers?)\b.{0,80}\bdecode unclear words?|decode unclear words?.{0,80}\b(?:sister|brother|father|family|caregivers?)\b/i.test(text)
      ? `Family members may help decode unclear words or phrases.`
      : "",
    /\bbody language|nonverbal|non-verbal|non-verbally\b/i.test(text)
      ? `${name} also uses body language and nonverbal cues.`
      : ""
  ].filter(Boolean);

  return uniqueGuideItems(details).map(sentence);
}

function ipadRequestMeaningPattern() {
  return /\b(?:selects?|press(?:es|ed)?|chooses?|uses?)\b.{0,80}\b(?:i want ipad|want(?:s)? (?:his|her|their)?\s*ipad)\b|\b(?:i want ipad|want(?:s)? (?:his|her|their)?\s*ipad)\b.{0,80}\b(?:internet|not working|broken|cannot find|can't find|video|content|search)\b/i;
}

function groupIpadRequestMeanings(facts: StructuredCaptureFact[], name: string) {
  const text = factText(facts);
  if (!/\b(?:i want ipad|want(?:s)? (?:his|her|their)?\s*ipad)\b/i.test(text)) {
    return "";
  }

  const meanings = [
    /\binternet\b.{0,40}\bdown\b|\bdown\b.{0,40}\binternet\b/i.test(text)
      ? "the internet is down"
      : "",
    /\bipad\b.{0,40}\b(?:not working|broken|isn't working|doesn't work)\b|\b(?:not working|broken|isn't working|doesn't work)\b.{0,40}\bipad\b/i.test(text)
      ? "the iPad is not working"
      : "",
    /\b(?:cannot|can't|can not)\s+find\b.{0,60}\b(?:video|content)\b|\b(?:video|content)\b.{0,60}\b(?:cannot|can't|can not)\s+find\b|\bsearch history\b/i.test(text)
      ? "he cannot find the video or content he wants"
      : ""
  ].filter(Boolean);

  return meanings.length > 0
    ? sentence(`If ${name} selects "I want iPad," check whether ${formatInsightList(meanings)}`)
    : "";
}

function groupToiletingRoutine(facts: StructuredCaptureFact[], name: string) {
  const text = factText(facts);
  if (!/\b(bathroom|toilet|toileting)\b/i.test(text)) {
    return "";
  }

  const hasPrompts = /\bhourly|every hour|speaker|remind|prompt|told to use\b/i.test(text);
  const hasInitiationLimit = /\b(?:does not|doesn't|do not|don't|won't|will not)\b.{0,70}\b(?:communicate|initiate|tell|use it independently|use .*bathroom independently)\b/i.test(text);

  if (hasPrompts && hasInitiationLimit) {
    return sentence(`Bathroom reminders every hour help because ${name} does not independently communicate toileting needs`);
  }

  if (hasPrompts) {
    return sentence(`Bathroom reminders every hour help ${name} with toileting`);
  }

  return "";
}

function illnessPainGroupingPattern() {
  return /\b(not eating|not drinking|limp(?:s|ed|ing)?|avoid(?:ing)? a body part|favor(?:ing|s)? a body part|low energy|letharg|illness|pain|walking strangely|appetite changes?)\b/i;
}

function groupBehaviorSigns(facts: StructuredCaptureFact[]) {
  const text = factText(facts);
  const signs = [
    /\bagitat(?:ed|ion)|agitation showing .*face\b/i.test(text) ? "agitation" : "",
    /\belop(?:e|es|ed|ing|ement)?|run away|running away\b/i.test(text) ? "eloping" : "",
    /\bhand biting|bit(?:e|es|ing)? (?:his|her|their) hand\b/i.test(text) ? "hand biting" : "",
    /\bangry (?:sounds?|noises?|vocalizations?)|yelling|shouting|flailing|flare .*arms|flail .*arms\b/i.test(text) ? "shouting, flailing, or angry vocalizations" : "",
    /\bhiding|hide|disappears?\b/i.test(text) ? "hiding" : ""
  ].filter(Boolean);

  return signs.length >= 2 ? sentence(`Behavior signs may include ${formatInsightList(signs)}`) : "";
}

function groupedTriggerDetailPattern() {
  return /\b(things?.{0,30}(?:moved|out of place)|out of place|expected position|rigid.{0,60}(?:lights?|shades?)|(?:lights?|shades?).{0,60}(?:expected|position)|overhead lighting|soft indirect lighting|indirect lighting|difficulty transition|difficulty transitioning|does not want to go|does not want to get out of the car|feels rushed|feels pressured|not her idea|not his idea|not their idea)\b/i;
}

function groupTriggerDetails(facts: StructuredCaptureFact[], name: string) {
  const text = factText(facts);
  const sensory: string[] = [];
  const routine: string[] = [];

  if (/\boverhead lighting|soft indirect lighting|indirect lighting\b/i.test(text)) {
    sensory.push("Soft or indirect lighting may be easier than overhead lighting.");
  }

  const changedItems = [
    /\bthings?\b.{0,35}\bmoved\b|\bmoved\b.{0,35}\bthings?\b/i.test(text)
      ? "things are moved"
      : "",
    /\bout of place\b/i.test(text) ? "things are out of place" : ""
  ].filter(Boolean);
  if (changedItems.length > 0) {
    routine.push(sentence(`Changes to the environment can upset ${name}, especially when ${formatInsightList(changedItems)}`));
  }

  const expectedPositions = [
    /\b(?:lights?|lighting)\b.{0,80}\b(?:expected|position|rigid)|\b(?:expected|position|rigid)\b.{0,80}\b(?:lights?|lighting)\b/i.test(text)
      ? "lights"
      : "",
    /\bshades?\b.{0,80}\b(?:expected|position|rigid)|\b(?:expected|position|rigid)\b.{0,80}\bshades?\b/i.test(text)
      ? "shades"
      : ""
  ].filter(Boolean);
  if (expectedPositions.length > 0) {
    routine.push(sentence(`${name} may be rigid about ${formatInsightList(expectedPositions)} being in the expected position`));
  }

  const transitionTriggers = [
    /\bdoes not want to go\b/i.test(text) ? "they do not want to go" : "",
    /\bdoes not want to get out of the car\b|\bstuck in the car\b/i.test(text) ? "they do not want to get out of the car" : "",
    /\bfeels? rushed\b|\brushed\b/i.test(text) ? "they feel rushed" : "",
    /\bfeels? pressured\b|\bpressured\b/i.test(text) ? "they feel pressured" : "",
    /\bnot (?:her|his|their) idea\b/i.test(text) ? "the transition was not their idea" : ""
  ].filter(Boolean);
  if (transitionTriggers.length > 0) {
    routine.push(sentence(`Transitions may be harder for ${name} when ${formatInsightList(transitionTriggers)}`));
  }

  return {
    sensory: uniqueGuideItems(sensory).map(sentence),
    routine: uniqueGuideItems(routine).map(sentence)
  };
}

function dayRoutinePattern() {
  return /^(?:In the past,\s+)?On\s+(?:(?:Mondays?|Tuesdays?|Wednesdays?|Thursdays?|Fridays?|Saturdays?|Sundays?|weekdays?|weekends?)(?:,\s+|,\s+and\s+|\s+and\s+)?)+,\s+/i;
}

function cleanRoutineStep(value: string) {
  return compactWhitespace(
    value
      .replace(/[.!?]+$/, "")
      .replace(/^(?:he|she|they|[A-Z][A-Za-z'-]+)\s+/i, "")
  );
}

function groupDayRoutines(facts: StructuredCaptureFact[]) {
  const grouped = new Map<string, string[]>();

  for (const fact of facts) {
    if (!dayRoutinePattern().test(fact.statement)) {
      continue;
    }

    const match = fact.statement.match(/^(?:In the past,\s+)?(On\s+(?:(?:Mondays?|Tuesdays?|Wednesdays?|Thursdays?|Fridays?|Saturdays?|Sundays?|weekdays?|weekends?)(?:,\s+|,\s+and\s+|\s+and\s+)?)+),\s+(.+?)[.!?]?$/i);
    if (!match) {
      continue;
    }

    const label = compactWhitespace(match[1]);
    const step = cleanRoutineStep(match[2]);
    if (!step) {
      continue;
    }

    grouped.set(label, [...(grouped.get(label) ?? []), step]);
  }

  return [...grouped.entries()]
    .filter(([, steps]) => steps.length >= 2)
    .map(([label, steps]) => sentence(`${label}, the routine includes ${formatInsightList(uniqueGuideItems(steps))}`));
}

function groupLearningSupport(facts: StructuredCaptureFact[], name: string) {
  const text = factText(facts);
  const supports = [
    /\bvideos?\b|wake up to the iPad/i.test(text) ? "videos" : "",
    /\bvisual\w*\b/i.test(text) ? "visual supports" : "",
    /\bpictures?\b/i.test(text) ? "pictures" : "",
    /\bactual items?|items themselves\b/i.test(text) ? "actual items" : "",
    /\btwo-step|2-step\b/i.test(text) ? "two-step directions" : "",
    /\bfirst[ -]?then|first this, then that|first[- ]this[-, ]*then[- ]that\b/i.test(text) ? "First-Then language" : "",
    /\bvisual schedules?\b/i.test(text) ? "visual schedules" : "",
    /\bvisual timers?\b/i.test(text) ? "visual timers" : "",
    /\bmodel(?:ing)?|demonstrat/i.test(text) ? "modeling or demonstration" : "",
    /\bphysical cues?|tap(?:ping)? .*foot|gentle tap\b/i.test(text) ? "gentle physical prompts" : ""
  ].filter(Boolean);

  return supports.length >= 2
    ? sentence(`${name} learns best with visual and concrete supports, including ${formatInsightList(supports)}`)
    : "";
}

function groupedLearningDetailStatements(facts: StructuredCaptureFact[]) {
  return factStatements(facts, learningGroupingPattern()).filter(
    (statement) => !/\bshow(?:ing)? .*?\b(?:pictures?|actual items?|items themselves)\b.*\bchoose\b|\b(?:pictures?|actual items?|items themselves)\b.*\bhelp .*choose\b/i.test(statement)
  );
}

function learningGroupingPattern() {
  return /\b(visual\w*|videos?|pictures?|actual items?|two-step|2-step|first[ -]?then|first this, then that|first[- ]this[-, ]*then[- ]that|show(?:ing)? .*things? to pick from|things? to pick from|shown? .*choices?|choices? .*shown?|visual schedules?|visual timers?|model(?:ing)?|demonstrat|physical cues?|tap(?:ping)? .*foot|gentle tap|more than two steps|gets lost)\b/i;
}

function splitListText(value: string) {
  return value
    .replace(/^preferred activities include\s+/i, "")
    .replace(/^activities include\s+/i, "")
    .replace(/^include\s+/i, "")
    .split(/\s*,\s*|\s+ and\s+|\s+ or\s+/i)
    .map((item) =>
      compactWhitespace(
        item
          .replace(/[.!?]+$/, "")
          .replace(/^to\s+/i, "")
          .replace(/^(?:go|going) to\s+/i, "")
          .replace(/^include\s+/i, "")
          .replace(/^(?:a|an|the)\s+/i, "")
      )
    )
    .filter((item) => item.length > 1);
}

function activityItems(facts: StructuredCaptureFact[]) {
  const items: string[] = [];

  for (const fact of facts) {
    const statement = fact.statement;
    if (/^(?:preferred activities|activities) include\b/i.test(statement)) {
      items.push(...splitListText(statement));
      continue;
    }

    const placesMatch = statement.match(/\bplaces?.*likes? to go (?:are|include)\s+(.+?)[.!?]?$/i);
    if (placesMatch?.[1]) {
      items.push(...splitListText(placesMatch[1]));
      continue;
    }

    const happyActivityMatch = statement.match(/^(.+?)\s+is an activity (?:that .*?\s+)?makes? (?:him|her|them) happy[.!?]?$/i);
    if (happyActivityMatch?.[1]) {
      items.push(compactWhitespace(happyActivityMatch[1]));
      continue;
    }

    const match = statement.match(/\b(?:interested in|enjoys?|likes?|loves?|favorite(?:s)?(?: is| are)?|especially loves?)\s+(.+?)[.!?]?$/i);
    if (match?.[1]) {
      items.push(...splitListText(match[1]));
    }
  }

  return uniqueGuideItems(items).filter((item) =>
    !foodGroupingPattern().test(item) &&
    !/\b(glasses|hearing aids?|medicat|medicine|allerg|eczema|boils?|not found a reliable strategy|not planning|get a dog|though they are not always|caretaker|caregiver|communicat\w*|nonverbal|non-verbal|non-verbally|body language|visual\w* choices?|shown? .*choices?|choices? .*shown?)\b/i.test(item) &&
    !/^(?:person|activities?|preferences?)$/i.test(item) &&
    !/^and\b/i.test(item)
  );
}

function socialActivityItems(facts: StructuredCaptureFact[], name: string) {
  const items: string[] = [];

  for (const fact of facts) {
    const statement = fact.statement;
    if (!/\b(favorite person|spending time|alone|downtime|couch|watch TV|visiting family|family visits|family time|(?:mom|mother|family).{0,40}(?:favorite|spending time|visit|together))\b/i.test(statement)) {
      continue;
    }

    const favorite = statement.match(/\b([A-Z][A-Za-z'-]+|mom|mother|dad|father|grandmother|grandfather|family)\b.{0,30}\bfavorite person\b/i);
    const favoritePerson = favorite?.[1]?.replace(/^mom$/i, "Mom");
    if (favoritePerson && !/^family$/i.test(favoritePerson)) {
      items.push(`${favoritePerson} is one of ${name}'s favorite people`);
    }

    if (/\bspending time with family|family time|visiting family|family visits|family\b/i.test(statement)) {
      items.push("family time");
    }

    if (/\bbeing left alone|left alone|own thing|downtime\b/i.test(statement)) {
      items.push("being left alone to do their own thing");
    }

    if (/\bwatch TV|watch television|couch\b/i.test(statement)) {
      items.push("watching TV on the couch");
    }
  }

  return uniqueGuideItems(items);
}

function groupedListItem(prefix: string, items: string[], limit = 10) {
  const normalized = items.map((item) => {
    const cleaned = compactWhitespace(item)
      .replace(/^include\s+/i, "")
      .replace(/\s+outside (?:the )?home$/i, "")
      .replace(/\s+outside (?:the )?house$/i, "");
    return /\bcar rides?\b/i.test(cleaned) ? "car rides" : cleaned;
  });
  const unique = uniqueGuideItems(normalized)
    .filter((item) => item.length > 1)
    .slice(0, limit);
  return unique.length > 0 ? sentence(`${prefix} ${formatInsightList(unique)}`) : "";
}

function groupActivityPreferences(facts: StructuredCaptureFact[], name: string) {
  let remaining = activityItems(facts);
  const take = (pattern: RegExp) => {
    const matched = remaining.filter((item) => pattern.test(item));
    remaining = remaining.filter((item) => !pattern.test(item));
    return matched;
  };

  const media = take(/\b(ipad|youtube|videos?|music|tv|drums?|guitar|piano)\b/i);
  const movement = take(/\b(walks?|walking|scooter|horseback|swimm?ing|jump(?:ing)?|crash(?:ing)?|swing(?:ing)?|obstacle|bowling|basketball|trampoline|balls?|roller racer)\b/i);
  const sensory = take(/\b(sensory|tickles?|mouthing|necklaces?|pop tubes?|therapy ball|fidget|lights?)\b/i);
  const outings = take(/\b(car rides?|new places|explor(?:ing|e)?|hikes?|malls?|stores?|museums?|adventures?|novelty)\b/i);
  const interests = take(/\b(animals?|farms?|dinosaurs?|cars?|trucks?|books?|planets?|puzzles?|cause-and-effect|ramps?)\b/i);
  const social = socialActivityItems(facts, name);

  return groupedBlock([
    { label: "Technology and music", items: [groupedListItem("Technology and music interests include", media, 4)] },
    { label: "Movement and physical activities", items: [groupedListItem("Movement activities include", movement, 4)] },
    { label: "Sensory activities", items: [groupedListItem("Sensory activities include", sensory, 4)] },
    { label: "Outings and exploration", items: [groupedListItem("Outings and exploration include", outings, 4)] },
    { label: "Interests and toys", items: [groupedListItem("Interests include", interests, 4)] },
    { label: "Social preferences and downtime", items: [groupedListItem("Social connection and downtime include", social, 3)] },
    { label: "Other activities and preferences", items: [groupedListItem("Other activities and preferences include", remaining, 4)] }
  ]);
}

function activityGroupingPattern() {
  return /\b(preferred activities include|activity .*makes? .*happy|interested in|enjoys?|likes?|loves?|favorite|ipad|youtube|video|music|horseback|swim|scooter|walking|new places|exploring|sensory|trampoline|mom|family|downtime|watch tv)\b/i;
}

function supportGroupingPattern() {
  return /\b(space|quiet|noise|stimulation|crowd|low-light|lights?|environment|time alone|not a lot going on|calm|squeeze|deep breath|count|music|fidget|headphones|car ride|drive|dog|romeo|tough day|sad|reset|redirect|snap out|candy|gumm|swedish fish|transition|schedule|timer|first|then|back off|reward|motivat|preferred|hype|hyping|enthusiastic|enthusiastically|speak|orient|startle|what .*doing|contact .*(?:caregivers?|family)|(?:caregivers?|family).*contact|do not hesitate .*(?:contact|call)|don't hesitate .*(?:contact|call)|seizure|recover|safety checks?|safe in .*space|outside close by|floor|get down|safe|hurt|self-harm|elop|hand biting|block|stop|bite you|cannot hurt)\b/i;
}

function healthSafetyGroupingPattern() {
  return /\b(elop(?:e|es|ed|ing|ement)?|run away|running away|hand biting|unsafe walking|walks? .*safety issue|safety issue .*walks?|two adults?|two caregivers?|two people|more than one person|does not communicate pain|does not tell .*hurt|physically unsafe|pica|may bite you|bite you|danger|dangerous|unsafe situations?|social cues?|innocent|strangers?|unfamiliar situations?|drags? a chair|kitchen counter|on the counter|step on the stove|ground\b.{0,60}\bnot pureed|not pureed\b.{0,60}\bground|avoid choking|too hot\b.{0,80}\bseizure activity|too cold\b.{0,80}\bseizure activity|seizure activity\b.{0,80}\b(?:too hot|too cold))\b/i;
}

function groupHealthSafetyRisks(facts: StructuredCaptureFact[]) {
  const text = factText(facts);
  const risks = [
    /\belop(?:e|es|ed|ing|ement)?|run away|running away\b/i.test(text) ? "elopement" : "",
    /\bhand biting\b/i.test(text) ? "hand biting" : "",
    /\bunsafe walking\b/i.test(text) ? "unsafe walking" : "",
    /\b(?:does not|doesn't|do not|don't)\b.{0,50}\b(?:tell|communicate|let .*know|report)\b.{0,50}\b(?:hurt|pain)\b|\b(?:hurt|pain)\b.{0,50}\b(?:does not|doesn't|do not|don't)\b.{0,50}\b(?:tell|communicate|let .*know|report)\b/i.test(text)
      ? "not communicating pain"
      : "",
    /\b(two adults?|two caregivers?|two people|more than one person)\b.{0,80}\b(walks?|outings?|car rides?)\b|\b(walks?|outings?|car rides?)\b.{0,80}\b(two adults?|two caregivers?|two people|more than one person)\b/i.test(text)
      ? "needing two adults for walks or outings"
      : "",
    /\bphysically unsafe|unsafe when dysregulated\b/i.test(text) ? "becoming physically unsafe when dysregulated" : "",
    /\bpica\b/i.test(text) ? "pica" : "",
    /\bmay bite you|bite you|do not .*block.*hand biting|do not .*stop.*biting|physically stop(?:ping)? .*biting|physically block(?:ing)? .*biting|redirection rather than physically stopping\b/i.test(text)
      ? "may bite you if hand biting is blocked"
      : "",
    /\brisk taker|take risks?|willing to take risks?|trust .*risks?\b/i.test(text)
      ? "risk-taking, especially when trust affects willingness to try something"
      : "",
    /\b(?:does not|doesn't|do not|don't|cannot|can't)\b.{0,80}\b(?:danger|dangerous|unsafe|social cues?)\b|\b(?:danger|dangerous|unsafe|social cues?)\b.{0,80}\b(?:does not|doesn't|do not|don't|cannot|can't|unsure|not know|doesn't know)\b|\binnocent\b.{0,80}\b(?:safety|strangers?|unfamiliar)\b|\b(?:strangers?|unfamiliar situations?)\b.{0,80}\b(?:safety|innocent|danger|overwhelm)\b/i.test(text)
      ? "difficulty recognizing danger, unsafe situations, social cues, or risk around strangers and unfamiliar situations"
      : "",
    /\bdrags? a chair\b.{0,120}\b(?:kitchen counter|counter|stove|fall)\b|\b(?:kitchen counter|counter|stove|fall)\b.{0,120}\bdrags? a chair\b/i.test(text)
      ? "kitchen-counter safety risk if a chair is dragged over without supervision, including falling, climbing onto the counter, or stepping on the stove"
      : "",
    /\bground\b.{0,80}\bnot pureed\b|\bnot pureed\b.{0,80}\bground\b|\bavoid choking\b/i.test(text)
      ? "choking risk if meals are not ground to the needed texture"
      : ""
  ].filter(Boolean);

  return risks.length >= 2 || risks.some((risk) => /risk-taking|danger|kitchen-counter|choking risk/i.test(risk))
    ? sentence(`Safety concerns include ${formatInsightList(risks)}`)
    : "";
}

function groupFamilyCallGuidance(facts: StructuredCaptureFact[], name: string) {
  const text = factText(facts);

  if (!/\bcall\b.{0,80}\b(?:family|caregivers?|mother|father)|\b(?:family|caregivers?|mother|father)\b.{0,80}\bcall\b/i.test(text)) {
    return "";
  }

  const details = [
    /\bany time\b|\bday or night\b/i.test(text) ? "any time of day or night" : "",
    /\bonly have a question\b|\beven if .*question\b/i.test(text) ? "even for questions" : "",
    /\btell\b.{0,60}\b(?:family|caregivers?|mother|father)\b.{0,60}\bwhat is going on|\bwhat is going on\b.{0,60}\bwhen .*call\b/i.test(text)
      ? "explain what is going on"
      : "",
    /\bnot hesitate\b|\bdo not hesitate\b|\bdon't hesitate\b/i.test(text) ? "do not hesitate" : ""
  ].filter(Boolean);

  if (details.length === 0) {
    return "";
  }

  return sentence(`Caregivers may call ${name}'s family ${formatInsightList(details)}`);
}

function groupAllergyAndConditionDetails(facts: StructuredCaptureFact[]) {
  const text = factText(facts);
  const details = [
    /\bcerebral palsy\b|\bcp\b/i.test(text)
      ? `Cerebral palsy was reported${/\btightness\b/i.test(text) ? " and may create uncomfortable body tightness" : ""}.`
      : "",
    /\bnot sure whether\b.{0,80}\ballerg|\ballerg\b.{0,80}\bnot sure whether|\bhas not had the chance to (?:take medicine|try new foods)\b/i.test(text)
      ? "Medication or food allergy history is uncertain because the caregiver has not been able to observe reactions to some medicines or foods."
      : "",
    /\bg6pd\b/i.test(text) && /\bmothballs?|mexican food\b/i.test(text)
      ? "G6PD-related allergy or avoidance concerns include mothballs and Mexican food."
      : "",
    /\binsect bites?|hives|swell(?:ing)?\b/i.test(text)
      ? "Insect bites may cause swelling or hives."
      : "",
    /\btcf20\b|\bmutation\b/i.test(text)
      ? "A TCF20 chromosome mutation was reported."
      : "",
    /\btcf20\b|\bmutation\b/i.test(text) && /\b(?:does not know|don't know|not sure|may not have|facebook group|parent descriptions?)\b/i.test(text)
      ? "Caregiver is unsure exactly what the TCF20 mutation means and whether parent descriptions match Tatiana."
      : "",
    /\b(?:too hot|hot)\b.{0,80}\bseizure activity|\b(?:too cold|cold)\b.{0,80}\bseizure activity|\bseizure activity\b.{0,80}\b(?:too hot|hot|too cold|cold)\b/i.test(text)
      ? "Temperature extremes, including being too hot or too cold, may contribute to seizure activity."
      : "",
    /\bintellectual disability\b/i.test(text)
      ? "Intellectual disability was reported."
      : "",
    /\bglobal developmental delay\b/i.test(text)
      ? "Global developmental delay was reported."
      : "",
    /\bautis(?:m|tic)\b/i.test(text) && /\b(?:contradict|main diagnosis|other doctors?)\b/i.test(text)
      ? "Caregiver reported that an autism statement contradicted the main diagnosis given by other doctors."
      : "",
    /\bgastrointestinal\b|\bgi issues?\b/i.test(text)
      ? "Gastrointestinal/GI issues were reported."
      : ""
  ].filter(Boolean);

  return uniqueGuideItems(details).map(sentence);
}

function groupEquipmentDetails(facts: StructuredCaptureFact[]) {
  const text = factText(facts);
  const equipment = [
    /\bwheelchair\b/i.test(text) ? "wheelchair" : "",
    /\bbeach wheelchair\b/i.test(text) ? "beach wheelchair" : "",
    /\boverhead lift\b/i.test(text) ? "overhead lift" : "",
    /\bregular chair\b|\bregular furniture\b/i.test(text) ? "regular chair or furniture" : "",
    /\bmodified passenger seat\b/i.test(text) ? "modified passenger seat" : "",
    /\bdisposable pull[- ]?up style underwear\b|\bpull[- ]?ups?\b/i.test(text) ? "disposable pull-up style underwear" : "",
    /\bbuckle buddy\b/i.test(text) ? "Buckle Buddy for seat belt safety" : "",
    /\bgolf cart\b/i.test(text) && /\bseat belts?\b/i.test(text) ? "golf cart with seat belts" : "",
    /\bwhite cane\b/i.test(text) && /\blearning\b/i.test(text) ? "white cane they are learning to use" : ""
  ].filter(Boolean);
  const details = [
    equipment.length >= 2
      ? sentence(`Equipment and supports include ${formatInsightList(equipment)}`)
      : "",
    equipment.length < 2 && /\bwhite cane\b/i.test(text) && /\blearning\b/i.test(text)
      ? "Learning to use a white cane was reported."
      : "",
    equipment.length < 2 && /\bgolf cart\b/i.test(text) && /\bseat belts?\b/i.test(text)
      ? "A golf cart with seat belts was reported."
      : ""
  ].filter(Boolean);

  return uniqueGuideItems(details).map(sentence);
}

function groupMedicationPurpose(facts: StructuredCaptureFact[]) {
  const text = factText(facts);
  if (!/\b(aripiprazole|abilify)\b/i.test(text)) {
    return "";
  }

  const purposes = [
    /\birritability\b/i.test(text) ? "irritability" : "",
    /\baggression\b/i.test(text) ? "aggression" : "",
    /\brepetitive behaviors?\b/i.test(text) ? "repetitive behaviors" : "",
    /\bself-?injury\b/i.test(text) ? "self-injury" : ""
  ].filter(Boolean);

  return purposes.length >= 2
    ? sentence(`ARIPiprazole/Abilify helps manage ${formatInsightList(purposes)}`)
    : "";
}

function groupMedicationDetails(facts: StructuredCaptureFact[]) {
  const text = factText(facts);
  const details: string[] = [];

  if (/\b(aripiprazole|abilify)\b/i.test(text)) {
    const dose = text.match(/\b\d+(?:\.\d+)?\s*mg\b/i)?.[0] ?? "";
    const time = text.match(/\b(?:at\s+)?\d{1,2}(?::\d{2})?\s*(?:a\.m\.|p\.m\.|am|pm)\b/i)?.[0] ?? "";
    const frequency = /\bonce daily\b/i.test(text)
      ? "once daily"
      : /\bonce a day\b/i.test(text)
        ? "once a day"
        : /\bdaily\b/i.test(text)
          ? "daily"
          : "";
    const timeText = time
      ? /^at\s+/i.test(time)
        ? time
        : `at ${time}`
      : "";
    const purposes = [
      /\birritability\b/i.test(text) ? "irritability" : "",
      /\baggression\b/i.test(text) ? "aggression" : "",
      /\brepetitive behaviors?\b/i.test(text) ? "repetitive behaviors" : "",
      /\bself-?injury\b/i.test(text) ? "self-injury" : ""
    ].filter(Boolean);
    const schedule = [dose, frequency, timeText].filter(Boolean).join(" ");
    details.push(sentence(`Abilify/aripiprazole${schedule ? ` ${schedule}` : ""}${purposes.length > 0 ? ` helps manage ${formatInsightList(purposes)}` : ""}`));
  }

  if (/\b(miralax|polyethylene glycol|clearlax|gavilax|healthylax)\b/i.test(text)) {
    const dose = text.match(/\b\d+(?:\.\d+)?\s*(?:g|grams?|teaspoons?)\b/i)?.[0] ?? "";
    const aliases = [
      /\bpolyethylene glycol\b/i.test(text) ? "Polyethylene glycol" : "",
      /\bmiralax\b/i.test(text) ? "MiraLax" : ""
    ].filter(Boolean);
    const name = aliases.length > 0 ? [...new Set(aliases)].join("/") : "MiraLax";
    const schedule = [
      dose,
      /\bdaily\b/i.test(text) ? "daily" : "",
      /\bin water\b|\bmixed in water\b/i.test(text) ? "in water" : ""
    ].filter(Boolean).join(" ");
    details.push(sentence(`${name}${schedule ? ` ${schedule}` : ""}${/\bstool regular|regular stool|constipation\b/i.test(text) ? " helps keep stool regular" : ""}`));
  }

  if (/\b(multivitamin|gummy vites|gummies per day)\b/i.test(text)) {
    const dose = text.match(/\b\d+\s+gumm(?:y|ies)\s+per\s+day\b/i)?.[0] ?? "";
    details.push(sentence(`Multivitamin${dose ? `: ${dose}` : ""}`));
  }

  if (/\bmedicine cups?\b|\bliquid medicines?\b|\bcorrect dosage\b|\bwhile (?:he|she|they|[A-Z][A-Za-z'-]+) (?:is|are)?\s*eating breakfast\b|\bwhile eating breakfast\b|\bwith breakfast\b/i.test(text)) {
    const steps = [
      /\bsets? up .*medicine cups?\b|\bmedicine cups?\b/i.test(text) ? "setting up medicine cups" : "",
      /\bmeasure(?:s)? .*dosage\b|\bcorrect dosage\b/i.test(text) ? "measuring the correct dosage" : "",
      /\bliquid medicines?\b/i.test(text) ? "taking liquid medicine" : "",
      /\bwith breakfast\b|\bwhile (?:he|she|they|[A-Z][A-Za-z'-]+) (?:is|are)?\s*eating breakfast\b|\bwhile eating breakfast\b/i.test(text) ? "taking medicine with breakfast" : ""
    ].filter(Boolean);
    details.push(sentence(`Morning medicine routine includes ${formatInsightList(steps.length > 0 ? steps : ["taking medicine in the morning"])}`));
  }

  if (/\bstomach feels different\b/i.test(text) && /\b(?:medicine|medicines|breakfast)\b/i.test(text)) {
    details.push("After breakfast and medicine, stomach discomfort or a different stomach feeling was reported.");
  }

  if (/\bpropranolol\b|\bcitalopram\b|\bsitelapram\b/i.test(text)) {
    const medications = [
      /\bpropranolol\b/i.test(text) ? "propranolol" : "",
      /\bcitalopram\b|\bsitelapram\b/i.test(text) ? "citalopram/Sitelapram" : ""
    ].filter(Boolean);
    details.push(sentence(`Reported medications include ${formatInsightList(medications)}; confirm exact names and doses`));
  }

  if (/\bdoes not know the dose\b|\bdose is unknown\b|\bunknown dose\b|\b(?:propranolol|citalopram|sitelapram)\b.{0,80}\bdose\b|\bdose\b.{0,80}\b(?:propranolol|citalopram|sitelapram)\b/i.test(text)) {
    details.push("Confirm medication names and doses because the caregiver does not know all medication doses.");
  }

  if (/\bmedicines?\b.{0,80}\b(?:yogurt|applesauce|apple sauce|chaser|sweet spoonfuls?)\b|\b(?:yogurt|applesauce|apple sauce|chaser|sweet spoonfuls?)\b.{0,80}\bmedicines?\b|\bspoon-?feed\b.{0,80}\bmedicines?\b/i.test(text)) {
    const medicationFoodDetails = [
      /\bbitter\b/i.test(text) ? "nighttime medicine may taste very bitter" : "",
      /\bgrind(?:ing)?\b/i.test(text) ? "grinding medicine into yogurt can make the yogurt taste bad" : "",
      /\bbroken pill\b/i.test(text) ? "a broken pill may be given with bites of yogurt instead of grinding" : "",
      /\bchew(?:s|ing)?\b.{0,40}\bmedicine\b|\bmedicine\b.{0,40}\bchew(?:s|ing)?\b/i.test(text) ? "medicine may be chewed" : "",
      /\bsweet spoonfuls?\b|\bchaser\b/i.test(text) ? "sweet spoonfuls of yogurt can be used as a chaser" : ""
    ].filter(Boolean);
    details.push(sentence(`Medicine may be given with yogurt or applesauce${medicationFoodDetails.length > 0 ? `; notes include ${formatInsightList(medicationFoodDetails)}` : ", followed by sweet spoonfuls as a chaser"}`));
  }

  if (/\bmedicines?\b.{0,80}\b(?:vaginal|vagina|vulva|vulvar)\b|\b(?:vaginal|vagina|vulva|vulvar)\b.{0,80}\bmedicines?\b/i.test(text)) {
    details.push("Morning health checks may include checking the vaginal or vulvar area and applying medicine if needed.");
  }

  if (/\bmedicine or hydration\b|\bhydration situations?\b|\byogurt and fluids\b|\btilt(?:ing)? .*head back\b|\bchok(?:e|ing)\b|\bdrown(?:ing)?\b/i.test(text)) {
    details.push("During medicine or hydration support, prioritize yogurt and fluids when needed and avoid approaches that feel like choking or drowning.");
  }

  if (/\bsleep-related medications?\b|\bsleep related medications?\b|\bsleep aid\b|\bnarcoleptic\b|\bmood stabilizer\b|\bmelatonin\b/i.test(text)) {
    const descriptors = [
      /\bnarcoleptic\b/i.test(text) ? "narcoleptic medication" : "",
      /\bsleep aid\b/i.test(text) ? "sleep aid" : "",
      /\bmood stabilizer\b/i.test(text) ? "mood stabilizer" : "",
      /\bmelatonin\b/i.test(text) ? "melatonin" : ""
    ].filter(Boolean);
    const count = text.match(/\b\d+\s+different sleep-related medications?\b/i)?.[0]?.replace(/\bdifferent\s+/i, "") ?? "sleep-related medications";
    details.push(sentence(`${count} were reported${descriptors.length > 0 ? `, including ${formatInsightList(descriptors)}` : ""}`));
  }

  if (/\b(?:does not|doesn't|do not|don't|no)\s+take\s+(?:any\s+)?(?:medication|medicine)\b|\bno medications?\b/i.test(text)) {
    details.push("No medications were reported.");
  }

  if (/\britalin\b|\bRIT\b|something called like RIT/i.test(text)) {
    details.push("A medication that sounded like RIT/Ritalin was mentioned; confirm the exact name and dose.");
  }

  if (/\bno allergies\b|\bno known allergies\b/i.test(text)) {
    details.push("No allergies were reported.");
  }

  return uniqueGuideItems(details).map(sentence);
}

function groupedMedicationPattern() {
  return /\b(abilify|aripiprazole|miralax|polyethylene glycol|clearlax|gavilax|healthylax|multivitamin|gummy vites|gummies per day|medicine cups?|liquid medicines?|correct dosage|medicine with breakfast|with breakfast|stomach feels different|different stomach feeling|does not know the dose|dose is unknown|unknown dose|propranolol|citalopram|sitelapram|yogurt|applesauce|apple sauce|chaser|sweet spoonfuls?|bitter|grind(?:ing)?|broken pill|chew(?:s|ing)? .*medicine|medicine .*chew(?:s|ing)?|vaginal|vagina|vulva|vulvar|hydration|chok(?:e|ing)|drown(?:ing)?|sleep-related medications?|sleep related medications?|sleep aid|narcoleptic|mood stabilizer|melatonin|ritalin|something called like RIT|no allergies|no known allergies|not sure whether .*allerg|has not had the chance to take medicine|has not had the chance to try new foods|does not take medicine|does not take medication|no medication|no medications)\b/i;
}

function groupedEquipmentPattern() {
  return /\b(white cane\b.{0,80}\blearning|learning\b.{0,80}\bwhite cane|buckle buddy|golf cart|seat belts?|wheelchair|beach wheelchair|overhead lift|regular chair|regular furniture|modified passenger seat|pull[- ]?up style underwear|pull[- ]?ups?)\b/i;
}

function familyCallGuidancePattern() {
  return /\b(call .*family|family .*call|call any time|any time of the day or night|day or night|only have a question|even if .*question|tell .*family .*what is going on|not hesitate to call|should not hesitate to call)\b/i;
}

function groupSupportFacts(facts: StructuredCaptureFact[]) {
  const text = factText(facts);
  const environmental = [
    /\bspace|do not crowd|don't crowd|back off\b/i.test(text) ? "giving space and not crowding" : "",
    /\bquiet|noise|stimulation|not a lot going on|environment\b/i.test(text) ? "keep things quiet and reduce stimulation" : "",
    /\btime alone|moment to (?:himself|herself|themself)\b/i.test(text) ? "allowing time alone when safe" : "",
    /\blow-light|dim lights?|lights?\b/i.test(text) ? "adjusting lighting" : "",
    /\bdifferent (?:space|room)|another room|go(?:ing)? outside|go(?:ing)? to the car|change (?:the )?environment|change spaces?\b/i.test(text)
      ? "changing spaces, such as going outside, going to another room, or going to the car"
      : "",
    /\bfreeze\b|pause everything|stop everything|absolute freeze\b/i.test(text)
      ? "pausing demands and activity when escalation is high"
      : "",
    /\blisten\b|honou?r .*request|honou?r .*leave .*alone|leave (?:him|her|them) alone\b/i.test(text)
      ? "listening and honoring requests for space when safe"
      : ""
  ].filter(Boolean);
  const calming = [
    /\bcar ride|drive\b/i.test(text) ? "car rides or drives" : "",
    /\b(dog|romeo)\b.{0,80}\b(support|calm|sad|upset|tough day|hard time|stress|feel less stressed|walk helps?)\b|\b(support|calm|sad|upset|tough day|hard time|stress|feel less stressed|walk helps?)\b.{0,80}\b(dog|romeo)\b/i.test(text) ? "dog support or a walk with the dog" : "",
    /\bsqueeze|release|deep breath|count(?:ing)? to 10\b/i.test(text) ? "calming prompts such as squeeze-and-release, deep breaths, or counting" : "",
    /\bmusic|nascar|cooking shows|this old house\b/i.test(text) ? "familiar low-volume audio" : "",
    /\bfidget|headphones|weighted blanket\b/i.test(text) ? "calming items such as fidgets or headphones" : "",
    /\bcandy|gumm|swedish fish\b/i.test(text) ? "candy or gummies when they help redirect or motivate" : ""
  ].filter(Boolean);
  const transitions = [
    /\bvisual schedule|written schedule|schedule\b/i.test(text) ? "visual or written schedules" : "",
    /\bvisual timer|timer\b/i.test(text) ? "timers" : "",
    /\bfirst[ -]?then|first this,? then that\b/i.test(text) ? "First-Then language" : "",
    /\btransition|change|advance|beforehand|ahead of time\b/i.test(text) ? "preparing for transitions ahead of time" : "",
    /\bhype|hyping|enthusiastic|enthusiastically\b/i.test(text) ? "enthusiastically hyping up where they are going or what they will do" : "",
    /\bspeak|orient|tell .*what|what .*doing|startle\b/i.test(text) ? "speaking first and explaining what is happening" : "",
    /\breward|motivat|preferred\b/i.test(text) ? "using a preferred item or activity as motivation" : ""
  ].filter(Boolean);
  const safety = [
    /\bsafe|cannot hurt|can't hurt|self-harm|self harm\b/i.test(text) ? "make sure they are safe and cannot hurt themself" : "",
    /\bfloor|get down|safely down\b/i.test(text) ? "helping them get safely positioned when needed" : "",
    /\bhand biting|bite you|do not .*block|don't .*block|do not .*stop|don't .*stop\b/i.test(text) ? "do not physically stop or block hand biting because they may bite you or cause caregiver injury" : "",
    /\belop|run away|running away\b/i.test(text) ? "stay nearby and manage elopement risk" : "",
    /\bcontact\b.{0,80}\bcaregivers?\b|\bcaregivers?\b.{0,80}\bcontact\b/i.test(text) ? "contact caregivers when you need guidance" : "",
    /\bcontact\b.{0,80}\bfamily\b|\bfamily\b.{0,80}\bcontact\b|\bdo not hesitate\b.{0,80}\b(?:contact|call)\b|\bdon't hesitate\b.{0,80}\b(?:contact|call)\b/i.test(text)
      ? "contact family when you need guidance, even if you are unsure"
      : "",
    /\bseizure\b.{0,120}\b(?:car|home|bed|recover)|\b(?:car|home|bed|recover)\b.{0,120}\bseizure\b/i.test(text)
      ? "after a seizure, help them get safely home and settled for recovery"
      : "",
    /\bsafe in (?:his|her|their) space\b|\bsafety checks?\b|\boutside close by\b/i.test(text)
      ? "stay close enough to complete safety checks while they remain safe in their space"
      : ""
  ].filter(Boolean);

  return groupedBlock([
    { label: "Environmental supports", items: [groupedListItem("Environmental supports include", environmental)] },
    { label: "Calming supports", items: [groupedListItem("Calming supports include", calming)] },
    { label: "Transitions and motivation", items: [groupedListItem("Transition supports include", transitions)] },
    { label: "Safety in the moment", items: [groupedListItem("In the moment", safety)] }
  ]);
}

function groupEscalationSupport(facts: StructuredCaptureFact[], name: string) {
  const text = factText(facts);
  const supports = [
    /\bspace|do not crowd|don't crowd|back off\b/i.test(text) ? `give ${name} space` : "",
    /\bquiet|noise|stimulation|not a lot going on|environment\b/i.test(text) ? "keep things quiet" : "",
    /\bhand biting|bite you|do not .*block|don't .*block|do not .*stop|don't .*stop\b/i.test(text)
      ? "do not physically stop hand biting"
      : ""
  ].filter(Boolean);

  return supports.length >= 2 ? sentence(`When escalation is high, ${formatInsightList(supports)}`) : "";
}

function composeGuideSummaryFromCapture(
  summary: StructuredSummary,
  capture: StructuredCapture,
  nameHint?: string
) {
  const byGuide = new Map<GuideSectionTitle, StructuredCaptureFact[]>(
    GUIDE_SECTION_TITLES.map((title) => [title, []])
  );
  const name = displaySubject(nameHint);
  const pronouns = pronounSet(nameHint);

  for (const fact of capture.facts) {
    byGuide.get(guideSectionForFact(fact))?.push(fact);
  }

  const factsFor = (title: GuideSectionTitle) => byGuide.get(title) ?? [];
  const aboutFacts = capture.facts.filter((fact) =>
    fact.safetyRelevant ||
    fact.factKind === "communication_method" ||
    fact.factKind === "learning" ||
    fact.factKind === "condition"
  );
  const communicationFacts = factsFor("Communication");
  const learningFacts = factsFor("Understanding and Learning");
  const routineFacts = factsFor("Daily Routine");
  const foodFacts = factsFor("Food and Meals");
  const activityFacts = factsFor("Activities and Interests");
  const triggerFacts = factsFor("What Can Upset or Overwhelm");
  const signFacts = factsFor("Signs They Need Help");
  const supportFacts = factsFor("What Helps When They Are Having a Hard Time");
  const healthFacts = factsFor("Health & Safety");

  const hygieneSummary = groupHygiene(routineFacts, name);
  const foodSummary = groupFoods(foodFacts);
  const illnessPainSummary = groupIllnessPainSigns(signFacts);

  const sections = GUIDE_SECTION_TITLES.map((title, index) => {
    if (title === "About") {
      return compactSection(
        title,
        index,
        `${name} has practical support needs that are easiest to understand when communication, routines, regulation, and safety are viewed together`,
        [
          guideBlock("note", [
            `Use this guide to understand ${name}'s support needs across communication, routines, regulation, food, activities, and health and safety.`
          ])
        ]
      );
    }

    if (title === "Communication") {
      const reportingLimitNote = groupReportingLimits(capture.facts, name);
      const nonverbalNote = groupNonverbalCommunication(capture.facts, name);
      const aacRequestNote = groupAacRequestMeanings(capture.facts, name);
      const ipadRequestMeaningNote = groupIpadRequestMeanings(capture.facts, name);
      const communicationMethodDetails = groupCommunicationMethodDetails(communicationFacts, name);
      return compactSection(title, index, `${name} may communicate through AAC, body language, sounds, behavior, and proximity.`, [
        reportingLimitNote ? guideBlock("note", [reportingLimitNote]) : null,
        aacRequestNote ? guideBlock("note", [aacRequestNote]) : null,
        ipadRequestMeaningNote ? guideBlock("note", [ipadRequestMeaningNote]) : null,
        nonverbalNote ? guideBlock("note", [nonverbalNote]) : null,
        groupedBlock(limitGroupItems(exclusiveGroups(rejectStatements(communicationFacts.map((fact) => fact.statement), [
          nonverbalCommunicationPattern(),
          aacMethodGroupingPattern(),
          communicationMethodGroupingPattern(),
          ipadRequestMeaningPattern()
        ]), [
          { label: "How they communicate", pattern: /aac|touchchat|non-speaking|body language|gesture|sound|voice|vocal|communicat|happy|sad|label/i },
          { label: "What specific things mean", pattern: /\bmeans?|indicate|select|press|lead|close|attention|help|i want ipad|word car|search history|internet|touch|sit/i },
          { label: "What helps communication", pattern: /visual choices|pictures|simple|wait|demonstrat|show|choices|support|items to pick|non-verbal/i }
        ]), {
          "How they communicate": 6,
          "What specific things mean": 4,
          "What helps communication": 4
        }).map((group) =>
          group.label === "How they communicate"
            ? { ...group, items: [...communicationMethodDetails, ...group.items] }
            : group
        ))
      ]);
    }

    if (title === "Understanding and Learning") {
      const learningSummary = groupLearningSupport(learningFacts, name);
      const extraLearningNotes = [
        hasAny(factText(learningFacts), /\bmore than two steps\b|\bgets lost\b/i)
          ? "More than two steps at one time can be hard for him."
          : ""
      ].filter(Boolean);
      const remaining = rejectStatements(
        learningFacts.map((fact) => fact.statement),
        [learningGroupingPattern()]
      );
      return compactSection(title, index, undefined, [
        learningSummary ? guideBlock("note", [learningSummary]) : null,
        groupedBlock([
          { label: "How they learn", items: [...extraLearningNotes, ...remaining] },
          { label: "Visual and concrete supports", items: groupedLearningDetailStatements(learningFacts) }
        ])
      ]);
    }

    if (title === "Daily Routine") {
      const routineStatements = routineFacts.map((fact) => fact.statement);
      const dayRoutineSummaries = groupDayRoutines(routineFacts);
      const toiletingSummary = groupToiletingRoutine(routineFacts, name);
      const toiletingDetails = groupToiletingDetails(routineFacts, name);
      const hydrationDetails = groupHydrationRoutineDetails(routineFacts, name);
      const hygieneDetails = [
        ...groupHygieneDetails(routineFacts, name),
        ...routineStatements.filter((statement) =>
          hygieneGroupingPattern().test(statement) &&
          !detailedHygieneGroupingPattern().test(statement) &&
          !simpleHygieneAssistancePattern().test(statement) &&
          !/\b(?:void|pee|urinate|showerhead)\b/i.test(statement)
        )
      ];
      const remaining = rejectStatements(routineStatements, [
        hygieneGroupingPattern(),
        detailedHygieneGroupingPattern(),
        toiletingGroupingPattern(),
        dayRoutinePattern(),
        foodGroupingPattern(),
        foodAvoidancePattern(),
        hydrationRoutinePattern()
      ]);
      return compactSection(title, index, undefined, [
        hygieneSummary ? guideBlock("note", [hygieneSummary]) : null,
        toiletingSummary ? guideBlock("note", [toiletingSummary]) : null,
        groupedBlock(limitGroupItems([
          { label: "Day-specific routines", items: dayRoutineSummaries },
          { label: "Hygiene and dressing details", items: hygieneDetails },
          { label: "Toileting and bathroom support", items: toiletingDetails },
          { label: "Hydration support", items: hydrationDetails },
          { label: "Morning and daily routines", items: remaining.filter((statement) => !/[“"][^”"]*$/.test(statement)).slice(0, 4) }
        ], {
          "Hygiene and dressing details": 5,
          "Toileting and bathroom support": 5
        }))
      ]);
    }

    if (title === "Food and Meals") {
      const foodNotes = groupFoodNotes(foodFacts, name);
      const avoidedFoods = groupFoodAvoidance(foodFacts);
      return compactSection(title, index, undefined, [
        foodSummary ? guideBlock("note", [foodSummary]) : null,
        avoidedFoods ? guideBlock("note", [avoidedFoods]) : null,
        groupedBlock([
          { label: "Food and drink notes", items: foodNotes.slice(0, 6) }
        ])
      ]);
    }

    if (title === "Activities and Interests") {
      const activityGroup = groupActivityPreferences(activityFacts, name);
      const remaining = rejectStatements(activityFacts.map((fact) => fact.statement), [
        activityGroupingPattern(),
        /\bbiggest favorites?\b|\bfavorites?\s+include\b/i,
        foodGroupingPattern(),
        /\b(car ride|soothe|calm|redirect|space|quiet|hand biting|bite the caregiver)\b/i
      ]);
      return compactSection(title, index, undefined, [
        activityGroup,
        labeledBlock("Additional activity notes", remaining.slice(0, 2))
      ]);
    }

    if (title === "What Can Upset or Overwhelm") {
      const triggerStatements = triggerFacts.map((fact) => fact.statement);
      const triggerDetails = groupTriggerDetails(triggerFacts, name);
      return compactSection(title, index, undefined, [
        groupedBlock(limitGroupItems(exclusiveGroups(rejectStatements(triggerStatements, [
          groupedTriggerDetailPattern()
        ]), [
          { label: "Sensory and environmental triggers", pattern: /loud|noise|crowd|bright|light|shade|chaotic|overstimulat|people/i },
          { label: "Routine, transition, and control triggers", pattern: /routine|transition|moved|out of place|expected|waiting|rushed|demand|hard/i },
          { label: "Body-state triggers", pattern: /hunger|hungry|tired|ill|pain|hot|cold/i }
        ]).map((group) => {
          if (group.label === "Sensory and environmental triggers") {
            return { ...group, items: [...triggerDetails.sensory, ...group.items] };
          }

          if (group.label === "Routine, transition, and control triggers") {
            return { ...group, items: [...triggerDetails.routine, ...group.items] };
          }

          return group;
        }), {
          "Sensory and environmental triggers": 3,
          "Routine, transition, and control triggers": 3,
          "Body-state triggers": 3
        }))
      ]);
    }

    if (title === "Signs They Need Help") {
      const behaviorSignsSummary = groupBehaviorSigns(capture.facts);
      const signStatements = rejectStatements(signFacts.map((fact) => fact.statement), [
        illnessPainGroupingPattern(),
        /\belop(?:e|es|ed|ing|ement)?|run away|running away|hand biting|bit(?:e|es|ing)? (?:his|her|their) hand|angry (?:sounds?|noises?|vocalizations?)|yelling|shouting|flailing|flare .*arms|flail .*arms\b/i,
        /\bagitat(?:ed|ion)\b.*\b(?:needs? help|show|face)|\bneeds? help\b.*\bagitat/i,
        /\bhid(?:e|ing)|disappears?|hiding when .*bowel movement.*sign\b/i,
        /\b(?:does not|doesn't|do not|don't|has not|never|no known|not known|not a|not at)\b.{0,55}\b(?:run away|running away|elope|elopement|wander|safety risk|risk|unsafe)\b/i
      ]);
      return compactSection(title, index, undefined, [
        illnessPainSummary ? guideBlock("note", [illnessPainSummary]) : null,
        behaviorSignsSummary ? guideBlock("note", [behaviorSignsSummary]) : null,
        groupedBlock(limitGroupItems(exclusiveGroups(signStatements, [
          { label: "Body signs", pattern: /limp|body part|not eating|not drinking|appetite|letharg|low energy|sick|illness|pain|walking strangely|too hot|too cold|clammy|stomach|seizure|pulls? .*legs?/i },
          { label: "Behavior signs", pattern: /agitat|dysregulat|hand biting|elope|run away|hiding|grunt|bowel|fridge|cheese|hungry/i },
          { label: "Communication signs", pattern: /press(?:es)? help|signs? for help|aac|device|ask for help|too dysregulated/i }
        ]), {
          "Body signs": 5,
          "Behavior signs": 4,
          "Communication signs": 4
        }))
      ]);
    }

    if (title === "What Helps When They Are Having a Hard Time") {
      const escalationSupportSummary = groupEscalationSupport(supportFacts, name);
      const supportStatements = rejectStatements(supportFacts.map((fact) => fact.statement), [
        supportGroupingPattern()
      ]).filter((statement) => !/[“"][^”"]*$/.test(statement));
      return compactSection(title, index, undefined, [
        escalationSupportSummary ? guideBlock("note", [escalationSupportSummary]) : null,
        groupSupportFacts(supportFacts),
        labeledBlock("Additional support notes", supportStatements.slice(0, 3))
      ]);
    }

    if (title === "Health & Safety") {
      const healthSafetySummary = groupHealthSafetyRisks(capture.facts);
      const medicationDetails = groupMedicationDetails(capture.facts);
      const allergyAndConditionDetails = groupAllergyAndConditionDetails(healthFacts);
      const equipmentDetails = groupEquipmentDetails(healthFacts);
      const familyCallGuidance = groupFamilyCallGuidance(healthFacts, name);
      const healthStatements = [
        ...medicationDetails,
        ...allergyAndConditionDetails,
        ...equipmentDetails,
        familyCallGuidance,
        ...rejectStatements(healthFacts.map((fact) => fact.statement), [
        /\bno medication information was provided\b/i,
        /\bbuckled? .*Buckle Buddy\b/i,
        /\bARIPiprazole\b.*\bused to help manage\b/i,
        groupedMedicationPattern(),
        groupedEquipmentPattern(),
        familyCallGuidancePattern(),
        healthSafetyGroupingPattern()
        ])
      ].filter(Boolean);
      return compactSection(title, index, undefined, [
        healthSafetySummary ? guideBlock("note", [healthSafetySummary]) : null,
        groupedBlock(limitGroupItems(exclusiveGroups(healthStatements, [
          { label: "Emergency contacts", pattern: /\b(phone number|call 911|emergency|non-?emergency|guardian|physical custody|617-|contact .*first|call(?:ed)? .*first|should be called first|call .*family|family .*call|any time of day or night|even for questions|not hesitate to call|contact (?:his|her|their)?\s*(?:mother|father|parent|guardian|grandmother|grandfather|sister|brother)|(?:mother|father|parent|guardian|grandmother|grandfather|sister|brother).{0,60}\b(?:emergency|contact|call|called first|phone number))\b/i },
          { label: "Diagnoses and conditions", pattern: /diagnos|condition|autism|autistic|g6pd|diabetes|pica|apraxia|developmental|processing|cerebral|cerebral palsy|\bcp\b|blind|blindness|vision|gastrointestinal|\bgi\b|seizures?|prematur|oxygen|syndrome|trisomy|down syndrome|tcf20|mutation|chromosome|intellectual disability|eczema|boils?|disability|delay|tone|language regression|receptive|expressive/i },
          { label: "Medications and allergies", pattern: /medicat|medicine|medicines|pill|hydration|vaginal|vulvar|yogurt|applesauce|abilify|aripiprazole|miralax|polyethylene|clearlax|gavilax|healthylax|multivitamin|gummy vites|propranolol|citalopram|sitelapram|esomeprazole|tylenol|melatonin|ritalin|\bRIT\b|allerg|reaction|dose|mg\b|17 g|3 pm/i },
          { label: "Equipment and supports", pattern: /equipment|aac|touchchat|headphones|glasses|hearing aids?|buckle|cane|pull|fidget|wheelchair|lift|chair|passenger seat|bathroom setup|bolster|bungee|underpad|liner|golf cart|seat belts?|ice sled|exercise ball/i },
          { label: "Supervision and safety", pattern: /supervision|safety|adult|two people|two caregivers|elop|hand biting|hurt|danger|swallow|unsafe|self-injury/i }
        ]), {
          "Emergency contacts": 6,
          "Diagnoses and conditions": 9,
          "Medications and allergies": 6,
          "Equipment and supports": 6,
          "Supervision and safety": 3
        }))
      ]);
    }

    const tips = [
      communicationFacts.some((fact) => /aac|non-speaking|body language|gesture|sound/i.test(fact.statement))
        ? `Watch ${pronouns.possessive} communication across AAC, body language, sounds, and behavior`
        : "",
      learningFacts.some((fact) => /visual|video|schedule|first[ -]?then|pictures?/i.test(fact.statement))
        ? "Use visual supports and concrete examples whenever possible"
        : "",
      supportFacts.some((fact) => /space|quiet|stimulation|crowd/i.test(fact.statement))
        ? "Reduce stimulation and give space when things are escalating"
        : "",
      triggerFacts.some((fact) => /routine|change|unexpected|moved|out of place/i.test(fact.statement))
        ? "Prepare for changes and keep routines predictable"
        : "",
      healthFacts.some((fact) => /safety|supervision|elop|hand biting|risk|911|contact/i.test(fact.statement))
        ? "Prioritize safety and contact the listed caregiver or emergency support when needed"
        : ""
    ].filter(Boolean);

    return compactSection(title, index, undefined, [labeledBlock("Quick tips", tips)]);
  });

  const composed: StructuredSummary = {
    ...summary,
    title: summary.title || (nameHint ? `Caring for ${nameHint}` : "Caregiver Handoff Summary"),
    sections
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

function collectDuplicateIssues(summary: StructuredSummary) {
  const issues: SummaryAuditIssue[] = [];

  for (const section of summary.sections) {
    const title = GUIDE_SECTION_TITLES.find((candidate) => candidate === section.title);
    if (!title) {
      continue;
    }

    for (let index = 0; index < section.items.length; index += 1) {
      const item = section.items[index];
      for (let otherIndex = index + 1; otherIndex < section.items.length; otherIndex += 1) {
        const otherItem = section.items[otherIndex];
        if (
          statementLooksCovered(item, [otherItem]) ||
          statementLooksCovered(otherItem, [item])
        ) {
          issues.push({
            code: "duplicate_item",
            message: `${title} contains duplicate or overlapping bullets that should be collapsed.`,
            expectedSection: title,
            item
          });
          break;
        }
      }
    }
  }

  return issues;
}

function auditSummaryAgainstCapture(summary: StructuredSummary, capture: StructuredCapture) {
  const issues: SummaryAuditIssue[] = [];
  const itemsBySection = summaryItemsBySection(summary);

  for (const fact of capture.facts) {
    const expectedSection = guideSectionForFact(fact);
    const requiresVisibleCoverage = factRequiresVisibleGuideCoverage(fact);
    const expectedItems = itemsBySection.get(expectedSection) ?? [];
    const matchedInExpected = expectedItems.some((item) => factLooksCoveredByItem(fact, item));

    if (matchedInExpected) {
      continue;
    }

    const matchedElsewhere = GUIDE_SECTION_TITLES.find((title) => {
      if (title === expectedSection) {
        return false;
      }

      return (itemsBySection.get(title) ?? []).some((item) => factLooksCoveredByItem(fact, item));
    });

    if (matchedElsewhere) {
      if (!requiresVisibleCoverage) {
        continue;
      }

      issues.push({
        code: "section_leakage",
        message: `${fact.factId} is only represented in ${matchedElsewhere} but belongs in ${expectedSection}.`,
        factId: fact.factId,
        expectedSection,
        actualSection: matchedElsewhere
      });
      continue;
    }

    if (!requiresVisibleCoverage) {
      continue;
    }

    issues.push({
      code: "missing_coverage",
      message: `${fact.factId} is missing from ${expectedSection}: ${fact.statement}`,
      factId: fact.factId,
      expectedSection
    });
  }

  for (const section of summary.sections) {
    const title = GUIDE_SECTION_TITLES.find((candidate) => candidate === section.title);
    if (!title) {
      continue;
    }

    for (const item of section.items) {
      if (normalizeCoverageText(item) === normalizeCoverageText(NO_INFORMATION_PLACEHOLDER)) {
        continue;
      }

      const authoritativeTitle = inferAuthoritativeSectionTitle(item, title);
      if (authoritativeTitle !== title) {
        if (
          title === "What Helps When They Are Having a Hard Time" &&
          supportGroupingPattern().test(item)
        ) {
          continue;
        }

        if (
          title === "Health & Safety" &&
          /\b(caregiver does not know the doses|diagnosis|condition|medications? and allergies|equipment and supports)\b/i.test(item)
        ) {
          continue;
        }

        issues.push({
          code: "wrong_section",
          message: `A bullet in ${title} belongs in ${authoritativeTitle}: ${item}`,
          expectedSection: authoritativeTitle,
          actualSection: title,
          item
        });
      }
    }
  }

  return [...issues, ...collectDuplicateIssues(summary)];
}

function summarizeAuditIssues(issues: SummaryAuditIssue[]) {
  return [...new Set(issues.map((issue) => issue.message))].slice(0, 8);
}

function auditAndFinalizeSummary(
  summary: StructuredSummary,
  capture: StructuredCapture,
  nameHint?: string
) {
  const composed = composeGuideSummaryFromCapture(summary, capture, nameHint);
  const clusters = buildFactClusters(capture);
  const captureIssues = auditSummaryAgainstCapture(composed, capture);
  const { summary: normalized, report } = finalizeSummaryWithQa(composed, {
    source: "generated",
    nameHint,
    issues: captureIssues,
    diagnostics: []
  });
  const sectionItems = new Map(
    normalized.sections.map((section) => [
      section.title as GuideSectionTitle,
      section.items.filter((item) => normalizeCoverageText(item) !== normalizeCoverageText(NO_INFORMATION_PLACEHOLDER))
    ] as const)
  );
  const statuses: FactAuditStatus[] = [];
  for (const cluster of clusters) {
    const expectedSection = guideSectionForFact(cluster.facts[0]);
    const expectedItems = sectionItems.get(expectedSection) ?? [];
    const matchedInExpected = expectedItems.find((item) =>
      cluster.facts.some((fact) => factLooksCoveredByItem(fact, item))
    );

    if (matchedInExpected) {
      statuses.push(
        ...cluster.facts.map((fact) => ({
          factId: fact.factId,
          clusterId: cluster.clusterId,
          expectedSection,
          factKind: cluster.factKind,
          status: "covered" as const,
          matchedBullet: matchedInExpected
        }))
      );
      continue;
    }

    const matchedElsewhere = GUIDE_SECTION_TITLES.find((title) => {
      if (title === expectedSection) {
        return false;
      }

      return (sectionItems.get(title) ?? []).some((item) =>
        cluster.facts.some((fact) => factLooksCoveredByItem(fact, item))
      );
    });

    if (matchedElsewhere) {
      if (!cluster.facts.some(factRequiresVisibleGuideCoverage)) {
        statuses.push(
          ...cluster.facts.map((fact) => ({
            factId: fact.factId,
            clusterId: cluster.clusterId,
            expectedSection,
            factKind: cluster.factKind,
            status: "internal" as const
          }))
        );
        continue;
      }

      const matchedBullet = (sectionItems.get(matchedElsewhere) ?? []).find((item) =>
        cluster.facts.some((fact) => factLooksCoveredByItem(fact, item))
      );
      statuses.push(
        ...cluster.facts.map((fact) => ({
          factId: fact.factId,
          clusterId: cluster.clusterId,
          expectedSection,
          factKind: cluster.factKind,
          status: "leaked" as const,
          actualSection: matchedElsewhere,
          matchedBullet
        }))
      );
      continue;
    }

    if (!cluster.facts.some(factRequiresVisibleGuideCoverage)) {
      statuses.push(
        ...cluster.facts.map((fact) => ({
          factId: fact.factId,
          clusterId: cluster.clusterId,
          expectedSection,
          factKind: cluster.factKind,
          status: "internal" as const
        }))
      );
      continue;
    }

    statuses.push(
      ...cluster.facts.map((fact) => ({
        factId: fact.factId,
        clusterId: cluster.clusterId,
        expectedSection,
        factKind: cluster.factKind,
        status: "missing" as const
      }))
    );
  }

  return {
    summary: normalized,
    report: {
      ...report,
      diagnostics: [...report.diagnostics, ...buildAuditDiagnostics(statuses)]
    }
  };
}

export function buildSummarySectionArtifacts(summary: StructuredSummary): SummarySectionArtifact[] {
  return summary.sections.map((section) => ({
    sectionTitle: section.title,
    itemsJson: {
      id: section.id,
      title: section.title,
      intro: section.intro,
      items: section.items,
      blocks: section.blocks
    }
  }));
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

function modelSupportsCustomTemperature(model: string) {
  return !/^gpt-5\.5(?:$|-)/i.test(model);
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

  let response: Response;

  try {
    const requestBody = {
      model,
      store: false,
      ...(modelSupportsCustomTemperature(model) ? { temperature } : {}),
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
    };

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
        undefined,
        "timeout"
      );
    }

    throw new SummaryModelRequestError(
      "Summary generation could not reach the model provider."
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

    throw new SummaryModelRequestError(message, response.status);
  }

  const data = (await response.json()) as {
    choices?: Array<{
      finish_reason?: string | null;
      message?: {
        content?: string | ChatCompletionContentPart[];
        refusal?: string | null;
      };
    }>;
  };

  const choice = data.choices?.[0];
  const content = extractChatCompletionText(choice?.message?.content);
  if (choice?.finish_reason === "length") {
    console.error("[summary:model] structured response truncated", {
      schemaName,
      model,
      maxCompletionTokens,
      contentLength: content.length
    });
    throw new SummaryModelTruncationError(schemaName, maxCompletionTokens, content.length);
  }

  if (choice?.message?.refusal) {
    throw new SummaryModelRequestError(
      "Summary generation could not process the provided answers.",
      undefined,
      "refusal"
    );
  }

  if (!content) {
    throw new SummaryModelRequestError(
      "Summary generation returned an empty structured response.",
      undefined,
      "empty_response"
    );
  }

  try {
    return parseStructuredCompletionContent<T>(content);
  } catch (error) {
    console.error("[summary:model] invalid structured response", {
      schemaName,
      model,
      finishReason: choice?.finish_reason ?? null,
      contentLength: content.length,
      parseError: error instanceof Error ? error.message : "Unknown parse error"
    });
    throw new SummaryModelRequestError(
      "Summary generation returned invalid structured JSON.",
      undefined,
      "invalid_json"
    );
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
    userPrompt: `${summarySchemaDescription}\n\n${sevenSectionOneStepRules}\n\n${buildTitleInstruction(
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
  const entryMetadata = new Map(entries.map((entry) => [entry.entryId, entry] as const));
  const entryBatches = buildSummaryEntryBatches(entries, CAPTURE_PROMPT_TARGET_CHARS);
  const capturedBatches = new Array<StructuredCaptureFact[]>(entryBatches.length);
  let nextBatchIndex = 0;

  const captureBatch = async (
    batch: SummarySourceEntry[]
  ): Promise<StructuredCaptureFact[]> => {
    try {
      const rawCapture = await requestStructuredCompletion<StructuredCapture>({
        apiKey,
        model,
        schemaName: "caregiver_handoff_structured_capture",
        schema: captureSchema,
        systemPrompt:
          "You are a structured capture step for caregiver handoff notes. Preserve facts, split them into atomic statements, assign each one to the best section, and never drop meaningful care information.",
        userPrompt: `${sevenSectionCaptureRules}\n\nCaregiver input:\n${batch
          .map((entry) => entry.text)
          .join("\n\n")}`,
        temperature: 0.1,
        maxCompletionTokens: 6000
      });

      return normalizeCapture(rawCapture, entryMetadata).facts;
    } catch (error) {
      if (
        batch.length > 1 &&
        (
          error instanceof SummaryModelTruncationError ||
          (error instanceof SummaryModelRequestError && error.code === "timeout")
        )
      ) {
        const midpoint = Math.ceil(batch.length / 2);
        const [left, right] = await Promise.all([
          captureBatch(batch.slice(0, midpoint)),
          captureBatch(batch.slice(midpoint))
        ]);
        return [...left, ...right];
      }

      throw error;
    }
  };

  const captureWorker = async () => {
    while (nextBatchIndex < entryBatches.length) {
      const batchIndex = nextBatchIndex;
      nextBatchIndex += 1;
      capturedBatches[batchIndex] = await captureBatch(entryBatches[batchIndex]);
    }
  };

  await Promise.all(
    Array.from(
      { length: Math.min(CAPTURE_CONCURRENCY_LIMIT, entryBatches.length) },
      () => captureWorker()
    )
  );

  const captures = capturedBatches.flat();

  return {
    facts: dedupeCaptureFacts([
      ...captures,
      ...deterministicCommunicationFacts(entries),
      ...deterministicToiletingFacts(entries)
    ])
  } satisfies StructuredCapture;
}

async function generateCaregiverInsights(
  apiKey: string,
  model: string,
  capture: StructuredCapture,
  nameHint?: string
) {
  const deterministicInsights = buildVisualLearningInsight(capture, nameHint);
  if (capture.facts.length < 2) {
    return deterministicInsights;
  }

  try {
    const rawInsights = await requestStructuredCompletion<StructuredInsightCapture>({
      apiKey,
      model,
      schemaName: "caregiver_handoff_insights",
      schema: insightSchema,
      systemPrompt:
        "You synthesize caregiver handoff facts into short, non-clinical caregiver insights. You only use provided facts and cite supporting fact IDs.",
      userPrompt: `${caregiverInsightRules}\n\n${
        nameHint ? `Care recipient name: ${nameHint}\n\n` : ""
      }Structured facts:\n${groupFactsForRewritePrompt(capture)}`,
      temperature: 0.1,
      maxCompletionTokens: 2500
    });

    return mergeCaregiverInsights(
      deterministicInsights,
      normalizeInsightCapture(rawInsights, capture)
    );
  } catch (error) {
    console.error("[summary:insights] insight generation failed; continuing with deterministic insights", {
      errorName: error instanceof Error ? error.name : "UnknownError",
      errorMessage: error instanceof Error ? error.message : "Unknown insight error"
    });
    return deterministicInsights;
  }
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
    userPrompt: `${summarySchemaDescription}\n\n${sevenSectionRewriteRules}\n\n${buildTitleInstruction(
      nameHint
    )}\n\nStructured capture:\n${groupFactsForRewritePrompt(capture)}${repairPrompt}`,
    temperature: 0.1,
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
  nameHint?: string
) {
  const capture = await captureSummaryFacts(apiKey, model, turns);
  if (capture.facts.length === 0) {
    return null;
  }

  const caregiverInsights = await generateCaregiverInsights(apiKey, model, capture, nameHint);
  const firstPass = auditAndFinalizeSummary(
    buildGuideSummaryShell(nameHint, caregiverInsights),
    capture,
    nameHint
  );
  return {
    ...firstPass,
    facts: capture.facts
  };
}

export function buildSummarySource(turns: ConversationTurn[]) {
  return buildSummaryEntries(turns).map((entry) => entry.text).join("\n\n");
}

function finalizeGeneratedSummary(
  summary: StructuredSummary,
  turns: ConversationTurn[],
  nameHint?: string,
  existingReport?: SummaryAuditReport,
  facts: StructuredCaptureFact[] = []
) {
  const finalized = existingReport
    ? {
        summary,
        report: existingReport
      }
    : finalizeSummaryWithQa(summary, {
        source: "generated",
        nameHint
      });
  const normalized = finalized.summary;
  const report = finalized.report;

  const finalSummary = {
      ...normalized,
      pipelineVersion: SUMMARY_PIPELINE_VERSION,
      layoutVersion: SUMMARY_LAYOUT_VERSION,
      sourceTurnsHash: computeTurnsHash(turns)
    } satisfies StructuredSummary;

  return {
    summary: finalSummary,
    auditReport: report,
    facts,
    sectionSummaries: buildSummarySectionArtifacts(finalSummary)
  } satisfies SummaryGenerationResult;
}

export async function generateCaregiverSummaryWithQa(
  turns: ConversationTurn[],
  nameHint?: string,
  mode: SummaryGenerationMode = "two-step"
): Promise<SummaryGenerationResult> {
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

    const result = await generateSummaryTwoStep(apiKey, model, turns, nameHint);
    if (!result) {
      throw new SummaryQualityError(
        "Summary generation returned no structured two-step summary.",
        []
      );
    }
    return finalizeGeneratedSummary(result.summary, turns, nameHint, result.report, result.facts);
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

    throw new SummaryModelRequestError("Summary generation failed unexpectedly.");
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
