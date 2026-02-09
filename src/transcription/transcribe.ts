export async function transcribePcm16(
  buffers: Buffer[],
  sampleRate: number,
): Promise<string> {
  const totalBytes = buffers.reduce((acc, b) => acc + b.length, 0);
  const durationSec = totalBytes / 2 / sampleRate;
  return `[mock transcript ${durationSec.toFixed(2)}s]`;
}
