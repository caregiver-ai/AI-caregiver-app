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
const DEFAULT_SUMMARY_MODEL = "gpt-5.4";
const DEFAULT_OPENAI_TIMEOUT_MS = 75_000;
const CAPTURE_ENTRY_TARGET_CHARS = 2_400;
const CAPTURE_PROMPT_TARGET_CHARS = 7_200;

const SUMMARY_SECTION_TITLES = [...PREFERRED_SUMMARY_SECTION_ORDER];

type SummarySectionTitle = (typeof SUMMARY_SECTION_TITLES)[number];

type ChatCompletionContentPart = {
  type?: string;
  text?: string;
};

type StructuredCaptureFact = {
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

type StructuredCapture = {
  facts: StructuredCaptureFact[];
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
  expectedSection: SummarySectionTitle;
  factKind: StructuredFactKind;
  status: "covered" | "leaked" | "missing" | "duplicated";
  actualSection?: SummarySectionTitle;
  matchedBullet?: string;
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

  constructor(message: string, status?: number) {
    super(message);
    this.name = "SummaryModelRequestError";
    this.status = status;
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

const sevenSectionRewriteRules = `Rewrite the structured facts into a concise caregiver-ready handoff.

${sevenSectionGuidance}

Keep each fact in its assigned section and use each factKind consistently. Include all seven sections. Every captured fact must appear in the final summary. Use one clear idea per bullet, combine facts only when the combined bullet preserves every detail, keep medications/equipment/contacts distinct, and return ["${NO_INFORMATION_PLACEHOLDER}"] for an empty section.

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

function buildSummaryEntryChunks(entries: SummarySourceEntry[], targetChars: number) {
  const chunks: string[] = [];
  let current: string[] = [];
  let currentLength = 0;

  const flush = () => {
    if (current.length > 0) {
      chunks.push(current.join("\n\n"));
      current = [];
      currentLength = 0;
    }
  };

  for (const entry of entries) {
    const nextLength = currentLength + (current.length > 0 ? 2 : 0) + entry.text.length;
    if (current.length > 0 && nextLength > targetChars) {
      flush();
    }

    current.push(entry.text);
    currentLength += (current.length > 1 ? 2 : 0) + entry.text.length;
  }

  flush();
  return chunks;
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

function statementLooksLikeMedication(value: string) {
  return /\b(abilify|aripiprazole|miralax|polyethylene glycol|clearlax|gavilax|healthylax|multivitamin|gummy vites|mg\b|dose|once a day|daily at|3pm|3 p\.m\.)\b/i.test(
    value
  );
}

function statementLooksLikeEquipment(value: string) {
  return /\b(aac on an ipad|aac device|touchchat|noise-?cancel(?:ing)? headphones?|headphones?|buckle buddy|fidgets?|white cane)\b/i.test(
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
  return /\b(learn|understand|process(?:ing)?|read|write|literacy|one-step|two-step|direction|extra time|express|consequence|decision|recognizes? (?:pictures?|words?)|independent)\b/i.test(
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

function statementLooksLikeSupportStrategy(value: string) {
  return /\b(help|helps|helpful|work best|works best|reset|calm|sooth|regulat)\b/i.test(value) &&
    /\b(quiet|low-light|dim|space|stimulation|noise|car ride|time alone|visual choices?|limited choices?)\b/i.test(
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

function statementLooksLikeContact(value: string) {
  return /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3}).*\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/.test(value);
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

  if (fact.conceptKeys.length === 0) {
    return false;
  }

  const safeConcepts = new Set([
    "non_speaking",
    "elopement",
    "bowel_movement_sign",
    "limping_sign",
    "not_eating_sign",
    "not_drinking_sign",
    "low_energy_sign",
    "vocalization_sign",
    "hunger_sign",
    "caregiver_leading_sign",
    "attention_sign",
    "offer_car_ride",
    "do_not_block_hand_biting",
    "calming_prompt"
  ]);
  const itemConcepts = extractCoverageConcepts(item);
  if (
    fact.conceptKeys.includes("help_request_signal") &&
    itemConcepts.has("help_request_signal") &&
    helpRequestMode(fact.statement) !== "" &&
    helpRequestMode(fact.statement) === helpRequestMode(item)
  ) {
    return true;
  }

  if (
    fact.section === "Signs They Are Having a Hard Time" &&
    fact.conceptKeys.includes("hand_biting") &&
    itemConcepts.has("hand_biting") &&
    /\b(?:sign|help is needed|needs? help)\b/i.test(item)
  ) {
    return true;
  }

  return fact.conceptKeys.some(
    (concept) => safeConcepts.has(concept) && itemConcepts.has(concept)
  );
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
    buckets.get(cluster.section)?.push(selected?.item ?? clusterStatement(cluster));
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

function collectDuplicateIssues(summary: StructuredSummary) {
  const issues: SummaryAuditIssue[] = [];

  for (const section of summary.sections) {
    const title = SUMMARY_SECTION_TITLES.find((candidate) => candidate === section.title);
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
      issues.push({
        code: "section_leakage",
        message: `${fact.factId} is only represented in ${matchedElsewhere} but belongs in ${fact.section}.`,
        factId: fact.factId,
        expectedSection: fact.section,
        actualSection: matchedElsewhere
      });
      continue;
    }

    issues.push({
      code: "missing_coverage",
      message: `${fact.factId} is missing from ${fact.section}: ${fact.statement}`,
      factId: fact.factId,
      expectedSection: fact.section
    });
  }

  for (const section of summary.sections) {
    const title = SUMMARY_SECTION_TITLES.find((candidate) => candidate === section.title);
    if (!title) {
      continue;
    }

    for (const item of section.items) {
      if (normalizeCoverageText(item) === normalizeCoverageText(NO_INFORMATION_PLACEHOLDER)) {
        continue;
      }

      const authoritativeTitle = inferAuthoritativeSectionTitle(item, title);
      if (authoritativeTitle !== title) {
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
  const composed = composeSummaryFromCapture(summary, capture, nameHint);
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
    report: {
      ...report,
      diagnostics: [...report.diagnostics, ...buildAuditDiagnostics(statuses)]
    }
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
        "Summary generation timed out while waiting for the model."
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
      message?: {
        content?: string | ChatCompletionContentPart[];
      };
    }>;
  };

  const content = extractChatCompletionText(data.choices?.[0]?.message?.content);
  if (!content) {
    throw new SummaryModelRequestError(
      "Summary generation returned an empty structured response."
    );
  }

  try {
    return JSON.parse(content) as T;
  } catch {
    throw new SummaryModelRequestError(
      "Summary generation returned invalid structured JSON."
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
  const entryChunks = buildSummaryEntryChunks(entries, CAPTURE_PROMPT_TARGET_CHARS);
  const captures: StructuredCaptureFact[] = [];

  for (const chunk of entryChunks) {
    const rawCapture = await requestStructuredCompletion<StructuredCapture>({
      apiKey,
      model,
      schemaName: "caregiver_handoff_structured_capture",
      schema: captureSchema,
      systemPrompt:
        "You are a structured capture step for caregiver handoff notes. Preserve facts, split them into atomic statements, assign each one to the best section, and never drop meaningful care information.",
      userPrompt: `${sevenSectionCaptureRules}\n\nCaregiver input:\n${chunk}`,
      temperature: 0.1,
      maxCompletionTokens: 6000
    });

    captures.push(...normalizeCapture(rawCapture, entryMetadata).facts);
  }

  return {
    facts: dedupeCaptureFacts([...captures, ...deterministicCommunicationFacts(entries)])
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

  const rewrittenSummary = await rewriteStructuredCapture(apiKey, model, capture, nameHint);
  if (!rewrittenSummary) {
    return null;
  }

  const firstPass = auditAndFinalizeSummary(rewrittenSummary, capture, nameHint);
  if (firstPass.report.issues.length === 0) {
    return firstPass;
  }

  const repairedSummary = await rewriteStructuredCapture(
    apiKey,
    model,
    capture,
    nameHint,
    summarizeAuditIssues(firstPass.report.issues)
  );

  if (!repairedSummary) {
    return firstPass;
  }

  return auditAndFinalizeSummary(repairedSummary, capture, nameHint);
}

export function buildSummarySource(turns: ConversationTurn[]) {
  return buildSummaryEntries(turns).map((entry) => entry.text).join("\n\n");
}

function finalizeGeneratedSummary(
  summary: StructuredSummary,
  turns: ConversationTurn[],
  nameHint?: string,
  existingReport?: SummaryAuditReport
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
  mode: SummaryGenerationMode = "two-step"
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

    const result = await generateSummaryTwoStep(apiKey, model, turns, nameHint);
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
