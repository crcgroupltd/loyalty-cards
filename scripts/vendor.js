// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 CRC Group LTD

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
  // License texts ship next to the code they cover (see THIRD_PARTY_NOTICES.md).
  ['bwip-js/LICENSE', 'bwip-js/LICENSE'],
  ['bwip-js/LICENSE.INCONSOLATA', 'bwip-js/LICENSE.INCONSOLATA'],
  ['zxing-wasm/LICENSE', 'zxing/LICENSE'],
  ['@simplewebauthn/browser/LICENSE.md', 'simplewebauthn/LICENSE.md'],
];

for (const [src, dest] of copies) {
  mkdirSync(dirname(join(out, dest)), { recursive: true });
  cpSync(join(nm, src), join(out, dest), { recursive: true, filter: jsOnly });
}
// The zxing wasm build contains zxing-cpp (Apache-2.0), whose license text
// the npm package does not include.
cpSync(join(root, 'licenses', 'Apache-2.0.txt'), join(out, 'zxing', 'LICENSE.zxing-cpp'));
cpSync(join(root, 'THIRD_PARTY_NOTICES.md'), join(out, 'THIRD_PARTY_NOTICES.md'));
console.log(`vendored ${copies.length} entries into public/vendor`);
