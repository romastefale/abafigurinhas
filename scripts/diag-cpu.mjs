// Mede, na plataforma (tgcloud run), o que cabe no limite de CPU por execução: se há WebAssembly e quantas
// repetições de cada etapa (10 s de áudio estéreo 44,1 kHz) terminam antes de "CPU timer exceeded".
// Usado para escolher a complexidade do Opus e a reamostragem (lib/voice.js). Para repetir, troque o último
// passo de .github/workflows/diag-convert.yml por `node scripts/diag-cpu.mjs` e dispare o workflow.
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';

const ENDPOINT = 'tgcloud/endpoints/diagCpu.js';
execFileSync('ffmpeg', ['-loglevel', 'error', '-y',
  '-f', 'lavfi', '-i', "aevalsrc='0.4*sin(2*PI*(150+80*t)*t)*(0.6+0.4*sin(2*PI*3*t))|0.3*sin(2*PI*440*t)':s=44100:d=10",
  '-f', 'lavfi', '-i', 'color=c=black:s=16x16:r=1:d=10', '-c:v', 'libx264', '-c:a', 'aac', '-b:a', '64k', '-shortest', '/tmp/cpu10.mp4']);
const b64 = fs.readFileSync('/tmp/cpu10.mp4').toString('base64');

fs.writeFileSync(ENDPOINT, `import { decodeBase64 } from '../lib/base64.js';
import { readAacTrack } from '../lib/mp4audio.js';
import { decoder } from '../lib/vendor/aac.js';
import { encodeOpus } from '../lib/vendor/opus.js';
import { resample } from '../lib/vendor/resample.js';
import { downmixPlanar, toInt16 } from '../lib/pcm.js';

const VIDEO = '${b64}';

async function pcm() {
  const track = readAacTrack(decodeBase64(VIDEO));
  const dec = await decoder({ asc: track.asc });
  const planes = []; let total = 0, rate = 0;
  for (const f of track.frames) { const o = dec.decode(f); if (!o.channelData.length) continue; rate = o.sampleRate; planes.push(o.channelData); total += o.channelData[0].length; }
  dec.free();
  return { track, mono: downmixPlanar(planes, total), rate };
}

export default async function ({ etapa, complexity }) {
  if (etapa === 'wasm') {
    const r = { typeof: typeof WebAssembly };
    if (typeof WebAssembly !== 'undefined') {
      // menor módulo válido: (module (func (export "f") (result i32) i32.const 42))
      const bytes = new Uint8Array([0,97,115,109,1,0,0,0,1,5,1,96,0,1,127,3,2,1,0,7,5,1,1,102,0,0,10,6,1,4,0,65,42,11]);
      try { r.validate = WebAssembly.validate(bytes); } catch (e) { r.validate = 'erro: ' + e.message; }
      try { const { instance } = await WebAssembly.instantiate(bytes); r.instantiate = instance.exports.f(); } catch (e) { r.instantiate = 'erro: ' + e.message; }
      try { r.moduleSync = new WebAssembly.Instance(new WebAssembly.Module(bytes)).exports.f(); } catch (e) { r.moduleSync = 'erro: ' + e.message; }
    }
    return r;
  }
  const base = await pcm();
  console.log('preparado');
  const at48 = etapa === 'resample' || etapa === 'opus' ? resample(base.mono, base.rate, 48000, { method: 'sinc', LPF: true }) : null;
  const i16 = at48 ? toInt16(at48) : null;
  if (etapa !== 'decode') console.log('preparado 2');
  for (let k = 1; k <= 60; k++) {
    if (etapa === 'decode') await pcm();
    else if (etapa === 'resample') resample(base.mono, base.rate, 48000, { method: 'sinc', LPF: true });
    else if (etapa === 'opus') encodeOpus(i16, { bitrate: 96000, complexity });
    console.log('repeticao', k);
  }
  return 'terminou as 60 repeticoes';
}
`);

const casos = [['wasm', {}], ['decode', {}], ['resample', {}],
  ['opus', { complexity: 10 }], ['opus', { complexity: 5 }], ['opus', { complexity: 2 }], ['opus', { complexity: 0 }]];
try {
  for (const [etapa, extra] of casos) {
    const args = JSON.stringify({ etapa, ...extra });
    console.log(`\n===== ${args} =====`);
    spawnSync('npx', ['tgcloud', 'run', 'endpoints/diagCpu', args, '--ctx', '{ initData: { user: { id: 1 } } }'], { stdio: 'inherit' });
  }
} finally {
  fs.rmSync(ENDPOINT, { force: true });
}
