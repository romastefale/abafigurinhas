// Mistura em mono e converte para Int16. A reamostragem para 48 kHz é do wave-resampler (vendor/resample.js).

// Mistura os canais (planares, um bloco por quadro) em mono pela média.
export function downmixPlanar(blocks, total) {
  const out = new Float32Array(total);
  let o = 0;
  for (const channels of blocks) {
    const n = channels[0].length;
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let c = 0; c < channels.length; c++) s += channels[c][i];
      out[o + i] = s / channels.length;
    }
    o += n;
  }
  return out;
}

export function toInt16(samples) {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    out[i] = v < 0 ? v * 32768 : v * 32767;
  }
  return out;
}
