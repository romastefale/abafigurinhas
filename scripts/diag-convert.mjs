// Diagnóstico do /convert na plataforma real: gera vídeos de teste com ffmpeg, embute cada um num endpoint
// temporário (nunca publicado) e o executa com `tgcloud run`, que roda no Serverless e devolve logs e tempo.
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';

const ENDPOINT = 'tgcloud/endpoints/diagConvert.js';
const casos = [
  { nome: '30 s, estéreo 44,1 kHz', seg: 30, args: ['-ac', '2', '-ar', '44100', '-b:a', '64k'] },
  { nome: '120 s, estéreo 44,1 kHz (pior caso: reamostra)', seg: 120, args: ['-ac', '2', '-ar', '44100', '-b:a', '32k'] },
  { nome: '120 s, mono 48 kHz', seg: 120, args: ['-ac', '1', '-ar', '48000', '-b:a', '32k'] },
];

function endpoint(b64) {
  // só a função que o bot usa, uma vez: o CPU medido é o de uma conversão real
  return `import { decodeBase64 } from '../lib/base64.js';
import { videoToVoice } from '../lib/voice.js';

const VIDEO = '${b64}';

export default async function () {
  const bytes = decodeBase64(VIDEO);
  console.log('início');
  const r = await videoToVoice(bytes, { maxSeconds: 121 });
  return { ok: true, oggBytes: r.ogg.length, segundos: r.duration };
}
`;
}

try {
  for (const c of casos) {
    console.log(`\n===== ${c.nome} =====`);
    const mp4 = `/tmp/diag-${c.seg}.mp4`;
    execFileSync('ffmpeg', ['-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', `aevalsrc='0.4*sin(2*PI*(150+80*t)*t)*(0.6+0.4*sin(2*PI*3*t))':s=48000:d=${c.seg}`,
      '-f', 'lavfi', '-i', `color=c=black:s=16x16:r=1:d=${c.seg}`,
      '-c:v', 'libx264', '-c:a', 'aac', ...c.args, '-shortest', mp4]);
    const b64 = fs.readFileSync(mp4).toString('base64');
    fs.writeFileSync(ENDPOINT, endpoint(b64));
    console.log(`vídeo de teste: ${fs.statSync(mp4).size} bytes; módulo: ${fs.statSync(ENDPOINT).size} bytes`);
    const r = spawnSync('npx', ['tgcloud', 'run', 'endpoints/diagConvert', '{}', '--ctx', '{ initData: { user: { id: 1 } } }'], { stdio: 'inherit' });
    console.log(`(tgcloud run terminou com código ${r.status})`);
  }
} finally {
  fs.rmSync(ENDPOINT, { force: true });
}
