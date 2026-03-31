import { getLocalizedReflectionPrompts } from "@/lib/localization";
import { ConversationTurn, UiLanguage } from "@/lib/types";

export function getPromptSequence(language: UiLanguage = "english"): ConversationTurn[] {
  return getLocalizedReflectionPrompts(language).map((prompt) => ({
    id: prompt.id,
    role: "assistant",
    promptType: "section_prompt",
    sectionId: prompt.sectionId,
    sectionTitle: prompt.sectionTitle,
    promptLabel: prompt.promptLabel,
    promptExamples: prompt.examples,
    content: prompt.question,
    createdAt: new Date().toISOString()
  }));
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
        turn.sectionTitle && turn.promptLabel
          ? ` [${turn.sectionTitle} > ${turn.promptLabel}]`
          : turn.sectionTitle
            ? ` [${turn.sectionTitle}]`
            : "";

      if (turn.role === "user" && turn.skipped) {
        return `USER${sectionContext}: [Skipped]`;
      }

      return `${turn.role.toUpperCase()}${sectionContext}: ${turn.content}`;
    })
    .join("\n");
}
