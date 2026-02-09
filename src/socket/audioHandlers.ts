import { type Server, type Socket } from "socket.io";
import { pcm16ToFloat32, rmsDb } from "../audio/pcm";
import {
  DEFAULT_CHANNELS,
  DEFAULT_ENCODING,
  DEFAULT_SAMPLE_RATE,
  INITIAL_NOISE_DB,
  SILENCE_MS_TO_FINALIZE,
  SPEECH_MARGIN_DB,
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
        state.segmentBuffers = [];

        socket.emit("audio:ack", { ok: true });
      });

      socket.on("audio:chunk", async (chunk: Buffer) => {
        if (!state.active) return;
        if (!Buffer.isBuffer(chunk)) return;

        const int16 = new Int16Array(
          chunk.buffer,
          chunk.byteOffset,
          chunk.byteLength / 2,
        );
        const f32 = pcm16ToFloat32(int16);
        const db = rmsDb(f32);

        if (!state.speaking) {
          state.noiseDb = 0.95 * state.noiseDb + 0.05 * db;
        }

        const thresholdDb = state.noiseDb + SPEECH_MARGIN_DB;
        const frameMs = (int16.length / state.sampleRate) * 1000;
        const isSpeech = db > thresholdDb;

        if (isSpeech) {
          if (!state.speaking) {
            console.log(
              `[VAD] speaking:start chatId=${state.chatId ?? "unknown"} db=${db.toFixed(
                1,
              )} threshold=${thresholdDb.toFixed(1)}`,
            );
          }
          state.speaking = true;
          state.silenceMs = 0;
          state.segmentBuffers.push(chunk);
          return;
        }

        if (!state.speaking) return;

        state.segmentBuffers.push(chunk);
        state.silenceMs += frameMs;

        if (state.silenceMs >= SILENCE_MS_TO_FINALIZE) {
          console.log(
            `[VAD] speaking:stop chatId=${state.chatId ?? "unknown"} silenceMs=${Math.round(
              state.silenceMs,
            )}`,
          );
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
          state.segmentBuffers = [];
        }
      });

      socket.on("audio:stop", async () => {
        if (!state.active) return;

        if (state.segmentBuffers.length > 0) {
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
        state.segmentBuffers = [];
      });
    },
  );
}
