"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/shell";
import { StatusBanner } from "@/components/status-banner";
import { StructuredSummarySectionDisplay } from "@/components/structured-summary-sections";
import {
  authenticatedFetch,
  getCurrentAuthUser,
  loadRemoteDraftBundle,
  saveRemoteDraft
} from "@/lib/draft-api";
import { getCompletionCopy } from "@/lib/localization";
import { finalizeSummaryWithQa } from "@/lib/summary-audit";
import { getVisibleSections } from "@/lib/summary-display";
import { getSummaryFreshness } from "@/lib/summary-structured";
import {
  formatSummaryGeneratedAt,
  getOverviewLines
} from "@/lib/summary";
import { loadDraft, saveDraft } from "@/lib/storage";
import {
  SessionDraft,
  StructuredSummary,
  SummaryFreshness,
  UiLanguage
} from "@/lib/types";

function deriveFreshness(draft: SessionDraft, remoteFreshness?: SummaryFreshness | null) {
  if (remoteFreshness) {
    return remoteFreshness;
  }

  return getSummaryFreshness(draft.turns, draft.structuredSummary, draft.editedSummary);
}

export function CompletionView() {
  const router = useRouter();
  const [summary, setSummary] = useState<StructuredSummary | null>(null);
  const [sessionId, setSessionId] = useState("");
  const [rating, setRating] = useState("");
  const [comments, setComments] = useState("");
  const [status, setStatus] = useState("");
  const [statusTone, setStatusTone] = useState<"success" | "error">("success");
  const [recipientEmail, setRecipientEmail] = useState("");
  const [emailSending, setEmailSending] = useState(false);
  const [emailStatus, setEmailStatus] = useState("");
  const [emailStatusTone, setEmailStatusTone] = useState<"success" | "error">("success");
  const [pdfDownloading, setPdfDownloading] = useState(false);
  const [pdfStatus, setPdfStatus] = useState("");
  const [returningToQuestions, setReturningToQuestions] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [uiLanguage, setUiLanguage] = useState<UiLanguage>("english");
  const [summaryFreshness, setSummaryFreshness] = useState<SummaryFreshness | null>(null);
  const copy = useMemo(() => getCompletionCopy(uiLanguage), [uiLanguage]);
  const generatedAtText = useMemo(
    () => formatSummaryGeneratedAt(summary?.generatedAt ?? "", uiLanguage),
    [summary?.generatedAt, uiLanguage]
  );
  const overviewLines = useMemo(
    () => getOverviewLines(summary?.overview ?? ""),
    [summary?.overview]
  );
  const requiresRegeneration = summaryFreshness?.requiresRegeneration ?? false;

  function applyDraftState(draft: SessionDraft, freshness?: SummaryFreshness | null) {
    setSummary(
      finalizeSummaryWithQa(draft.editedSummary ?? draft.structuredSummary, {
        source: "saved"
      }).summary
    );
    setSessionId(draft.sessionId);
    setRating(draft.feedback?.usefulnessRating ?? "");
    setComments(draft.feedback?.comments ?? "");
    setRecipientEmail(draft.email ?? "");
    setUiLanguage(draft.intakeDetails.preferredLanguage ?? "english");
    setSummaryFreshness(deriveFreshness(draft, freshness));
  }

  useEffect(() => {
    let active = true;

    async function initialize() {
      const localDraft = loadDraft();
      if (localDraft?.editedSummary) {
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

        if (remoteResult?.draft?.editedSummary) {
          saveDraft(remoteResult.draft);
          applyDraftState(remoteResult.draft, remoteResult.summaryFreshness);
          setRecipientEmail(remoteResult.draft.email ?? user.email ?? "");
          return;
        }
      }

      if (
        localDraft?.editedSummary &&
        (!normalizedUserEmail || normalizedLocalEmail === normalizedUserEmail)
      ) {
        if (normalizedUserEmail) {
          setRecipientEmail((current) => current || normalizedUserEmail);
        }
        return;
      }
    }

    void initialize();

    return () => {
      active = false;
    };
  }, []);

  async function handleRegenerate() {
    if (!sessionId || regenerating) {
      return;
    }

    setRegenerating(true);
    setStatus("");
    setEmailStatus("");
    setPdfStatus("");

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
      setStatus(copy.regenerateSuccess);
      setStatusTone("success");
    } catch (requestError) {
      setStatus(requestError instanceof Error ? requestError.message : copy.regenerateFailed);
      setStatusTone("error");
    } finally {
      setRegenerating(false);
    }
  }

  async function handleFeedbackSave() {
    if (requiresRegeneration) {
      setStatus(copy.staleSummaryMessage);
      setStatusTone("error");
      return;
    }

    const response = await fetch("/api/feedback", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        sessionId,
        usefulnessRating: rating,
        comments
      })
    });

    if (!response.ok) {
      setStatus(copy.feedbackSaveFailed);
      setStatusTone("error");
      return;
    }

    const draft = loadDraft();
    if (draft) {
      draft.feedback = {
        usefulnessRating: rating,
        comments
      };
      saveDraft(draft);
      void saveRemoteDraft(draft, "completed").catch(() => {
        // Preserve local feedback even if remote draft sync fails.
      });
    }

    setStatus(copy.feedbackSaved);
    setStatusTone("success");
  }

  async function handleEmailSend() {
    if (requiresRegeneration) {
      setEmailStatus(copy.staleSummaryMessage);
      setEmailStatusTone("error");
      return;
    }

    if (!sessionId || !recipientEmail.trim()) {
      setEmailStatus(copy.emailSendFailed);
      setEmailStatusTone("error");
      return;
    }

    setEmailSending(true);
    setEmailStatus("");

    try {
      const response = await authenticatedFetch("/api/summary/email", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          sessionId,
          recipientEmail: recipientEmail.trim()
        })
      });

      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(data.error ?? copy.emailSendFailed);
      }

      setEmailStatus(copy.emailSent(recipientEmail.trim()));
      setEmailStatusTone("success");
    } catch (sendError) {
      setEmailStatus(sendError instanceof Error ? sendError.message : copy.emailSendFailed);
      setEmailStatusTone("error");
    } finally {
      setEmailSending(false);
    }
  }

  async function handlePdfDownload() {
    if (!summary || pdfDownloading) {
      return;
    }

    if (requiresRegeneration) {
      setPdfStatus(copy.staleSummaryMessage);
      return;
    }

    setPdfDownloading(true);
    setPdfStatus("");

    try {
      const { createSummaryPdf, sanitizePdfFilename } = await import("@/lib/summary-pdf");
      const qaSummary = finalizeSummaryWithQa(summary, { source: "saved" }).summary;
      const pdfBytes = await createSummaryPdf(qaSummary);
      const pdfBuffer = new ArrayBuffer(pdfBytes.byteLength);
      new Uint8Array(pdfBuffer).set(pdfBytes);
      const blob = new Blob([pdfBuffer], { type: "application/pdf" });
      const objectUrl = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = `${sanitizePdfFilename(qaSummary.title)}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(objectUrl);
    } catch {
      setPdfStatus(copy.downloadPdfFailed);
    } finally {
      setPdfDownloading(false);
    }
  }

  async function handleBackToQuestions() {
    setReturningToQuestions(true);

    const draft = loadDraft();
    if (draft) {
      saveDraft(draft);
      await saveRemoteDraft(draft, "in_progress").catch(() => {
        // Preserve local state and allow editing even if remote sync briefly fails.
      });
    }

    router.push("/reflection");
  }

  if (!summary) {
    return (
      <AppShell title={copy.emptyTitle} subtitle={copy.emptySubtitle}>
        <StatusBanner tone="info">{copy.emptyMessage}</StatusBanner>
      </AppShell>
    );
  }

  return (
    <AppShell title={copy.title} subtitle={copy.subtitle}>
      <div className="space-y-5">
        <div className="space-y-3 rounded-3xl border border-border bg-canvas px-5 py-5">
          <h2 className="text-2xl font-semibold text-ink">{summary.title}</h2>
          {generatedAtText ? (
            <div className="space-y-1">
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                {copy.generatedAtLabel}
              </div>
              <p className="text-sm text-slate-700">{generatedAtText}</p>
            </div>
          ) : null}
          {overviewLines.length > 0 ? (
            <div className="space-y-2">
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                {copy.overviewLabel}
              </div>
              <ul className="space-y-1 text-sm leading-6 text-slate-700">
                {overviewLines.map((line) => (
                  <li key={line} className="flex gap-2">
                    <span aria-hidden="true">•</span>
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="space-y-3 border-t border-border pt-4">
            {requiresRegeneration ? (
              <StatusBanner tone="error">{copy.staleSummaryMessage}</StatusBanner>
            ) : (
              <p className="text-sm leading-6 text-slate-700">{copy.regenerateHint}</p>
            )}
            <button
              className="w-full rounded-2xl bg-accent px-4 py-3 text-sm font-semibold text-white transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={regenerating || returningToQuestions}
              type="button"
              onClick={handleRegenerate}
            >
              {regenerating ? copy.regeneratingButton : copy.regenerateButton}
            </button>
            <button
              className="w-full rounded-2xl border border-accent px-4 py-3 text-sm font-semibold text-accent transition hover:bg-accent hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
              disabled={returningToQuestions || regenerating}
              type="button"
              onClick={handleBackToQuestions}
            >
              {copy.backToQuestionsButton}
            </button>
          </div>
        </div>

        {!requiresRegeneration ? (
          <>
            {getVisibleSections(summary).map((section) => (
              <StructuredSummarySectionDisplay key={section.id} section={section} />
            ))}

            <button
              className="print-hidden w-full rounded-2xl border border-accent px-4 py-3 text-sm font-semibold text-accent transition hover:bg-accent hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
              disabled={pdfDownloading}
              type="button"
              onClick={handlePdfDownload}
            >
              {pdfDownloading ? copy.preparingPdfButton : copy.downloadPdfButton}
            </button>
            {pdfStatus ? <StatusBanner tone="error">{pdfStatus}</StatusBanner> : null}

            <div className="space-y-3 rounded-3xl border border-border bg-canvas px-5 py-5">
              <div className="space-y-1">
                <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">
                  {copy.emailPdfTitle}
                </h2>
                <p className="text-sm leading-6 text-slate-700">{copy.emailPdfSubtitle}</p>
              </div>
              <label className="block space-y-2">
                <span className="text-sm font-medium text-slate-700">{copy.recipientEmailLabel}</span>
                <input
                  autoComplete="email"
                  className="w-full rounded-2xl border border-border px-4 py-3 outline-none transition focus:border-accent"
                  placeholder={copy.recipientEmailPlaceholder}
                  type="email"
                  value={recipientEmail}
                  onChange={(event) => {
                    setRecipientEmail(event.target.value);
                    setEmailStatus("");
                  }}
                />
              </label>
              <button
                className="w-full rounded-2xl bg-accent px-4 py-3 text-sm font-semibold text-white transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={!sessionId || !recipientEmail.trim() || emailSending}
                type="button"
                onClick={handleEmailSend}
              >
                {emailSending ? copy.sendingPdfButton : copy.sendPdfButton}
              </button>
              {emailStatus ? <StatusBanner tone={emailStatusTone}>{emailStatus}</StatusBanner> : null}
            </div>

            <div className="space-y-3 border-t border-border pt-4">
              <label className="block space-y-2">
                <span className="text-sm font-medium text-slate-700">{copy.feedbackLabel}</span>
                <input
                  className="w-full rounded-2xl border border-border px-4 py-3 outline-none transition focus:border-accent"
                  placeholder={copy.feedbackPlaceholder}
                  value={rating}
                  onChange={(event) => setRating(event.target.value)}
                />
              </label>
              <label className="block space-y-2">
                <span className="text-sm font-medium text-slate-700">{copy.commentsLabel}</span>
                <textarea
                  className="min-h-24 w-full rounded-2xl border border-border px-4 py-3 outline-none transition focus:border-accent"
                  value={comments}
                  onChange={(event) => setComments(event.target.value)}
                />
              </label>
              <button
                className="print-hidden w-full rounded-2xl bg-accent px-4 py-3 text-sm font-semibold text-white transition hover:bg-teal-700"
                type="button"
                onClick={handleFeedbackSave}
              >
                {copy.saveFeedbackButton}
              </button>
              {status ? <StatusBanner tone={statusTone}>{status}</StatusBanner> : null}
            </div>
          </>
        ) : (
          <>
            {status ? <StatusBanner tone={statusTone}>{status}</StatusBanner> : null}
            {emailStatus ? <StatusBanner tone={emailStatusTone}>{emailStatus}</StatusBanner> : null}
            {pdfStatus ? <StatusBanner tone="error">{pdfStatus}</StatusBanner> : null}
          </>
        )}
      </div>
    </AppShell>
  );
}
