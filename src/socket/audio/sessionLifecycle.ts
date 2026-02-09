import {
  DEFAULT_CHANNELS,
  DEFAULT_ENCODING,
  DEFAULT_SAMPLE_RATE,
  INITIAL_NOISE_DB,
} from "../../config/constants";
import type { AudioStartPayload, SessionState } from "../../types/audio";

export function applyAudioStart(state: SessionState, meta: AudioStartPayload): void {
  state.active = true;
  state.sampleRate = meta.sampleRate || DEFAULT_SAMPLE_RATE;
  state.channels = meta.channels || DEFAULT_CHANNELS;
  state.encoding = meta.encoding || DEFAULT_ENCODING;
  state.chatId = meta.chatId ?? null;

  state.speaking = false;
  state.silenceMs = 0;
  state.noiseDb = INITIAL_NOISE_DB;
  state.smoothDb = INITIAL_NOISE_DB;
  state.speechCandidateMs = 0;
  state.speechMs = 0;
  state.lastNonSpeechLogAt = 0;
  state.isProcessingTranscription = false;
  state.lastTranscriptText = "";
  state.lastTranscriptAt = 0;
  state.isProcessingAssistant = false;
  state.pendingAssistantTurns = [];
  state.conversationHistory = [];
  state.candidateBuffers = [];
  state.segmentBuffers = [];
}

export function clearActiveSegment(state: SessionState): void {
  state.speaking = false;
  state.silenceMs = 0;
  state.speechMs = 0;
  state.segmentBuffers = [];
}

export function beginSegmentTranscription(state: SessionState): {
  buffers: Buffer[];
  speechMs: number;
} {
  const buffers = state.segmentBuffers.slice();
  const speechMs = state.speechMs;

  state.isProcessingTranscription = true;
  clearActiveSegment(state);

  return { buffers, speechMs };
}

export function finishSegmentTranscription(state: SessionState): void {
  state.isProcessingTranscription = false;
}

export function stopSession(state: SessionState): void {
  state.active = false;
  state.speaking = false;
  state.silenceMs = 0;
  state.noiseDb = INITIAL_NOISE_DB;
  state.smoothDb = INITIAL_NOISE_DB;
  state.speechCandidateMs = 0;
  state.speechMs = 0;
  state.lastNonSpeechLogAt = 0;
  state.isProcessingTranscription = false;
  state.isProcessingAssistant = false;
  state.pendingAssistantTurns = [];
  state.conversationHistory = [];
  state.candidateBuffers = [];
  state.segmentBuffers = [];
}
