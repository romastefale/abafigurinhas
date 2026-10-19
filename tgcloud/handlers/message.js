// Figurinhas: a conversão acontece no Mini App; o chat só leva o usuário até ele.
// /convert: vídeo de até 2 minutos vira mensagem de voz, tudo dentro do chat (lib/convert.js).
// Boas-vindas como mensagem rica (sendRichMessage, Bot API 10.1) com um botão verde (Bot API 10.3)
// que abre o Mini App. A tag e os atributos seguem a seção "Rich HTML style" da documentação.
import { api, BotApiError } from 'sdk';
import { MINI_APP_URL } from '../lib/config.js';
import { esc } from '../lib/rich.js';
import { ehComandoConvert, anexoDeVideo, respondeAoPedido, pedirVideo, converter } from '../lib/convert.js';

const TEXTO = 'Transforme imagens e vídeos em figurinhas. Abra o app, escolha o arquivo e adicione ao seu pacote.';

function boasVindas() {
  const botao = MINI_APP_URL
    ? `<tg-button-row align="center"><tg-button type="web_app" style="success" url="${esc(MINI_APP_URL)}">Abrir o app</tg-button></tg-button-row>`
    : '';
  return `<h1>@abafigurinhas</h1><p>${esc(TEXTO)}</p>${botao}`;
}

export default async function (message) {
  if (message.chat.type !== 'private') return;
  const chat_id = message.chat.id;

  if (ehComandoConvert(message)) {
    await pedirVideo(chat_id);
    return;
  }
  const anexo = anexoDeVideo(message);
  if (anexo && respondeAoPedido(message)) {
    let erro;
    try {
      erro = await converter(chat_id, anexo);
    } catch (e) {
      // erro inesperado: o usuário recebe o motivo em vez de silêncio
      console.error('/convert falhou:', e);
      erro = `Não consegui converter esse vídeo (${(e && e.name) || 'Erro'}: ${(e && (e.description || e.message)) || e}).`;
    }
    if (erro) await api.sendMessage({ chat_id, text: erro });
    return;
  }

  try {
    await api.sendRichMessage({ chat_id, rich_message: { html: boasVindas() } });
  } catch (e) {
    if (!(e instanceof BotApiError)) throw e;
    // se o Telegram recusar a mensagem rica, o bot responde em texto simples em vez de ficar mudo
    console.warn('sendRichMessage recusado:', e.method, e.code, e.description);
    await api.sendMessage({ chat_id, text: `${TEXTO}\n\nAbra o app pelo botão de menu do bot.` });
  }
}
