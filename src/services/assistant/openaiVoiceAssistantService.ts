import OpenAI from "openai";
import type { ConversationTurn } from "../../types/audio";

const DEFAULT_CHAT_MODEL = "gpt-4o-mini";
const DEFAULT_TTS_MODEL = "gpt-4o-mini-tts";
const DEFAULT_TTS_VOICE = "alloy";
const MAX_HISTORY_TURNS = 12;

export interface VoiceAssistantReply {
  text: string;
  audioBase64: string;
  format: "mp3";
  mimeType: "audio/mpeg";
}

export interface VoiceAssistantService {
  generateReply(params: {
    history: ConversationTurn[];
    userText: string;
  }): Promise<VoiceAssistantReply>;
}

export class OpenAIVoiceAssistantService implements VoiceAssistantService {
  private readonly openai: OpenAI;
  private readonly chatModel: string;
  private readonly ttsModel: string;
  private readonly ttsVoice: string;

  constructor(apiKey: string) {
    this.openai = new OpenAI({ apiKey });
    this.chatModel = process.env.OPENAI_CHAT_MODEL ?? DEFAULT_CHAT_MODEL;
    this.ttsModel = process.env.OPENAI_TTS_MODEL ?? DEFAULT_TTS_MODEL;
    this.ttsVoice = process.env.OPENAI_TTS_VOICE ?? DEFAULT_TTS_VOICE;
  }

  async generateReply(params: {
    history: ConversationTurn[];
    userText: string;
  }): Promise<VoiceAssistantReply> {
    const recentHistory = params.history.slice(-MAX_HISTORY_TURNS);
    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      {
        role: "system",
        content:
          "Eres un asistente por voz en español. Responde de forma natural, clara y breve, " +
          "con tono profesional y cercano.",
      },
      ...recentHistory.map((turn) => ({
        role: turn.role,
        content: turn.content,
      })),
      { role: "user", content: params.userText },
    ];

    const completion = await this.openai.chat.completions.create({
      model: this.chatModel,
      messages,
    });

    const text = completion.choices[0]?.message?.content?.trim() ?? "";
    if (!text) {
      throw new Error("Assistant response text is empty.");
    }

    const speech = await this.openai.audio.speech.create({
      model: this.ttsModel,
      voice: this.ttsVoice,
      response_format: "mp3",
      input: text,
    });
    const audioBuffer = Buffer.from(await speech.arrayBuffer());

    return {
      text,
      audioBase64: audioBuffer.toString("base64"),
      format: "mp3",
      mimeType: "audio/mpeg",
    };
  }
}
