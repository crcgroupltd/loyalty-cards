# Third-party notices

Loyalty Cards is licensed under the GNU Affero General Public License v3.0 or later (see `LICENSE`). It includes or depends on the third-party software listed below, each under its own license. Those licenses apply to those components, not to this project's own code.

## Shipped to the browser

`npm install` copies these into `public/vendor/`, together with their license files, and they are served to users' browsers.

| Component | License | Notes |
|---|---|---|
| [bwip-js](https://github.com/metafloor/bwip-js) | MIT | Barcode rendering. Includes BWIPP (Barcode Writer in Pure PostScript, MIT). License in `public/vendor/bwip-js/LICENSE`. |
| Inconsolata font (embedded in bwip-js) | SIL Open Font License 1.1 | `public/vendor/bwip-js/LICENSE.INCONSOLATA` |
| [zxing-wasm](https://github.com/Sec-ant/zxing-wasm) | MIT | Barcode scanning. `public/vendor/zxing/LICENSE` |
| [zxing-cpp](https://github.com/zxing-cpp/zxing-cpp) (compiled into `zxing_reader.wasm`) | Apache License 2.0 | `public/vendor/zxing/LICENSE.zxing-cpp`; full text also in `licenses/Apache-2.0.txt`. Its image loading uses stb_image (public domain / MIT). |
| [@simplewebauthn/browser](https://github.com/MasterKale/SimpleWebAuthn) | MIT | Passkey sign-in. `public/vendor/simplewebauthn/LICENSE.md` |

## Server dependencies

Installed from npm, not redistributed in this repository. Their license texts are in `node_modules/<package>/` and in the Docker image.

| Package | License |
|---|---|
| fastify, @fastify/cookie, @fastify/multipart, @fastify/rate-limit, @fastify/static | MIT |
| better-sqlite3 (bundles SQLite, public domain) | MIT |
| @simplewebauthn/server | MIT |
| @node-rs/argon2 | MIT |
| fflate | MIT |
| bwip-js, zxing-wasm (also used by the tests) | MIT |

Transitive dependencies can be listed with `npx license-checker --production --summary`.
