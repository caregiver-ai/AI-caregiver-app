"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/shell";
import { StatusBanner } from "@/components/status-banner";
import { EMPTY_SUMMARY } from "@/lib/constants";
import { getCurrentAuthUser, loadRemoteDraft, saveRemoteDraft } from "@/lib/draft-api";
import { getReviewCopy } from "@/lib/localization";
import { loadDraft, saveDraft } from "@/lib/storage";
import { StructuredSummary, UiLanguage } from "@/lib/types";

function arrayToTextarea(items: string[]) {
  return items.join("\n");
}

function textareaToArray(value: string) {
  return value
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function ReviewEditor() {
  const router = useRouter();
  const [summary, setSummary] = useState<StructuredSummary>(EMPTY_SUMMARY);
  const [sessionId, setSessionId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [uiLanguage, setUiLanguage] = useState<UiLanguage>("english");
  const copy = useMemo(() => getReviewCopy(uiLanguage), [uiLanguage]);

  useEffect(() => {
    let active = true;

    async function initialize() {
      const localDraft = loadDraft();
      const normalizedLocalEmail = localDraft?.email.trim().toLowerCase();

      if (localDraft?.structuredSummary && localDraft.sessionId) {
        setSummary(localDraft.editedSummary ?? localDraft.structuredSummary);
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
      setSummary(draft.editedSummary ?? draft.structuredSummary);
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

  function updateArrayField(field: Exclude<keyof StructuredSummary, "caregiver_summary_text">, value: string) {
    setSummary((current) => ({
      ...current,
      [field]: textareaToArray(value)
    }));
  }

  const arrayFields: Exclude<keyof StructuredSummary, "caregiver_summary_text">[] = [
    "key_barriers",
    "emotional_concerns",
    "safety_considerations",
    "past_negative_experiences",
    "situations_to_avoid",
    "conditions_for_successful_respite",
    "unresolved_questions"
  ];

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

  return (
    <AppShell title={copy.title} subtitle={copy.subtitle}>
      <div className="space-y-4">
        {arrayFields.map((field) => (
          <label key={field} className="block space-y-2">
            <span className="text-sm font-medium text-slate-700">{copy.fieldLabels[field]}</span>
            <textarea
              className="min-h-24 w-full rounded-2xl border border-border px-4 py-3 outline-none transition focus:border-accent"
              value={arrayToTextarea(summary[field])}
              onChange={(event) => updateArrayField(field, event.target.value)}
            />
          </label>
        ))}

        <label className="block space-y-2">
          <span className="text-sm font-medium text-slate-700">{copy.fieldLabels.caregiver_summary_text}</span>
          <textarea
            className="min-h-28 w-full rounded-2xl border border-border px-4 py-3 outline-none transition focus:border-accent"
            value={summary.caregiver_summary_text}
            onChange={(event) =>
              setSummary((current) => ({
                ...current,
                caregiver_summary_text: event.target.value
              }))
            }
          />
        </label>

        {error ? <StatusBanner tone="error">{error}</StatusBanner> : null}

        <button
          className="w-full rounded-2xl bg-accent px-4 py-3 text-sm font-semibold text-white transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={saving}
          type="button"
          onClick={handleConfirm}
        >
          {saving ? copy.savingButton : copy.saveButton}
        </button>
      </div>
    </AppShell>
  );
}
