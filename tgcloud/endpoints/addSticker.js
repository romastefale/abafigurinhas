import { api, db, InputFile, BotApiError, EndpointError } from 'sdk';
import { and, eq } from 'sdk/db';
import { packs } from '../schema.js';
import { decodeBase64 } from '../lib/base64.js';
import { KINDS, matchesMime, randomEmoji, cleanTitle, newPackName, explain } from '../lib/stickers.js';
import { avisoDoPacote } from '../lib/rich.js';

const fail = (message, code, extra = {}) => new EndpointError(message, { code, ...extra });
const link = (name) => `https://t.me/addstickers/${name}`;

async function remember(userId, name, title, format) {
  const known = await db.select().from(packs)
    .where(and(eq(packs.userId, userId), eq(packs.name, name))).get();
  if (known) return known.id;
  const res = await db.insert(packs).values({ userId, name, title, format }).run();
  return res.lastInsertRowid;
}

// Uma única mensagem rica no chat confirma o resultado. Se o envio falhar, o pacote já foi
// criado/atualizado: a falha só vai para o log e não desfaz nem esconde o que foi feito.
async function avisarNoChat(userId, resultado) {
  try {
    await api.sendRichMessage({ chat_id: userId, rich_message: { html: avisoDoPacote(resultado) } });
  } catch (e) {
    console.warn('aviso no chat falhou:', (e && e.description) || String(e));
  }
}

async function adicionarAoPacote(userId, packId, kind, sticker) {
  if (!Number.isInteger(packId)) throw fail('Pacote inválido.', 'BAD_PACK');
  const pack = await db.select().from(packs)
    .where(and(eq(packs.id, packId), eq(packs.userId, userId))).get();
  if (!pack) throw fail('Pacote não encontrado.', 'BAD_PACK');
  if (pack.format !== kind.format) {
    throw fail(`Esse pacote só aceita figurinhas ${pack.format === 'video' ? 'de vídeo' : 'de imagem'}.`, 'FORMAT_MISMATCH');
  }
  await api.addStickerToSet({ user_id: userId, name: pack.name, sticker: sticker() });
  return { packId: pack.id, name: pack.name, title: pack.title, link: link(pack.name), created: false };
}

async function criarPacote(userId, rawTitle, kind, sticker) {
  const title = cleanTitle(rawTitle);
  if (!title) throw fail('Dê um nome ao pacote (até 64 caracteres).', 'BAD_TITLE');
  const me = await api.getMe();
  for (let attempt = 0; ; attempt++) {
    const name = newPackName(title, me.username);
    try {
      await api.createNewStickerSet({ user_id: userId, name, title, stickers: [sticker()] });
      const id = await remember(userId, name, title, kind.format);
      return { packId: id, name, title, link: link(name), created: true };
    } catch (e) {
      const taken = e instanceof BotApiError && /occupied/i.test(e.description);
      if (!taken || attempt >= 2) throw e;
    }
  }
}

// input: { mime, data (base64), packId? | title? }  (sem packId, cria um pacote novo chamado `title`)
export default async function (input, ctx) {
  const userId = ctx.initData.user.id;
  const kind = KINDS[input.mime];
  if (!kind) throw fail('Formato não suportado.', 'BAD_FORMAT');

  let bytes;
  try {
    bytes = decodeBase64(input.data);
  } catch {
    throw fail('Arquivo corrompido. Tente de novo.', 'BAD_DATA');
  }
  if (!matchesMime(input.mime, bytes)) throw fail('O arquivo não é do formato declarado.', 'BAD_DATA');
  if (bytes.length > kind.max) {
    throw fail(`A figurinha ficou com ${Math.ceil(bytes.length / 1024)} KB (máximo ${kind.max / 1024} KB).`, 'TOO_BIG');
  }

  const sticker = () => ({
    sticker: new InputFile(bytes, kind.file, { type: input.mime }),
    format: kind.format,
    emoji_list: [randomEmoji()],
  });

  let resultado;
  try {
    resultado = input.packId != null
      ? await adicionarAoPacote(userId, input.packId, kind, sticker)
      : await criarPacote(userId, input.title, kind, sticker);
  } catch (e) {
    if (e instanceof EndpointError) throw e;
    if (e instanceof BotApiError) {
      console.warn('Bot API:', e.method, e.code, e.description);
      throw fail(explain(e.description), 'TELEGRAM', { telegram: e.description });
    }
    throw e;
  }

  await avisarNoChat(userId, resultado);
  return resultado;
}
