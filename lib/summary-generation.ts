import {
  PREFERRED_SUMMARY_SECTION_ORDER,
  buildFallbackSummary,
  inferAuthoritativeSectionTitle,
  normalizeAuthoritativeStructuredSummary,
  normalizeGeneratedSummaryWithOptions
} from "./summary";
import {
  SUMMARY_LAYOUT_VERSION,
  SUMMARY_PIPELINE_VERSION,
  computeTurnsHash
} from "./summary-structured";
import { ConversationTurn, StructuredSummary } from "./types";

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
  subcategory: string;
  statement: string;
  safetyRelevant: boolean;
  conceptKeys: string[];
  sourceEntryIds: string[];
};

type StructuredCapture = {
  facts: StructuredCaptureFact[];
};

type SummaryAuditIssue = {
  code:
    | "missing_coverage"
    | "section_leakage"
    | "wrong_section"
    | "duplicate_item";
  message: string;
  factId?: string;
  expectedSection?: SummarySectionTitle;
  actualSection?: SummarySectionTitle;
  item?: string;
};

class SummaryQualityError extends Error {
  issues: SummaryAuditIssue[];

  constructor(message: string, issues: SummaryAuditIssue[]) {
    super(message);
    this.name = "SummaryQualityError";
    this.issues = issues;
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
- Keep medications, equipment, contacts, and health conditions as separate bullets so they can be split into dedicated sections later.
- In What helps the day go well, collapse preferred activities into 1-2 concise bullets. Do not repeat the same preference in separate "likes" or "enjoys" bullets.
- In What helps the day go well, do not produce long runs of one-item preference bullets like "He likes X."
- In Communication, do not repeat the same cue twice in different wording.
- In Signs they need help, keep only one phrasing per symptom (for example, keep either "Not eating can mean illness" or "Not eating is a sign", not both).
- In What can upset or overwhelm them, collapse repeated transition or stop-activity triggers into one bullet.
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

function normalizeSummarySourceText(value: string) {
  return value
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => (line.trim() ? compactWhitespace(line) : ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
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
  return turns
    .filter((turn) => turn.role === "user" && !turn.skipped)
    .flatMap((turn, index) => {
      const entryId = `Entry ${index + 1}`;
      const content = normalizeSummarySourceText(turn.content);
      const parts = options?.chunkLongEntries
        ? splitSummaryEntryContent(content, CAPTURE_ENTRY_TARGET_CHARS)
        : [content];

      return parts.map((part) => ({
        entryId,
        text: buildSummaryEntryText(turn, entryId, part)
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
        const conceptKeys = [...extractCoverageConcepts(statement)].sort();
        const factIdPrefix = entryId.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

        return {
          factId: `${factIdPrefix || "entry"}-fact-${index + 1}`,
          entryId,
          section,
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
    const key = `${fact.section}::${normalizeCoverageText(fact.statement)}`;
    const existing = deduped.get(key);

    if (!existing) {
      const nearDuplicate = [...deduped.entries()].find(([, entry]) => {
        if (entry.section !== fact.section) {
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
          `- [${fact.factId}] ${fact.statement}${fact.safetyRelevant ? " [safety]" : ""} (${fact.sourceEntryIds.join(", ")})`
        );
      }
    }

    return lines.join("\n");
  }).join("\n\n");
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
  const finalized = normalizeAuthoritativeStructuredSummary(summary, nameHint);
  const issues = auditSummaryAgainstCapture(finalized, capture);

  return {
    summary: finalized,
    issues
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
  const entryChunks = buildSummaryEntryChunks(
    buildSummaryEntries(turns, { chunkLongEntries: true }),
    CAPTURE_PROMPT_TARGET_CHARS
  );
  const captures: StructuredCaptureFact[] = [];

  for (const chunk of entryChunks) {
    const rawCapture = await requestStructuredCompletion<StructuredCapture>({
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

    captures.push(...normalizeCapture(rawCapture).facts);
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
    )}\n\nStructured capture:\n${formatStructuredCaptureForPrompt(capture)}${repairPrompt}`,
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
  if (firstPass.issues.length === 0) {
    return firstPass.summary;
  }

  const repairedSummary = await rewriteStructuredCapture(
    apiKey,
    model,
    capture,
    nameHint,
    summarizeAuditIssues(firstPass.issues)
  );

  if (!repairedSummary) {
    throw new SummaryQualityError(
      "The caregiver summary could not be repaired after audit failures.",
      firstPass.issues
    );
  }

  const secondPass = auditAndFinalizeSummary(repairedSummary, capture, nameHint);
  if (secondPass.issues.length > 0) {
    throw new SummaryQualityError(
      "The caregiver summary still failed the final quality audit after one retry.",
      secondPass.issues
    );
  }

  return secondPass.summary;
}

export function buildSummarySource(turns: ConversationTurn[]) {
  return buildSummaryEntries(turns).map((entry) => entry.text).join("\n\n");
}

function finalizeGeneratedSummary(
  summary: StructuredSummary,
  turns: ConversationTurn[],
  nameHint?: string
) {
  const normalized = normalizeAuthoritativeStructuredSummary(summary, nameHint);

  return {
    ...normalized,
    pipelineVersion: SUMMARY_PIPELINE_VERSION,
    layoutVersion: SUMMARY_LAYOUT_VERSION,
    sourceTurnsHash: computeTurnsHash(turns)
  } satisfies StructuredSummary;
}

export async function generateCaregiverSummary(
  turns: ConversationTurn[],
  nameHint?: string,
  mode: SummaryGenerationMode = "two-step"
) {
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

    const summary = await generateSummaryTwoStep(apiKey, model, turns, nameHint);
    if (!summary) {
      throw new SummaryQualityError(
        "Summary generation returned no structured two-step summary.",
        []
      );
    }
    return finalizeGeneratedSummary(summary, turns, nameHint);
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
