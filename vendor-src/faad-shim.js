// Substitui src/aac.wasm.js do @audio/decode-aac: mesma cola do Emscripten, mas o módulo é o wasm2js.
import createAAC from '@audio/decode-aac/src/aac.wasm.js';
import { instantiateFaad } from './.gen/faad.wasm2js.js';

if (typeof WebAssembly === 'undefined') globalThis.WebAssembly = { RuntimeError: Error };

export default function () {
  return createAAC({
    instantiateWasm(info, receive) {
      receive({ exports: instantiateFaad(info.a) });
      return {};
    },
  });
}
