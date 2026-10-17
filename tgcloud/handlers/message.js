// Toda a conversão acontece no Mini App; o chat só leva o usuário até ele.
import { api } from 'sdk';
import { MINI_APP_URL } from '../lib/config.js';

const TEXT = 'Para fazer uma figurinha, abra o app: escolha uma imagem ou vídeo, ele converte no seu aparelho e adiciona ao seu pacote.';

export default async function (message) {
  if (message.chat.type !== 'private') return;
  const body = { chat_id: message.chat.id, text: TEXT };
  if (MINI_APP_URL) {
    body.reply_markup = { inline_keyboard: [[{ text: 'Abrir o app', web_app: { url: MINI_APP_URL } }]] };
  }
  await api.sendMessage(body);
}
