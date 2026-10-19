# vendor-src

Gera `tgcloud/lib/vendor/*.js`: as bibliotecas de áudio do `/convert`, em JavaScript puro (o Serverless só enxerga o
`sdk` e os módulos do projeto, e não documenta WebAssembly). **Não faz parte do deploy** e tem `package.json` próprio,
separado do da raiz (o CI roda `npm ci` só na raiz).

```
cd vendor-src && npm ci && npm run build   # reescreve tgcloud/lib/vendor/{aac,opus,resample}.js
```

| Arquivo gerado | Biblioteca (versão fixa) | Papel | Licença |
|---|---|---|---|
| `aac.js` | FAAD2, via [`@audio/decode-aac`](https://www.npmjs.com/package/@audio/decode-aac) 1.6.0, convertido de WASM para JS com `wasm2js` ([Binaryen](https://github.com/WebAssembly/binaryen) 132) | decodifica AAC (LC e HE) | **GPL-2.0** |
| `opus.js` | libopus 1.4 via [`opusscript`](https://www.npmjs.com/package/opusscript) 0.1.1, build `asm.js` | codifica Opus | MIT (libopus: BSD-3) |
| `resample.js` | [`wave-resampler`](https://www.npmjs.com/package/wave-resampler) 1.0.0 | 44,1 → 48 kHz (o libopus só aceita 8/12/16/24/48 kHz) | MIT |

Escritos neste projeto: `lib/mp4audio.js` (leitura do MP4, ISO/IEC 14496-12), `lib/ogg.js` (Ogg, RFC 3533, com Opus,
RFC 7845), `lib/pcm.js` (mistura em mono e Int16), `lib/voice.js` (encadeia tudo). Parâmetros herdados do bot antigo,
que usava ffmpeg: OGG/Opus, mono, 48 kHz, 96 kbps.

**Licença:** o FAAD2 é GPL-2.0. Usá-lo num bot que você mesmo opera é uma coisa; publicar o repositório com esse código
embutido exige que o repositório seja compatível com a GPL-2.0.
