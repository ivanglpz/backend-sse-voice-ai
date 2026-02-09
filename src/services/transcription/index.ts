import {
  OpenAIWhisperTranscriptionService,
  type TranscriptionService,
} from "./openaiWhisperService";

let cachedTranscriptionService: TranscriptionService | null = null;

export function getTranscriptionService(): TranscriptionService {
  if (cachedTranscriptionService) return cachedTranscriptionService;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "OPENAI_API_KEY is required to use OpenAI Whisper transcription.",
    );
  }

  cachedTranscriptionService = new OpenAIWhisperTranscriptionService(apiKey);
  return cachedTranscriptionService;
}
