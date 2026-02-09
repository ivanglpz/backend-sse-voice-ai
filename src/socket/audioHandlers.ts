import { type Server, type Socket } from "socket.io";
import { rmsDb } from "../audio/pcm";
import {
  DEFAULT_CHANNELS,
  DEFAULT_ENCODING,
  DEFAULT_SAMPLE_RATE,
  INITIAL_NOISE_DB,
  LEVEL_SMOOTHING_ALPHA,
  MIN_SEGMENT_MS,
  MIN_SPEECH_DB,
  NOISE_UPDATE_ALPHA,
  NOISE_UPDATE_GATE_DB,
  SILENCE_MS_TO_FINALIZE,
  SPEECH_MARGIN_DB,
  START_SPEECH_MIN_MS,
} from "../config/constants";
import { createSessionState } from "./session";
import { transcribePcm16 } from "../transcription/transcribe";
import type {
  AudioStartPayload,
  ClientToServerEvents,
  InterServerEvents,
  ServerToClientEvents,
  SocketData,
} from "../types/audio";

function pcm16BufferToFloat32(chunk: Buffer): Float32Array {
  const sampleCount = Math.floor(chunk.length / 2);
  const out = new Float32Array(sampleCount);
  for (let i = 0; i < sampleCount; i += 1) {
    const sample = chunk.readInt16LE(i * 2);
    out[i] = sample / 32768;
  }
  return out;
}

function shouldTreatAsSpeech(db: number, noiseDb: number): boolean {
  return db > Math.max(noiseDb + SPEECH_MARGIN_DB, MIN_SPEECH_DB);
}

function updateNoiseFloor(currentNoiseDb: number, db: number): number {
  if (db > currentNoiseDb + NOISE_UPDATE_GATE_DB) {
    return currentNoiseDb;
  }
  return (1 - NOISE_UPDATE_ALPHA) * currentNoiseDb + NOISE_UPDATE_ALPHA * db;
}

export function registerAudioHandlers(
  io: Server<
    ClientToServerEvents,
    ServerToClientEvents,
    InterServerEvents,
    SocketData
  >,
): void {
  io.on(
    "connection",
    (socket: Socket<ClientToServerEvents, ServerToClientEvents>) => {
      const state = createSessionState();

      socket.on("audio:start", (meta: AudioStartPayload) => {
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
        state.candidateBuffers = [];
        state.segmentBuffers = [];

        socket.emit("audio:ack", { ok: true });
      });

      socket.on("audio:chunk", async (chunk: Buffer) => {
        if (!state.active) return;
        if (!Buffer.isBuffer(chunk)) return;
        if (chunk.length < 2) return;

        const f32 = pcm16BufferToFloat32(chunk);
        const db = rmsDb(f32);
        const frameMs = (f32.length / state.sampleRate) * 1000;
        state.smoothDb =
          (1 - LEVEL_SMOOTHING_ALPHA) * state.smoothDb +
          LEVEL_SMOOTHING_ALPHA * db;

        const isSpeechFrame = shouldTreatAsSpeech(state.smoothDb, state.noiseDb);

        if (!state.speaking) {
          state.noiseDb = updateNoiseFloor(state.noiseDb, state.smoothDb);

          if (!isSpeechFrame) {
            state.speechCandidateMs = 0;
            state.candidateBuffers = [];
            return;
          }

          state.speechCandidateMs += frameMs;
          state.candidateBuffers.push(chunk);

          if (state.speechCandidateMs < START_SPEECH_MIN_MS) {
            return;
          }

          console.log(
            `[VAD] speaking:start chatId=${state.chatId ?? "unknown"} db=${state.smoothDb.toFixed(
              1,
            )} threshold=${Math.max(state.noiseDb + SPEECH_MARGIN_DB, MIN_SPEECH_DB).toFixed(1)}`,
          );
          state.speaking = true;
          state.silenceMs = 0;
          state.speechMs = state.speechCandidateMs;
          state.segmentBuffers = state.candidateBuffers.slice();
          state.speechCandidateMs = 0;
          state.candidateBuffers = [];
          return;
        }

        state.segmentBuffers.push(chunk);
        if (isSpeechFrame) {
          state.silenceMs = 0;
          state.speechMs += frameMs;
        } else {
          state.silenceMs += frameMs;
        }

        if (state.silenceMs >= SILENCE_MS_TO_FINALIZE) {
          console.log(
            `[VAD] speaking:stop chatId=${state.chatId ?? "unknown"} silenceMs=${Math.round(
              state.silenceMs,
            )}`,
          );
          if (state.speechMs < MIN_SEGMENT_MS) {
            console.log(
              `[VAD] segment:dropped chatId=${state.chatId ?? "unknown"} speechMs=${Math.round(
                state.speechMs,
              )}`,
            );
            state.speaking = false;
            state.silenceMs = 0;
            state.speechMs = 0;
            state.segmentBuffers = [];
            return;
          }
          const text = await transcribePcm16(
            state.segmentBuffers,
            state.sampleRate,
          );
          socket.emit("transcript:final", {
            chatId: state.chatId ?? "unknown",
            text,
          });

          state.speaking = false;
          state.silenceMs = 0;
          state.speechMs = 0;
          state.segmentBuffers = [];
        }
      });

      socket.on("audio:stop", async () => {
        if (!state.active) return;

        if (state.segmentBuffers.length > 0 && state.speechMs >= MIN_SEGMENT_MS) {
          const text = await transcribePcm16(
            state.segmentBuffers,
            state.sampleRate,
          );
          socket.emit("transcript:final", {
            chatId: state.chatId ?? "unknown",
            text,
          });
        }

        state.active = false;
        state.speaking = false;
        state.silenceMs = 0;
        state.noiseDb = INITIAL_NOISE_DB;
        state.smoothDb = INITIAL_NOISE_DB;
        state.speechCandidateMs = 0;
        state.speechMs = 0;
        state.candidateBuffers = [];
        state.segmentBuffers = [];
      });
    },
  );
}
