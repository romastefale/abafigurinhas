// Temporário: testa lib/registrar.js na plataforma (tgcloud run). Repositório público: só imprime o início das respostas.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
const ENDPOINT = 'tgcloud/endpoints/diagRegistrar.js';
fs.writeFileSync(ENDPOINT, `import { api, db } from 'sdk';
import { and, eq, desc } from 'sdk/db';
import { packs } from '../schema.js';
import { registrarPacote } from '../lib/registrar.js';
const inicio = (t) => t.split('"')[0];
export default async function () {
  const rows = await db.select().from(packs).orderBy(desc(packs.id)).all();
  let real = null;
  for (const r of rows) { try { await api.getStickerSet({ name: r.name }); real = r; break; } catch {} }
  const out = {};
  out.naoEDoBot = inicio(await registrarPacote(real.userId, 'Outro_pacote_by_outrobot'));
  out.jaNaLista = inicio(await registrarPacote(real.userId, real.name));
  out.novoParaUsuarioTeste = inicio(await registrarPacote(1, real.name));
  const criado = await db.select().from(packs).where(and(eq(packs.userId, 1), eq(packs.name, real.name))).get();
  out.linhaCriada = !!criado;
  await db.delete(packs).where(eq(packs.userId, 1)).run();
  out.linhaRemovida = !(await db.select().from(packs).where(eq(packs.userId, 1)).get());
  return out;
}
`);
try { spawnSync('npx', ['tgcloud', 'run', 'endpoints/diagRegistrar', '{}', '--ctx', '{ initData: { user: { id: 1 } } }'], { stdio: 'inherit' }); }
finally { fs.rmSync(ENDPOINT, { force: true }); }
