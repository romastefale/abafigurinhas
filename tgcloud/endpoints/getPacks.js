import { db } from 'sdk';
import { eq, asc } from 'sdk/db';
import { packs } from '../schema.js';
import { inspecionar } from '../lib/sets.js';

const SIMULTANEAS = 5;

async function conferir(rows) {
  const estados = new Array(rows.length);
  let proximo = 0;
  const trabalhador = async () => {
    while (proximo < rows.length) {
      const i = proximo++;
      estados[i] = await inspecionar(rows[i].name);
    }
  };
  await Promise.all(Array.from({ length: Math.min(SIMULTANEAS, rows.length) }, trabalhador));
  return estados;
}

// Pacotes do usuário que abriu o Mini App, como o Telegram os vê agora. Pacotes que o Bot API não
// consegue devolver ficam de fora da lista; nada é apagado da tabela (se voltarem, voltam à lista).
export default async function (input, ctx) {
  const rows = await db.select().from(packs)
    .where(eq(packs.userId, ctx.initData.user.id))
    .orderBy(asc(packs.id))
    .limit(50)
    .all();
  const estados = await conferir(rows);
  const lista = [];
  for (let i = 0; i < rows.length; i++) {
    const p = rows[i];
    const e = estados[i];
    if (e.status === 'unavailable') continue;
    // o título é o que o Telegram devolve (StickerSet.title); se mudou, a linha acompanha
    const title = e.status === 'ok' && e.title ? e.title : p.title;
    if (title !== p.title) {
      try {
        await db.update(packs).set({ title }).where(eq(packs.id, p.id)).run();
      } catch (err) {
        console.warn('título não atualizado na lista:', p.name, (err && err.message) || String(err));
      }
    }
    lista.push({
      id: p.id,
      name: p.name,
      title,
      full: e.status === 'ok' && e.full,
    });
  }
  return lista;
}
