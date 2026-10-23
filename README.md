# Loyalty Cards

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

You need Docker and a reverse proxy that serves HTTPS (Caddy, Traefik, Nginx Proxy Manager, …). iOS needs HTTPS for passkeys, the camera and offline mode.

1. Edit `docker-compose.yml`. Set `ORIGIN` to your public URL, exactly as the browser shows it, for example `https://cards.example.com`.
2. Start it:
   ```bash
   docker compose up -d --build
   ```
3. Find your one-time setup token in the logs (unless you set `SETUP_TOKEN`):
   ```bash
   docker compose logs wallet
   ```
4. Open `https://cards.example.com/#/setup` and create the admin account.
5. On your iPhone, open the site in Safari, then tap Share → **Add to Home Screen**. Open it from the Home Screen, go to Settings and tap **Add a passkey**.
6. Invite the rest of the household: Settings → Household and invites → **Create invite link**.

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

Everything lives in `./data`: `wallet.db` (SQLite) plus `logos/`. To back up while the app runs:

```bash
sqlite3 data/wallet.db ".backup data/wallet-backup.db"
```

Or stop the container and copy the folder. Each user can also export their own cards as JSON from Settings.

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
