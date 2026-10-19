// Extrai a faixa de áudio AAC de um MP4/MOV e a reempacota como M4A, sem recodificar.
// O runtime não tem ffmpeg; o Telegram aceita M4A em sendVoice. Só lê MP4 "plano" (não fragmentado).

export class M4aError extends Error {}

const fourcc = (v, o) => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));

// Lista as caixas filhas em [start, end): { type, start, size, hdr } (hdr = bytes do cabeçalho).
function boxes(view, start, end) {
  const out = [];
  let o = start;
  while (o + 8 <= end) {
    let size = view.getUint32(o);
    const type = fourcc(view, o + 4);
    let hdr = 8;
    if (size === 1) {
      if (o + 16 > end) break;
      size = view.getUint32(o + 8) * 4294967296 + view.getUint32(o + 12);
      hdr = 16;
    } else if (size === 0) {
      size = end - o;
    }
    if (size < hdr || o + size > end) break;
    out.push({ type, start: o, size, hdr });
    o += size;
  }
  return out;
}

const find = (list, type) => list.find((b) => b.type === type);
const kids = (view, b) => boxes(view, b.start + b.hdr, b.start + b.size);

// 'mp4a' também serve para MP3 e outros; o tipo de objeto no esds (0x40) distingue o AAC.
function isAac(bytes, view, stsd) {
  const end = stsd.start + stsd.size;
  for (let i = stsd.start; i + 8 < end; i++) {
    if (fourcc(view, i) !== 'esds') continue;
    for (let j = i + 8; j + 2 < end && j < i + 64; j++) {
      if (bytes[j] !== 0x04) continue;   // DecoderConfigDescriptor
      let k = j + 1;
      while (k < end && (bytes[k] & 0x80)) k++;   // comprimento em formato variável
      return bytes[k + 1] === 0x40;
    }
  }
  return false;
}

function need(box, what) {
  if (!box) throw new M4aError(`Não encontrei ${what} no vídeo.`);
  return box;
}

// Devolve { m4a: Uint8Array, duration: segundos } ou lança M4aError.
export function extractM4a(bytes) {
  try {
    return extrair(bytes);
  } catch (e) {
    // arquivo truncado ou corrompido: a leitura passa do fim e o DataView lança RangeError
    if (e instanceof RangeError) throw new M4aError('O arquivo de vídeo está corrompido ou incompleto.');
    throw e;
  }
}

function extrair(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const top = boxes(view, 0, bytes.length);
  const moov = need(find(top, 'moov'), 'os metadados (moov)');
  const moovKids = kids(view, moov);
  if (find(moovKids, 'mvex')) throw new M4aError('Esse formato de vídeo (fragmentado) não é suportado.');
  const mvhd = need(find(moovKids, 'mvhd'), 'o cabeçalho do filme');

  let audio = null;
  for (const trak of moovKids.filter((b) => b.type === 'trak')) {
    const mdia = find(kids(view, trak), 'mdia');
    if (!mdia) continue;
    const mk = kids(view, mdia);
    const hdlr = find(mk, 'hdlr');
    if (hdlr && fourcc(view, hdlr.start + hdlr.hdr + 8) === 'soun') { audio = { trak, mdia, mk }; break; }
  }
  if (!audio) throw new M4aError('Esse vídeo não tem faixa de áudio.');

  const mdhd = need(find(audio.mk, 'mdhd'), 'o cabeçalho da mídia');
  const p = mdhd.start + mdhd.hdr;
  let timescale, dur;
  if (view.getUint8(p) === 1) { timescale = view.getUint32(p + 20); dur = view.getUint32(p + 24) * 4294967296 + view.getUint32(p + 28); }
  else { timescale = view.getUint32(p + 12); dur = view.getUint32(p + 16); }
  const duration = timescale ? dur / timescale : 0;

  const minf = need(find(audio.mk, 'minf'), 'a mídia do áudio');
  const stbl = need(find(kids(view, minf), 'stbl'), 'a tabela de amostras');
  const sk = kids(view, stbl);
  const stsd = need(find(sk, 'stsd'), 'a descrição do áudio');
  if (fourcc(view, stsd.start + stsd.hdr + 8 + 4) !== 'mp4a' || !isAac(bytes, view, stsd)) {
    throw new M4aError('O áudio desse vídeo não é AAC.');
  }
  const stsz = need(find(sk, 'stsz'), 'os tamanhos das amostras');
  const stsc = need(find(sk, 'stsc'), 'o mapa de blocos');
  const stco = find(sk, 'stco');
  const co64 = find(sk, 'co64');
  const offBox = need(stco || co64, 'os offsets dos blocos');

  // tamanhos das amostras
  const sz = stsz.start + stsz.hdr;
  const fixed = view.getUint32(sz + 4);
  const nSamples = view.getUint32(sz + 8);
  const sampleSize = (i) => (fixed ? fixed : view.getUint32(sz + 12 + i * 4));
  // blocos (chunks)
  const nChunks = view.getUint32(offBox.start + offBox.hdr + 4);
  const wide = !stco;
  const chunkOff = (i) => {
    const q = offBox.start + offBox.hdr + 8 + i * (wide ? 8 : 4);
    return wide ? view.getUint32(q) * 4294967296 + view.getUint32(q + 4) : view.getUint32(q);
  };
  const sc = stsc.start + stsc.hdr;
  const nEntries = view.getUint32(sc + 4);
  if (!nSamples || !nChunks || !nEntries) throw new M4aError('O áudio desse vídeo está vazio.');

  const parts = [];
  const sizes = [];
  let sample = 0;
  let total = 0;
  for (let e = 0; e < nEntries; e++) {
    const first = view.getUint32(sc + 8 + e * 12);
    const per = view.getUint32(sc + 12 + e * 12);
    const last = e + 1 < nEntries ? view.getUint32(sc + 8 + (e + 1) * 12) - 1 : nChunks;
    for (let c = first; c <= last; c++) {
      let size = 0;
      for (let k = 0; k < per && sample < nSamples; k++, sample++) size += sampleSize(sample);
      const off = chunkOff(c - 1);
      if (off + size > bytes.length) throw new M4aError('O arquivo de vídeo está incompleto.');
      parts.push(bytes.subarray(off, off + size));
      sizes.push(size);
      total += size;
    }
  }

  // moov novo = mvhd + trak de áudio (cópia, com os offsets reescritos)
  const trakCopy = bytes.slice(audio.trak.start, audio.trak.start + audio.trak.size);
  const tv = new DataView(trakCopy.buffer);
  const mvhdBytes = bytes.subarray(mvhd.start, mvhd.start + mvhd.size);
  const ftyp = new Uint8Array([
    0, 0, 0, 28, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20, 0, 0, 0, 0,
    0x4d, 0x34, 0x41, 0x20, 0x6d, 0x70, 0x34, 0x32, 0x69, 0x73, 0x6f, 0x6d,
  ]);
  const moovSize = 8 + mvhdBytes.length + trakCopy.length;
  let pos = ftyp.length + moovSize + 8; // início dos dados dentro do mdat
  const base = offBox.start + offBox.hdr + 8 - audio.trak.start;
  for (let i = 0; i < nChunks; i++) {
    if (wide) { tv.setUint32(base + i * 8, Math.floor(pos / 4294967296)); tv.setUint32(base + i * 8 + 4, pos >>> 0); }
    else tv.setUint32(base + i * 4, pos);
    pos += sizes[i];
  }

  const out = new Uint8Array(ftyp.length + moovSize + 8 + total);
  const ov = new DataView(out.buffer);
  out.set(ftyp, 0);
  let o = ftyp.length;
  ov.setUint32(o, moovSize); out.set([0x6d, 0x6f, 0x6f, 0x76], o + 4); o += 8; // moov
  out.set(mvhdBytes, o); o += mvhdBytes.length;
  out.set(trakCopy, o); o += trakCopy.length;
  ov.setUint32(o, 8 + total); out.set([0x6d, 0x64, 0x61, 0x74], o + 4); o += 8; // mdat
  for (const part of parts) { out.set(part, o); o += part.length; }
  return { m4a: out, duration };
}
