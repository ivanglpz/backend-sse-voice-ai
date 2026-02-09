import {
  DEFAULT_CHANNELS,
  DEFAULT_ENCODING,
  DEFAULT_SAMPLE_RATE,
  INITIAL_NOISE_DB,
} from "../config/constants";
import type { SessionState } from "../types/audio";

export function createSessionState(): SessionState {
  return {
    active: false,
    sampleRate: DEFAULT_SAMPLE_RATE,
    channels: DEFAULT_CHANNELS,
    encoding: DEFAULT_ENCODING,
    chatId: null,
    speaking: false,
    silenceMs: 0,
    noiseDb: INITIAL_NOISE_DB,
    smoothDb: INITIAL_NOISE_DB,
    speechCandidateMs: 0,
    speechMs: 0,
    lastNonSpeechLogAt: 0,
    candidateBuffers: [],
    segmentBuffers: [],
  };
}
