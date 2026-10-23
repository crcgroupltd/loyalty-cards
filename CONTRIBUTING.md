# Contributing

Thanks for helping improve Loyalty Cards. Bug reports, barcode samples that don't scan, and pull requests are all welcome.

## Before you start

- **Security problems:** don't open a public issue. See [SECURITY.md](SECURITY.md).
- **Bigger changes:** open an issue first to discuss them, so nobody spends time on something that won't be merged.
- **Contributor License Agreement:** every pull request must tick the box confirming you agree to the [CLA](CLA.md).
  - You keep the copyright in your work.
  - CRC Group LTD can license your contribution under the project's license or other licenses, which keeps future licensing options open.
  - Pull requests without the box ticked can't be merged.

## Development

You need Node.js 24 or newer.

```bash
npm install          # also copies browser libraries into public/vendor
cp .env.example .env # set ORIGIN=http://localhost:3000 and a SETUP_TOKEN
npm run dev
npm test
```

Open http://localhost:3000/#/setup and use your `SETUP_TOKEN`.

## Guidelines

- **No build step for the frontend:** `public/` is plain ES modules served as-is. Please keep it that way.
- **Match the surrounding code:** use the same naming, comment density, and the small `h()` DOM helper. Never use `innerHTML` with user data.
- **Barcode changes:**
  - Barcode rules live in `public/formats.js`, shared by server and browser.
  - Add a case to `test/formats.test.js`. It renders each barcode and decodes it back, and the result must match exactly.
- **Server changes:** add tests in `test/` (`node:test`, with `app.inject` via `test/helpers.js`).
- **Third-party code:** don't add code or libraries under a license incompatible with AGPL-3.0. New browser libraries go through `scripts/vendor.js` (never a CDN) and must be listed in `THIRD_PARTY_NOTICES.md`.
- **License headers:** new source files start with:
  ```js
  // SPDX-License-Identifier: AGPL-3.0-or-later
  // Copyright (C) 2026 CRC Group LTD
  ```
- **Run `npm test` before opening a pull request.**

## Reporting a barcode that doesn't scan

Please include:
- the barcode type, if known;
- a sample image with personal numbers changed;
- what the till or scanner did.
