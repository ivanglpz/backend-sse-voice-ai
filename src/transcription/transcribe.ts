import { getTranscriptionService } from "../services/transcription";

export async function transcribePcm16(
  buffers: Buffer[],
  sampleRate: number,
): Promise<string> {
  if (buffers.length === 0) return "";

  const service = getTranscriptionService();
  return service.transcribePcm16(buffers, sampleRate, "es");
}
