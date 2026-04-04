"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/shell";
import { StatusBanner } from "@/components/status-banner";
import { EMPTY_SUMMARY } from "@/lib/constants";
import { getCurrentAuthUser, loadRemoteDraft, saveRemoteDraft } from "@/lib/draft-api";
import { getReviewCopy } from "@/lib/localization";
import { formatSummaryGeneratedAt, normalizeStructuredSummary } from "@/lib/summary";
import { loadDraft, saveDraft } from "@/lib/storage";
import { StructuredSummary, SummarySection, UiLanguage } from "@/lib/types";

function itemsToTextarea(items: string[]) {
  return items.join("\n");
}

function textareaToItems(value: string) {
  return value
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
}

function createEmptySection(): SummarySection {
  return {
    id: crypto.randomUUID(),
    title: "",
    items: []
  };
}

export function ReviewEditor() {
  const router = useRouter();
  const [summary, setSummary] = useState<StructuredSummary>(EMPTY_SUMMARY);
  const [sessionId, setSessionId] = useState("");
  const [saving, setSaving] = useState(false);
  const [returningToQuestions, setReturningToQuestions] = useState(false);
  const [error, setError] = useState("");
  const [uiLanguage, setUiLanguage] = useState<UiLanguage>("english");
  const copy = useMemo(() => getReviewCopy(uiLanguage), [uiLanguage]);
  const generatedAtText = useMemo(
    () => formatSummaryGeneratedAt(summary.generatedAt, uiLanguage),
    [summary.generatedAt, uiLanguage]
  );

  useEffect(() => {
    let active = true;

    async function initialize() {
      const localDraft = loadDraft();
      const normalizedLocalEmail = localDraft?.email.trim().toLowerCase();

      if (localDraft?.structuredSummary && localDraft.sessionId) {
        setSummary(normalizeStructuredSummary(localDraft.editedSummary ?? localDraft.structuredSummary));
        setSessionId(localDraft.sessionId);
        setUiLanguage(localDraft.intakeDetails.preferredLanguage ?? "english");
      }

      const user = await getCurrentAuthUser();
      const normalizedUserEmail = user?.email?.trim().toLowerCase();

      if (!active) {
        return;
      }

      if (
        localDraft?.structuredSummary &&
        localDraft.sessionId &&
        (!normalizedUserEmail || normalizedLocalEmail === normalizedUserEmail)
      ) {
        return;
      }

      if (!user?.email) {
        router.replace("/");
        return;
      }

      const draft = await loadRemoteDraft().catch(() => null);

      if (!active || !draft?.structuredSummary || !draft.sessionId) {
        router.replace("/");
        return;
      }

      saveDraft(draft);
      setSummary(normalizeStructuredSummary(draft.editedSummary ?? draft.structuredSummary));
      setSessionId(draft.sessionId);
      setUiLanguage(draft.intakeDetails.preferredLanguage ?? "english");
    }

    void initialize();

    return () => {
      active = false;
    };
  }, [router]);

  useEffect(() => {
    if (!sessionId) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      const draft = loadDraft();
      if (!draft) {
        return;
      }

      const nextDraft = {
        ...draft,
        editedSummary: summary
      };

      saveDraft(nextDraft);
      void saveRemoteDraft(nextDraft, "in_progress").catch(() => {
        // Keep local edits if remote persistence is briefly unavailable.
      });
    }, 700);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [sessionId, summary]);

  function updateSection(sectionId: string, changes: Partial<SummarySection>) {
    setSummary((current) => ({
      ...current,
      sections: current.sections.map((section) =>
        section.id === sectionId ? { ...section, ...changes } : section
      )
    }));
  }

  function addSection() {
    setSummary((current) => ({
      ...current,
      sections: [...current.sections, createEmptySection()]
    }));
  }

  function removeSection(sectionId: string) {
    setSummary((current) => ({
      ...current,
      sections: current.sections.filter((section) => section.id !== sectionId)
    }));
  }

  async function handleConfirm() {
    setSaving(true);
    setError("");

    try {
      const response = await fetch("/api/summary/save", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          sessionId,
          editedSummary: summary
        })
      });

      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        throw new Error(data.error ?? copy.confirmFailed);
      }

      const draft = loadDraft();
      if (draft) {
        draft.editedSummary = summary;
        saveDraft(draft);
      }

      router.push("/complete");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : copy.saveFailed);
    } finally {
      setSaving(false);
    }
  }

  async function handleBackToQuestions() {
    setReturningToQuestions(true);

    const draft = loadDraft();
    if (draft) {
      const nextDraft = {
        ...draft,
        editedSummary: summary,
        structuredSummary: draft.structuredSummary ?? summary
      };

      saveDraft(nextDraft);
      await saveRemoteDraft(nextDraft, "in_progress").catch(() => {
        // Preserve local state and continue editing even if remote sync briefly fails.
      });
    }

    router.push("/reflection");
  }

  return (
    <AppShell title={copy.title} subtitle={copy.subtitle}>
      <div className="space-y-5">
        <div className="space-y-3 rounded-3xl border border-border bg-canvas px-5 py-5">
          {generatedAtText ? (
            <div className="space-y-1">
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                {copy.generatedAtLabel}
              </div>
              <div className="text-sm text-slate-700">{generatedAtText}</div>
            </div>
          ) : null}
          <p className="text-sm leading-6 text-slate-700">{copy.regenerateHint}</p>
          <button
            className="w-full rounded-2xl border border-accent px-4 py-3 text-sm font-semibold text-accent transition hover:bg-accent hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
            disabled={saving || returningToQuestions}
            type="button"
            onClick={handleBackToQuestions}
          >
            {copy.backToQuestionsButton}
          </button>
        </div>

        <label className="block space-y-2">
          <span className="text-sm font-medium text-slate-700">{copy.summaryTitleLabel}</span>
          <input
            className="w-full rounded-2xl border border-border px-4 py-3 outline-none transition focus:border-accent"
            value={summary.title}
            onChange={(event) =>
              setSummary((current) => ({
                ...current,
                title: event.target.value
              }))
            }
          />
        </label>

        <label className="block space-y-2">
          <span className="text-sm font-medium text-slate-700">{copy.overviewLabel}</span>
          <textarea
            className="min-h-28 w-full rounded-2xl border border-border px-4 py-3 outline-none transition focus:border-accent"
            value={summary.overview}
            onChange={(event) =>
              setSummary((current) => ({
                ...current,
                overview: event.target.value
              }))
            }
          />
        </label>

        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-medium text-slate-700">{copy.sectionsLabel}</h2>
            <button
              className="rounded-2xl border border-border px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-canvas"
              type="button"
              onClick={addSection}
            >
              {copy.addSectionButton}
            </button>
          </div>

          {summary.sections.map((section) => (
            <div key={section.id} className="space-y-3 rounded-3xl border border-border bg-canvas px-4 py-4">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-medium text-slate-700">{copy.sectionTitleLabel}</span>
                <button
                  className="text-sm font-semibold text-slate-500 transition hover:text-red-600"
                  type="button"
                  onClick={() => removeSection(section.id)}
                >
                  {copy.removeSectionButton}
                </button>
              </div>
              <input
                className="w-full rounded-2xl border border-border bg-white px-4 py-3 outline-none transition focus:border-accent"
                placeholder={copy.sectionTitlePlaceholder}
                value={section.title}
                onChange={(event) => updateSection(section.id, { title: event.target.value })}
              />
              <label className="block space-y-2">
                <span className="text-sm font-medium text-slate-700">{copy.sectionItemsLabel}</span>
                <textarea
                  className="min-h-28 w-full rounded-2xl border border-border bg-white px-4 py-3 outline-none transition focus:border-accent"
                  placeholder={copy.sectionItemsPlaceholder}
                  value={itemsToTextarea(section.items)}
                  onChange={(event) =>
                    updateSection(section.id, { items: textareaToItems(event.target.value) })
                  }
                />
              </label>
            </div>
          ))}
        </div>

        {error ? <StatusBanner tone="error">{error}</StatusBanner> : null}

        <button
          className="w-full rounded-2xl bg-accent px-4 py-3 text-sm font-semibold text-white transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={saving || returningToQuestions}
          type="button"
          onClick={handleConfirm}
        >
          {saving ? copy.savingButton : copy.saveButton}
        </button>
      </div>
    </AppShell>
  );
}
