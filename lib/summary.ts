import { EMPTY_SUMMARY } from "@/lib/constants";
import { ConversationTurn, StructuredSummary } from "@/lib/types";

function userResponses(turns: ConversationTurn[]) {
  return turns
    .filter((turn) => turn.role === "user")
    .map((turn) => turn.content.trim())
    .filter(Boolean);
}

function splitSentences(text: string) {
  return text
    .split(/[.;\n]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 12);
}

function toSentenceCase(value: string) {
  if (!value) {
    return value;
  }

  return value.charAt(0).toUpperCase() + value.slice(1);
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

function pickMatches(sentences: string[], pattern: RegExp, limit = 3) {
  return dedupe(
    sentences
      .filter((item) => pattern.test(item))
      .map((item) => toSentenceCase(item.replace(/\bi want to avoid\b/gi, "").trim()))
  ).slice(0, limit);
}

function summarizeBarriers(sentences: string[]) {
  const results: string[] = [];
  const combined = sentences.join(" ").toLowerCase();

  if (/(cost|expensive|money|afford)/.test(combined)) {
    results.push("Cost makes respite support feel difficult to access.");
  }

  if (/(schedule|timing|appointment|work|transport|transportation|coordinate)/.test(combined)) {
    results.push("Scheduling and coordination make it hard to arrange a break.");
  }

  if (/(find|coverage|staff|help|someone|caregiver)/.test(combined)) {
    results.push("Finding reliable caregiver coverage is a major barrier.");
  }

  return dedupe(results).slice(0, 3);
}

function summarizeConditions(sentences: string[]) {
  const results: string[] = [];
  const combined = sentences.join(" ").toLowerCase();

  if (/(trained|experience|understands|dementia|medical|routine)/.test(combined)) {
    results.push("Respite would feel more workable with a trained caregiver who understands the care routine.");
  }

  if (/(consistent|same person|familiar)/.test(combined)) {
    results.push("Consistency and familiarity with the backup caregiver would increase trust.");
  }

  if (/(text|update|communication|check in|check-in)/.test(combined)) {
    results.push("Clear communication and updates during respite would help the caregiver feel comfortable.");
  }

  return dedupe(results).slice(0, 3);
}

function buildSummaryText(summary: Omit<StructuredSummary, "caregiver_summary_text">) {
  const firstBarrier = summary.key_barriers[0];
  const firstEmotion = summary.emotional_concerns[0];
  const firstSafety = summary.safety_considerations[0];
  const firstCondition = summary.conditions_for_successful_respite[0];
  const firstPastIssue = summary.past_negative_experiences[0];

  const sentences = [
    firstBarrier
      ? `The caregiver wants respite but faces barriers including ${firstBarrier.charAt(0).toLowerCase()}${firstBarrier.slice(1)}`
      : "The caregiver wants respite but still faces several barriers to stepping away.",
    firstEmotion
      ? `Emotionally, ${firstEmotion.charAt(0).toLowerCase()}${firstEmotion.slice(1)}`
      : "",
    firstSafety
      ? `Safety remains a concern, especially around ${firstSafety.charAt(0).toLowerCase()}${firstSafety.slice(1)}`
      : "",
    firstPastIssue
      ? `Past experiences continue to shape trust in outside help, including ${firstPastIssue.charAt(0).toLowerCase()}${firstPastIssue.slice(1)}`
      : "",
    firstCondition
      ? `Respite appears more realistic if ${firstCondition.charAt(0).toLowerCase()}${firstCondition.slice(1)}`
      : "A more reliable and reassuring support setup would likely make respite feel more achievable."
  ].filter(Boolean);

  return sentences.map((sentence) => sentence.replace(/[.]*$/, ".")).join(" ");
}

export function buildFallbackSummary(turns: ConversationTurn[]): StructuredSummary {
  const responses = userResponses(turns);
  const joined = responses.join(". ");
  const sentences = splitSentences(joined);

  const key_barriers = summarizeBarriers(sentences);
  const emotional_concerns = pickMatches(
    sentences,
    /(guilt|worry|fear|stress|overwhelm|anxious|judged|trust|alone)/i
  );
  const safety_considerations = pickMatches(
    sentences,
    /(safe|safety|medication|medical|fall|emergency|wandering|supervision|mobility)/i
  );
  const past_negative_experiences = pickMatches(
    sentences,
    /(before|last time|previous|went wrong|bad experience|late|upset|hesitant since)/i
  );
  const situations_to_avoid = pickMatches(
    sentences,
    /(avoid|don't want|do not want|uncomfortable|wouldn't want|stranger|unfamiliar|rushed)/i
  );
  const conditions_for_successful_respite = [
    ...summarizeConditions(sentences),
    ...pickMatches(sentences, /(need|want|prefer|comfortable|would feel better|acceptable)/i, 2)
  ].slice(0, 3);

  const summaryBase = {
    ...EMPTY_SUMMARY,
    key_barriers,
    emotional_concerns,
    safety_considerations,
    past_negative_experiences,
    situations_to_avoid,
    conditions_for_successful_respite,
    unresolved_questions: dedupe(
      [
        conditions_for_successful_respite.length === 0
          ? "What type of backup support would feel trustworthy enough to try first?"
          : "",
        safety_considerations.length === 0
          ? "What safety tasks would another caregiver need to handle confidently?"
          : "",
        "What is the smallest next step that could test respite without adding more stress?"
      ].filter(Boolean)
    ).slice(0, 3)
  };

  return {
    ...summaryBase,
    caregiver_summary_text:
      buildSummaryText(summaryBase) ||
      "The caregiver wants respite but still needs a safer, more trusted support plan before taking a break."
  };
}

export function normalizeStructuredSummary(input: unknown): StructuredSummary {
  const candidate = input as Partial<StructuredSummary> | undefined;

  return {
    key_barriers: Array.isArray(candidate?.key_barriers) ? candidate.key_barriers.map(String) : [],
    emotional_concerns: Array.isArray(candidate?.emotional_concerns)
      ? candidate.emotional_concerns.map(String)
      : [],
    safety_considerations: Array.isArray(candidate?.safety_considerations)
      ? candidate.safety_considerations.map(String)
      : [],
    past_negative_experiences: Array.isArray(candidate?.past_negative_experiences)
      ? candidate.past_negative_experiences.map(String)
      : [],
    situations_to_avoid: Array.isArray(candidate?.situations_to_avoid)
      ? candidate.situations_to_avoid.map(String)
      : [],
    conditions_for_successful_respite: Array.isArray(candidate?.conditions_for_successful_respite)
      ? candidate.conditions_for_successful_respite.map(String)
      : [],
    unresolved_questions: Array.isArray(candidate?.unresolved_questions)
      ? candidate.unresolved_questions.map(String)
      : [],
    caregiver_summary_text:
      typeof candidate?.caregiver_summary_text === "string"
        ? candidate.caregiver_summary_text
        : ""
  };
}
