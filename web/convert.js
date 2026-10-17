// Conversão no aparelho: nada sai do celular até a figurinha estar pronta.
// Imagem -> WebP/PNG 512x512 (até 512 KB). Vídeo -> WebM VP9 512x512, sem áudio, até 3 s e 256 KB.
// O contorno (square, rounded, squircle) vira transparência nos cantos.
import {
  Input, Output, Conversion, BlobSource, BufferTarget, WebMOutputFormat, ALL_FORMATS, canEncodeVideo,
} from "./vendor/mediabunny.min.mjs";

const LADO = 512;
const MAX_ESTATICA = 512 * 1024;
const MAX_VIDEO = 256 * 1024;
const ALVO_VIDEO = 240 * 1024; // folga para o contêiner e variação do controle de taxa
const MAX_SEGUNDOS = 3;
const RAIO_ARREDONDADO = 0.14 * LADO; // 14% do lado
const EXPOENTE_SQUIRCLE = 4; // |x|^4 + |y|^4 = 1

export const FORMAS = ["square", "rounded", "squircle"];

export class ErroDeConversao extends Error {}

export async function podeGerarVideo() {
  try {
    return await canEncodeVideo("vp9", { width: LADO, height: LADO });
  } catch {
    return false;
  }
}

// Contorno como Path2D no quadrado LADO x LADO; null = sem recorte (cantos vivos, opaco).
export function contorno(forma) {
  if (forma === "rounded") {
    const r = RAIO_ARREDONDADO, l = LADO, p = new Path2D();
    p.moveTo(r, 0);
    p.arcTo(l, 0, l, l, r);
    p.arcTo(l, l, 0, l, r);
    p.arcTo(0, l, 0, 0, r);
    p.arcTo(0, 0, l, 0, r);
    p.closePath();
    return p;
  }
  if (forma === "squircle") {
    const p = new Path2D(), n = EXPOENTE_SQUIRCLE, passos = 360, m = LADO / 2;
    for (let i = 0; i < passos; i++) {
      const t = (i / passos) * 2 * Math.PI, c = Math.cos(t), s = Math.sin(t);
      const x = m + Math.sign(c) * Math.pow(Math.abs(c), 2 / n) * m;
      const y = m + Math.sign(s) * Math.pow(Math.abs(s), 2 / n) * m;
      if (i) p.lineTo(x, y); else p.moveTo(x, y);
    }
    p.closePath();
    return p;
  }
  return null;
}

// Mesma curva do contorno, em coordenadas 0..1 (para o clip-path da prévia).
export function caminhoSquirclePrevia() {
  const n = EXPOENTE_SQUIRCLE, passos = 180, pontos = [];
  for (let i = 0; i < passos; i++) {
    const t = (i / passos) * 2 * Math.PI, c = Math.cos(t), s = Math.sin(t);
    const x = 0.5 + Math.sign(c) * Math.pow(Math.abs(c), 2 / n) * 0.5;
    const y = 0.5 + Math.sign(s) * Math.pow(Math.abs(s), 2 / n) * 0.5;
    pontos.push(`${i ? "L" : "M"}${x.toFixed(4)} ${y.toFixed(4)}`);
  }
  return `${pontos.join("")}Z`;
}

const canvasPara = (bmp, forma) => {
  const c = document.createElement("canvas");
  c.width = c.height = LADO;
  const g = c.getContext("2d");
  const recorte = contorno(forma);
  if (recorte) g.clip(recorte);
  const lado = Math.min(bmp.width, bmp.height); // recorte quadrado, centrado
  g.drawImage(bmp, (bmp.width - lado) / 2, (bmp.height - lado) / 2, lado, lado, 0, 0, LADO, LADO);
  return c;
};

const paraBlob = (canvas, tipo, qualidade) =>
  new Promise((ok) => canvas.toBlob((b) => ok(b), tipo, qualidade));

// Reduz as cores do PNG (mais repetição = arquivo menor) quando passa do limite. O alpha fica como está.
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

export async function converterImagem(arquivo, forma = "square") {
  let bmp;
  try {
    bmp = await createImageBitmap(arquivo, { imageOrientation: "from-image" });
  } catch {
    throw new ErroDeConversao("Não consegui abrir essa imagem.");
  }
  const canvas = canvasPara(bmp, forma);
  bmp.close?.();
  // WebP onde o navegador codifica (Chrome/Android); senão PNG (Safari/iOS). Ambos guardam transparência.
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

async function codificar(arquivo, bitrate, fim, forma) {
  const input = new Input({ source: new BlobSource(arquivo), formats: ALL_FORMATS });
  const output = new Output({ format: new WebMOutputFormat(), target: new BufferTarget() });
  const video = { width: LADO, height: LADO, fit: "cover", frameRate: 30, codec: "vp9", bitrate };
  const recorte = contorno(forma);
  if (recorte) {
    // cada quadro é redesenhado dentro do contorno; o que fica fora vira transparência (VP9 com alpha)
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = LADO;
    const g = canvas.getContext("2d");
    Object.assign(video, {
      alpha: "keep",
      processedWidth: LADO,
      processedHeight: LADO,
      process: (amostra) => {
        g.clearRect(0, 0, LADO, LADO);
        g.save();
        g.clip(recorte);
        amostra.draw(g, 0, 0, LADO, LADO);
        g.restore();
        return canvas;
      },
    });
  }
  const conversao = await Conversion.init({
    input,
    output,
    video,
    audio: { discard: true },
    trim: { start: 0, end: fim },
    showWarnings: false,
  });
  if (!conversao.isValid) {
    console.warn("Conversão inválida:", conversao.discardedTracks.map((t) => `${t.track.type}: ${t.reason}`));
    throw new ErroDeConversao("Esse vídeo não pode ser convertido neste aparelho.");
  }
  await conversao.execute();
  return output.target.buffer;
}

export async function converterVideo(arquivo, forma = "square") {
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
    const buffer = await codificar(arquivo, bitrate, fim, forma);
    if (buffer.byteLength <= MAX_VIDEO && (buffer.byteLength <= ALVO_VIDEO || tentativa === 5)) {
      return { blob: new Blob([buffer], { type: "video/webm" }), mime: "video/webm", tipo: "video" };
    }
    // o tamanho é quase proporcional à taxa: ajusta direto para o alvo
    bitrate = Math.max(30_000, Math.floor(bitrate * (ALVO_VIDEO / buffer.byteLength) * 0.92));
  }
  throw new ErroDeConversao("O vídeo é complexo demais para caber em 256 KB.");
}

export const ehVideo = (arquivo) => arquivo.type.startsWith("video/");
