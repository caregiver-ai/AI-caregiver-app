"use client";

import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/shell";
import { StatusBanner } from "@/components/status-banner";
import { getCurrentAuthUser, loadRemoteDraft, saveRemoteDraft } from "@/lib/draft-api";
import { getCompletionCopy } from "@/lib/localization";
import { loadDraft, saveDraft } from "@/lib/storage";
import { StructuredSummary, UiLanguage } from "@/lib/types";

function SummaryBlock({ label, items }: { label: string; items: string[] }) {
  if (items.length === 0) {
    return null;
  }

  return (
    <div className="space-y-2">
      <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">{label}</h2>
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
  const [summary, setSummary] = useState<StructuredSummary | null>(null);
  const [sessionId, setSessionId] = useState("");
  const [rating, setRating] = useState("");
  const [comments, setComments] = useState("");
  const [status, setStatus] = useState("");
  const [statusTone, setStatusTone] = useState<"success" | "error">("success");
  const [uiLanguage, setUiLanguage] = useState<UiLanguage>("english");
  const copy = useMemo(() => getCompletionCopy(uiLanguage), [uiLanguage]);

  useEffect(() => {
    let active = true;

    async function initialize() {
      const localDraft = loadDraft();
      const normalizedLocalEmail = localDraft?.email.trim().toLowerCase();

      if (localDraft?.editedSummary) {
        setSummary(localDraft.editedSummary);
        setSessionId(localDraft.sessionId);
        setRating(localDraft.feedback?.usefulnessRating ?? "");
        setComments(localDraft.feedback?.comments ?? "");
        setUiLanguage(localDraft.intakeDetails.preferredLanguage ?? "english");
      }

      const user = await getCurrentAuthUser();
      const normalizedUserEmail = user?.email?.trim().toLowerCase();

      if (!active) {
        return;
      }

      if (localDraft?.editedSummary && (!normalizedUserEmail || normalizedLocalEmail === normalizedUserEmail)) {
        return;
      }

      if (!user?.email) {
        return;
      }

      const draft = await loadRemoteDraft().catch(() => null);
      if (!draft?.editedSummary) {
        return;
      }

      setSummary(draft.editedSummary);
      setSessionId(draft.sessionId);
      setRating(draft.feedback?.usefulnessRating ?? "");
      setComments(draft.feedback?.comments ?? "");
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
        <SummaryBlock label={copy.fieldLabels.key_barriers} items={summary.key_barriers} />
        <SummaryBlock label={copy.fieldLabels.emotional_concerns} items={summary.emotional_concerns} />
        <SummaryBlock
          label={copy.fieldLabels.safety_considerations}
          items={summary.safety_considerations}
        />
        <SummaryBlock
          label={copy.fieldLabels.past_negative_experiences}
          items={summary.past_negative_experiences}
        />
        <SummaryBlock label={copy.fieldLabels.situations_to_avoid} items={summary.situations_to_avoid} />
        <SummaryBlock
          label={copy.fieldLabels.conditions_for_successful_respite}
          items={summary.conditions_for_successful_respite}
        />
        <SummaryBlock
          label={copy.fieldLabels.unresolved_questions}
          items={summary.unresolved_questions}
        />

        <div className="rounded-2xl bg-canvas px-4 py-4 text-sm leading-6 text-slate-700">
          {summary.caregiver_summary_text}
        </div>

        <button
          className="print-hidden w-full rounded-2xl border border-accent px-4 py-3 text-sm font-semibold text-accent transition hover:bg-accent hover:text-white"
          type="button"
          onClick={() => window.print()}
        >
          {copy.downloadPdfButton}
        </button>

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
