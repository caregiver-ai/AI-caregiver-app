"use client";

export interface RecordedAudio {
  blob: Blob;
  durationMs: number;
}

export interface AudioRecorderController {
  stop: () => Promise<RecordedAudio>;
  cancel: () => Promise<void>;
}

const TARGET_SAMPLE_RATE = 16000;

type BrowserWindow = Window &
  typeof globalThis & {
    webkitAudioContext?: typeof AudioContext;
  };

function getAudioContextConstructor() {
  const browserWindow = window as BrowserWindow;
  return browserWindow.AudioContext ?? browserWindow.webkitAudioContext;
}

function mergeChunks(chunks: Float32Array[]) {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const merged = new Float32Array(totalLength);
  let offset = 0;

  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }

  return merged;
}

function downsample(samples: Float32Array, inputSampleRate: number, outputSampleRate: number) {
  if (outputSampleRate >= inputSampleRate) {
    return samples;
  }

  const sampleRateRatio = inputSampleRate / outputSampleRate;
  const outputLength = Math.round(samples.length / sampleRateRatio);
  const downsampled = new Float32Array(outputLength);
  let outputIndex = 0;
  let inputIndex = 0;

  while (outputIndex < outputLength) {
    const nextInputIndex = Math.round((outputIndex + 1) * sampleRateRatio);
    let total = 0;
    let count = 0;

    for (let sampleIndex = inputIndex; sampleIndex < nextInputIndex && sampleIndex < samples.length; sampleIndex += 1) {
      total += samples[sampleIndex];
      count += 1;
    }

    downsampled[outputIndex] = count > 0 ? total / count : 0;
    outputIndex += 1;
    inputIndex = nextInputIndex;
  }

  return downsampled;
}

function encodeWav(samples: Float32Array, sampleRate: number) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  function writeString(offset: number, value: string) {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  }

  writeString(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, samples.length * 2, true);

  let offset = 44;
  for (const sample of samples) {
    const normalized = Math.max(-1, Math.min(1, sample));
    const pcm = normalized < 0 ? normalized * 0x8000 : normalized * 0x7fff;
    view.setInt16(offset, pcm, true);
    offset += 2;
  }

  return new Blob([buffer], { type: "audio/wav" });
}

export function isAudioRecordingSupported() {
  if (typeof window === "undefined") {
    return false;
  }

  return Boolean(navigator.mediaDevices && getAudioContextConstructor());
}

export async function startWavRecording(): Promise<AudioRecorderController> {
  if (!isAudioRecordingSupported()) {
    throw new Error("Audio recording is not supported in this browser.");
  }

  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const AudioContextConstructor = getAudioContextConstructor();

  if (!AudioContextConstructor) {
    throw new Error("Audio recording is not supported in this browser.");
  }

  const audioContext = new AudioContextConstructor();
  const source = audioContext.createMediaStreamSource(stream);
  const processor = audioContext.createScriptProcessor(4096, 1, 1);
  const silence = audioContext.createGain();
  const chunks: Float32Array[] = [];
  const startedAt = performance.now();
  let closed = false;

  silence.gain.value = 0;
  processor.onaudioprocess = (event) => {
    const channelData = event.inputBuffer.getChannelData(0);
    chunks.push(new Float32Array(channelData));
  };

  source.connect(processor);
  processor.connect(silence);
  silence.connect(audioContext.destination);

  async function cleanup() {
    if (closed) {
      return;
    }

    closed = true;
    processor.disconnect();
    source.disconnect();
    silence.disconnect();
    stream.getTracks().forEach((track) => track.stop());
    await audioContext.close();
  }

  return {
    async stop() {
      const merged = mergeChunks(chunks);
      const durationMs = Math.round((merged.length / audioContext.sampleRate) * 1000);
      const normalizedSamples = downsample(merged, audioContext.sampleRate, TARGET_SAMPLE_RATE);
      const blob = encodeWav(normalizedSamples, TARGET_SAMPLE_RATE);
      await cleanup();

      return {
        blob,
        durationMs: durationMs || Math.round(performance.now() - startedAt)
      };
    },
    async cancel() {
      await cleanup();
    }
  };
}
