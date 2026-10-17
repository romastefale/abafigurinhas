// Toda a conversão acontece no Mini App; o chat só leva o usuário até ele.
// Boas-vindas como mensagem rica (Bot API 10.1+) com um botão verde que abre o app.
import { api, BotApiError } from 'sdk';
import { MINI_APP_URL } from '../lib/config.js';

const TEXTO = 'Transforme imagens e vídeos em figurinhas. Abra o app, escolha o arquivo e adicione ao seu pacote.';

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function boasVindas() {
  const botao = MINI_APP_URL
    ? `<tg-button-row><tg-button type="web_app" style="success" url="${esc(MINI_APP_URL)}">Abrir o app</tg-button></tg-button-row>`
    : '';
  return `<h3>abafigurinhas</h3><p>${esc(TEXTO)}</p>${botao}`;
}

export default async function (message) {
  if (message.chat.type !== 'private') return;
  const chat_id = message.chat.id;
  try {
    await api.sendRichMessage({ chat_id, rich_message: { html: boasVindas() } });
  } catch (e) {
    if (!(e instanceof BotApiError)) throw e;
    // se o Telegram recusar a mensagem rica, o bot responde em texto simples em vez de ficar mudo
    console.warn('sendRichMessage recusado:', e.method, e.code, e.description);
    await api.sendMessage({ chat_id, text: `${TEXTO}\n\nAbra o app pelo botão de menu do bot.` });
  }
}
