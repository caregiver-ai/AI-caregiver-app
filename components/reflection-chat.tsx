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
  areAllPromptsCompleted,
  buildTurnsFromResponses,
  getFirstIncompletePromptIndex,
  getPromptSequence,
  getResponsesFromTurns
} from "@/lib/reflection";
import { loadDraft, saveDraft } from "@/lib/storage";
import { ConversationTurn, SessionDraft, UiLanguage } from "@/lib/types";

const MAX_RECORDING_MS = 2 * 60 * 1000;
const MAX_TRANSCRIPTION_UPLOAD_BYTES = 4 * 1024 * 1024;
const SPOKEN_LANGUAGE_OPTIONS: UiLanguage[] = ["english", "spanish", "mandarin"];

function formatDuration(durationMs: number) {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function createTurn(
  role: ConversationTurn["role"],
  content: string,
  promptType: ConversationTurn["promptType"],
  options: Partial<
    Pick<
      ConversationTurn,
      "sectionId" | "sectionTitle" | "promptLabel" | "promptExamples" | "skipped"
    >
  > = {}
): ConversationTurn {
  return {
    id: crypto.randomUUID(),
    role,
    content,
    promptType,
    ...options,
    createdAt: new Date().toISOString()
  };
}

export function ReflectionChat() {
  const router = useRouter();
  const [sessionId, setSessionId] = useState("");
  const [responses, setResponses] = useState<Record<string, ReflectionResponse>>({});
  const [activePromptId, setActivePromptId] = useState("");
  const [inputValue, setInputValue] = useState("");
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
          promptSequence[firstIncompleteIndex >= 0 ? firstIncompleteIndex : promptSequence.length - 1]?.id ?? ""
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
        promptSequence[firstIncompleteIndex >= 0 ? firstIncompleteIndex : promptSequence.length - 1]?.id ?? ""
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

  const reflectionCopy = useMemo(() => getReflectionCopy(uiLanguage), [uiLanguage]);
  const prompts = useMemo(() => getPromptSequence(uiLanguage), [uiLanguage]);
  const allPromptsCompleted = useMemo(
    () => areAllPromptsCompleted(responses, uiLanguage),
    [responses, uiLanguage]
  );
  const currentPrompt = useMemo(
    () => prompts.find((prompt) => prompt.id === activePromptId) ?? prompts[0] ?? null,
    [activePromptId, prompts]
  );
  const promptIndex = useMemo(
    () => prompts.findIndex((prompt) => prompt.id === currentPrompt?.id),
    [currentPrompt?.id, prompts]
  );
  const visiblePrompts = useMemo(() => {
    if (!currentPrompt || promptIndex < 0) {
      return [];
    }

    return prompts.slice(0, promptIndex + 1);
  }, [currentPrompt, promptIndex, prompts]);
  const hasPendingChanges = useMemo(() => {
    if (!currentPrompt) {
      return false;
    }

    const savedResponse = responses[currentPrompt.id];
    if (!savedResponse) {
      return inputValue.trim().length > 0;
    }

    if (savedResponse.skipped) {
      return inputValue.trim().length > 0;
    }

    return savedResponse.content !== inputValue.trim();
  }, [currentPrompt, inputValue, responses]);

  useEffect(() => {
    if (!currentPrompt) {
      setInputValue("");
      return;
    }

    const savedResponse = responses[currentPrompt.id];
    if (!savedResponse || savedResponse.skipped) {
      setInputValue("");
      return;
    }

    setInputValue(savedResponse.content);
  }, [currentPrompt, responses]);

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

  async function persistDraft(nextDraft: SessionDraft) {
    saveDraft(nextDraft);

    try {
      await saveRemoteDraft(nextDraft, "in_progress");
    } catch {
      // Keep local progress even if the server save fails temporarily.
    }
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

      setInputValue((current) =>
        current.trim() ? `${current.trim()}\n${transcriptText}` : transcriptText
      );
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

  async function persistResponses(nextResponses: Record<string, ReflectionResponse>) {
    const draft = loadDraft();
    if (draft) {
      draft.turns = buildTurnsFromResponses(nextResponses, uiLanguage);
      await persistDraft(draft);
    }
  }

  function selectNextPrompt(nextResponses: Record<string, ReflectionResponse>, promptId: string) {
    const nextIncompleteIndex = getFirstIncompletePromptIndex(nextResponses, uiLanguage);
    if (nextIncompleteIndex >= 0) {
      setActivePromptId(prompts[nextIncompleteIndex]?.id ?? promptId);
      return;
    }

    const currentIndex = prompts.findIndex((prompt) => prompt.id === promptId);
    const nextPrompt = currentIndex >= 0 ? prompts[currentIndex + 1] : null;
    setActivePromptId(nextPrompt?.id ?? promptId);
  }

  async function finalizeFlow() {
    if (!allPromptsCompleted) {
      return;
    }

    setSubmitting(true);

    try {
      const finalTurns = buildTurnsFromResponses(responses, uiLanguage);
      const response = await fetch("/api/summary", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          sessionId,
          turns: finalTurns
        })
      });

      if (!response.ok) {
        throw new Error("Summary generation failed.");
      }

      const data = await response.json();
      const updatedDraft = loadDraft();
      if (updatedDraft) {
        updatedDraft.structuredSummary = data.summary;
        updatedDraft.editedSummary = data.summary;
        await persistDraft(updatedDraft);
      }

      router.push("/review");
    } catch (requestError) {
      setError(
        requestError instanceof Error ? requestError.message : reflectionCopy.unableToGenerateSummary
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSubmit() {
    if (!inputValue.trim() || !sessionId || !currentPrompt || recording || transcribing) {
      return;
    }

    const nextResponses = {
      ...responses,
      [currentPrompt.id]: {
        promptId: currentPrompt.id,
        content: inputValue.trim(),
        skipped: false,
        createdAt: new Date().toISOString()
      }
    };

    setResponses(nextResponses);
    setError("");
    setStatusMessage("");
    await persistResponses(nextResponses);
    selectNextPrompt(nextResponses, currentPrompt.id);
  }

  async function handleSkip() {
    if (!sessionId || !currentPrompt || submitting || recording || transcribing) {
      return;
    }

    const nextResponses = {
      ...responses,
      [currentPrompt.id]: {
        promptId: currentPrompt.id,
        content: "",
        skipped: true,
        createdAt: new Date().toISOString()
      }
    };

    setResponses(nextResponses);
    setInputValue("");
    setError("");
    setStatusMessage("");
    await persistResponses(nextResponses);
    selectNextPrompt(nextResponses, currentPrompt.id);
  }

  async function handleComplete() {
    if (!allPromptsCompleted || hasPendingChanges || submitting || recording || transcribing) {
      return;
    }

    await finalizeFlow();
  }

  return (
    <AppShell title={reflectionCopy.title} subtitle={reflectionCopy.subtitle}>
      <div className="flex h-full min-h-[70vh] flex-col">
        <div className="mb-4 rounded-2xl border border-border bg-canvas px-4 py-3 text-sm text-slate-700">
          {reflectionCopy.promptCounter(Math.min(Math.max(promptIndex, 0) + 1, prompts.length), prompts.length)}
        </div>
        <div className="space-y-4 overflow-y-auto pb-4">
          {visiblePrompts.map((prompt, index) => {
            const savedResponse = responses[prompt.id];
            const showSectionHeader =
              prompt.sectionTitle &&
              (index === 0 || visiblePrompts[index - 1]?.sectionTitle !== prompt.sectionTitle);
            const isActive = currentPrompt?.id === prompt.id;

            return (
              <div key={prompt.id} className="space-y-2">
                {showSectionHeader ? (
                  <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                    {prompt.sectionTitle}
                  </div>
                ) : null}
                {isActive ? (
                  <div className="mr-auto w-full rounded-3xl bg-canvas px-4 py-3 text-left text-sm leading-6 text-slate-700 ring-2 ring-accent/30 sm:max-w-[88%]">
                    {prompt.promptLabel ? (
                      <div className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                        {prompt.promptLabel}
                      </div>
                    ) : null}
                    <div>{prompt.content}</div>
                    {prompt.promptExamples?.length ? (
                      <ul className="mt-3 space-y-1 text-xs leading-5 text-slate-500">
                        {prompt.promptExamples.map((example) => (
                          <li key={example}>- {example}</li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                ) : savedResponse ? (
                  <button
                    className={`ml-auto block w-full max-w-[88%] rounded-3xl px-4 py-3 text-left text-sm leading-6 transition ${
                      savedResponse.skipped
                        ? "border border-dashed border-border bg-white text-slate-500 hover:bg-slate-50"
                        : "bg-accent text-white hover:bg-teal-700"
                    }`}
                    type="button"
                    onClick={() => setActivePromptId(prompt.id)}
                  >
                    {prompt.promptLabel ? (
                      <div
                        className={`mb-2 text-xs font-semibold uppercase tracking-[0.16em] ${
                          savedResponse.skipped ? "text-slate-400" : "text-white/80"
                        }`}
                      >
                        {prompt.promptLabel}
                      </div>
                    ) : null}
                    <div>{savedResponse.skipped ? reflectionCopy.skippedLabel : savedResponse.content}</div>
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>

        {error ? (
          <div className="mb-3">
            <StatusBanner tone="error">{error}</StatusBanner>
          </div>
        ) : null}
        {!error && statusMessage ? (
          <div className="mb-3">
            <StatusBanner tone={statusTone}>{statusMessage}</StatusBanner>
          </div>
        ) : null}

        <div className="mt-auto space-y-3 border-t border-border pt-4">
          <textarea
            className="min-h-28 w-full rounded-2xl border border-border px-4 py-3 outline-none transition focus:border-accent disabled:bg-slate-50"
            disabled={!currentPrompt || submitting || transcribing}
            placeholder={
              currentPrompt ? reflectionCopy.textareaPlaceholder : reflectionCopy.allQuestionsAnswered
            }
            value={inputValue}
            onChange={(event) => setInputValue(event.target.value)}
          />
          {currentPrompt ? (
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
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                  <label className="flex-1 text-sm text-slate-600">
                    <span className="mb-2 block font-medium text-slate-700">
                      {reflectionCopy.spokenLanguageLabel}
                    </span>
                    <select
                      className="w-full rounded-full border border-border bg-white px-4 py-2.5 text-sm font-medium text-slate-700 outline-none transition focus:border-accent disabled:bg-slate-50"
                      disabled={recording || transcribing || submitting}
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
                      disabled={submitting || transcribing}
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
          <div className="flex gap-3">
            <button
              className="w-full rounded-2xl border border-border px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-canvas disabled:cursor-not-allowed disabled:opacity-60"
              disabled={!currentPrompt || submitting || recording || transcribing}
              type="button"
              onClick={handleSkip}
            >
              {reflectionCopy.skipButton}
            </button>
            <button
              className="w-full rounded-2xl bg-accent px-4 py-3 text-sm font-semibold text-white transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={!currentPrompt || !inputValue.trim() || submitting || recording || transcribing}
              type="button"
              onClick={handleSubmit}
            >
              {reflectionCopy.saveResponseButton}
            </button>
          </div>
          <button
            className="w-full rounded-2xl bg-accent px-4 py-3 text-sm font-semibold text-white transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={!allPromptsCompleted || hasPendingChanges || submitting || recording || transcribing}
            type="button"
            onClick={handleComplete}
          >
            {submitting ? reflectionCopy.buildingSummaryLabel : reflectionCopy.completeButton}
          </button>
        </div>
      </div>
    </AppShell>
  );
}
