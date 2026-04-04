import { getLocalizedReflectionPrompts } from "@/lib/localization";
import { ConversationTurn, ReflectionStepId, UiLanguage } from "@/lib/types";

export type ReflectionResponse = {
  promptId: string;
  content: string;
  skipped: boolean;
  createdAt: string;
};

export function getPromptSequence(language: UiLanguage = "english"): ConversationTurn[] {
  return getLocalizedReflectionPrompts(language).map((prompt) => ({
    id: prompt.id,
    role: "assistant",
    promptType: "section_prompt",
    sectionId: prompt.sectionId,
    sectionTitle: prompt.sectionTitle,
    stepId: prompt.stepId,
    stepTitle: prompt.stepTitle,
    stepSubtitle: prompt.stepSubtitle,
    stepCompletionMessage: prompt.stepCompletionMessage,
    promptLabel: prompt.promptLabel,
    promptExamples: prompt.examples,
    content: prompt.question,
    createdAt: new Date().toISOString()
  }));
}

export function getResponsesFromTurns(
  turns: ConversationTurn[],
  language: UiLanguage = "english"
): Record<string, ReflectionResponse> {
  const prompts = getPromptSequence(language);
  const promptIds = new Set(prompts.map((prompt) => prompt.id));
  const responses: Record<string, ReflectionResponse> = {};
  let activePromptId: string | null = null;

  for (const turn of turns) {
    if (turn.role === "assistant" && promptIds.has(turn.id)) {
      activePromptId = turn.id;
      continue;
    }

    if (turn.role !== "user" || !activePromptId) {
      continue;
    }

    responses[activePromptId] = {
      promptId: activePromptId,
      content: turn.content,
      skipped: Boolean(turn.skipped),
      createdAt: turn.createdAt
    };
    activePromptId = null;
  }

  return responses;
}

export function buildTurnsFromResponses(
  responses: Record<string, ReflectionResponse>,
  language: UiLanguage = "english"
): ConversationTurn[] {
  return getPromptSequence(language).flatMap((prompt) => {
    const response = responses[prompt.id];
    if (!response) {
      return [];
    }

    return [
      prompt,
      {
        id: `${prompt.id}-response`,
        role: "user",
        promptType: prompt.promptType,
        promptId: prompt.id,
        sectionId: prompt.sectionId,
        sectionTitle: prompt.sectionTitle,
        stepId: prompt.stepId,
        stepTitle: prompt.stepTitle,
        stepSubtitle: prompt.stepSubtitle,
        stepCompletionMessage: prompt.stepCompletionMessage,
        promptLabel: prompt.promptLabel,
        content: response.content,
        skipped: response.skipped,
        createdAt: response.createdAt
      }
    ];
  });
}

export function getFirstIncompletePromptIndex(
  responses: Record<string, ReflectionResponse>,
  language: UiLanguage = "english"
) {
  return getPromptSequence(language).findIndex((prompt) => !responses[prompt.id]);
}

export function areAllPromptsCompleted(
  responses: Record<string, ReflectionResponse>,
  language: UiLanguage = "english"
) {
  return getPromptSequence(language).every((prompt) => Boolean(responses[prompt.id]));
}

export function getPromptIndex(turns: ConversationTurn[]) {
  return turns.filter((turn) => turn.role === "assistant" && turn.promptType === "section_prompt").length;
}

export function getCurrentPrompt(turns: ConversationTurn[], language: UiLanguage = "english") {
  return getPromptSequence(language)[getPromptIndex(turns)];
}

export function buildTranscript(turns: ConversationTurn[]): string {
  return turns
    .map((turn) => {
      const sectionContext =
        turn.sectionTitle && turn.stepTitle && turn.promptLabel
          ? ` [${turn.sectionTitle} > ${turn.stepTitle} > ${turn.promptLabel}]`
          : turn.sectionTitle && turn.promptLabel
            ? ` [${turn.sectionTitle} > ${turn.promptLabel}]`
            : turn.stepTitle && turn.promptLabel
              ? ` [${turn.stepTitle} > ${turn.promptLabel}]`
          : turn.sectionTitle
            ? ` [${turn.sectionTitle}]`
            : turn.stepTitle
              ? ` [${turn.stepTitle}]`
            : "";

      if (turn.role === "user" && turn.skipped) {
        return `USER${sectionContext}: [Skipped]`;
      }

      return `${turn.role.toUpperCase()}${sectionContext}: ${turn.content}`;
    })
    .join("\n");
}

export function getStepOrder(language: UiLanguage = "english"): ReflectionStepId[] {
  const ordered: ReflectionStepId[] = [];

  for (const prompt of getLocalizedReflectionPrompts(language)) {
    if (!ordered.includes(prompt.stepId)) {
      ordered.push(prompt.stepId);
    }
  }

  return ordered;
}
