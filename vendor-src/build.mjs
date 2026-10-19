import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, '..', 'tgcloud', 'lib', 'vendor');

// módulos de Node que só os caminhos de dispositivo/arquivo usam; no isolate não existem
const stubNode = {
  name: 'stub-node',
  setup(b) {
    b.onResolve({ filter: /^(fs|path|http|https|stream|speaker|url|os|util)$/ }, (a) => ({ path: a.path, namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'module.exports = {};', loader: 'js' }));
  },
};

const common = {
  bundle: true, format: 'esm', platform: 'neutral', mainFields: ['main'], target: 'es2019',
  plugins: [stubNode], logLevel: 'warning', legalComments: 'inline', define: { global: 'globalThis' },
  banner: { js: '/* Gerado por vendor-src/build.mjs; não edite à mão. */' },
};

// o decodificador AAC usa o módulo wasm2js no lugar do .wasm (ver faad-shim.js)
const swapWasm = {
  name: 'swap-wasm',
  setup(b) {
    b.onResolve({ filter: /aac\.wasm\.js$/ }, (a) => (a.importer.includes('faad-shim') ? undefined : { path: path.join(here, 'faad-shim.js') }));
    b.onResolve({ filter: /^@audio\/decode-aac\/src\/aac\.wasm\.js$/ }, () => ({ path: path.join(here, 'node_modules/@audio/decode-aac/src/aac.wasm.js') }));
  },
};
await build({ ...common, plugins: [stubNode, swapWasm], entryPoints: [path.join(here, 'aac-entry.js')], outfile: path.join(out, 'aac.js'), minify: true });
await build({ ...common, entryPoints: [path.join(here, 'opus-entry.js')], outfile: path.join(out, 'opus.js'), minify: true });
await build({ ...common, entryPoints: [path.join(here, 'resample-entry.js')], outfile: path.join(out, 'resample.js'), mainFields: ['module', 'main'] });
