// Contêiner Ogg (RFC 3533) com Opus (RFC 7845): OpusHead, OpusTags e os pacotes de áudio.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let r = i << 24;
    for (let k = 0; k < 8; k++) r = r & 0x80000000 ? (r << 1) ^ 0x04c11db7 : r << 1;
    t[i] = r >>> 0;
  }
  return t;
})();

function crc(bytes) {
  let c = 0;
  for (let i = 0; i < bytes.length; i++) c = ((c << 8) ^ CRC_TABLE[((c >>> 24) ^ bytes[i]) & 0xff]) >>> 0;
  return c;
}

const ascii = (s) => Uint8Array.from(s, (ch) => ch.charCodeAt(0));

// Uma página com os pacotes dados (cada um com até 255 segmentos no total da página).
function page(packets, { type, granule, serial, seq }) {
  const lacing = [];
  for (const p of packets) {
    let n = p.length;
    while (n >= 255) { lacing.push(255); n -= 255; }
    lacing.push(n);
  }
  const body = packets.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(27 + lacing.length + body);
  const v = new DataView(out.buffer);
  out.set(ascii('OggS'), 0);
  out[5] = type;
  v.setUint32(6, granule % 4294967296, true);
  v.setUint32(10, Math.floor(granule / 4294967296), true);
  v.setUint32(14, serial, true);
  v.setUint32(18, seq, true);
  out[26] = lacing.length;
  out.set(lacing, 27);
  let o = 27 + lacing.length;
  for (const p of packets) { out.set(p, o); o += p.length; }
  v.setUint32(22, crc(out), true);
  return out;
}

// packets: pacotes Opus de 20 ms (960 amostras a 48 kHz); totalSamples: amostras reais do áudio.
export function oggOpus(packets, { preSkip, totalSamples, sampleRate }) {
  const serial = 0x61626166;
  const head = new Uint8Array(19);
  const hv = new DataView(head.buffer);
  head.set(ascii('OpusHead'), 0);
  head[8] = 1;                        // versão
  head[9] = 1;                        // canais
  hv.setUint16(10, preSkip, true);
  hv.setUint32(12, sampleRate, true); // taxa original, só informativa
  hv.setUint16(16, 0, true);          // ganho
  head[18] = 0;                       // mapeamento de canais
  const vendor = ascii('abafigurinhas');
  const tags = new Uint8Array(8 + 4 + vendor.length + 4);
  const tv = new DataView(tags.buffer);
  tags.set(ascii('OpusTags'), 0);
  tv.setUint32(8, vendor.length, true);
  tags.set(vendor, 12);
  tv.setUint32(12 + vendor.length, 0, true);

  const pages = [
    page([head], { type: 0x02, granule: 0, serial, seq: 0 }),
    page([tags], { type: 0, granule: 0, serial, seq: 1 }),
  ];
  const PER_PAGE = 50;                // 1 s por página
  let seq = 2;
  for (let i = 0; i < packets.length; i += PER_PAGE) {
    const group = packets.slice(i, i + PER_PAGE);
    const last = i + PER_PAGE >= packets.length;
    const granule = last ? totalSamples + preSkip : (i + group.length) * 960;
    pages.push(page(group, { type: last ? 0x04 : 0, granule, serial, seq: seq++ }));
  }
  const size = pages.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(size);
  let o = 0;
  for (const p of pages) { out.set(p, o); o += p.length; }
  return out;
}
