import { QUESTIONNAIRE_VERSION, getQuestionnairePrompts } from "@/lib/questionnaire";
import { buildTurnsFromResponses, ReflectionResponse } from "@/lib/reflection";
import { ConversationTurn, SessionDraft, UiLanguage } from "@/lib/types";

export const QUESTIONNAIRE_PROMPT_MIGRATION_TARGETS: Record<string, string> = {
  "communication-how-do-they-communicate": "communication-how-do-they-communicate",
  "communication-what-helps-you-communicate": "communication-what-helps-you-communicate",
  "communication-what-do-specific-things-mean": "communication-what-do-specific-things-mean",
  "communication-how-can-you-tell-they-need-help": "hard-time-signs-behavior-communication",
  "daily-schedule-mornings": "daily-schedule-mornings",
  "daily-schedule-meals-snacks": "daily-schedule-meals-snacks",
  "daily-schedule-bedtime": "daily-schedule-bedtime",
  "daily-schedule-transitions": "hard-time-support-transitions",
  "daily-schedule-daytime-activities": "activities-preferences-favorite-activities",
  "activities-preferences-during-the-day": "activities-preferences-favorite-activities",
  "activities-preferences-favorite-activities": "activities-preferences-favorite-activities",
  "activities-preferences-outings": "activities-preferences-outings",
  "activities-preferences-trusted-people": "activities-preferences-trusted-people",
  "activities-preferences-quiet-time": "activities-preferences-favorite-activities",
  "upset-overwhelm-plan-changes": "hard-time-signs-situations-changes",
  "upset-overwhelm-environment": "hard-time-signs-situations-changes",
  "upset-overwhelm-physical-state": "hard-time-signs-situations-changes",
  "signs-need-help-body-signs": "signs-need-help-body-signs",
  "signs-need-help-behavior-changes": "hard-time-signs-behavior-communication",
  "signs-need-help-communication-changes": "hard-time-signs-behavior-communication",
  "hard-time-support-environment": "hard-time-support-environment",
  "hard-time-support-calming-items": "hard-time-support-calming-items",
  "hard-time-support-in-the-moment": "hard-time-support-environment",
  "health-safety-medical-info": "health-safety-allergies",
  "health-safety-medications-routines": "health-safety-diagnoses",
  "health-safety-equipment-supports": "health-safety-medications",
  "health-safety-safety-concerns": "health-safety-equipment-supports",
  "who-to-contact-emergency": "health-safety-contact-guidance",
  "who-to-contact-non-emergency": "health-safety-contact-guidance",
  "who-to-contact-call-guidance": "health-safety-contact-guidance"
};

for (const prompt of getQuestionnairePrompts("english")) {
  if (!(prompt.id in QUESTIONNAIRE_PROMPT_MIGRATION_TARGETS)) {
    QUESTIONNAIRE_PROMPT_MIGRATION_TARGETS[prompt.id] = prompt.id;
  }
}

type SavedResponse = {
  promptId: string;
  content: string;
  skipped: boolean;
  createdAt: string;
};

const LEGACY_CONTACT_LABELS: Record<
  UiLanguage,
  Partial<Record<string, string>>
> = {
  english: {
    "who-to-contact-emergency": "Emergency contact:",
    "who-to-contact-non-emergency": "Non-emergency contact:",
    "who-to-contact-call-guidance": "When to call:"
  },
  spanish: {
    "who-to-contact-emergency": "Contacto de emergencia:",
    "who-to-contact-non-emergency": "Contacto para situaciones que no son de emergencia:",
    "who-to-contact-call-guidance": "Cuándo llamar:"
  },
  mandarin: {
    "who-to-contact-emergency": "紧急联系人：",
    "who-to-contact-non-emergency": "非紧急联系人：",
    "who-to-contact-call-guidance": "何时联系："
  }
};

function migratedResponseContent(response: SavedResponse, language: UiLanguage) {
  if (!response.content) {
    return "";
  }

  const label = LEGACY_CONTACT_LABELS[language][response.promptId];
  return label ? `${label} ${response.content}` : response.content;
}

function extractSavedResponses(turns: ConversationTurn[]): SavedResponse[] {
  const responses: SavedResponse[] = [];
  let activePromptId = "";

  for (const turn of turns) {
    if (turn.role === "assistant" && turn.promptType === "section_prompt") {
      activePromptId = turn.id;
      continue;
    }

    if (turn.role !== "user") {
      continue;
    }

    const promptId = turn.promptId || activePromptId;
    if (!promptId) {
      continue;
    }

    responses.push({
      promptId,
      content: turn.content.trim(),
      skipped: Boolean(turn.skipped),
      createdAt: turn.createdAt
    });
    activePromptId = "";
  }

  return responses;
}

function earliestTimestamp(values: string[]) {
  return values
    .filter(Boolean)
    .slice()
    .sort((left, right) => Date.parse(left) - Date.parse(right))[0] ?? new Date().toISOString();
}

export function migrateQuestionnaireTurns(turns: ConversationTurn[], language: UiLanguage) {
  const validPromptIds = new Set(getQuestionnairePrompts(language).map((prompt) => prompt.id));
  const grouped = new Map<string, SavedResponse[]>();

  for (const response of extractSavedResponses(turns)) {
    const targetId = QUESTIONNAIRE_PROMPT_MIGRATION_TARGETS[response.promptId];
    if (!targetId || !validPromptIds.has(targetId)) {
      continue;
    }

    const current = grouped.get(targetId) ?? [];
    current.push(response);
    grouped.set(targetId, current);
  }

  const migratedResponses: Record<string, ReflectionResponse> = {};

  for (const [promptId, sourceResponses] of grouped) {
    const seenContent = new Set<string>();
    const contentParts: string[] = [];

    for (const response of sourceResponses) {
      const content = migratedResponseContent(response, language);
      if (!content || seenContent.has(content)) {
        continue;
      }

      seenContent.add(content);
      contentParts.push(content);
    }

    migratedResponses[promptId] = {
      promptId,
      content: contentParts.join("\n\n"),
      skipped: contentParts.length === 0 && sourceResponses.every((response) => response.skipped),
      createdAt: earliestTimestamp(sourceResponses.map((response) => response.createdAt))
    };
  }

  return buildTurnsFromResponses(migratedResponses, language);
}

export function migrateSessionDraftQuestionnaire(draft: SessionDraft): SessionDraft {
  if (draft.questionnaireVersion === QUESTIONNAIRE_VERSION) {
    return draft;
  }

  const language = draft.intakeDetails.preferredLanguage ?? "english";

  return {
    ...draft,
    questionnaireVersion: QUESTIONNAIRE_VERSION,
    turns: migrateQuestionnaireTurns(draft.turns, language)
  };
}
