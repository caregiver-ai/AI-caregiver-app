"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/shell";
import { StatusBanner } from "@/components/status-banner";
import { authenticatedFetch, getCurrentAuthUser, loadRemoteDraft, saveRemoteDraft } from "@/lib/draft-api";
import { getCompletionCopy } from "@/lib/localization";
import { formatSummaryGeneratedAt, normalizeAuthoritativeStructuredSummary } from "@/lib/summary";
import { loadDraft, saveDraft } from "@/lib/storage";
import { StructuredSummary, UiLanguage } from "@/lib/types";

function SummarySectionBlock({
  title,
  items
}: {
  title: string;
  items: string[];
}) {
  if (items.length === 0) {
    return null;
  }

  return (
    <div className="space-y-2">
      <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">{title}</h2>
      <ul className="space-y-2 text-sm leading-6 text-slate-700">
        {items.map((item) => (
          <li key={item} className="rounded-2xl bg-canvas px-4 py-3">
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
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
  const [uiLanguage, setUiLanguage] = useState<UiLanguage>("english");
  const copy = useMemo(() => getCompletionCopy(uiLanguage), [uiLanguage]);
  const generatedAtText = useMemo(
    () => formatSummaryGeneratedAt(summary?.generatedAt ?? "", uiLanguage),
    [summary?.generatedAt, uiLanguage]
  );

  useEffect(() => {
    let active = true;

    async function initialize() {
      const localDraft = loadDraft();
      const normalizedLocalEmail = localDraft?.email.trim().toLowerCase();

      if (localDraft?.editedSummary) {
        setSummary(normalizeAuthoritativeStructuredSummary(localDraft.editedSummary));
        setSessionId(localDraft.sessionId);
        setRating(localDraft.feedback?.usefulnessRating ?? "");
        setComments(localDraft.feedback?.comments ?? "");
        setRecipientEmail(localDraft.email ?? "");
        setUiLanguage(localDraft.intakeDetails.preferredLanguage ?? "english");
      }

      const user = await getCurrentAuthUser();
      const normalizedUserEmail = user?.email?.trim().toLowerCase();

      if (!active) {
        return;
      }

      if (localDraft?.editedSummary && (!normalizedUserEmail || normalizedLocalEmail === normalizedUserEmail)) {
        if (normalizedUserEmail) {
          setRecipientEmail((current) => current || normalizedUserEmail);
        }
        return;
      }

      if (!user?.email) {
        return;
      }

      const draft = await loadRemoteDraft().catch(() => null);
      if (!draft?.editedSummary) {
        return;
      }

      setSummary(normalizeAuthoritativeStructuredSummary(draft.editedSummary));
      setSessionId(draft.sessionId);
      setRating(draft.feedback?.usefulnessRating ?? "");
      setComments(draft.feedback?.comments ?? "");
      setRecipientEmail(draft.email ?? user.email ?? "");
      setUiLanguage(draft.intakeDetails.preferredLanguage ?? "english");
    }

    void initialize();

    return () => {
      active = false;
    };
  }, []);

  async function handleFeedbackSave() {
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

    setPdfDownloading(true);
    setPdfStatus("");

    try {
      const { createSummaryPdf, sanitizePdfFilename } = await import("@/lib/summary-pdf");
      const pdfBytes = await createSummaryPdf(summary);
      const pdfBuffer = new ArrayBuffer(pdfBytes.byteLength);
      new Uint8Array(pdfBuffer).set(pdfBytes);
      const blob = new Blob([pdfBuffer], { type: "application/pdf" });
      const objectUrl = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = `${sanitizePdfFilename(summary.title)}.pdf`;
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
          {summary.overview ? (
            <div className="space-y-2">
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                {copy.overviewLabel}
              </div>
              <p className="text-sm leading-6 text-slate-700">{summary.overview}</p>
            </div>
          ) : null}
          <div className="space-y-3 border-t border-border pt-4">
            <p className="text-sm leading-6 text-slate-700">{copy.regenerateHint}</p>
            <button
              className="w-full rounded-2xl border border-accent px-4 py-3 text-sm font-semibold text-accent transition hover:bg-accent hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
              disabled={returningToQuestions}
              type="button"
              onClick={handleBackToQuestions}
            >
              {copy.backToQuestionsButton}
            </button>
          </div>
        </div>

        {summary.sections.map((section) => (
          <SummarySectionBlock key={section.id} title={section.title} items={section.items} />
        ))}

        <button
          className="print-hidden w-full rounded-2xl border border-accent px-4 py-3 text-sm font-semibold text-accent transition hover:bg-accent hover:text-white"
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
      </div>
    </AppShell>
  );
}
