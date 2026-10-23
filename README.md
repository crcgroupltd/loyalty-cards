# Loyalty Cards

[![License: AGPL-3.0-or-later](https://img.shields.io/badge/license-AGPL--3.0--or--later-blue.svg)](LICENSE)

A small self-hosted wallet for store loyalty cards, built for iPhone (it works on any phone). It is a web app you add to your Home Screen. It has no tracking, no ads, and no third-party calls from your phone.

- **Exact barcodes:** each card keeps its own symbology and its exact value. Supported types are QR, Aztec, Data Matrix, PDF417, Code 128, Code 39, Code 93, EAN-13, EAN-8, UPC-A, UPC-E, ITF and Codabar.
- **Adding cards:** scan with the camera, read a photo or screenshot, or type the number in.
- **Bulk import:**
  - Screenshots, for moving off Klarna/Stocard.
  - Catima exports, from Android users.
- **Household:** invite-only accounts, sign-in with passkeys (Face ID) or a password, and per-card sharing.
- **Works offline:** cards are saved on the phone, so they show in a store with no signal.
- **Optional logos:** found by store name and stored on your server.

## Run it

You need Docker and a reverse proxy that serves HTTPS (Caddy, Traefik, Nginx Proxy Manager, …). iOS needs HTTPS for passkeys, the camera and offline mode. There is no published image yet, so Docker builds it from source.

1. Get the code:
   ```bash
   git clone https://github.com/BossManC0/loyalty-cards.git
   ```
   Then work inside the new `loyalty-cards` folder.
2. Edit `docker-compose.yml`. Set `ORIGIN` to your public URL, exactly as the browser shows it, for example `https://cards.example.com`.
3. Start it:
   ```bash
   docker compose up -d --build
   ```
4. Find your one-time setup token in the logs (unless you set `SETUP_TOKEN`):
   ```bash
   docker compose logs wallet
   ```
5. Open `https://cards.example.com/#/setup` and create the admin account.
6. On your iPhone, open the site in Safari, then tap Share → **Add to Home Screen**. Open it from the Home Screen, go to Settings and tap **Add a passkey**.
7. Invite the rest of the household: Settings → Household and invites → **Create invite link**.

### Caddy example

```
cards.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

Any proxy works if it passes `Host` and sets `X-Forwarded-For` / `X-Forwarded-Proto`. Set `TRUST_PROXY` to match your proxy:
- `1`: one proxy hop.
- The proxy's IP or CIDR, if the proxy runs in another container.

Rate limiting uses the client IP, so this matters.

## Settings

| Variable | Purpose |
|---|---|
| `ORIGIN` | Public URL. Required in production. Passkeys and the CSRF check are bound to it. |
| `RP_ID` | Passkey domain. Defaults to `ORIGIN`'s hostname. |
| `SETUP_TOKEN` | Token for creating the first admin. If unset, a random one is logged on start until setup is done. |
| `TRUST_PROXY` | `true`, a hop count, or proxy IPs/CIDRs. |
| `LOGO_API_KEY` | Optional [logo.dev](https://www.logo.dev) **secret** key (`sk_…`). Enables logo search. |
| `SOURCE_URL` | Source-code link shown in the app. Defaults to this repository. **If you run a modified version, set it to your modified source** (AGPL-3.0 §13). |
| `DATA_DIR` | Where the database and logos live (`/data` in Docker). |
| `PORT` | Defaults to `3000`. |

## Moving your cards in

**From Klarna:**
1. In Klarna, open each card and take a screenshot.
2. In this app, tap the import icon → **Choose screenshots** and select them all.
3. Each barcode is read on your phone. Type a store name for each, then tap **Add**.

Screenshots with no readable barcode are flagged so you can type the number in or skip them.

**From Catima (Android):**
1. In Catima, go to Settings → Export and leave the password empty. Password-protected exports can't be read.
2. Import the `.zip` here and review the cards before adding them.

**Physical cards:** tap **+** → **Scan**.

## Logos

With `LOGO_API_KEY` set:
- The edit screen gets a **Find logo** button.
- Bulk import can pick logos automatically.

The server sends **only the store name** to logo.dev. It downloads the logo through logo.dev's brand-logo API, which is their supported route for storing logos yourself, and serves it from your own server. Logo files are sniffed and must be PNG, JPEG or WebP; SVG is refused. Downloads are limited to https and public IP addresses, with size and time limits.

## Backups

Everything lives in the Docker volume `loyalty-cards-data`, mounted at `/data`: `wallet.db` (SQLite) plus `logos/`. It survives rebuilds and `docker compose down`, but `docker compose down -v` deletes it.

To take a consistent snapshot of the database while the app runs:

```bash
docker compose exec wallet node -e "require('better-sqlite3')('/data/wallet.db').backup('/data/wallet-backup.db').then(() => console.log('done'))"
```

Then copy the snapshot and the logos out of the container:

```bash
docker compose cp wallet:/data/wallet-backup.db ./wallet-backup.db
```

```bash
docker compose cp wallet:/data/logos ./logos-backup
```

To restore, stop the app, copy the file back as `/data/wallet.db`, and start it again. Each user can also export their own cards as JSON from Settings.

## Notes and limits

- **Brightness:** web apps can't change screen brightness on iOS. Turn it up if a scanner struggles. The barcode is always black on white, even in dark mode.
- **Keeping the screen on:** the screen stays awake while a card is open, on iOS 18.4 and newer from the Home Screen.
- **Offline:** offline mode is read-only. Adding, editing or sharing needs a connection.
- **UPC-A:** a UPC-A barcode is bar-for-bar the same as an EAN-13 starting with `0`. A scan may label it either way; tills read the same number.
- **Codabar:** cards imported without start/stop characters are drawn with `A…A`, as most Codabar writers do.
- **Apple Wallet:** not supported. Wallet can't show EAN/UPC, which most grocery cards use.

## Development

```bash
npm install          # also copies browser libraries into public/vendor
cp .env.example .env # set ORIGIN=http://localhost:3000 and a SETUP_TOKEN
npm run dev
npm test
```

The tests include an encode→decode round trip for every barcode type. Each barcode is drawn with bwip-js (the renderer the app uses) and read back with zxing-wasm (the scanner the app uses), and the test requires the exact same type and value.

Layout:
- `server/`: Fastify API with SQLite.
- `public/`: the PWA, plain ES modules with no build step.
- `public/formats.js`: the barcode rules, shared by server and browser.

## Contributing and security

- **Contributing:** contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md). Pull requests require agreeing to the [Contributor License Agreement](CLA.md).
- **Security:** please report security problems privately, as described in [SECURITY.md](SECURITY.md).

## Legal

**License.** Copyright (C) 2026 CRC Group LTD. This program is free software: you can redistribute it and/or modify it under the terms of the [GNU Affero General Public License](LICENSE) as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version.

If you run a modified version for other people over a network, the AGPL requires you to offer them your modified source. Set `SOURCE_URL` to point at it. For other licensing arrangements, contact CRC Group LTD.

**No warranty.** This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See sections 15 and 16 of the [license](LICENSE), "Disclaimer of Warranty" and "Limitation of Liability". In short:
- you use this software at your own risk;
- CRC Group LTD is not liable for lost data, rejected cards at a till, or any other damage.

**No affiliation.** This project is independent. It is not affiliated with, endorsed by, or sponsored by Klarna, Stocard, Catima, logo.dev, Apple, or any retailer or loyalty program. Their names are used only to describe compatibility. All trademarks, including store names and logos, belong to their owners.

**Store logos.** Logos are fetched only when a user asks for them, to help that user recognise their own cards. Instances that turn on logo search must follow logo.dev's terms, including any attribution its plan requires.

**Your data.** The project collects nothing and has no telemetry. Whoever runs an instance controls the data stored on it and is responsible for:
- securing that data;
- backing it up;
- meeting any privacy obligations towards the people who use it.

Bundled third-party components and their licenses are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
