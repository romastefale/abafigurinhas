// Temporário: roda o endpoint getPacks real na plataforma para o dono do primeiro pacote registrado.
// Repositório público: não imprime IDs nem títulos.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
const ENDPOINT = 'tgcloud/endpoints/diagGetPacks.js';
fs.writeFileSync(ENDPOINT, `import { db } from 'sdk';
import { asc } from 'sdk/db';
import { packs } from '../schema.js';
import getPacks from './getPacks.js';
export default async function () {
  const rows = await db.select().from(packs).orderBy(asc(packs.id)).all();
  const dono = rows[0].userId;
  const registrados = rows.filter((r) => r.userId === dono).length;
  const lista = await getPacks({}, { initData: { user: { id: dono } } });
  return { registradosDoUsuario1: registrados, naLista: lista.length, campos: lista.map((p) => Object.keys(p).sort().join(',')), cheios: lista.filter((p) => p.full).length };
}
`);
try { spawnSync('npx', ['tgcloud', 'run', 'endpoints/diagGetPacks', '{}', '--ctx', '{ initData: { user: { id: 1 } } }'], { stdio: 'inherit' }); }
finally { fs.rmSync(ENDPOINT, { force: true }); }
