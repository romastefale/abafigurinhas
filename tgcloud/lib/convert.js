// /convert (Bot API: ForceReply + getFile + sendVoice). O bot pede o vídeo com um ForceReply, o que
// dispensa guardar estado: o vídeo que chega como resposta a esse pedido é o que será convertido.
// O áudio sai como mensagem de voz (sendVoice, OGG/Opus), sem título, para parecer um áudio nativo ao encaminhar.
import { api, InputFile, BotApiError } from 'sdk';
import { videoToVoice, Mp4Error } from './voice.js';

export const MAX_SEGUNDOS = 120;
const MAX_BYTES = 20 * 1024 * 1024;   // limite do getFile (documentação do Serverless)

export const PEDIDO = 'Envie o vídeo (até 2 minutos) que você quer transformar em áudio.';

export const ehComandoConvert = (message) => /^\/convert(@\w+)?(\s|$)/i.test(message.text || '');

// O anexo que pode ser convertido: vídeo, vídeo redondo, GIF ou arquivo com MIME de vídeo.
export function anexoDeVideo(message) {
  const v = message.video || message.video_note || message.animation;
  if (v) return v;
  const d = message.document;
  return d && /^video\//.test(d.mime_type || '') ? d : null;
}

// A mensagem é a resposta ao pedido do /convert?
export const respondeAoPedido = (message) => {
  const r = message.reply_to_message;
  return !!r && !!r.from && r.from.is_bot === true && r.text === PEDIDO;
};

export async function pedirVideo(chat_id) {
  await api.sendMessage({
    chat_id,
    text: PEDIDO,
    reply_markup: { force_reply: true, input_field_placeholder: 'Envie o vídeo' },
  });
}

// Converte o anexo e envia a voz. Devolve o texto de erro para o usuário, ou null se deu certo.
export async function converter(chat_id, anexo) {
  if (anexo.duration && anexo.duration > MAX_SEGUNDOS) return 'O vídeo tem mais de 2 minutos. Envie um vídeo de até 2 minutos.';
  if (anexo.file_size && anexo.file_size > MAX_BYTES) return 'O arquivo passa de 20 MB, o máximo que o bot consegue baixar. Envie um vídeo menor.';
  // indicador nativo do Telegram enquanto converte (some sozinho em até 5 s ou quando a voz chega)
  await api.sendChatAction({ chat_id, action: 'upload_voice' }).catch(() => {});
  let bytes;
  try {
    bytes = await api.getFileContent(anexo.file_id);
  } catch (e) {
    if (!(e instanceof BotApiError)) throw e;
    return 'Não consegui baixar esse vídeo. Tente enviar de novo (até 20 MB).';
  }
  let resultado;
  try {
    resultado = await videoToVoice(bytes);
  } catch (e) {
    if (!(e instanceof Mp4Error)) throw e;
    return e.message;
  }
  if (resultado.duration > MAX_SEGUNDOS + 1) return 'O áudio tem mais de 2 minutos. Envie um vídeo de até 2 minutos.';
  // sem caption: é só a mensagem de voz
  await api.sendVoice({
    chat_id,
    voice: new InputFile(resultado.ogg, 'voice.ogg', { type: 'audio/ogg' }),
    duration: Math.round(resultado.duration),
  });
  return null;
}
