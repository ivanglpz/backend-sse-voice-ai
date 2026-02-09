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

export interface AssistantResponsePayload {
  chatId: string;
  text: string;
}

export interface AssistantAudioPayload {
  chatId: string;
  format: "mp3";
  mimeType: "audio/mpeg";
  audioBase64: string;
}

export interface AssistantErrorPayload {
  chatId: string;
  message: string;
}

export interface ServerToClientEvents {
  "audio:ack": (payload: AudioAckPayload) => void;
  "transcript:final": (payload: TranscriptFinalPayload) => void;
  "assistant:response": (payload: AssistantResponsePayload) => void;
  "assistant:audio": (payload: AssistantAudioPayload) => void;
  "assistant:error": (payload: AssistantErrorPayload) => void;
}

export interface ClientToServerEvents {
  "audio:start": (payload: AudioStartPayload) => void;
  "audio:chunk": (chunk: Buffer) => void;
  "audio:stop": () => void;
}

export interface InterServerEvents {}

export interface SocketData {}

export interface ConversationTurn {
  role: "user" | "assistant";
  content: string;
}

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
  lastNonSpeechLogAt: number;
  isProcessingTranscription: boolean;
  lastTranscriptText: string;
  lastTranscriptAt: number;
  isProcessingAssistant: boolean;
  pendingAssistantTurns: string[];
  conversationHistory: ConversationTurn[];
  candidateBuffers: Buffer[];
  segmentBuffers: Buffer[];
}
