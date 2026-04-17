import {
  PREFERRED_SUMMARY_SECTION_ORDER,
  buildFallbackSummary,
  normalizeGeneratedSummary,
  normalizeGeneratedSummaryWithOptions,
  normalizeStructuredSummaryWithOptions
} from "./summary";
import { ConversationTurn, StructuredSummary } from "./types";

const NO_INFORMATION_PLACEHOLDER = "(No information provided)";
const OPENAI_CHAT_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions";
const DEFAULT_SUMMARY_MODEL = "gpt-5.4";

const SUMMARY_SECTION_TITLES = [...PREFERRED_SUMMARY_SECTION_ORDER];

type SummarySectionTitle = (typeof SUMMARY_SECTION_TITLES)[number];

type ChatCompletionContentPart = {
  type?: string;
  text?: string;
};

type StructuredCaptureFact = {
  entryId: string;
  section: SummarySectionTitle;
  subcategory: string;
  statement: string;
  safetyRelevant: boolean;
};

type StructuredCapture = {
  facts: StructuredCaptureFact[];
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

const QUESTION_ECHO_PATTERN =
  /^(?:what|who|how|when|where|why|are|do|does|did|is|can|could|should|would)\b.*\?$/i;
const NON_ANSWER_PATTERN =
  /^(?:use skip|skip|n\/a|na|none|unknown|not sure|not clearly stated(?: in the raw input)?|not stated|not provided|no information)$/i;
const TRANSCRIPTION_NOISE_PATTERN =
  /^(?:um+|uh+|hmm+|mm+|eh+|ah+|ha+|heh+|eheh+|haha+|huh+|mmm+|uh-huh|mm-hmm)$/i;
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
        required: ["entryId", "section", "subcategory", "statement", "safetyRelevant"]
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
- Choose a short internal subcategory label that helps organize related facts.
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
- Do not expose internal subcategory labels in the final output.
- The section assignments in the structured capture are authoritative. Keep each fact in its assigned section.
- Do not move facts into Communication just because they mention an iPad, AAC device, attention, or help.
- Use this distinction:
  - meaning of a device selection or communication method -> Communication
  - a trigger caused by device/content access problems -> What can upset or overwhelm them
  - a proactive support such as helping find content before distress escalates -> What helps the day go well
  - an in-the-moment caregiver action during distress -> What helps when they are having a hard time
- Keep general regulation supports such as car rides, walks, or preferred activities in What helps the day go well.
- Keep direct action bullets such as "offer a car ride" or "help him access" in What helps when they are having a hard time.
- Keep bathroom reminders and regular food access in What helps the day go well when they are presented as proactive supports.
- Keep repeated trips to the fridge, grabbing cheese, hiding, grunting, angry vocalizations, elopement, and hand biting in Signs they need help.
- Keep inability to open items, inability to access iPad content, hunger, and missing preferred items in What can upset or overwhelm them.
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

function normalizeSummarySourceText(value: string) {
  return value
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => (line.trim() ? compactWhitespace(line) : ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function defaultModel() {
  return process.env.OPENAI_MODEL ?? DEFAULT_SUMMARY_MODEL;
}

function buildTitleInstruction(nameHint?: string) {
  return nameHint
    ? `The product already displays the overall heading "Caregiver Handoff". For the JSON "title" field, use exactly "Caring for ${nameHint}".`
    : 'The product already displays the overall heading "Caregiver Handoff". For the JSON "title" field, use "Caring for <Name>" if the name is clear and reliable in the transcript. Otherwise use "Caregiver Handoff Summary".';
}

function cleanCaptureStatement(value: string) {
  const trimmed = value
    .replace(/^[\-\u2022*]+\s*/u, "")
    .replace(/^["'“”]+|["'“”]+$/gu, "")
    .trim();

  if (!trimmed) {
    return null;
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

function normalizeCapture(input: unknown) {
  const candidate = input as Partial<StructuredCapture> | undefined;
  const facts = Array.isArray(candidate?.facts) ? candidate.facts : [];

  return {
    facts: facts
      .map((fact, index) => {
        const section = SUMMARY_SECTION_TITLES.find((title) => title === fact.section);
        const statement = cleanCaptureStatement(String(fact.statement ?? ""));
        if (!section || !statement) {
          return null;
        }

        const entryId = compactWhitespace(String(fact.entryId ?? "")) || `Entry ${index + 1}`;
        const subcategory = compactWhitespace(String(fact.subcategory ?? "")) || "General";

        return {
          entryId,
          section,
          subcategory,
          statement,
          safetyRelevant: Boolean(fact.safetyRelevant)
        } satisfies StructuredCaptureFact;
      })
      .filter((fact): fact is StructuredCaptureFact => Boolean(fact))
  } satisfies StructuredCapture;
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
    const itemCoverage = overlapCount / itemTokens.length;

    return statementCoverage >= 0.75 || itemCoverage >= 0.75;
  });
}

function sortCaptureFactsForMerge(facts: StructuredCaptureFact[]) {
  return [...facts].sort((left, right) => {
    if (left.safetyRelevant !== right.safetyRelevant) {
      return left.safetyRelevant ? -1 : 1;
    }

    return left.statement.length - right.statement.length;
  });
}

function formatStructuredCaptureForPrompt(capture: StructuredCapture) {
  return SUMMARY_SECTION_TITLES.map((title) => {
    const sectionFacts = capture.facts.filter((fact) => fact.section === title);
    if (sectionFacts.length === 0) {
      return `[${title}]\n- ${NO_INFORMATION_PLACEHOLDER}`;
    }

    const grouped = new Map<string, StructuredCaptureFact[]>();

    for (const fact of sectionFacts) {
      const items = grouped.get(fact.subcategory) ?? [];
      items.push(fact);
      grouped.set(fact.subcategory, items);
    }

    const lines = [`[${title}]`];

    for (const [subcategory, facts] of grouped.entries()) {
      lines.push(`Subcategory: ${subcategory}`);
      for (const fact of facts) {
        lines.push(
          `- ${fact.statement}${fact.safetyRelevant ? " [safety]" : ""} (${fact.entryId})`
        );
      }
    }

    return lines.join("\n");
  }).join("\n\n");
}

function mergeCapturedFactsIntoSummary(
  summary: StructuredSummary,
  capture: StructuredCapture,
  nameHint?: string
) {
  const sections = summary.sections.map((section) => ({
    ...section,
    items: [...section.items]
  }));
  const byTitle = new Map(sections.map((section) => [section.title, section]));

  for (const fact of sortCaptureFactsForMerge(capture.facts)) {
    const section = byTitle.get(fact.section);
    if (!section) {
      continue;
    }

    const meaningfulItems = section.items.filter((item) => item !== NO_INFORMATION_PLACEHOLDER);

    if (meaningfulItems.length === 0) {
      section.items = [fact.statement];
      continue;
    }

    if (!statementLooksCovered(fact.statement, meaningfulItems)) {
      section.items.push(fact.statement);
    }
  }

  return normalizeStructuredSummaryWithOptions(
    {
      ...summary,
      sections
    },
    nameHint,
    { reclassify: false }
  );
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
  const response = await fetch(OPENAI_CHAT_COMPLETIONS_URL, {
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
    })
  });

  if (!response.ok) {
    return null;
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
    return null;
  }

  return JSON.parse(content) as T;
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
    temperature: 0.1,
    maxCompletionTokens: 5000
  });

  if (!rawSummary) {
    return null;
  }

  return normalizeGeneratedSummary(rawSummary, nameHint);
}

async function captureSummaryFacts(
  apiKey: string,
  model: string,
  turns: ConversationTurn[]
) {
  const rawCapture = await requestStructuredCompletion<StructuredCapture>({
    apiKey,
    model,
    schemaName: "caregiver_handoff_structured_capture",
    schema: captureSchema,
    systemPrompt:
      "You are a structured capture step for caregiver handoff notes. Preserve facts, split them into atomic statements, assign each one to the best section, and never drop meaningful care information.",
    userPrompt: `${stepOneCaptureRules}\n\nCaregiver input:\n${buildSummarySource(turns)}`,
    temperature: 0.1,
    maxCompletionTokens: 6000
  });

  return normalizeCapture(rawCapture);
}

async function rewriteStructuredCapture(
  apiKey: string,
  model: string,
  capture: StructuredCapture,
  nameHint?: string
) {
  const rawSummary = await requestStructuredCompletion<object>({
    apiKey,
    model,
    schemaName: "caregiver_handoff_summary",
    schema: summarySchema,
    systemPrompt:
      "You are the final caregiver handoff writer. Use the structured capture to write a complete, organized, caregiver-ready handoff that preserves safety details and avoids duplication.",
    userPrompt: `${summarySchemaDescription}\n\n${stepTwoRewriteRules}\n\n${buildTitleInstruction(
      nameHint
    )}\n\nStructured capture:\n${formatStructuredCaptureForPrompt(capture)}`,
    temperature: 0.2,
    maxCompletionTokens: 5000
  });

  if (!rawSummary) {
    return null;
  }

  return normalizeGeneratedSummaryWithOptions(rawSummary, nameHint, { reclassify: false });
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

  return mergeCapturedFactsIntoSummary(rewrittenSummary, capture, nameHint);
}

export function buildSummarySource(turns: ConversationTurn[]) {
  const entries = turns
    .filter((turn) => turn.role === "user" && !turn.skipped)
    .map((turn, index) => {
      const lines = [
        `Entry ${index + 1}`,
        turn.sectionTitle ? `Original main category: ${compactWhitespace(turn.sectionTitle)}` : "",
        turn.stepTitle && turn.stepTitle !== turn.sectionTitle
          ? `Original subsection: ${compactWhitespace(turn.stepTitle)}`
          : "",
        turn.promptLabel ? `Question asked: ${compactWhitespace(turn.promptLabel)}` : "",
        `Caregiver input:\n${normalizeSummarySourceText(turn.content)}`
      ].filter(Boolean);

      return lines.join("\n");
    });

  return entries.join("\n\n");
}

export async function generateCaregiverSummary(
  turns: ConversationTurn[],
  nameHint?: string,
  mode: SummaryGenerationMode = "two-step"
) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return buildFallbackSummary(turns, nameHint);
  }

  const model = defaultModel();

  try {
    if (mode === "one-step") {
      return (await generateSummaryOneStep(apiKey, model, turns, nameHint)) ?? buildFallbackSummary(turns, nameHint);
    }

    return (
      (await generateSummaryTwoStep(apiKey, model, turns, nameHint)) ??
      buildFallbackSummary(turns, nameHint)
    );
  } catch {
    return buildFallbackSummary(turns, nameHint);
  }
}
