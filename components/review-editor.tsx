"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/shell";
import { StatusBanner } from "@/components/status-banner";
import { StructuredSummarySectionEditor } from "@/components/structured-summary-sections";
import { EMPTY_SUMMARY } from "@/lib/constants";
import {
  authenticatedFetch,
  getCurrentAuthUser,
  loadRemoteDraftBundle,
  saveRemoteDraft
} from "@/lib/draft-api";
import { getReviewCopy } from "@/lib/localization";
import { finalizeSummaryWithQa, summarizeSummaryAuditReport } from "@/lib/summary-audit";
import { getVisibleSections } from "@/lib/summary-display";
import { getSummaryFreshness } from "@/lib/summary-structured";
import { formatSummaryGeneratedAt, normalizeEditableStructuredSummary } from "@/lib/summary";
import { loadDraft, saveDraft } from "@/lib/storage";
import {
  SessionDraft,
  StructuredSummary,
  SummaryAuditReport,
  SummaryFreshness,
  SummarySection,
  UiLanguage
} from "@/lib/types";

function deriveFreshness(draft: SessionDraft, remoteFreshness?: SummaryFreshness | null) {
  if (remoteFreshness) {
    return remoteFreshness;
  }

  return getSummaryFreshness(draft.turns, draft.structuredSummary, draft.editedSummary);
}

export function ReviewEditor() {
  const router = useRouter();
  const [summary, setSummary] = useState<StructuredSummary>(EMPTY_SUMMARY);
  const [sessionId, setSessionId] = useState("");
  const [saving, setSaving] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [returningToQuestions, setReturningToQuestions] = useState(false);
  const [error, setError] = useState("");
  const [uiLanguage, setUiLanguage] = useState<UiLanguage>("english");
  const [summaryFreshness, setSummaryFreshness] = useState<SummaryFreshness | null>(null);
  const [storedAuditReport, setStoredAuditReport] = useState<SummaryAuditReport | null>(null);
  const copy = useMemo(() => getReviewCopy(uiLanguage), [uiLanguage]);
  const generatedAtText = useMemo(
    () => formatSummaryGeneratedAt(summary.generatedAt, uiLanguage),
    [summary.generatedAt, uiLanguage]
  );
  const auditResult = useMemo(
    () => finalizeSummaryWithQa(summary, { source: "edited" }),
    [summary]
  );
  const auditReport = auditResult.report;
  const auditSummaryLines = useMemo(
    () => summarizeSummaryAuditReport(auditReport),
    [auditReport]
  );
  const requiresRegeneration = summaryFreshness?.requiresRegeneration ?? false;

  function applyDraftState(draft: SessionDraft, freshness?: SummaryFreshness | null) {
    setSummary(normalizeEditableStructuredSummary(draft.editedSummary ?? draft.structuredSummary));
    setSessionId(draft.sessionId);
    setUiLanguage(draft.intakeDetails.preferredLanguage ?? "english");
    setSummaryFreshness(deriveFreshness(draft, freshness));
    setStoredAuditReport(draft.editedSummaryAudit ?? draft.structuredSummaryAudit ?? null);
  }

  useEffect(() => {
    let active = true;

    async function initialize() {
      const localDraft = loadDraft();
      if (localDraft?.structuredSummary && localDraft.sessionId) {
        applyDraftState(localDraft);
      }

      const user = await getCurrentAuthUser();
      const normalizedLocalEmail = localDraft?.email.trim().toLowerCase();
      const normalizedUserEmail = user?.email?.trim().toLowerCase();

      if (!active) {
        return;
      }

      if (user?.email) {
        const remoteResult = await loadRemoteDraftBundle().catch(() => null);
        if (!active) {
          return;
        }

        if (remoteResult?.draft?.structuredSummary && remoteResult.draft.sessionId) {
          saveDraft(remoteResult.draft);
          applyDraftState(remoteResult.draft, remoteResult.summaryFreshness);
          return;
        }
      }

      if (
        localDraft?.structuredSummary &&
        localDraft.sessionId &&
        (!normalizedUserEmail || normalizedLocalEmail === normalizedUserEmail)
      ) {
        return;
      }

      router.replace("/");
    }

    void initialize();

    return () => {
      active = false;
    };
  }, [router]);

  useEffect(() => {
    if (!sessionId || requiresRegeneration) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      const draft = loadDraft();
      if (!draft) {
        return;
      }

      const nextDraft = {
        ...draft,
        editedSummary: summary,
        editedSummaryAudit: auditReport
      };

      saveDraft(nextDraft);
      void saveRemoteDraft(nextDraft, "in_progress").catch(() => {
        // Keep local edits if remote persistence is briefly unavailable.
      });
    }, 700);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [requiresRegeneration, sessionId, summary]);

  function updateSection(nextSection: SummarySection) {
    setSummary((current) => ({
      ...current,
      sections: current.sections.map((section) => (section.id === nextSection.id ? nextSection : section))
    }));
  }

  async function handleRegenerate() {
    if (!sessionId || regenerating) {
      return;
    }

    setRegenerating(true);
    setError("");

    try {
      const response = await authenticatedFetch("/api/summary/regenerate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ sessionId })
      });

      const data = (await response.json()) as {
        draft?: SessionDraft;
        summary?: StructuredSummary;
        summaryFreshness?: SummaryFreshness | null;
        error?: string;
      };

      if (!response.ok) {
        throw new Error(data.error ?? copy.regenerateFailed);
      }

      const nextDraft =
        data.draft ??
        (() => {
          const currentDraft = loadDraft();
          if (!currentDraft || !data.summary) {
            return null;
          }

          return {
            ...currentDraft,
            structuredSummary: data.summary,
            editedSummary: data.summary
          } satisfies SessionDraft;
        })();

      if (!nextDraft) {
        throw new Error(copy.regenerateFailed);
      }

      saveDraft(nextDraft);
      applyDraftState(nextDraft, data.summaryFreshness);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : copy.regenerateFailed);
    } finally {
      setRegenerating(false);
    }
  }

  async function handleConfirm() {
    if (requiresRegeneration) {
      setError(copy.staleSummaryMessage);
      return;
    }

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

      const data = (await response.json()) as {
        ok?: boolean;
        editedSummary?: StructuredSummary;
        auditReport?: SummaryAuditReport;
      };

      const draft = loadDraft();
      if (draft) {
        draft.editedSummary = data.editedSummary ?? summary;
        draft.editedSummaryAudit = data.auditReport ?? auditReport;
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
        structuredSummary: draft.structuredSummary ?? summary,
        editedSummaryAudit: auditReport
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
          {requiresRegeneration ? (
            <div className="space-y-3">
              <StatusBanner tone="error">{copy.staleSummaryMessage}</StatusBanner>
              <button
                className="w-full rounded-2xl bg-accent px-4 py-3 text-sm font-semibold text-white transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={regenerating || returningToQuestions}
                type="button"
                onClick={handleRegenerate}
              >
                {regenerating ? copy.regeneratingButton : copy.regenerateButton}
              </button>
            </div>
          ) : (
            <p className="text-sm leading-6 text-slate-700">{copy.regenerateHint}</p>
          )}
          {!requiresRegeneration && auditReport.status === "warn" ? (
            <StatusBanner tone="error">
              <div className="space-y-2">
                <p className="font-medium">{copy.auditWarningTitle}</p>
                <p>{copy.auditWarningIntro}</p>
                <ul className="list-disc pl-5">
                  {auditSummaryLines.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </div>
            </StatusBanner>
          ) : storedAuditReport?.status === "warn" ? (
            <StatusBanner tone="error">
              <div className="space-y-2">
                <p className="font-medium">{copy.auditWarningTitle}</p>
                <p>{copy.auditWarningIntro}</p>
                <ul className="list-disc pl-5">
                  {summarizeSummaryAuditReport(storedAuditReport).map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </div>
            </StatusBanner>
          ) : null}
          <button
            className="w-full rounded-2xl border border-accent px-4 py-3 text-sm font-semibold text-accent transition hover:bg-accent hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
            disabled={saving || regenerating || returningToQuestions}
            type="button"
            onClick={handleBackToQuestions}
          >
            {copy.backToQuestionsButton}
          </button>
        </div>

        {requiresRegeneration ? null : (
          <>
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

            {summary.overview ? (
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
            ) : null}

            <div className="space-y-3">
              <h2 className="text-sm font-medium text-slate-700">{copy.sectionsLabel}</h2>
              {getVisibleSections(summary).map((section) => (
                <StructuredSummarySectionEditor
                  key={section.id}
                  section={section}
                  onChange={updateSection}
                />
              ))}
            </div>
          </>
        )}

        {error ? <StatusBanner tone="error">{error}</StatusBanner> : null}

        {!requiresRegeneration ? (
          <button
            className="w-full rounded-2xl bg-accent px-4 py-3 text-sm font-semibold text-white transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={saving || returningToQuestions || regenerating}
            type="button"
            onClick={handleConfirm}
          >
            {saving ? copy.savingButton : copy.saveButton}
          </button>
        ) : null}
      </div>
    </AppShell>
  );
}
