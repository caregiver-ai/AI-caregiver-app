import { STORAGE_KEY } from "@/lib/constants";
import { migrateSessionDraftQuestionnaire } from "@/lib/questionnaire-migration";
import { SessionDraft, StructuredSummary } from "@/lib/types";

export function loadDraft(): SessionDraft | null {
  if (typeof window === "undefined") {
    return null;
  }

  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    const draft = migrateSessionDraftQuestionnaire(JSON.parse(raw) as SessionDraft);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
    return draft;
  } catch {
    return null;
  }
}

export function saveDraft(draft: SessionDraft) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
}

export function clearDraft() {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.removeItem(STORAGE_KEY);
}

export function updateStoredSummary(summary: StructuredSummary) {
  const draft = loadDraft();
  if (!draft) {
    return;
  }

  draft.structuredSummary = summary;
  draft.editedSummary = draft.editedSummary ?? summary;
  saveDraft(draft);
}
