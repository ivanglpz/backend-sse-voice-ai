export function pcm16ToFloat32(int16: Int16Array): Float32Array {
  const out = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i += 1) {
    out[i] = int16[i] / 32768;
  }
  return out;
}

export function rmsDb(samples: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) {
    sum += samples[i] * samples[i];
  }
  const rms = Math.sqrt(sum / samples.length + 1e-12);
  return 20 * Math.log10(rms + 1e-12);
}
