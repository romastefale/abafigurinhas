import { api, db, InputFile, BotApiError, EndpointError } from 'sdk';
import { and, eq } from 'sdk/db';
import { packs } from '../schema.js';
import { decodeBase64 } from '../lib/base64.js';
import { KINDS, matchesMime, randomEmoji, cleanTitle, packNameFromRef, newPackName, explain } from '../lib/stickers.js';

const fail = (message, code, extra = {}) => new EndpointError(message, { code, ...extra });
const link = (name) => `https://t.me/addstickers/${name}`;

async function remember(userId, name, title, format) {
  const known = await db.select().from(packs)
    .where(and(eq(packs.userId, userId), eq(packs.name, name))).get();
  if (known) return known.id;
  const res = await db.insert(packs).values({ userId, name, title, format }).run();
  return res.lastInsertRowid;
}

// input: { mime, data (base64), packId? | packRef? | title? }
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

  try {
    // 1) pacote já registrado no banco
    if (input.packId != null) {
      if (!Number.isInteger(input.packId)) throw fail('Pacote inválido.', 'BAD_PACK');
      const pack = await db.select().from(packs)
        .where(and(eq(packs.id, input.packId), eq(packs.userId, userId))).get();
      if (!pack) throw fail('Pacote não encontrado.', 'BAD_PACK');
      if (pack.format !== kind.format) throw fail(`Esse pacote só aceita figurinhas ${pack.format === 'video' ? 'de vídeo' : 'de imagem'}.`, 'FORMAT_MISMATCH');
      await api.addStickerToSet({ user_id: userId, name: pack.name, sticker: sticker() });
      return { packId: pack.id, name: pack.name, title: pack.title, link: link(pack.name), created: false };
    }

    // 2) pacote existente informado por link ou nome
    if (input.packRef != null) {
      const name = packNameFromRef(input.packRef);
      if (!name) throw fail('Link ou nome de pacote inválido.', 'BAD_PACK');
      const set = await api.getStickerSet({ name });
      const first = set.stickers && set.stickers[0];
      const format = first && first.is_video ? 'video' : first && first.is_animated ? 'animated' : 'static';
      if (format !== kind.format) throw fail('Esse pacote tem outro tipo de figurinha (imagem, vídeo ou animada).', 'FORMAT_MISMATCH');
      await api.addStickerToSet({ user_id: userId, name: set.name, sticker: sticker() });
      const id = await remember(userId, set.name, set.title, format);
      return { packId: id, name: set.name, title: set.title, link: link(set.name), created: false };
    }

    // 3) novo pacote
    const title = cleanTitle(input.title);
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
  } catch (e) {
    if (e instanceof EndpointError) throw e;
    if (e instanceof BotApiError) {
      console.warn('Bot API:', e.method, e.code, e.description);
      throw fail(explain(e.description), 'TELEGRAM', { telegram: e.description });
    }
    throw e;
  }
}
