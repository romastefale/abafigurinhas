// Situação de um pacote segundo o Telegram, só com o que a documentação do Bot API garante:
// - getStickerSet devolve o StickerSet "em caso de sucesso";
// - StickerSet não tem formato: cada figurinha tem o seu (InputSticker.format), e um pacote pode misturá-los;
// - pacotes comuns aceitam até 120 figurinhas (addStickerToSet);
// - ao exceder o controle de fluxo, a resposta traz parameters.retry_after.
// Nada aqui depende do texto nem do código de um erro (a doc diz que error_code pode mudar).
import { api, BotApiError } from 'sdk';

export const MAX_FIGURINHAS = 120;

// { status: 'ok', count, full, title }          o Telegram (title = StickerSet.title, 1-64 caracteres) devolveu o pacote
// { status: 'unavailable' }              o Bot API respondeu que não conseguiu (sem aviso de controle de fluxo)
// { status: 'unknown' }                  limite de requisições ou sem resposta do Bot API: nada a afirmar
export async function inspecionar(name) {
  try {
    const set = await api.getStickerSet({ name });
    const count = Array.isArray(set.stickers) ? set.stickers.length : 0;
    const title = typeof set.title === 'string' && set.title ? set.title : null;
    return { status: 'ok', count, full: count >= MAX_FIGURINHAS, title };
  } catch (e) {
    if (e instanceof BotApiError && !(e.parameters && e.parameters.retry_after)) return { status: 'unavailable' };
    return { status: 'unknown' };
  }
}
