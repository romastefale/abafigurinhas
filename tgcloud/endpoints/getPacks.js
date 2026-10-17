import { db } from 'sdk';
import { eq, asc } from 'sdk/db';
import { packs } from '../schema.js';

// Pacotes do usuário que abriu o Mini App.
export default async function (input, ctx) {
  const rows = await db.select().from(packs)
    .where(eq(packs.userId, ctx.initData.user.id))
    .orderBy(asc(packs.id))
    .limit(50)
    .all();
  return rows.map((p) => ({ id: p.id, name: p.name, title: p.title, format: p.format }));
}
