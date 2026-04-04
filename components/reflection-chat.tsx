"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/shell";
import { StatusBanner } from "@/components/status-banner";
import {
  AudioRecorderController,
  isAudioRecordingSupported,
  startWavRecording
} from "@/lib/audio";
import { getCurrentAuthUser, loadRemoteDraft, saveRemoteDraft } from "@/lib/draft-api";
import { getLanguageLabel, getReflectionCopy } from "@/lib/localization";
import {
  ReflectionResponse,
  buildTurnsFromResponses,
  getFirstIncompletePromptIndex,
  getPromptSequence,
  getResponsesFromTurns
} from "@/lib/reflection";
import { loadDraft, saveDraft } from "@/lib/storage";
import { SessionDraft, UiLanguage } from "@/lib/types";

const MAX_RECORDING_MS = 45 * 1000;
const MAX_TRANSCRIPTION_UPLOAD_BYTES = 4 * 1024 * 1024;
const SPOKEN_LANGUAGE_OPTIONS: UiLanguage[] = ["english", "spanish", "mandarin"];

function formatDuration(durationMs: number) {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function hasContent(response?: ReflectionResponse) {
  return Boolean(response?.content.trim());
}

function getFirstPromptId(language: UiLanguage) {
  return getPromptSequence(language)[0]?.id ?? "";
}

function sanitizeResponses(responses: Record<string, ReflectionResponse>) {
  const sanitizedEntries: Array<[string, ReflectionResponse]> = [];

  for (const [promptId, response] of Object.entries(responses)) {
    const content = response.content.trim();
    if (!content) {
      continue;
    }

    sanitizedEntries.push([
      promptId,
      {
        ...response,
        content
      }
    ]);
  }

  return Object.fromEntries(sanitizedEntries) as Record<string, ReflectionResponse>;
}

export function ReflectionChat() {
  const router = useRouter();
  const [sessionId, setSessionId] = useState("");
  const [responses, setResponses] = useState<Record<string, ReflectionResponse>>({});
  const [activePromptId, setActivePromptId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [statusTone, setStatusTone] = useState<"info" | "success">("info");
  const [recordingSupported, setRecordingSupported] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordingDurationMs, setRecordingDurationMs] = useState(0);
  const [transcribing, setTranscribing] = useState(false);
  const [uiLanguage, setUiLanguage] = useState<UiLanguage>("english");
  const [audioLanguage, setAudioLanguage] = useState<UiLanguage>("english");
  const recorderRef = useRef<AudioRecorderController | null>(null);
  const recordingTimerRef = useRef<number | null>(null);
  const recordingTimeoutRef = useRef<number | null>(null);
  const recordingStartedAtRef = useRef<number | null>(null);

  const reflectionCopy = useMemo(() => getReflectionCopy(uiLanguage), [uiLanguage]);
  const prompts = useMemo(() => getPromptSequence(uiLanguage), [uiLanguage]);
  const currentPrompt = useMemo(
    () => prompts.find((prompt) => prompt.id === activePromptId) ?? prompts[0] ?? null,
    [activePromptId, prompts]
  );
  const hasAnyResponse = useMemo(
    () => prompts.some((prompt) => hasContent(responses[prompt.id])),
    [prompts, responses]
  );

  useEffect(() => {
    let active = true;

    async function initialize() {
      const localDraft = loadDraft();
      const normalizedLocalEmail = localDraft?.email.trim().toLowerCase();

      if (localDraft?.sessionId) {
        const preferredLanguage = localDraft.intakeDetails.preferredLanguage ?? "english";
        const localResponses = getResponsesFromTurns(localDraft.turns, preferredLanguage);
        const firstIncompleteIndex = getFirstIncompletePromptIndex(localResponses, preferredLanguage);
        const promptSequence = getPromptSequence(preferredLanguage);
        setSessionId(localDraft.sessionId);
        setResponses(localResponses);
        setUiLanguage(preferredLanguage);
        setAudioLanguage(preferredLanguage);
        setActivePromptId(
          promptSequence[firstIncompleteIndex >= 0 ? firstIncompleteIndex : 0]?.id ??
            getFirstPromptId(preferredLanguage)
        );
      }

      const user = await getCurrentAuthUser();
      const normalizedUserEmail = user?.email?.trim().toLowerCase();

      if (!active) {
        return;
      }

      if (localDraft?.sessionId && (!normalizedUserEmail || normalizedLocalEmail === normalizedUserEmail)) {
        return;
      }

      if (!user?.email) {
        router.replace("/");
        return;
      }

      const draft = await loadRemoteDraft().catch(() => null);

      if (!active || !draft?.sessionId) {
        router.replace("/");
        return;
      }

      saveDraft(draft);

      const preferredLanguage = draft.intakeDetails.preferredLanguage ?? "english";
      const remoteResponses = getResponsesFromTurns(draft.turns, preferredLanguage);
      const firstIncompleteIndex = getFirstIncompletePromptIndex(remoteResponses, preferredLanguage);
      const promptSequence = getPromptSequence(preferredLanguage);
      setSessionId(draft.sessionId);
      setResponses(remoteResponses);
      setUiLanguage(preferredLanguage);
      setAudioLanguage(preferredLanguage);
      setActivePromptId(
        promptSequence[firstIncompleteIndex >= 0 ? firstIncompleteIndex : 0]?.id ??
          getFirstPromptId(preferredLanguage)
      );
    }

    void initialize();

    return () => {
      active = false;
    };
  }, [router]);

  useEffect(() => {
    setRecordingSupported(isAudioRecordingSupported());
  }, []);

  useEffect(() => {
    return () => {
      if (recordingTimerRef.current) {
        window.clearInterval(recordingTimerRef.current);
      }

      if (recordingTimeoutRef.current) {
        window.clearTimeout(recordingTimeoutRef.current);
      }

      const recorder = recorderRef.current;
      recorderRef.current = null;
      if (recorder) {
        void recorder.cancel();
      }
    };
  }, []);

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
        turns: buildTurnsFromResponses(sanitizeResponses(responses), uiLanguage)
      };

      saveDraft(nextDraft);
      void saveRemoteDraft(nextDraft, "in_progress").catch(() => {
        // Keep local progress even if remote persistence is briefly unavailable.
      });
    }, 500);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [responses, sessionId, uiLanguage]);

  function getAudioPanelCopy({
    recordingState,
    transcribingState,
    durationMs
  }: {
    recordingState: boolean;
    transcribingState: boolean;
    durationMs: number;
  }) {
    const audioLanguageLabel = getLanguageLabel(audioLanguage, uiLanguage);
    const isEnglish = audioLanguage === "english";

    if (recordingState) {
      return reflectionCopy.recordingStatus(
        formatDuration(durationMs),
        formatDuration(MAX_RECORDING_MS)
      );
    }

    if (transcribingState) {
      return reflectionCopy.audioTranscribing(audioLanguageLabel, isEnglish);
    }

    return reflectionCopy.audioReady(audioLanguageLabel, isEnglish);
  }

  function clearRecordingTimers() {
    if (recordingTimerRef.current) {
      window.clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }

    if (recordingTimeoutRef.current) {
      window.clearTimeout(recordingTimeoutRef.current);
      recordingTimeoutRef.current = null;
    }
  }

  function updateResponse(promptId: string, value: string) {
    setActivePromptId(promptId);
    setError("");
    setStatusMessage("");

    setResponses((current) => {
      if (!value.trim()) {
        if (!current[promptId]) {
          return current;
        }

        const next = { ...current };
        delete next[promptId];
        return next;
      }

      return {
        ...current,
        [promptId]: {
          promptId,
          content: value,
          skipped: false,
          createdAt: current[promptId]?.createdAt ?? new Date().toISOString()
        }
      };
    });
  }

  async function transcribeAudio(audioBlob: Blob) {
    if (!currentPrompt) {
      return;
    }

    if (audioBlob.size > MAX_TRANSCRIPTION_UPLOAD_BYTES) {
      setError(reflectionCopy.recordingTooLarge);
      setStatusMessage("");
      setStatusTone("info");
      return;
    }

    setTranscribing(true);
    setError("");
    setStatusMessage(
      getAudioPanelCopy({
        recordingState: false,
        transcribingState: true,
        durationMs: recordingDurationMs
      })
    );
    setStatusTone("info");

    try {
      const formData = new FormData();
      formData.append("audio", new File([audioBlob], "response.wav", { type: "audio/wav" }));
      formData.append("question", currentPrompt.content);
      formData.append("sectionTitle", currentPrompt.sectionTitle ?? "");
      formData.append("promptLabel", currentPrompt.promptLabel ?? "");
      formData.append("spokenLanguage", audioLanguage);

      const response = await fetch("/api/transcribe", {
        method: "POST",
        body: formData
      });

      const rawResponse = await response.text();
      let data: {
        error?: string;
        transcript?: string;
      } = {};

      try {
        data = rawResponse ? (JSON.parse(rawResponse) as typeof data) : {};
      } catch {
        if (!response.ok) {
          const normalizedError = rawResponse.trim().toLowerCase();
          if (
            response.status === 413 ||
            normalizedError.includes("request entity too large") ||
            normalizedError.includes("body exceeded")
          ) {
            throw new Error(reflectionCopy.recordingTooLarge);
          }

          throw new Error(reflectionCopy.unableToTranscribe);
        }

        data = {
          transcript: rawResponse
        };
      }

      if (!response.ok) {
        throw new Error(data.error ?? "Audio transcription failed.");
      }

      const transcriptText = data.transcript?.trim() ?? "";
      if (!transcriptText) {
        setStatusMessage(reflectionCopy.noSpeechDetected);
        setStatusTone("info");
        return;
      }

      setResponses((current) => {
        const currentValue = current[currentPrompt.id]?.content.trim() ?? "";
        const nextValue = currentValue ? `${currentValue}\n${transcriptText}` : transcriptText;

        return {
          ...current,
          [currentPrompt.id]: {
            promptId: currentPrompt.id,
            content: nextValue,
            skipped: false,
            createdAt: current[currentPrompt.id]?.createdAt ?? new Date().toISOString()
          }
        };
      });
      setStatusMessage(reflectionCopy.audioAdded(audioLanguage === "english"));
      setStatusTone("success");
    } catch (requestError) {
      setError(
        requestError instanceof Error ? requestError.message : reflectionCopy.unableToTranscribe
      );
    } finally {
      setTranscribing(false);
    }
  }

  async function startRecording() {
    if (!currentPrompt || submitting || transcribing || recording) {
      return;
    }

    setError("");
    setStatusMessage(reflectionCopy.recordingStatus("0:00", formatDuration(MAX_RECORDING_MS)));
    setStatusTone("info");
    setRecordingDurationMs(0);

    try {
      const recorder = await startWavRecording();
      recorderRef.current = recorder;
      recordingStartedAtRef.current = performance.now();
      setRecording(true);

      recordingTimerRef.current = window.setInterval(() => {
        const startedAt = recordingStartedAtRef.current;
        if (startedAt) {
          setRecordingDurationMs(performance.now() - startedAt);
        }
      }, 250);

      recordingTimeoutRef.current = window.setTimeout(() => {
        void stopRecording(true);
      }, MAX_RECORDING_MS);
    } catch (recordingError) {
      setStatusMessage("");
      setError(
        recordingError instanceof Error
          ? recordingError.message
          : reflectionCopy.unableToStartRecording
      );
    }
  }

  async function stopRecording(autoStopped = false) {
    const recorder = recorderRef.current;
    if (!recorder) {
      return;
    }

    recorderRef.current = null;
    clearRecordingTimers();
    setRecording(false);
    recordingStartedAtRef.current = null;

    try {
      const recordedAudio = await recorder.stop();
      setRecordingDurationMs(recordedAudio.durationMs);

      if (recordedAudio.durationMs < 500) {
        setStatusMessage(reflectionCopy.recordingTooShort);
        setStatusTone("info");
        return;
      }

      setStatusMessage(
        autoStopped
          ? reflectionCopy.audioLimitReached(
              getLanguageLabel(audioLanguage, uiLanguage),
              audioLanguage === "english"
            )
          : getAudioPanelCopy({
              recordingState: false,
              transcribingState: true,
              durationMs: recordedAudio.durationMs
            })
      );
      setStatusTone("info");
      await transcribeAudio(recordedAudio.blob);
    } catch (recordingError) {
      setError(
        recordingError instanceof Error
          ? recordingError.message
          : reflectionCopy.unableToFinishRecording
      );
    }
  }

  async function persistDraft(nextDraft: SessionDraft) {
    saveDraft(nextDraft);

    try {
      await saveRemoteDraft(nextDraft, "in_progress");
    } catch {
      // Keep local progress even if the server save fails temporarily.
    }
  }

  async function finalizeFlow() {
    const finalResponses = sanitizeResponses(responses);
    if (Object.keys(finalResponses).length === 0) {
      setError(reflectionCopy.enterAtLeastOneResponse);
      return;
    }

    setSubmitting(true);
    setError("");
    setStatusMessage("");

    try {
      const finalTurns = buildTurnsFromResponses(finalResponses, uiLanguage);
      const draft = loadDraft();
      const nameHint =
        draft?.intakeDetails.careRecipientPreferredName.trim() ||
        draft?.intakeDetails.careRecipientFirstName.trim() ||
        [draft?.intakeDetails.careRecipientFirstName, draft?.intakeDetails.careRecipientLastName]
          .filter(Boolean)
          .join(" ")
          .trim();

      const response = await fetch("/api/summary", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          sessionId,
          turns: finalTurns,
          nameHint
        })
      });

      if (!response.ok) {
        throw new Error("Summary generation failed.");
      }

      const data = await response.json();
      const updatedDraft = loadDraft();
      if (updatedDraft) {
        updatedDraft.turns = finalTurns;
        updatedDraft.structuredSummary = data.summary;
        updatedDraft.editedSummary = data.summary;
        delete updatedDraft.feedback;
        await persistDraft(updatedDraft);
      }

      router.push("/review");
    } catch (requestError) {
      setError(
        requestError instanceof Error ? requestError.message : reflectionCopy.unableToGenerateSummary
      );
      setSubmitting(false);
    }
  }

  if (submitting) {
    return (
      <AppShell title={reflectionCopy.completionMessage} subtitle={reflectionCopy.buildingSummaryLabel}>
        <StatusBanner tone="success">{reflectionCopy.completionMessage}</StatusBanner>
      </AppShell>
    );
  }

  return (
    <AppShell title={reflectionCopy.title} subtitle={reflectionCopy.subtitle}>
      <div className="space-y-5">
        {prompts.map((prompt, index) => {
          const isActive = currentPrompt?.id === prompt.id;

          return (
            <div
              key={prompt.id}
              className={`space-y-4 rounded-3xl border px-5 py-5 transition ${
                isActive ? "border-accent bg-canvas ring-2 ring-accent/20" : "border-border bg-white"
              }`}
            >
              <div className="space-y-2">
                <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                  Question {index + 1}
                </div>
                <h2 className="text-lg font-semibold leading-8 text-ink">{prompt.content}</h2>
                {prompt.promptExamples?.length ? (
                  <ul className="space-y-1 text-sm leading-6 text-slate-500">
                    {prompt.promptExamples.map((example) => (
                      <li key={example}>({example})</li>
                    ))}
                  </ul>
                ) : null}
              </div>

              <textarea
                className="min-h-28 w-full rounded-2xl border border-border px-4 py-3 outline-none transition focus:border-accent disabled:bg-slate-50"
                disabled={transcribing || recording}
                placeholder={reflectionCopy.textareaPlaceholder}
                value={responses[prompt.id]?.content ?? ""}
                onChange={(event) => updateResponse(prompt.id, event.target.value)}
                onFocus={() => setActivePromptId(prompt.id)}
              />

              {isActive ? (
                <div className="rounded-2xl border border-border bg-canvas px-4 py-3">
                  <div className="space-y-3">
                    <div className="space-y-1">
                      <div className="text-sm font-semibold text-slate-700">
                        {reflectionCopy.recordResponseTitle}
                      </div>
                      <div className="text-sm leading-6 text-slate-600">
                        {getAudioPanelCopy({
                          recordingState: recording,
                          transcribingState: transcribing,
                          durationMs: recordingDurationMs
                        })}
                      </div>
                    </div>
                    <div className="rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900">
                      {reflectionCopy.audioLimitNotice}
                    </div>
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                      <label className="flex-1 text-sm text-slate-600">
                        <span className="mb-2 block font-medium text-slate-700">
                          {reflectionCopy.spokenLanguageLabel}
                        </span>
                        <select
                          className="w-full rounded-full border border-border bg-white px-4 py-2.5 text-sm font-medium text-slate-700 outline-none transition focus:border-accent disabled:bg-slate-50"
                          disabled={recording || transcribing}
                          value={audioLanguage}
                          onChange={(event) => setAudioLanguage(event.target.value as UiLanguage)}
                        >
                          {SPOKEN_LANGUAGE_OPTIONS.map((option) => (
                            <option key={option} value={option}>
                              {getLanguageLabel(option, uiLanguage)}
                            </option>
                          ))}
                        </select>
                      </label>
                      {recordingSupported ? (
                        <button
                          className={`w-full rounded-full px-4 py-2.5 text-sm font-semibold transition sm:w-auto sm:min-w-[12rem] ${
                            recording
                              ? "bg-red-600 text-white hover:bg-red-700"
                              : "border border-border bg-white text-slate-700 hover:bg-slate-50"
                          } disabled:cursor-not-allowed disabled:opacity-60`}
                          disabled={transcribing}
                          type="button"
                          onClick={recording ? () => void stopRecording() : () => void startRecording()}
                        >
                          {recording ? reflectionCopy.stopRecordingButton : reflectionCopy.recordButton}
                        </button>
                      ) : (
                        <div className="text-xs text-slate-500">{reflectionCopy.audioNotSupported}</div>
                      )}
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}

        {error ? <StatusBanner tone="error">{error}</StatusBanner> : null}
        {!error && statusMessage ? <StatusBanner tone={statusTone}>{statusMessage}</StatusBanner> : null}

        <button
          className="w-full rounded-2xl bg-accent px-4 py-3 text-sm font-semibold text-white transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={!hasAnyResponse || recording || transcribing || !sessionId}
          type="button"
          onClick={finalizeFlow}
        >
          {reflectionCopy.completeButton}
        </button>
      </div>
    </AppShell>
  );
}
