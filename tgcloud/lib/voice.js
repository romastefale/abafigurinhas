// Vídeo (MP4/MOV com áudio AAC) -> nota de voz do Telegram: OGG/Opus, mono, 48 kHz, 96 kbps
// (os mesmos parâmetros que o bot usava quando convertia com ffmpeg).
// Peças consolidadas (ver vendor-src/README.md): FAAD2 decodifica o AAC, libopus codifica, wave-resampler
// reamostra; só o MP4 e o OGG (ISO 14496-12 / RFC 3533 e 7845) são lidos e escritos aqui.
import { readAacTrack, Mp4Error } from './mp4audio.js';
import { decoder } from './vendor/aac.js';
import { encodeOpus } from './vendor/opus.js';
import { resample } from './vendor/resample.js';
import { downmixPlanar, toInt16 } from './pcm.js';
import { oggOpus } from './ogg.js';

export { Mp4Error };

const BITRATE = 96000;
// O Serverless interrompe a execução após ~3 s de CPU (medido com tgcloud run: "CPU timer exceeded").
// Medidas na plataforma, em CPU por segundo de áudio: Opus complexidade 10 ≈ 39 ms, 5 ≈ 20 ms, 2 ≈ 8 ms;
// reamostragem sinc com LPF ≈ 21 ms, cúbica sem LPF ≈ 2 ms. Ao subir de 44,1 para 48 kHz o LPF não altera o
// resultado, e a cúbica fica muito acima do ruído do próprio Opus (scripts/diag-cpu.mjs).
const COMPLEXITY = 2;
const RESAMPLE = { method: 'cubic', LPF: false };

// Devolve { ogg: Uint8Array, duration: segundos } ou lança Mp4Error. maxSeconds é conferido antes de decodificar.
export async function videoToVoice(bytes, { maxSeconds = Infinity } = {}) {
  const track = readAacTrack(bytes);
  if (track.duration > maxSeconds) throw new Mp4Error(`O vídeo tem mais de ${Math.round(maxSeconds / 60)} minutos. Envie um vídeo de até ${Math.round(maxSeconds / 60)} minutos.`);
  let dec;
  try {
    dec = await decoder({ asc: track.asc });
  } catch (e) {
    console.warn('decodificador AAC recusou a configuração:', e);
    throw new Mp4Error(`Não consegui ler o áudio desse vídeo (${(e && e.message) || e}).`);
  }
  const planes = [];   // um bloco por quadro: { channelData: Float32Array[], sampleRate }
  let rate = 0;
  let total = 0;
  try {
    for (const frame of track.frames) {
      const out = dec.decode(frame);
      if (!out.channelData.length) continue;
      rate = out.sampleRate;
      planes.push(out.channelData);
      total += out.channelData[0].length;
    }
  } catch (e) {
    console.warn('falha ao decodificar um quadro AAC:', e);
    throw new Mp4Error(`Não consegui decodificar o áudio desse vídeo (${(e && e.message) || e}).`);
  } finally {
    dec.free();
  }
  if (!total) throw new Mp4Error('O áudio desse vídeo está vazio.');

  const mono = downmixPlanar(planes, total);
  // o libopus só aceita 8/12/16/24/48 kHz; a referência (Xiph) é reamostrar antes de codificar
  const at48 = rate === 48000 ? mono : resample(mono, rate, 48000, RESAMPLE);
  const pcm48 = toInt16(at48);
  const { packets, preSkip } = encodeOpus(pcm48, { bitrate: BITRATE, complexity: COMPLEXITY });
  const ogg = oggOpus(packets, { preSkip, totalSamples: pcm48.length, sampleRate: rate });
  return { ogg, duration: pcm48.length / 48000 };
}
