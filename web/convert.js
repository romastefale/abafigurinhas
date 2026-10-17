// Conversão no aparelho: nada sai do celular até a figurinha estar pronta.
// Imagem -> WebP/PNG 512x512 (até 512 KB). Vídeo -> WebM VP9 512x512, sem áudio, até 3 s e 256 KB.
import {
  Input, Output, Conversion, BlobSource, BufferTarget, WebMOutputFormat, ALL_FORMATS, canEncodeVideo,
} from "./vendor/mediabunny.min.mjs";

export const LADO = 512;
export const MAX_ESTATICA = 512 * 1024;
export const MAX_VIDEO = 256 * 1024;
const ALVO_VIDEO = 240 * 1024; // folga para o contêiner e variação do controle de taxa
const MAX_SEGUNDOS = 3;

export class ErroDeConversao extends Error {}

export async function podeGerarVideo() {
  try {
    return await canEncodeVideo("vp9", { width: LADO, height: LADO });
  } catch {
    return false;
  }
}

const canvasPara = (bmp) => {
  const c = document.createElement("canvas");
  c.width = c.height = LADO;
  const g = c.getContext("2d");
  const lado = Math.min(bmp.width, bmp.height); // recorte quadrado, centrado
  g.drawImage(bmp, (bmp.width - lado) / 2, (bmp.height - lado) / 2, lado, lado, 0, 0, LADO, LADO);
  return c;
};

const paraBlob = (canvas, tipo, qualidade) =>
  new Promise((ok) => canvas.toBlob((b) => ok(b), tipo, qualidade));

// Reduz as cores do PNG (mais repetição = arquivo menor) quando passa do limite.
function quantizar(canvas, bits) {
  const g = canvas.getContext("2d");
  const img = g.getImageData(0, 0, LADO, LADO);
  const passo = 1 << (8 - bits);
  for (let i = 0; i < img.data.length; i += 4) {
    img.data[i] = Math.min(255, Math.round(img.data[i] / passo) * passo);
    img.data[i + 1] = Math.min(255, Math.round(img.data[i + 1] / passo) * passo);
    img.data[i + 2] = Math.min(255, Math.round(img.data[i + 2] / passo) * passo);
  }
  g.putImageData(img, 0, 0);
}

export async function converterImagem(arquivo) {
  let bmp;
  try {
    bmp = await createImageBitmap(arquivo, { imageOrientation: "from-image" });
  } catch {
    throw new ErroDeConversao("Não consegui abrir essa imagem.");
  }
  const canvas = canvasPara(bmp);
  bmp.close?.();
  // WebP onde o navegador codifica (Chrome/Android); senão PNG (Safari/iOS).
  for (const q of [0.92, 0.8, 0.65, 0.5, 0.35]) {
    const b = await paraBlob(canvas, "image/webp", q);
    if (!b || b.type !== "image/webp") break;
    if (b.size <= MAX_ESTATICA) return { blob: b, mime: "image/webp", tipo: "static" };
  }
  for (const bits of [8, 6, 5, 4]) {
    if (bits < 8) quantizar(canvas, bits);
    const b = await paraBlob(canvas, "image/png");
    if (b && b.size <= MAX_ESTATICA) return { blob: b, mime: "image/png", tipo: "static" };
  }
  throw new ErroDeConversao("A imagem ficou grande demais para uma figurinha.");
}

async function codificar(arquivo, bitrate, fim, aoProgredir) {
  const input = new Input({ source: new BlobSource(arquivo), formats: ALL_FORMATS });
  const output = new Output({ format: new WebMOutputFormat(), target: new BufferTarget() });
  const conversao = await Conversion.init({
    input,
    output,
    video: { width: LADO, height: LADO, fit: "cover", frameRate: 30, codec: "vp9", bitrate },
    audio: { discard: true },
    trim: { start: 0, end: fim },
    showWarnings: false,
  });
  if (!conversao.isValid) {
    console.warn("Conversão inválida:", conversao.discardedTracks.map((t) => `${t.track.type}: ${t.reason}`));
    throw new ErroDeConversao("Esse vídeo não pode ser convertido neste aparelho.");
  }
  conversao.onProgress = aoProgredir;
  await conversao.execute();
  return output.target.buffer;
}

export async function converterVideo(arquivo, aoProgredir = () => {}) {
  if (!(await podeGerarVideo())) {
    throw new ErroDeConversao("Este aparelho não consegue gerar figurinha de vídeo. Imagens funcionam.");
  }
  let duracao;
  try {
    const input = new Input({ source: new BlobSource(arquivo), formats: ALL_FORMATS });
    duracao = await input.computeDuration();
  } catch {
    throw new ErroDeConversao("Não consegui ler esse vídeo.");
  }
  const fim = Math.min(MAX_SEGUNDOS, duracao);
  let bitrate = 700_000;
  for (let tentativa = 0; tentativa < 6; tentativa++) {
    const buffer = await codificar(arquivo, bitrate, fim, (p) => aoProgredir((tentativa + p) / 6));
    if (buffer.byteLength <= MAX_VIDEO && (buffer.byteLength <= ALVO_VIDEO || tentativa === 5)) {
      return { blob: new Blob([buffer], { type: "video/webm" }), mime: "video/webm", tipo: "video" };
    }
    // o tamanho é quase proporcional à taxa: ajusta direto para o alvo
    bitrate = Math.max(30_000, Math.floor(bitrate * (ALVO_VIDEO / buffer.byteLength) * 0.92));
  }
  throw new ErroDeConversao("O vídeo é complexo demais para caber em 256 KB.");
}

export const ehVideo = (arquivo) => arquivo.type.startsWith("video/");
