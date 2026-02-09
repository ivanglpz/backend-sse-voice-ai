import {
  OpenAIVoiceAssistantService,
  type VoiceAssistantService,
} from "./openaiVoiceAssistantService";

let cachedVoiceAssistantService: VoiceAssistantService | null = null;

export function getVoiceAssistantService(): VoiceAssistantService {
  if (cachedVoiceAssistantService) return cachedVoiceAssistantService;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "OPENAI_API_KEY is required to generate assistant responses with TTS.",
    );
  }

  cachedVoiceAssistantService = new OpenAIVoiceAssistantService(apiKey);
  return cachedVoiceAssistantService;
}
