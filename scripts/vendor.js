// Copies browser builds of client libraries into public/vendor so the app
// never loads code from a CDN.
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const nm = join(root, 'node_modules');
const out = join(root, 'public', 'vendor');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const jsOnly = (src) => !/\.(d\.ts|map)$/.test(src);

// [source in node_modules, destination in public/vendor]
const copies = [
  ['bwip-js/dist/bwip-js.mjs', 'bwip-js/bwip-js.mjs'],
  ['bwip-js/dist/bwipp.mjs', 'bwip-js/bwipp.mjs'],
  ['zxing-wasm/dist/es/share.js', 'zxing/share.js'],
  ['zxing-wasm/dist/es/reader/index.js', 'zxing/reader/index.js'],
  ['zxing-wasm/dist/reader/zxing_reader.wasm', 'zxing/zxing_reader.wasm'],
  ['@simplewebauthn/browser/esm', 'simplewebauthn'],
];

for (const [src, dest] of copies) {
  mkdirSync(dirname(join(out, dest)), { recursive: true });
  cpSync(join(nm, src), join(out, dest), { recursive: true, filter: jsOnly });
}
console.log(`vendored ${copies.length} entries into public/vendor`);
