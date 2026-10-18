import { api, db, InputFile, BotApiError, EndpointError } from 'sdk';
import { and, eq } from 'sdk/db';
import { packs } from '../schema.js';
import { decodeBase64 } from '../lib/base64.js';
import { KINDS, matchesMime, randomEmoji, cleanTitle, newPackName, explain } from '../lib/stickers.js';
import { inspecionar, MAX_FIGURINHAS } from '../lib/sets.js';
import { tituloDoAviso, linkDoPacote, previaDoPacote } from '../lib/rich.js';

const fail = (message, code, extra = {}) => new EndpointError(message, { code, ...extra });
const link = (name) => `https://t.me/addstickers/${name}`;

// Registra o pacote na lista do usuário (a lista é só do app; o pacote em si vive no Telegram).
// Um insert simples resolve para { rowsAffected, lastInsertRowid, rows } (pode vir como BigInt).
async function remember(userId, name, title, format) {
  const known = await db.select().from(packs)
    .where(and(eq(packs.userId, userId), eq(packs.name, name))).get();
  if (known) return known.id;
  const res = await db.insert(packs).values({ userId, name, title, format }).run();
  const id = Number(res && res.lastInsertRowid);
  return Number.isFinite(id) && id > 0 ? id : null;
}

// Aviso no chat: o título em mensagem rica (H1) e, logo abaixo, o hiperlink do pacote numa mensagem de
// texto comum. A prévia de link é opção de mensagens de texto (`sendMessage` + `link_preview_options`;
// `sendRichMessage` não tem esse parâmetro), com a `url` explícita para o Telegram montar a prévia do pacote.
// Cada envio é independente: se um falhar, o resultado do pacote não é desfeito (só vai para o log).
async function avisarNoChat(userId, resultado) {
  try {
    await api.sendRichMessage({ chat_id: userId, rich_message: { html: tituloDoAviso(resultado) } });
  } catch (e) {
    console.warn('título do aviso falhou:', (e && e.description) || String(e));
  }
  try {
    await api.sendMessage({
      chat_id: userId,
      text: linkDoPacote(resultado),
      parse_mode: 'HTML',
      link_preview_options: previaDoPacote(resultado.link),
    });
  } catch (e) {
    console.warn('link do pacote falhou:', (e && e.description) || String(e));
  }
}

const NOME_DO_FORMATO = { static: 'de imagem', video: 'de vídeo', animated: 'animadas (TGS)' };

async function adicionarAoPacote(userId, packId, kind, sticker) {
  if (!Number.isInteger(packId)) throw fail('Pacote inválido.', 'BAD_PACK');
  const pack = await db.select().from(packs)
    .where(and(eq(packs.id, packId), eq(packs.userId, userId))).get();
  if (!pack) throw fail('Pacote não encontrado.', 'BAD_PACK');
  // o estado vem do Telegram (getStickerSet), não do que foi registrado na criação
  const estado = await inspecionar(pack.name, pack.format);
  if (estado.status === 'unavailable') throw fail('O Telegram não devolveu esse pacote agora. Ele pode ter sido apagado.', 'PACK_UNAVAILABLE');
  const formato = estado.status === 'ok' ? estado.format : pack.format;
  if (formato !== kind.format) throw fail(`Esse pacote só aceita figurinhas ${NOME_DO_FORMATO[formato] || formato}.`, 'FORMAT_MISMATCH');
  if (estado.status === 'ok' && estado.full) throw fail(`Esse pacote já tem ${MAX_FIGURINHAS} figurinhas (o máximo).`, 'PACK_FULL');
  await api.addStickerToSet({ user_id: userId, name: pack.name, sticker: sticker() });
  return { packId: pack.id, name: pack.name, title: pack.title, link: link(pack.name), created: false };
}

// Escolhe um nome que o Telegram ainda não devolve como pacote existente (sem olhar texto de erro).
async function nomeLivre(title, username) {
  for (let tentativa = 0; tentativa < 3; tentativa++) {
    const name = newPackName(title, username);
    if ((await inspecionar(name, 'static')).status !== 'ok') return name;
  }
  throw fail('Não consegui um nome livre para o pacote. Tente outro nome.', 'NAME_TAKEN');
}

async function criarPacote(userId, rawTitle, kind, sticker) {
  const title = cleanTitle(rawTitle);
  if (!title) throw fail('Dê um nome ao pacote (até 64 caracteres).', 'BAD_TITLE');
  const me = await api.getMe();
  const name = await nomeLivre(title, me.username);
  await api.createNewStickerSet({ user_id: userId, name, title, stickers: [sticker()] });
  // o pacote já existe no Telegram: se o registro na lista falhar, não escondemos isso do usuário
  // (ele recebe o link no chat); a falha só vai para o log.
  let id = null;
  try {
    id = await remember(userId, name, title, kind.format);
  } catch (e) {
    console.error('pacote criado, mas não registrado na lista:', name, (e && e.message) || String(e));
  }
  return { packId: id, name, title, link: link(name), created: true };
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
