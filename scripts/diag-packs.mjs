// Diagnóstico dos pacotes registrados, na plataforma (tgcloud run), sem publicar nada.
// O repositório é público: a saída não mostra IDs de usuário, nomes nem títulos — só formatos e contagens.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const ENDPOINT = 'tgcloud/endpoints/diagPacks.js';
fs.writeFileSync(ENDPOINT, `import { api, db, BotApiError } from 'sdk';
import { asc } from 'sdk/db';
import { packs } from '../schema.js';

export default async function () {
  const rows = await db.select().from(packs).orderBy(asc(packs.id)).all();
  const donos = new Map();
  const saida = [];
  for (const r of rows) {
    if (!donos.has(r.userId)) donos.set(r.userId, 'usuario ' + (donos.size + 1));
    const linha = { pacote: saida.length + 1, dono: donos.get(r.userId), formatoGravado: r.format };
    try {
      const set = await api.getStickerSet({ name: r.name });
      const formatos = {};
      for (const s of set.stickers || []) {
        const f = s.is_video ? 'video' : s.is_animated ? 'animated' : 'static';
        formatos[f] = (formatos[f] || 0) + 1;
      }
      const p = (set.stickers || [])[0];
      linha.telegram = 'ok';
      linha.figurinhas = (set.stickers || []).length;
      linha.formatosNoPacote = formatos;
      linha.formatoDaPrimeira = p ? (p.is_video ? 'video' : p.is_animated ? 'animated' : 'static') : null;
      linha.camposDoStickerSet = Object.keys(set).sort().join(',');
    } catch (e) {
      linha.telegram = e instanceof BotApiError ? 'erro ' + e.code + ': ' + e.description : 'falha: ' + (e && e.message);
    }
    saida.push(linha);
  }
  console.log('pacotes registrados:', rows.length, '| usuarios:', donos.size);
  for (const l of saida) console.log(JSON.stringify(l));
  return { pacotes: rows.length, usuarios: donos.size };
}
`);
try {
  spawnSync('npx', ['tgcloud', 'run', 'endpoints/diagPacks', '{}', '--ctx', '{ initData: { user: { id: 1 } } }'], { stdio: 'inherit' });
} finally {
  fs.rmSync(ENDPOINT, { force: true });
}
