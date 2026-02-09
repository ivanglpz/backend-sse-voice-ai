export type AudioEncoding = "pcm_s16le";

export interface AudioStartPayload {
  chatId: string;
  sampleRate: number;
  channels: number;
  encoding: AudioEncoding;
}

export interface AudioAckPayload {
  ok: boolean;
}

export interface TranscriptFinalPayload {
  chatId: string;
  text: string;
}

export interface ServerToClientEvents {
  "audio:ack": (payload: AudioAckPayload) => void;
  "transcript:final": (payload: TranscriptFinalPayload) => void;
}

export interface ClientToServerEvents {
  "audio:start": (payload: AudioStartPayload) => void;
  "audio:chunk": (chunk: Buffer) => void;
  "audio:stop": () => void;
}

export interface InterServerEvents {}

export interface SocketData {}

export interface SessionState {
  active: boolean;
  sampleRate: number;
  channels: number;
  encoding: AudioEncoding;
  chatId: string | null;
  speaking: boolean;
  silenceMs: number;
  noiseDb: number;
  smoothDb: number;
  speechCandidateMs: number;
  speechMs: number;
  candidateBuffers: Buffer[];
  segmentBuffers: Buffer[];
}
