// Lê um MP4/MOV (ISO/IEC 14496-12) e devolve a faixa de áudio AAC: configuração (esds) e quadros brutos.
// Só MP4 "plano" (moov com as tabelas stsz/stsc/stco); vídeo fragmentado (moof) é recusado.

export class Mp4Error extends Error {}

const fourcc = (v, o) => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));

// Caixas filhas em [start, end): { type, start, size, hdr }.
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
const need = (box, what) => {
  if (!box) throw new Mp4Error(`Não encontrei ${what} no vídeo.`);
  return box;
};

// Descritores MPEG-4 do esds: tag, comprimento em formato variável, conteúdo.
function readDescriptor(bytes, o, end) {
  const tag = bytes[o++];
  let len = 0;
  for (let i = 0; i < 4 && o < end; i++) {
    const b = bytes[o++];
    len = (len << 7) | (b & 0x7f);
    if (!(b & 0x80)) break;
  }
  return { tag, start: o, end: Math.min(o + len, end) };
}

// AudioSpecificConfig (tag 0x05) dentro de ES_Descriptor (0x03) > DecoderConfigDescriptor (0x04).
function parseEsds(bytes, box, hdr) {
  const end = box.start + box.size;
  let o = box.start + hdr + 4;   // versão e flags
  const es = readDescriptor(bytes, o, end);
  if (es.tag !== 0x03) throw new Mp4Error('O áudio desse vídeo não é AAC.');
  o = es.start + 2;               // ES_ID
  const flags = bytes[o++];
  if (flags & 0x80) o += 2;
  if (flags & 0x40) o += 1 + bytes[o];
  if (flags & 0x20) o += 2;
  const dc = readDescriptor(bytes, o, es.end);
  if (dc.tag !== 0x04 || bytes[dc.start] !== 0x40) throw new Mp4Error('O áudio desse vídeo não é AAC.');
  const dsi = readDescriptor(bytes, dc.start + 13, dc.end);
  if (dsi.tag !== 0x05) throw new Mp4Error('O áudio desse vídeo não tem configuração AAC.');
  return bytes.subarray(dsi.start, dsi.end);
}

// Devolve { asc, channels, sampleRate, frames: Uint8Array[], duration } ou lança Mp4Error.
export function readAacTrack(bytes) {
  try {
    return ler(bytes);
  } catch (e) {
    // arquivo truncado ou corrompido: a leitura passa do fim e o DataView lança RangeError
    if (e instanceof RangeError) throw new Mp4Error('O arquivo de vídeo está corrompido ou incompleto.');
    throw e;
  }
}

function ler(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const moov = need(find(boxes(view, 0, bytes.length), 'moov'), 'os metadados (moov)');
  const moovKids = kids(view, moov);
  if (find(moovKids, 'mvex')) throw new Mp4Error('Esse formato de vídeo (fragmentado) não é suportado.');

  let mdia = null;
  let mk = null;
  for (const trak of moovKids.filter((b) => b.type === 'trak')) {
    const m = find(kids(view, trak), 'mdia');
    if (!m) continue;
    const k = kids(view, m);
    const hdlr = find(k, 'hdlr');
    if (hdlr && fourcc(view, hdlr.start + hdlr.hdr + 8) === 'soun') { mdia = m; mk = k; break; }
  }
  if (!mdia) throw new Mp4Error('Esse vídeo não tem faixa de áudio.');

  const mdhd = need(find(mk, 'mdhd'), 'o cabeçalho da mídia');
  const p = mdhd.start + mdhd.hdr;
  let timescale, dur;
  if (view.getUint8(p) === 1) { timescale = view.getUint32(p + 20); dur = view.getUint32(p + 24) * 4294967296 + view.getUint32(p + 28); }
  else { timescale = view.getUint32(p + 12); dur = view.getUint32(p + 16); }

  const stbl = need(find(kids(view, need(find(mk, 'minf'), 'a mídia do áudio')), 'stbl'), 'a tabela de amostras');
  const sk = kids(view, stbl);
  const stsd = need(find(sk, 'stsd'), 'a descrição do áudio');
  const entry = stsd.start + stsd.hdr + 8;           // primeira entrada de amostra
  if (fourcc(view, entry + 4) !== 'mp4a') throw new Mp4Error('O áudio desse vídeo não é AAC.');
  const channels = view.getUint16(entry + 8 + 16);
  const sampleRate = view.getUint32(entry + 8 + 24) >>> 16;
  const entryEnd = entry + view.getUint32(entry);
  // o esds fica logo após a entrada de amostra (MP4) ou dentro de um 'wave' (QuickTime): procura pela etiqueta
  let esdsAt = -1;
  for (let i = entry + 36; i + 8 <= entryEnd; i++) {
    if (fourcc(view, i) === 'esds') { esdsAt = i - 4; break; }
  }
  const esds = need(esdsAt < 0 ? null : { start: esdsAt, size: view.getUint32(esdsAt), hdr: 8 }, 'a configuração do AAC');
  const asc = parseEsds(bytes, esds, esds.hdr);

  const stsz = need(find(sk, 'stsz'), 'os tamanhos das amostras');
  const stsc = need(find(sk, 'stsc'), 'o mapa de blocos');
  const stco = find(sk, 'stco');
  const offBox = need(stco || find(sk, 'co64'), 'os offsets dos blocos');
  const wide = !stco;

  const sz = stsz.start + stsz.hdr;
  const fixed = view.getUint32(sz + 4);
  const nSamples = view.getUint32(sz + 8);
  const nChunks = view.getUint32(offBox.start + offBox.hdr + 4);
  const sc = stsc.start + stsc.hdr;
  const nEntries = view.getUint32(sc + 4);
  if (!nSamples || !nChunks || !nEntries) throw new Mp4Error('O áudio desse vídeo está vazio.');

  const frames = [];
  let sample = 0;
  for (let e = 0; e < nEntries; e++) {
    const first = view.getUint32(sc + 8 + e * 12);
    const per = view.getUint32(sc + 12 + e * 12);
    const last = e + 1 < nEntries ? view.getUint32(sc + 8 + (e + 1) * 12) - 1 : nChunks;
    for (let c = first; c <= last; c++) {
      const q = offBox.start + offBox.hdr + 8 + (c - 1) * (wide ? 8 : 4);
      let off = wide ? view.getUint32(q) * 4294967296 + view.getUint32(q + 4) : view.getUint32(q);
      for (let k = 0; k < per && sample < nSamples; k++, sample++) {
        const size = fixed || view.getUint32(sz + 12 + sample * 4);
        if (off + size > bytes.length) throw new Mp4Error('O arquivo de vídeo está incompleto.');
        frames.push(bytes.subarray(off, off + size));
        off += size;
      }
    }
  }
  return { asc, channels, sampleRate, frames, duration: timescale ? dur / timescale : 0 };
}
