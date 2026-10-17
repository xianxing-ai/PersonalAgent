/** Visual loudness from PCM16. Returns 0..1 and does not retain samples. */
export function pcmLevel(data) {
  if (!(data instanceof Uint8Array) || data.byteLength < 2 || data.byteLength % 2) return 0;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const samples = data.byteLength / 2;
  const step = Math.max(1, Math.floor(samples / 180));
  let sum = 0;
  let count = 0;
  for (let i = 0; i < samples; i += step) {
    const sample = view.getInt16(i * 2, true) / 32768;
    sum += sample * sample;
    count++;
  }
  const rms = Math.sqrt(sum / Math.max(1, count));
  return Math.max(0, Math.min(1, (rms - 0.008) / 0.16));
}
