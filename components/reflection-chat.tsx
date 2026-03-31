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
import { getCurrentPrompt, getPromptIndex, getPromptSequence } from "@/lib/reflection";
import { loadDraft, saveDraft } from "@/lib/storage";
import { ConversationTurn } from "@/lib/types";

const MAX_RECORDING_MS = 2 * 60 * 1000;
const AUDIO_LANGUAGE_OPTIONS = [
  { value: "english", label: "English" },
  { value: "spanish", label: "Spanish" },
  { value: "mandarin", label: "Mandarin" }
] as const;

type AudioLanguage = (typeof AUDIO_LANGUAGE_OPTIONS)[number]["value"];

function getAudioLanguageLabel(audioLanguage: AudioLanguage) {
  return AUDIO_LANGUAGE_OPTIONS.find((option) => option.value === audioLanguage)?.label ?? "English";
}

function getAudioPanelCopy({
  audioLanguage,
  recording,
  transcribing,
  recordingDurationMs
}: {
  audioLanguage: AudioLanguage;
  recording: boolean;
  transcribing: boolean;
  recordingDurationMs: number;
}) {
  if (recording) {
    return `Recording ${formatDuration(recordingDurationMs)} of ${formatDuration(MAX_RECORDING_MS)}.`;
  }

  if (transcribing) {
    return audioLanguage === "english"
      ? "Speech will be added as editable text."
      : `${getAudioLanguageLabel(audioLanguage)} speech will be translated into editable English text.`;
  }

  if (audioLanguage === "english") {
    return "Speech is transcribed before saving.";
  }

  return `${getAudioLanguageLabel(audioLanguage)} speech is translated into English before saving.`;
}

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
  const [turns, setTurns] = useState<ConversationTurn[]>([]);
  const [sessionId, setSessionId] = useState("");
  const [inputValue, setInputValue] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [statusTone, setStatusTone] = useState<"info" | "success">("info");
  const [recordingSupported, setRecordingSupported] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordingDurationMs, setRecordingDurationMs] = useState(0);
  const [transcribing, setTranscribing] = useState(false);
  const [audioLanguage, setAudioLanguage] = useState<AudioLanguage>("english");
  const recorderRef = useRef<AudioRecorderController | null>(null);
  const recordingTimerRef = useRef<number | null>(null);
  const recordingTimeoutRef = useRef<number | null>(null);
  const recordingStartedAtRef = useRef<number | null>(null);

  useEffect(() => {
    const draft = loadDraft();
    if (!draft?.sessionId) {
      router.replace("/");
      return;
    }

    setSessionId(draft.sessionId);
    setTurns(draft.turns);
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

  const prompts = useMemo(() => getPromptSequence(), []);
  const promptIndex = useMemo(() => getPromptIndex(turns), [turns]);
  const currentPrompt = useMemo(() => getCurrentPrompt(turns), [turns]);
  const transcript = useMemo(() => {
    const visibleTurns = [...turns];
    if (currentPrompt) {
      visibleTurns.push(currentPrompt);
    }
    return visibleTurns;
  }, [currentPrompt, turns]);

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

  async function transcribeAudio(audioBlob: Blob) {
    if (!currentPrompt) {
      return;
    }

    setTranscribing(true);
    setError("");
    setStatusMessage(
      audioLanguage === "english"
        ? "Transcribing audio. If Gemini is temporarily overloaded, we’ll retry automatically."
        : "Transcribing and translating audio into English. If Gemini is temporarily overloaded, we’ll retry automatically."
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

      const data = (await response.json()) as {
        error?: string;
        transcript?: string;
      };

      if (!response.ok) {
        throw new Error(data.error ?? "Audio transcription failed.");
      }

      const transcript = data.transcript?.trim() ?? "";
      if (!transcript) {
        setStatusMessage("No speech was detected. You can try again or type your response.");
        setStatusTone("info");
        return;
      }

      setInputValue((current) => (current.trim() ? `${current.trim()}\n${transcript}` : transcript));
      setStatusMessage(
        audioLanguage === "english"
          ? "Transcript added to the response field. You can edit it before saving."
          : "English translation added to the response field. You can edit it before saving."
      );
      setStatusTone("success");
    } catch (requestError) {
      setError(
        requestError instanceof Error ? requestError.message : "Unable to transcribe the audio."
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
    setStatusMessage("Recording...");
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
          : "Unable to start audio recording."
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
        setStatusMessage("Recording was too short. Try again or type your response.");
        setStatusTone("info");
        return;
      }

      setStatusMessage(
        autoStopped
          ? audioLanguage === "english"
            ? "Recording limit reached. Transcribing now and retrying automatically if Gemini is busy..."
            : "Recording limit reached. Translating into English now and retrying automatically if Gemini is busy..."
          : audioLanguage === "english"
            ? "Transcribing audio. If Gemini is temporarily overloaded, we’ll retry automatically."
            : "Transcribing and translating audio into English. If Gemini is temporarily overloaded, we’ll retry automatically."
      );
      setStatusTone("info");
      await transcribeAudio(recordedAudio.blob);
    } catch (recordingError) {
      setError(
        recordingError instanceof Error ? recordingError.message : "Unable to finish recording."
      );
    }
  }

  async function finalizeFlow(nextTurns: ConversationTurn[]) {
    const draft = loadDraft();
    if (draft) {
      draft.turns = nextTurns;
      saveDraft(draft);
    }

    const nextPrompt = getCurrentPrompt(nextTurns);
    if (nextPrompt) {
      return;
    }

    setSubmitting(true);

    try {
      const response = await fetch("/api/summary", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          sessionId,
          turns: nextTurns
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
        saveDraft(updatedDraft);
      }

      router.push("/review");
    } catch (requestError) {
      setError(
        requestError instanceof Error ? requestError.message : "Unable to generate the summary."
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSubmit() {
    if (!inputValue.trim() || !sessionId || !currentPrompt || recording || transcribing) {
      return;
    }

    const nextTurn = createTurn("user", inputValue.trim(), currentPrompt.promptType, {
      sectionId: currentPrompt.sectionId,
      sectionTitle: currentPrompt.sectionTitle,
      promptLabel: currentPrompt.promptLabel
    });
    const nextTurns = [...turns, currentPrompt, nextTurn];

    setTurns(nextTurns);
    setInputValue("");
    setError("");
    setStatusMessage("");

    await finalizeFlow(nextTurns);
  }

  async function handleSkip() {
    if (!sessionId || !currentPrompt || submitting || recording || transcribing) {
      return;
    }

    const skippedTurn = createTurn("user", "", currentPrompt.promptType, {
      sectionId: currentPrompt.sectionId,
      sectionTitle: currentPrompt.sectionTitle,
      promptLabel: currentPrompt.promptLabel,
      skipped: true
    });
    const nextTurns = [...turns, currentPrompt, skippedTurn];

    setTurns(nextTurns);
    setInputValue("");
    setError("");
    setStatusMessage("");

    await finalizeFlow(nextTurns);
  }

  return (
    <AppShell
      title="Guided reflection"
      subtitle="Start by capturing what helps the day go well. Each prompt covers one subsection, and you can skip anything that does not matter."
    >
      <div className="flex h-full min-h-[70vh] flex-col">
        <div className="mb-4 rounded-2xl border border-border bg-canvas px-4 py-3 text-sm text-slate-700">
          Prompt {Math.min(promptIndex + 1, prompts.length)} of {prompts.length}
        </div>
        <div className="space-y-4 overflow-y-auto pb-4">
          {transcript.map((turn, index) => {
            const showSectionHeader =
              turn.role === "assistant" &&
              turn.sectionTitle &&
              (index === 0 || transcript[index - 1]?.sectionTitle !== turn.sectionTitle);

            return (
              <div key={turn.id} className="space-y-2">
                {showSectionHeader ? (
                  <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                    {turn.sectionTitle}
                  </div>
                ) : null}
                <div
                  className={`max-w-[88%] rounded-3xl px-4 py-3 text-sm leading-6 ${
                    turn.role === "assistant"
                      ? "mr-auto bg-canvas text-slate-700"
                      : turn.skipped
                        ? "ml-auto border border-dashed border-border bg-white text-slate-500"
                        : "ml-auto bg-accent text-white"
                  }`}
                >
                  {turn.promptLabel && turn.role === "assistant" ? (
                    <div className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                      {turn.promptLabel}
                    </div>
                  ) : null}
                  <div>{turn.skipped ? "Skipped" : turn.content}</div>
                  {turn.role === "assistant" && turn.promptExamples?.length ? (
                    <ul className="mt-3 space-y-1 text-xs leading-5 text-slate-500">
                      {turn.promptExamples.map((example) => (
                        <li key={example}>- {example}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>
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
              currentPrompt
                ? "Write the most important details another caregiver should know..."
                : "All questions answered."
            }
            value={inputValue}
            onChange={(event) => setInputValue(event.target.value)}
          />
          {currentPrompt ? (
            <div className="rounded-2xl border border-border bg-canvas px-4 py-3">
              <div className="space-y-3">
                <div className="space-y-1">
                  <div className="text-sm font-semibold text-slate-700">Record a response</div>
                  <div className="text-sm leading-6 text-slate-600">
                    {getAudioPanelCopy({
                      audioLanguage,
                      recording,
                      transcribing,
                      recordingDurationMs
                    })}
                  </div>
                </div>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                  <label className="flex-1 text-sm text-slate-600">
                    <span className="mb-2 block font-medium text-slate-700">Spoken language</span>
                    <select
                      className="w-full rounded-full border border-border bg-white px-4 py-2.5 text-sm font-medium text-slate-700 outline-none transition focus:border-accent disabled:bg-slate-50"
                      disabled={recording || transcribing || submitting}
                      value={audioLanguage}
                      onChange={(event) => setAudioLanguage(event.target.value as AudioLanguage)}
                    >
                      {AUDIO_LANGUAGE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
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
                      {recording ? "Stop recording" : "Record response"}
                    </button>
                  ) : (
                    <div className="text-xs text-slate-500">Audio recording is not supported here.</div>
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
              Skip
            </button>
            <button
              className="w-full rounded-2xl bg-accent px-4 py-3 text-sm font-semibold text-white transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={!currentPrompt || !inputValue.trim() || submitting || recording || transcribing}
              type="button"
              onClick={handleSubmit}
            >
              {submitting ? "Building summary..." : currentPrompt ? "Save response" : "Complete"}
            </button>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
