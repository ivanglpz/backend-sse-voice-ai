import express, { type Express } from "express";
import { createServer, type Server as HttpServer } from "node:http";
import { Server, type Socket } from "socket.io";

type AudioEncoding = "pcm_s16le";

interface AudioStartPayload {
  chatId: string;
  sampleRate: number;
  channels: number;
  encoding: AudioEncoding;
}

interface AudioAckPayload {
  ok: boolean;
}

interface TranscriptFinalPayload {
  chatId: string;
  text: string;
}

interface ServerToClientEvents {
  "audio:ack": (payload: AudioAckPayload) => void;
  "transcript:final": (payload: TranscriptFinalPayload) => void;
}

interface ClientToServerEvents {
  "audio:start": (payload: AudioStartPayload) => void;
  "audio:chunk": (chunk: Buffer) => void; // binario
  "audio:stop": () => void;
}

interface InterServerEvents {}

interface SocketData {}

interface SessionState {
  active: boolean;
  sampleRate: number;
  channels: number;
  encoding: AudioEncoding;
  chatId: string | null;

  speaking: boolean;
  silenceMs: number;
  noiseDb: number;

  segmentBuffers: Buffer[];
}

const app: Express = express();
const httpServer: HttpServer = createServer(app);

const io = new Server<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>(httpServer, {
  cors: { origin: "*" },
  maxHttpBufferSize: 10_000_000,
});

function pcm16ToFloat32(int16: Int16Array): Float32Array {
  const out = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i += 1) {
    out[i] = int16[i] / 32768;
  }
  return out;
}

function rmsDb(samples: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) {
    sum += samples[i] * samples[i];
  }
  const rms = Math.sqrt(sum / samples.length + 1e-12);
  return 20 * Math.log10(rms + 1e-12);
}

// Reemplaza con tu STT real
async function transcribePcm16(
  buffers: Buffer[],
  sampleRate: number,
): Promise<string> {
  const totalBytes = buffers.reduce((acc, b) => acc + b.length, 0);
  const durationSec = totalBytes / 2 / sampleRate;
  return `[mock transcript ${durationSec.toFixed(2)}s]`;
}

io.on(
  "connection",
  (socket: Socket<ClientToServerEvents, ServerToClientEvents>) => {
    const state: SessionState = {
      active: false,
      sampleRate: 16000,
      channels: 1,
      encoding: "pcm_s16le",
      chatId: null,
      speaking: false,
      silenceMs: 0,
      noiseDb: -55,
      segmentBuffers: [],
    };

    socket.on("audio:start", (meta: AudioStartPayload) => {
      state.active = true;
      state.sampleRate = meta.sampleRate || 16000;
      state.channels = meta.channels || 1;
      state.encoding = meta.encoding || "pcm_s16le";
      state.chatId = meta.chatId ?? null;

      state.speaking = false;
      state.silenceMs = 0;
      state.noiseDb = -55;
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

      const thresholdDb = state.noiseDb + 10;
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

      if (state.silenceMs >= 800) {
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

httpServer.listen(3000, () => {
  console.log("Socket.IO server running on :3000");
});
