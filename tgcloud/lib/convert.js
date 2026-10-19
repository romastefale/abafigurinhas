// /convert: o usuário manda o comando, depois um vídeo de até 2 minutos; o bot devolve o áudio como
// mensagem de voz (sendVoice), sem título, para que pareça um áudio nativo ao encaminhar.
import { api, db, InputFile, BotApiError } from 'sdk';
import { eq } from 'sdk/db';
import { convertPending } from '../schema.js';
import { extractM4a, M4aError } from './m4a.js';

export const MAX_SEGUNDOS = 120;
const MAX_BYTES = 20 * 1024 * 1024;   // limite do getFile
const VALIDADE = 15 * 60;             // segundos que o pedido de /convert continua valendo

const agora = () => Math.floor(Date.now() / 1000);

export const ehComandoConvert = (message) => /^\/convert(@\w+)?(\s|$)/i.test(message.text || '');

// O anexo que pode ser convertido: vídeo, vídeo redondo, GIF ou arquivo com MIME de vídeo.
export function anexoDeVideo(message) {
  const v = message.video || message.video_note || message.animation;
  if (v) return v;
  const d = message.document;
  return d && /^video\//.test(d.mime_type || '') ? d : null;
}

export async function pedirVideo(userId) {
  await db.delete(convertPending).where(eq(convertPending.userId, userId)).run();
  await db.insert(convertPending).values({ userId, created: agora() }).run();
}

export async function aguardandoVideo(userId) {
  const row = await db.select().from(convertPending).where(eq(convertPending.userId, userId)).get();
  return !!row && agora() - row.created <= VALIDADE;
}

const limpar = (userId) => db.delete(convertPending).where(eq(convertPending.userId, userId)).run();

// Converte o anexo e envia a voz. Devolve null se deu certo, ou o texto de erro para o usuário.
// O pedido só é consumido em caso de sucesso; assim o usuário pode tentar outro vídeo.
export async function converter(chat_id, userId, anexo) {
  if (anexo.duration && anexo.duration > MAX_SEGUNDOS) return 'O vídeo tem mais de 2 minutos. Envie um vídeo de até 2 minutos.';
  if (anexo.file_size && anexo.file_size > MAX_BYTES) return 'O arquivo passa de 20 MB, o máximo que o bot consegue baixar. Envie um vídeo menor.';
  let bytes;
  try {
    bytes = await api.getFileContent(anexo.file_id);
  } catch (e) {
    if (!(e instanceof BotApiError)) throw e;
    return 'Não consegui baixar esse vídeo. Tente enviar de novo (até 20 MB).';
  }
  let resultado;
  try {
    resultado = extractM4a(bytes);
  } catch (e) {
    if (!(e instanceof M4aError)) throw e;
    return e.message;
  }
  const duration = Math.round(resultado.duration);
  if (resultado.duration > MAX_SEGUNDOS + 1) return 'O áudio tem mais de 2 minutos. Envie um vídeo de até 2 minutos.';
  // sem caption e sem título: é só a mensagem de voz
  await api.sendVoice({ chat_id, voice: new InputFile(resultado.m4a, 'voice.m4a', { type: 'audio/mp4' }), duration });
  await limpar(userId);
  return null;
}
