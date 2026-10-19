// libopus 1.4 (opusscript, MIT) na versão asm.js, usada pela API oficial do pacote: sem WebAssembly, fs nem rede.
import OpusScript from 'opusscript';

// o opusscript devolve Buffer do Node; no isolate basta um Uint8Array com o mesmo conteúdo
if (typeof Buffer === 'undefined') globalThis.Buffer = { from: (a) => Uint8Array.from(a) };

const FRAME = 960;   // 20 ms a 48 kHz

// PCM Int16 mono 48 kHz -> pacotes Opus de 20 ms. Devolve { packets: Uint8Array[], preSkip }.
export function encodeOpus(pcm, { bitrate = 96000 } = {}) {
  const enc = new OpusScript(48000, 1, OpusScript.Application.AUDIO, { wasm: false });
  enc.setBitrate(bitrate);
  const packets = [];
  const frame = new Int16Array(FRAME);
  for (let off = 0; off < pcm.length; off += FRAME) {
    frame.fill(0);   // o último quadro é completado com silêncio
    frame.set(pcm.subarray(off, Math.min(off + FRAME, pcm.length)));
    packets.push(new Uint8Array(enc.encode(new Uint8Array(frame.buffer), FRAME)));
  }
  enc.delete();
  return { packets, preSkip: 312 };
}
