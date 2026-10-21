// Devolve à lista do usuário um pacote que o bot criou e cujo nome a lista perdeu.
// Bot API: não há método que liste os pacotes de um usuário; o nome vem de uma figurinha (Sticker.set_name) ou do
// link t.me/addstickers/<name>. createNewStickerSet: o nome de um pacote do bot termina em "_by_<bot_username>",
// sem diferenciar maiúsculas; getStickerSet confirma que o pacote existe.
import { api, db, BotApiError } from 'sdk';
import { and, eq } from 'sdk/db';
import { packs } from '../schema.js';

const LINK = /(?:https?:\/\/)?(?:t|telegram)\.me\/addstickers\/([A-Za-z][A-Za-z0-9_]{0,63})/i;

// Nome do pacote que a mensagem aponta (figurinha ou link), ou null.
export function pacoteDaMensagem(message) {
  if (message.sticker && message.sticker.set_name) return message.sticker.set_name;
  const m = LINK.exec(message.text || '');
  return m ? m[1] : null;
}

// Registra o pacote para o usuário e devolve o texto da resposta.
export async function registrarPacote(userId, name) {
  const me = await api.getMe();
  if (!name.toLowerCase().endsWith(`_by_${me.username}`.toLowerCase())) {
    return 'Esse pacote não foi criado por este bot, então não posso adicionar figurinhas a ele.';
  }
  let set;
  try {
    set = await api.getStickerSet({ name });
  } catch (e) {
    if (!(e instanceof BotApiError)) throw e;
    return `O Telegram não devolveu esse pacote (${e.description}).`;
  }
  const known = await db.select().from(packs).where(and(eq(packs.userId, userId), eq(packs.name, name))).get();
  if (known) return `O pacote "${set.title}" já está na sua lista do app.`;
  // a coluna format é obrigatória na tabela; o formato real é o de cada figurinha (Sticker.is_video / is_animated)
  const s = (set.stickers || [])[0];
  const format = s && s.is_video ? 'video' : s && s.is_animated ? 'animated' : 'static';
  await db.insert(packs).values({ userId, name, title: set.title, format }).run();
  return `Pacote "${set.title}" de volta à sua lista. Abra o app para adicionar figurinhas a ele.`;
}
