import { type Server, type Socket } from "socket.io";
import { rmsDb } from "../audio/pcm";
import {
  LEVEL_SMOOTHING_ALPHA,
  MIN_SEGMENT_MS,
  NOISE_UPDATE_GATE_DB,
  SILENCE_MS_TO_FINALIZE,
  START_SPEECH_MIN_MS,
} from "../config/constants";
import { createSessionState } from "./session";
import { pcm16BufferToFloat32 } from "./audio/pcm16";
import {
  beginSegmentTranscription,
  applyAudioStart,
  finishSegmentTranscription,
  clearActiveSegment,
  stopSession,
} from "./audio/sessionLifecycle";
import { shouldEmitTranscript } from "./audio/transcript";
import {
  shouldLogNonSpeech,
  shouldTreatAsSpeech,
  speechThresholdDb,
  updateNoiseFloor,
} from "./audio/vad";
import { transcribePcm16 } from "../transcription/transcribe";
import { getVoiceAssistantService } from "../services/assistant";
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

      const emitTranscriptAndEnqueueAssistant = (text: string) => {
        const cleanedText = text.trim();
        if (!shouldEmitTranscript(state, cleanedText)) return;

        socket.emit("transcript:final", {
          chatId: state.chatId ?? "unknown",
          text: cleanedText,
        });
        state.pendingAssistantTurns.push(cleanedText);
        void processAssistantQueue();
      };

      const processAssistantQueue = async () => {
        if (state.isProcessingAssistant) return;
        const userText = state.pendingAssistantTurns.shift();
        if (!userText) return;

        state.isProcessingAssistant = true;

        try {
          const assistantService = getVoiceAssistantService();
          const assistantReply = await assistantService.generateReply({
            history: state.conversationHistory,
            userText,
          });

          state.conversationHistory.push({
            role: "user",
            content: userText,
          });
          state.conversationHistory.push({
            role: "assistant",
            content: assistantReply.text,
          });
          if (state.conversationHistory.length > 20) {
            state.conversationHistory = state.conversationHistory.slice(-20);
          }

          socket.emit("assistant:response", {
            chatId: state.chatId ?? "unknown",
            text: assistantReply.text,
          });
          socket.emit("assistant:audio", {
            chatId: state.chatId ?? "unknown",
            format: assistantReply.format,
            mimeType: assistantReply.mimeType,
            audioBase64: assistantReply.audioBase64,
          });
        } catch (error) {
          console.error("[ASSISTANT] Error generating AI voice response:", error);
          socket.emit("assistant:error", {
            chatId: state.chatId ?? "unknown",
            message:
              "No pude generar la respuesta por voz en este momento. Intenta de nuevo.",
          });
        } finally {
          state.isProcessingAssistant = false;
          if (state.pendingAssistantTurns.length > 0) {
            void processAssistantQueue();
          }
        }
      };

      socket.on("audio:start", (meta: AudioStartPayload) => {
        applyAudioStart(state, meta);
        socket.emit("audio:ack", { ok: true });
      });

      socket.on("audio:chunk", async (chunk: Buffer) => {
        if (!state.active) return;
        if (state.isProcessingTranscription) return;
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
            const soundDetectedDb = state.noiseDb + NOISE_UPDATE_GATE_DB;
            if (state.smoothDb > soundDetectedDb && shouldLogNonSpeech(state)) {
              console.log(
                `[VAD] Se detecta sonido de fondo, pero todavía no parece voz (db=${state.smoothDb.toFixed(
                  1,
                )}).`,
              );
            }
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
            )} threshold=${speechThresholdDb(state.noiseDb).toFixed(1)}`,
          );
          console.log("[VAD] La persona esta hablando ahora.");
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
          if (state.isProcessingTranscription) return;
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
            clearActiveSegment(state);
            return;
          }

          const { buffers: segmentToProcess, speechMs: segmentSpeechMs } =
            beginSegmentTranscription(state);

          try {
            const text = await transcribePcm16(segmentToProcess, state.sampleRate);
            emitTranscriptAndEnqueueAssistant(text);
          } catch (error) {
            console.error("[STT] Error transcribing audio segment:", error);
          } finally {
            finishSegmentTranscription(state);
          }
          console.log(
            `[VAD] Termine de procesar el segmento de voz (duracion hablada ~${Math.round(
              segmentSpeechMs,
            )}ms).`,
          );
        }
      });

      socket.on("audio:stop", async () => {
        if (!state.active) return;
        if (state.isProcessingTranscription) {
          state.active = false;
          return;
        }

        if (state.segmentBuffers.length > 0 && state.speechMs >= MIN_SEGMENT_MS) {
          const { buffers: trailingSegment, speechMs: trailingSpeechMs } =
            beginSegmentTranscription(state);

          try {
            const text = await transcribePcm16(trailingSegment, state.sampleRate);
            emitTranscriptAndEnqueueAssistant(text);
          } catch (error) {
            console.error("[STT] Error transcribing trailing audio:", error);
          } finally {
            finishSegmentTranscription(state);
          }
          console.log(
            `[VAD] Termine de procesar el audio restante al cerrar (duracion hablada ~${Math.round(
              trailingSpeechMs,
            )}ms).`,
          );
        }

        stopSession(state);
      });
    },
  );
}
