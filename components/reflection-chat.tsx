"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/shell";
import { StatusBanner } from "@/components/status-banner";
import {
  AudioRecorderController,
  isAudioRecordingSupported,
  prepareRecordingEndChime,
  RecordingEndChimeController,
  startWavRecording
} from "@/lib/audio";
import { getCurrentAuthUser, loadRemoteDraft, saveRemoteDraft } from "@/lib/draft-api";
import { getLanguageLabel, getReflectionCopy } from "@/lib/localization";
import {
  ReflectionResponse,
  buildTurnsFromResponses,
  getFirstIncompletePromptIndex,
  getPromptSequence,
  getResponsesFromTurns,
  getStepOrder
} from "@/lib/reflection";
import { processStoppedRecording } from "@/lib/recording";
import { loadDraft, saveDraft } from "@/lib/storage";
import { ReflectionStepId, SessionDraft, UiLanguage } from "@/lib/types";

const MAX_RECORDING_MS = 60 * 1000;
const MAX_TRANSCRIPTION_UPLOAD_BYTES = 4 * 1024 * 1024;
const SPANISH_TRANSLATION_DEBOUNCE_MS = 1000;
const SPOKEN_LANGUAGE_OPTIONS: UiLanguage[] = ["english", "spanish", "mandarin"];
const EXAMPLE_LABELS: Record<UiLanguage, string> = {
  english: "Examples",
  spanish: "Ejemplos",
  mandarin: "示例"
};
const EXAMPLE_SENTENCE_ENDINGS: Record<UiLanguage, string> = {
  english: ".",
  spanish: ".",
  mandarin: "。"
};

type TranslationStatus = {
  state: "pending" | "error";
  message?: string;
};

type TranslationApiResponse = {
  error?: string;
  transcript?: string;
  content?: string;
  sourceContent?: string;
  sourceLanguage?: UiLanguage;
  translatedAt?: string | null;
};

function formatDuration(durationMs: number) {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function sanitizeResponses(responses: Record<string, ReflectionResponse>) {
  const sanitizedEntries: Array<[string, ReflectionResponse]> = [];

  for (const [promptId, response] of Object.entries(responses)) {
    const content = response.content.trim();
    const sourceContent = response.sourceContent?.trim() ?? "";
    if (!content && !sourceContent) {
      continue;
    }

    sanitizedEntries.push([
      promptId,
      {
        ...response,
        content,
        sourceContent: sourceContent || undefined
      }
    ]);
  }

  return Object.fromEntries(sanitizedEntries) as Record<string, ReflectionResponse>;
}

function getFirstPromptIdForStep(stepId: ReflectionStepId, language: UiLanguage) {
  return getPromptSequence(language).find((prompt) => prompt.stepId === stepId)?.id ?? "";
}

function formatPromptExamples(examples: string[], language: UiLanguage) {
  const normalized = examples.map((example) => example.trim().replace(/[.。]+$/u, "")).filter(Boolean);
  if (normalized.length === 0) {
    return "";
  }

  return `${EXAMPLE_LABELS[language]}: ${normalized.join(", ")}${EXAMPLE_SENTENCE_ENDINGS[language]}`;
}

export function ReflectionChat() {
  const router = useRouter();
  const [sessionId, setSessionId] = useState("");
  const [careRecipientName, setCareRecipientName] = useState("");
  const [responses, setResponses] = useState<Record<string, ReflectionResponse>>({});
  const [activePromptId, setActivePromptId] = useState("");
  const [currentStepId, setCurrentStepId] = useState<ReflectionStepId>("communication");
  const [submitting, setSubmitting] = useState(false);
  const [pendingStepAdvance, setPendingStepAdvance] = useState<{
    nextStepId: ReflectionStepId;
    message: string;
  } | null>(null);
  const [error, setError] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [statusTone, setStatusTone] = useState<"info" | "success">("info");
  const [recordingSupported, setRecordingSupported] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordingDurationMs, setRecordingDurationMs] = useState(0);
  const [transcribing, setTranscribing] = useState(false);
  const [translationStatuses, setTranslationStatuses] = useState<Record<string, TranslationStatus>>({});
  const [uiLanguage, setUiLanguage] = useState<UiLanguage>("english");
  const [audioLanguage, setAudioLanguage] = useState<UiLanguage>("english");
  const recorderRef = useRef<AudioRecorderController | null>(null);
  const recordingEndChimeRef = useRef<RecordingEndChimeController | null>(null);
  const recordingTimerRef = useRef<number | null>(null);
  const recordingTimeoutRef = useRef<number | null>(null);
  const recordingStartedAtRef = useRef<number | null>(null);
  const translationTimersRef = useRef<Record<string, number>>({});
  const translationAbortControllersRef = useRef<Record<string, AbortController>>({});
  const translationRequestIdsRef = useRef<Record<string, number>>({});
  const shouldScrollToTopRef = useRef(false);

  const reflectionCopy = useMemo(() => getReflectionCopy(uiLanguage), [uiLanguage]);
  const prompts = useMemo(() => getPromptSequence(uiLanguage), [uiLanguage]);
  const stepOrder = useMemo(() => getStepOrder(uiLanguage), [uiLanguage]);
  const stepPrompts = useMemo(
    () => prompts.filter((prompt) => prompt.stepId === currentStepId),
    [currentStepId, prompts]
  );
  const currentPrompt = useMemo(
    () => stepPrompts.find((prompt) => prompt.id === activePromptId) ?? stepPrompts[0] ?? null,
    [activePromptId, stepPrompts]
  );
  const currentStepIndex = useMemo(
    () => Math.max(0, stepOrder.findIndex((stepId) => stepId === currentStepId)),
    [currentStepId, stepOrder]
  );
  const currentStepMeta = stepPrompts[0] ?? null;
  const nextSectionIndex = useMemo(() => {
    if (!pendingStepAdvance) {
      return -1;
    }

    const nextStepIndex = stepOrder.findIndex((stepId) => stepId === pendingStepAdvance.nextStepId);
    if (nextStepIndex < 0) {
      return -1;
    }

    return nextStepIndex;
  }, [pendingStepAdvance, stepOrder]);
  const hasAnyResponse = useMemo(
    () => Object.values(sanitizeResponses(responses)).length > 0,
    [responses]
  );
  const currentStepTranslationBlocked = useMemo(
    () => Boolean(getTranslationBlockMessage(stepPrompts.map((prompt) => prompt.id))),
    [reflectionCopy, responses, stepPrompts, translationStatuses, uiLanguage]
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
        const resumePrompt =
          promptSequence[firstIncompleteIndex >= 0 ? firstIncompleteIndex : promptSequence.length - 1];

        setSessionId(localDraft.sessionId);
        setCareRecipientName(
          localDraft.intakeDetails.careRecipientPreferredName.trim() ||
            localDraft.intakeDetails.careRecipientFirstName.trim()
        );
        setResponses(localResponses);
        setUiLanguage(preferredLanguage);
        setAudioLanguage(preferredLanguage);
        setCurrentStepId((resumePrompt?.stepId as ReflectionStepId | undefined) ?? "communication");
        setActivePromptId(resumePrompt?.id ?? getFirstPromptIdForStep("communication", preferredLanguage));
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
      const resumePrompt =
        promptSequence[firstIncompleteIndex >= 0 ? firstIncompleteIndex : promptSequence.length - 1];

      setSessionId(draft.sessionId);
      setCareRecipientName(
        draft.intakeDetails.careRecipientPreferredName.trim() ||
          draft.intakeDetails.careRecipientFirstName.trim()
      );
      setResponses(remoteResponses);
      setUiLanguage(preferredLanguage);
      setAudioLanguage(preferredLanguage);
      setCurrentStepId((resumePrompt?.stepId as ReflectionStepId | undefined) ?? "communication");
      setActivePromptId(resumePrompt?.id ?? getFirstPromptIdForStep("communication", preferredLanguage));
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
    if (!activePromptId && currentStepMeta) {
      setActivePromptId(currentStepMeta.id);
    }
  }, [activePromptId, currentStepMeta]);

  useEffect(() => {
    if (!currentStepMeta || !shouldScrollToTopRef.current) {
      return;
    }

    shouldScrollToTopRef.current = false;

    window.requestAnimationFrame(() => {
      window.scrollTo({ top: 0, left: 0, behavior: "auto" });
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
    });
  }, [currentStepMeta]);

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

      const chime = recordingEndChimeRef.current;
      recordingEndChimeRef.current = null;
      if (chime) {
        void chime.close();
      }

      for (const promptId of Object.keys(translationTimersRef.current)) {
        clearTranslationRequest(promptId);
      }

      for (const promptId of Object.keys(translationAbortControllersRef.current)) {
        clearTranslationRequest(promptId);
      }
    };
  }, []);

  useEffect(() => {
    if (uiLanguage !== "spanish") {
      return;
    }

    for (const prompt of prompts) {
      const response = responses[prompt.id];
      if (
        response?.sourceLanguage === "spanish" &&
        response.sourceContent?.trim() &&
        !response.content.trim() &&
        !translationTimersRef.current[prompt.id] &&
        !translationAbortControllersRef.current[prompt.id] &&
        translationStatuses[prompt.id]?.state !== "pending"
      ) {
        scheduleSpanishTranslation(prompt, response.sourceContent);
      }
    }
  }, [prompts, responses, translationStatuses, uiLanguage]);

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
        turns: buildTurnsFromResponses(responses, uiLanguage)
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

  useEffect(() => {
    if (!pendingStepAdvance) {
      return;
    }

    const previousBodyOverflow = document.body.style.overflow;
    const previousHtmlOverflow = document.documentElement.style.overflow;

    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousHtmlOverflow;
    };
  }, [pendingStepAdvance]);

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

  function clearTranslationRequest(promptId: string) {
    const timerId = translationTimersRef.current[promptId];
    if (timerId) {
      window.clearTimeout(timerId);
      delete translationTimersRef.current[promptId];
    }

    const controller = translationAbortControllersRef.current[promptId];
    if (controller) {
      controller.abort();
      delete translationAbortControllersRef.current[promptId];
    }
  }

  function clearTranslationStatus(promptId: string) {
    setTranslationStatuses((current) => {
      if (!current[promptId]) {
        return current;
      }

      const next = { ...current };
      delete next[promptId];
      return next;
    });
  }

  function setTranslationStatus(promptId: string, status: TranslationStatus) {
    setTranslationStatuses((current) => ({
      ...current,
      [promptId]: status
    }));
  }

  function getTranslationBlockMessage(
    promptIds: string[],
    candidateResponses: Record<string, ReflectionResponse> = responses
  ) {
    if (uiLanguage !== "spanish") {
      return "";
    }

    for (const promptId of promptIds) {
      const response = candidateResponses[promptId];
      if (!response || response.skipped || response.sourceLanguage !== "spanish") {
        continue;
      }

      const sourceContent = response.sourceContent?.trim() ?? "";
      if (!sourceContent) {
        continue;
      }

      const status = translationStatuses[promptId]?.state;
      if (status === "pending") {
        return reflectionCopy.translationPendingMessage;
      }

      if (status === "error") {
        return reflectionCopy.translationFailedMessage;
      }

      if (!response.content.trim()) {
        return reflectionCopy.translationMissingMessage;
      }
    }

    return "";
  }

  async function requestSpanishTranslation(
    prompt: (typeof prompts)[number],
    sourceContent: string,
    requestId: number,
    controller: AbortController
  ) {
    try {
      const response = await fetch("/api/translate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        signal: controller.signal,
        body: JSON.stringify({
          text: sourceContent,
          sourceLanguage: "spanish",
          question: prompt.content,
          sectionTitle: prompt.sectionTitle ?? "",
          promptLabel: prompt.promptLabel ?? ""
        })
      });

      const data = (await response.json().catch(() => ({}))) as TranslationApiResponse;
      if (!response.ok) {
        throw new Error(data.error ?? reflectionCopy.translationFailedMessage);
      }

      const translatedContent = (data.content ?? data.transcript ?? "").trim();
      if (!translatedContent) {
        throw new Error(reflectionCopy.translationFailedMessage);
      }

      if (translationRequestIdsRef.current[prompt.id] !== requestId) {
        return;
      }

      setResponses((current) => {
        const existing = current[prompt.id];
        if (
          !existing ||
          existing.sourceLanguage !== "spanish" ||
          (existing.sourceContent?.trim() ?? "") !== sourceContent
        ) {
          return current;
        }

        return {
          ...current,
          [prompt.id]: {
            ...existing,
            content: translatedContent,
            sourceContent,
            sourceLanguage: "spanish",
            translatedAt: data.translatedAt ?? new Date().toISOString()
          }
        };
      });
      clearTranslationStatus(prompt.id);
    } catch (translationError) {
      if (controller.signal.aborted || translationRequestIdsRef.current[prompt.id] !== requestId) {
        return;
      }

      setTranslationStatus(prompt.id, {
        state: "error",
        message:
          translationError instanceof Error
            ? translationError.message
            : reflectionCopy.translationFailedMessage
      });
    } finally {
      if (translationAbortControllersRef.current[prompt.id] === controller) {
        delete translationAbortControllersRef.current[prompt.id];
      }
    }
  }

  function scheduleSpanishTranslation(prompt: (typeof prompts)[number], value: string) {
    clearTranslationRequest(prompt.id);

    const sourceContent = value.trim();
    if (!sourceContent) {
      clearTranslationStatus(prompt.id);
      return;
    }

    setTranslationStatus(prompt.id, { state: "pending" });
    const requestId = (translationRequestIdsRef.current[prompt.id] ?? 0) + 1;
    translationRequestIdsRef.current[prompt.id] = requestId;

    translationTimersRef.current[prompt.id] = window.setTimeout(() => {
      delete translationTimersRef.current[prompt.id];
      const controller = new AbortController();
      translationAbortControllersRef.current[prompt.id] = controller;
      void requestSpanishTranslation(prompt, sourceContent, requestId, controller);
    }, SPANISH_TRANSLATION_DEBOUNCE_MS);
  }

  function retrySpanishTranslation(prompt: (typeof prompts)[number]) {
    const sourceContent = responses[prompt.id]?.sourceContent?.trim() ?? "";
    if (!sourceContent) {
      return;
    }

    scheduleSpanishTranslation(prompt, sourceContent);
  }

  function updateSpanishSourceResponse(prompt: (typeof prompts)[number], value: string) {
    setActivePromptId(prompt.id);
    setError("");
    setStatusMessage("");

    setResponses((current) => {
      if (!value.trim()) {
        if (!current[prompt.id]) {
          return current;
        }

        const next = { ...current };
        delete next[prompt.id];
        return next;
      }

      return {
        ...current,
        [prompt.id]: {
          promptId: prompt.id,
          content: "",
          sourceContent: value,
          sourceLanguage: "spanish",
          skipped: false,
          createdAt: current[prompt.id]?.createdAt ?? new Date().toISOString()
        }
      };
    });

    scheduleSpanishTranslation(prompt, value);
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

  function completeCurrentStepResponses() {
    const nextResponses = { ...responses };

    for (const prompt of stepPrompts) {
      const existing = nextResponses[prompt.id];
      if (existing) {
        nextResponses[prompt.id] = {
          ...existing,
          content: existing.content.trim(),
          sourceContent: existing.sourceContent?.trim() || undefined
        };
        continue;
      }

      nextResponses[prompt.id] = {
        promptId: prompt.id,
        content: "",
        skipped: true,
        createdAt: new Date().toISOString()
      };
    }

    return nextResponses;
  }

  async function transcribeAudio(audioBlob: Blob, transcribingStatus?: string) {
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
      transcribingStatus ??
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
        content?: string;
        sourceContent?: string;
        sourceLanguage?: UiLanguage;
        translatedAt?: string | null;
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
        const normalizedError = (data.error ?? rawResponse).trim().toLowerCase();
        if (
          response.status === 413 ||
          normalizedError.includes("request entity too large") ||
          normalizedError.includes("body exceeded") ||
          normalizedError.includes("too large")
        ) {
          throw new Error(reflectionCopy.recordingTooLarge);
        }

        throw new Error(reflectionCopy.unableToTranscribe);
      }

      const transcriptText = (data.content ?? data.transcript)?.trim() ?? "";
      const sourceTranscriptText = data.sourceContent?.trim() ?? "";
      if (!transcriptText && !sourceTranscriptText) {
        setStatusMessage(reflectionCopy.noSpeechDetected);
        setStatusTone("info");
        return;
      }

      setResponses((current) => {
        const existing = current[currentPrompt.id];
        const currentValue = existing?.content.trim() ?? "";
        const nextValue =
          currentValue && transcriptText ? `${currentValue}\n${transcriptText}` : transcriptText || currentValue;
        const currentSourceValue = existing?.sourceContent?.trim() ?? "";
        const nextSourceValue =
          currentSourceValue && sourceTranscriptText
            ? `${currentSourceValue}\n${sourceTranscriptText}`
            : sourceTranscriptText || currentSourceValue;

        return {
          ...current,
          [currentPrompt.id]: {
            promptId: currentPrompt.id,
            content: nextValue,
            sourceContent: nextSourceValue || undefined,
            sourceLanguage: data.sourceLanguage ?? existing?.sourceLanguage,
            translatedAt: data.translatedAt ?? existing?.translatedAt,
            skipped: false,
            createdAt: existing?.createdAt ?? new Date().toISOString()
          }
        };
      });
      clearTranslationRequest(currentPrompt.id);
      clearTranslationStatus(currentPrompt.id);
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
    if (!currentPrompt || pendingStepAdvance || submitting || transcribing || recording) {
      return;
    }

    setError("");
    setStatusMessage(reflectionCopy.recordingStatus("0:00", formatDuration(MAX_RECORDING_MS)));
    setStatusTone("info");
    setRecordingDurationMs(0);

    try {
      const previousChime = recordingEndChimeRef.current;
      recordingEndChimeRef.current = prepareRecordingEndChime();
      if (previousChime) {
        void previousChime.close();
      }

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

    const chime = recordingEndChimeRef.current;
    recordingEndChimeRef.current = null;
    recorderRef.current = null;
    clearRecordingTimers();
    setRecording(false);
    recordingStartedAtRef.current = null;
    const cutoffStatus = autoStopped
      ? reflectionCopy.audioLimitReached(
          getLanguageLabel(audioLanguage, uiLanguage),
          audioLanguage === "english"
        )
      : undefined;

    try {
      const result = await processStoppedRecording({
        recorder,
        chime,
        autoStopped,
        onRecordingStopped(recordedAudio) {
          setRecordingDurationMs(recordedAudio.durationMs);
          setStatusMessage(
            recordedAudio.durationMs < 500
              ? reflectionCopy.recordingTooShort
              : autoStopped
                ? cutoffStatus ?? ""
                : getAudioPanelCopy({
                    recordingState: false,
                    transcribingState: true,
                    durationMs: recordedAudio.durationMs
                  })
          );
          setStatusTone("info");
        },
        transcribe: (audioBlob) => transcribeAudio(audioBlob, cutoffStatus)
      });

      if (result === "too_short") {
        return;
      }
    } catch (recordingError) {
      setError(
        recordingError instanceof Error
          ? recordingError.message
          : reflectionCopy.unableToFinishRecording
      );
    } finally {
      if (chime) {
        void chime.close().catch(() => {
          // Releasing the sound context is best-effort.
        });
      }
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

  async function finalizeFlow(finalResponses: Record<string, ReflectionResponse>) {
    const sanitizedResponses = sanitizeResponses(finalResponses);
    if (Object.keys(sanitizedResponses).length === 0) {
      setError(reflectionCopy.enterAtLeastOneResponse);
      return;
    }

    const translationBlockMessage = getTranslationBlockMessage(
      prompts.map((prompt) => prompt.id),
      sanitizedResponses
    );
    if (translationBlockMessage) {
      setError(translationBlockMessage);
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
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? reflectionCopy.unableToGenerateSummary);
      }

      const data = await response.json();
      const updatedDraft = loadDraft();
      if (updatedDraft) {
        updatedDraft.turns = finalTurns;
        updatedDraft.structuredSummary = data.summary;
        updatedDraft.editedSummary = data.summary;
        updatedDraft.structuredSummaryAudit = data.auditReport ?? undefined;
        updatedDraft.editedSummaryAudit = data.auditReport ?? undefined;
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

  async function handleContinue() {
    const translationBlockMessage = getTranslationBlockMessage(stepPrompts.map((prompt) => prompt.id));
    if (translationBlockMessage) {
      setError(translationBlockMessage);
      setStatusMessage("");
      return;
    }

    const nextResponses = completeCurrentStepResponses();
    setResponses(nextResponses);
    setError("");
    setStatusMessage("");

    const draft = loadDraft();
    if (draft) {
      draft.turns = buildTurnsFromResponses(nextResponses, uiLanguage);
      await persistDraft(draft);
    }

    const nextStepId = stepOrder[currentStepIndex + 1];
    if (!nextStepId) {
      await finalizeFlow(nextResponses);
      return;
    }

    setPendingStepAdvance({
      nextStepId,
      message: currentStepMeta?.stepCompletionMessage ?? reflectionCopy.completionMessage
    });
  }

  function handleBack() {
    if (pendingStepAdvance) {
      return;
    }

    const previousStepId = stepOrder[currentStepIndex - 1];
    if (!previousStepId) {
      return;
    }

    setError("");
    setStatusMessage("");
    shouldScrollToTopRef.current = true;
    setCurrentStepId(previousStepId);
    setActivePromptId(getFirstPromptIdForStep(previousStepId, uiLanguage));
  }

  function handleAdvanceToNextStep() {
    if (!pendingStepAdvance) {
      return;
    }

    setError("");
    setStatusMessage("");
    shouldScrollToTopRef.current = true;
    setCurrentStepId(pendingStepAdvance.nextStepId);
    setActivePromptId(getFirstPromptIdForStep(pendingStepAdvance.nextStepId, uiLanguage));
    setPendingStepAdvance(null);
  }

  if (submitting) {
    return (
      <AppShell
        title={reflectionCopy.buildingSummaryLabel}
        subtitle=""
      >
        <StatusBanner tone="success">{reflectionCopy.buildingSummaryLabel}</StatusBanner>
      </AppShell>
    );
  }

  return (
    <>
      <AppShell
        title={currentStepMeta?.stepTitle ?? currentStepMeta?.sectionTitle ?? reflectionCopy.title}
        subtitle={
          currentStepMeta
            ? (
                <>
                  <div className="italic">{currentStepMeta.stepSubtitle}</div>
                </>
              )
            : reflectionCopy.subtitle
        }
      >
        <div className="space-y-5">
          {careRecipientName ? (
            <div className="text-sm font-semibold text-accent">
              {reflectionCopy.caringFor(careRecipientName)}
            </div>
          ) : null}
          <div className="rounded-2xl border border-border bg-canvas px-4 py-3 text-sm text-slate-700">
            {reflectionCopy.sectionCounter(currentStepIndex + 1, stepOrder.length)}
          </div>

          {stepPrompts.map((prompt) => {
            const isActive = currentPrompt?.id === prompt.id;
            const response = responses[prompt.id];
            const translationStatus = translationStatuses[prompt.id];
            const showSpanishAnswerEditor = uiLanguage === "spanish";

            return (
              <div
                key={prompt.id}
                className={`space-y-4 rounded-3xl border px-5 py-5 transition ${
                  isActive ? "border-accent bg-canvas ring-2 ring-accent/20" : "border-border bg-white"
                }`}
              >
                <div className="space-y-2">
                  <h2 className="text-lg font-semibold leading-8 text-ink">{prompt.content}</h2>
                  {prompt.promptExamples?.length ? (
                    <p className="text-sm leading-6 text-slate-500">
                      {formatPromptExamples(prompt.promptExamples, uiLanguage)}
                    </p>
                  ) : null}
                </div>

                {showSpanishAnswerEditor ? (
                  <div className="space-y-3">
                    <label className="block space-y-2">
                      <span className="text-sm font-semibold text-slate-700">
                        {reflectionCopy.sourceTextareaLabel}
                      </span>
                      <textarea
                        className="min-h-28 w-full rounded-2xl border border-border px-4 py-3 outline-none transition focus:border-accent disabled:bg-slate-50"
                        disabled={transcribing || recording || Boolean(pendingStepAdvance)}
                        placeholder={reflectionCopy.textareaPlaceholder}
                        value={
                          response?.skipped || response?.sourceLanguage !== "spanish"
                            ? ""
                            : response?.sourceContent ?? ""
                        }
                        onChange={(event) => updateSpanishSourceResponse(prompt, event.target.value)}
                        onFocus={() => setActivePromptId(prompt.id)}
                      />
                    </label>

                    <label className="block space-y-2">
                      <span className="text-sm font-semibold text-slate-700">
                        {reflectionCopy.englishTranslationLabel}
                      </span>
                      <textarea
                        className="min-h-24 w-full resize-none rounded-2xl border border-border bg-slate-50 px-4 py-3 text-slate-700 outline-none"
                        placeholder={reflectionCopy.englishTranslationPlaceholder}
                        readOnly
                        value={response?.skipped ? "" : response?.content ?? ""}
                      />
                    </label>

                    {translationStatus ? (
                      <div
                        className={`rounded-2xl border px-4 py-3 text-sm ${
                          translationStatus.state === "error"
                            ? "border-red-200 bg-red-50 text-red-800"
                            : "border-amber-200 bg-amber-50 text-amber-900"
                        }`}
                      >
                        <div>
                          {translationStatus.state === "error"
                            ? translationStatus.message ?? reflectionCopy.translationFailedMessage
                            : reflectionCopy.translationPendingMessage}
                        </div>
                        {translationStatus.state === "error" ? (
                          <button
                            className="mt-3 rounded-full border border-red-200 bg-white px-3 py-1.5 text-xs font-semibold text-red-800 transition hover:bg-red-100"
                            type="button"
                            onClick={() => retrySpanishTranslation(prompt)}
                          >
                            {reflectionCopy.retryTranslationButton}
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <textarea
                    className="min-h-28 w-full rounded-2xl border border-border px-4 py-3 outline-none transition focus:border-accent disabled:bg-slate-50"
                    disabled={transcribing || recording || Boolean(pendingStepAdvance)}
                    placeholder={reflectionCopy.textareaPlaceholder}
                    value={response?.skipped ? "" : response?.content ?? ""}
                    onChange={(event) => updateResponse(prompt.id, event.target.value)}
                    onFocus={() => setActivePromptId(prompt.id)}
                  />
                )}

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
                      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
                        <label className="w-full text-sm text-slate-600 sm:w-auto sm:min-w-48 sm:flex-1">
                          <span className="mb-2 block font-medium text-slate-700">
                            {reflectionCopy.spokenLanguageLabel}
                          </span>
                          <select
                            className="w-full min-w-0 rounded-full border border-border bg-white px-4 py-2.5 pr-10 text-sm font-medium text-slate-700 outline-none transition focus:border-accent disabled:bg-slate-50"
                            disabled={recording || transcribing || Boolean(pendingStepAdvance)}
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
                            disabled={transcribing || Boolean(pendingStepAdvance)}
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

          <div className="flex gap-3">
            <button
              className="w-full rounded-2xl border border-border px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-canvas disabled:cursor-not-allowed disabled:opacity-60"
              disabled={
                currentStepIndex === 0 || recording || transcribing || Boolean(pendingStepAdvance)
              }
              type="button"
              onClick={handleBack}
            >
              {reflectionCopy.backButton}
            </button>
            <button
              className="w-full rounded-2xl bg-accent px-4 py-3 text-sm font-semibold text-white transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={
                recording ||
                transcribing ||
                currentStepTranslationBlocked ||
                !sessionId ||
                Boolean(pendingStepAdvance)
              }
              type="button"
              onClick={handleContinue}
            >
              {currentStepIndex === stepOrder.length - 1
                ? reflectionCopy.completeButton
                : reflectionCopy.continueButton}
            </button>
          </div>
        </div>
      </AppShell>

      {pendingStepAdvance ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/35 px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-24 sm:items-center sm:px-6 sm:pb-6 sm:pt-6">
          <div className="w-full max-w-md overflow-y-auto rounded-3xl border border-border bg-white p-6 shadow-2xl sm:max-h-[calc(100dvh-3rem)]">
            <div className="space-y-3">
              <div className="text-sm font-semibold uppercase tracking-[0.22em] text-accent">
                {currentStepMeta?.stepTitle ?? reflectionCopy.title}
              </div>
              <h2 className="text-2xl font-semibold leading-9 text-ink">
                {pendingStepAdvance.message}
              </h2>
              <p className="text-sm leading-6 text-slate-600">
                {pendingStepAdvance && nextSectionIndex >= 0
                  ? reflectionCopy.sectionCounter(nextSectionIndex + 1, stepOrder.length)
                  : ""}
              </p>
            </div>
            <div className="mt-6 flex justify-end">
              <button
                className="rounded-2xl bg-accent px-5 py-3 text-sm font-semibold text-white transition hover:bg-teal-700"
                type="button"
                onClick={handleAdvanceToNextStep}
              >
                {reflectionCopy.continueButton}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
