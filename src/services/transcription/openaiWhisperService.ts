import { randomUUID } from "node:crypto";
import fs, { promises as fsp } from "node:fs";
import path from "node:path";
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
        model: "gpt-4o-transcribe",
        language,
        prompt:
          "Transcribe fielmente el audio en español. " +
          "No traduzcas ni conviertas nada al inglés; mantén todo el contenido en español. " +
          "Si una palabra o frase no es clara, infiérela por contexto para mejorar la comprensión. " +
          "No agregues comentarios ni explicaciones personales.",
      });

      return transcription.text.trim();
    } finally {
      await fsp.rm(filePath, { force: true });
    }
  }
}
