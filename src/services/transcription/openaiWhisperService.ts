import fs from "node:fs";
import { promises as fsp } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import OpenAI from "openai";
import { pcmToWav } from "../../audio/wav";

export interface TranscriptionService {
  transcribePcm16(
    buffers: Buffer[],
    sampleRate: number,
    language?: string,
  ): Promise<string>;
}

export class OpenAIWhisperTranscriptionService implements TranscriptionService {
  private readonly openai: OpenAI;

  constructor(apiKey: string) {
    this.openai = new OpenAI({ apiKey });
  }

  async transcribePcm16(
    buffers: Buffer[],
    sampleRate: number,
    language = "es",
  ): Promise<string> {
    const pcmBuffer = Buffer.concat(buffers);
    const wavBuffer = pcmToWav(pcmBuffer, sampleRate);
    const filePath = path.join("/tmp", `whisper-${randomUUID()}.wav`);

    await fsp.writeFile(filePath, wavBuffer);

    try {
      const transcription = await this.openai.audio.transcriptions.create({
        file: fs.createReadStream(filePath),
        model: "whisper-1",
        language,
        prompt:
          "Transcribe faithfully the audio in Spanish. " +
          "If a word or phrase is unclear, infer it from context to improve understanding. " +
          "Do not add personal comments or explanations.",
      });

      return transcription.text.trim();
    } finally {
      await fsp.rm(filePath, { force: true });
    }
  }
}
