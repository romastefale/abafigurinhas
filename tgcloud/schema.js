import { table, integer, text, uniqueIndex, sql } from 'sdk/db';

// Pacotes de figurinhas de cada usuário. Sem chave estrangeira: userId é só uma coluna.
export const packs = table('packs', {
  id:      integer('id').primaryKey({ autoIncrement: true }),
  userId:  integer('user_id').notNull(),
  name:    text('name').notNull(),      // nome curto do pacote (t.me/addstickers/<name>)
  title:   text('title').notNull(),
  format:  text('format').notNull(),    // static | video
  created: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
}, (t) => ({
  userNameIdx: uniqueIndex('uidx_packs_user_name').on(t.userId, t.name),
}));
