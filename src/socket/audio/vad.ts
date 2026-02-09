import {
  MIN_SPEECH_DB,
  NOISE_UPDATE_ALPHA,
  NOISE_UPDATE_GATE_DB,
  SPEECH_MARGIN_DB,
} from "../../config/constants";

export function shouldTreatAsSpeech(db: number, noiseDb: number): boolean {
  return db > Math.max(noiseDb + SPEECH_MARGIN_DB, MIN_SPEECH_DB);
}

export function updateNoiseFloor(currentNoiseDb: number, db: number): number {
  if (db > currentNoiseDb + NOISE_UPDATE_GATE_DB) {
    return currentNoiseDb;
  }

  return (1 - NOISE_UPDATE_ALPHA) * currentNoiseDb + NOISE_UPDATE_ALPHA * db;
}

export function shouldLogNonSpeech(state: { lastNonSpeechLogAt: number }): boolean {
  const now = Date.now();
  if (now - state.lastNonSpeechLogAt < 1500) return false;

  state.lastNonSpeechLogAt = now;
  return true;
}

export function speechThresholdDb(noiseDb: number): number {
  return Math.max(noiseDb + SPEECH_MARGIN_DB, MIN_SPEECH_DB);
}
