export function pcm16BufferToFloat32(chunk: Buffer): Float32Array {
  const sampleCount = Math.floor(chunk.length / 2);
  const out = new Float32Array(sampleCount);

  for (let i = 0; i < sampleCount; i += 1) {
    const sample = chunk.readInt16LE(i * 2);
    out[i] = sample / 32768;
  }

  return out;
}
