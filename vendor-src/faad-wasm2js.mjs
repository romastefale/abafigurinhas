// Converte o FAAD2 (WASM, dentro de @audio/decode-aac) em JavaScript puro com o wasm2js do Binaryen.
// O runtime do Serverless não documenta WebAssembly; o resultado não depende dele.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const gen = path.join(here, '.gen');
fs.mkdirSync(gen, { recursive: true });
const wasmFile = path.join(gen, 'faad.wasm');
const jsFile = path.join(gen, 'faad.wasm2js.js');

// 1. captura o binário que a cola do Emscripten entregaria ao WebAssembly.instantiate
const real = WebAssembly.instantiate;
WebAssembly.instantiate = async (bin, imports) => { fs.writeFileSync(wasmFile, bin); return real(bin, imports); };
const glue = await import(pathToFileURL(path.join(here, 'node_modules/@audio/decode-aac/src/aac.wasm.js')).href);
await glue.default();
WebAssembly.instantiate = real;

// 2. wasm2js com as extensões que o Emscripten usou
const bin = path.join(here, 'node_modules/binaryen/bin/wasm2js');
execFileSync(bin, [wasmFile, '--enable-bulk-memory', '--enable-bulk-memory-opt', '--enable-sign-ext',
  '--enable-nontrapping-float-to-int', '--enable-mutable-globals', '-O2', '-o', jsFile], { stdio: 'inherit' });

// 3. vira uma função: instantiateFaad(imports) -> exports, sem import/export estáticos
let src = fs.readFileSync(jsFile, 'utf8');
src = src.replace(/^import \* as a from 'a';\s*/m, '').replace(/^export var \w+ = retasmFunc\.\w+;\s*$/gm, '');
fs.writeFileSync(jsFile, `export function instantiateFaad(a) {\n${src}\n return retasmFunc;\n}\n`);
console.log('faad.wasm2js.js', (fs.statSync(jsFile).size / 1024).toFixed(0), 'KB');
