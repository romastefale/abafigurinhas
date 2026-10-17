// Formatos aceitos. O Mini App converte no aparelho; aqui só validamos e repassamos ao Telegram.
export const KINDS = {
  'image/webp': { format: 'static', file: 'sticker.webp', max: 512 * 1024 },
  'image/png':  { format: 'static', file: 'sticker.png',  max: 512 * 1024 },
  'video/webm': { format: 'video',  file: 'sticker.webm', max: 256 * 1024 },
};

const EMOJIS = ['😀', '😂', '😍', '😎', '🥳', '🤩', '😜', '🤖', '🔥', '✨', '💫', '🎉', '❤️', '👍', '👀', '🌟'];
export const randomEmoji = () => EMOJIS[Math.floor(Math.random() * EMOJIS.length)];

// Confere os primeiros bytes: o mime que o cliente declara não é confiável.
export function matchesMime(mime, b) {
  if (mime === 'image/png') return b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
  if (mime === 'image/webp') return b.length > 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50;
  if (mime === 'video/webm') return b.length > 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3;
  return false;
}

export function cleanTitle(value) {
  const title = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  return title.length >= 1 && title.length <= 64 ? title : '';
}

// Nome do pacote: letras/dígitos/_, começa com letra, termina em _by_<bot>, até 64 caracteres.
export function newPackName(title, botUsername) {
  const bot = botUsername.toLowerCase();
  const suffix = `_${(Math.random().toString(36) + '0000').slice(2, 6)}_by_${bot}`;
  let base = title.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  if (!base) base = 'pack';
  else if (!/^[a-z]/.test(base)) base = `p_${base}`;
  base = base.slice(0, 64 - suffix.length).replace(/_+$/, '');
  return `${base || 'pack'}${suffix}`;
}

// Mostra ao usuário o motivo que o Telegram devolve em `description` ("the error is explained in the
// description"). Nenhum comportamento do app depende do texto de um erro.
export function explain(description) {
  const motivo = String(description || '').replace(/^Bad Request:\s*/i, '').trim().slice(0, 160);
  return motivo ? `O Telegram recusou a operação (${motivo}).` : 'O Telegram recusou a operação.';
}
