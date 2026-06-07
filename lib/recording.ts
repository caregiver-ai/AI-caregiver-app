import type {
  AudioRecorderController,
  RecordedAudio,
  RecordingEndChimeController,
} from "@/lib/audio";

export type RecordingStopResult = "too_short" | "transcribed";

export async function processStoppedRecording({
  recorder,
  chime,
  autoStopped,
  minimumDurationMs = 500,
  onRecordingStopped,
  transcribe,
}: {
  recorder: AudioRecorderController;
  chime: RecordingEndChimeController | null;
  autoStopped: boolean;
  minimumDurationMs?: number;
  onRecordingStopped: (recordedAudio: RecordedAudio) => void;
  transcribe: (audioBlob: Blob) => Promise<void>;
}): Promise<RecordingStopResult> {
  const recordedAudio = await recorder.stop();
  onRecordingStopped(recordedAudio);

  if (recordedAudio.durationMs < minimumDurationMs) {
    return "too_short";
  }

  if (autoStopped) {
    try {
      await chime?.play();
    } catch {
      // Sound is best-effort; transcription must continue.
    }
  }

  await transcribe(recordedAudio.blob);
  return "transcribed";
}
