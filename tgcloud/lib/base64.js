const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const LOOKUP = new Int16Array(128).fill(-1);
for (let i = 0; i < ALPHABET.length; i++) LOOKUP[ALPHABET.charCodeAt(i)] = i;

// Base64 padrão (com "=") para bytes. Lança Error se a entrada for inválida.
export function decodeBase64(text) {
  if (typeof text !== 'string' || text.length === 0 || text.length % 4 !== 0) {
    throw new Error('base64 inválido');
  }
  let pad = 0;
  if (text.endsWith('==')) pad = 2;
  else if (text.endsWith('=')) pad = 1;
  const out = new Uint8Array((text.length / 4) * 3 - pad);
  let o = 0;
  for (let i = 0; i < text.length; i += 4) {
    let acc = 0;
    for (let j = 0; j < 4; j++) {
      const ch = text.charCodeAt(i + j);
      const isPad = ch === 61 && i + j >= text.length - pad;
      const v = isPad ? 0 : ch < 128 ? LOOKUP[ch] : -1;
      if (v < 0) throw new Error('base64 inválido');
      acc = (acc << 6) | v;
    }
    if (o < out.length) out[o++] = (acc >> 16) & 255;
    if (o < out.length) out[o++] = (acc >> 8) & 255;
    if (o < out.length) out[o++] = acc & 255;
  }
  return out;
}
