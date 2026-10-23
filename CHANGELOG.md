# Changelog

All notable changes to this project are listed here. Versions follow [Semantic Versioning](https://semver.org/).

## 0.1.1 (2026-10-22)

- **New image location:** the project moved to the `crcgroupltd` GitHub account. The image is now `ghcr.io/crcgroupltd/loyalty-cards`; update the `image:` line if your compose file still says `bossmanc0`.
- **Fixed:** the Docker image build no longer tries to compile SQLite, which failed in the slim base image.
- **Links:** the in-app "Source code" link, README and other project links point to the new account.

## 0.1.0 (2026-10-22)

First public version.

- **Barcodes:** 13 barcode types (QR, Aztec, Data Matrix, PDF417, Code 128/39/93, EAN-13/8, UPC-A/E, ITF, Codabar), stored and redrawn with their exact value.
- **Adding cards:** camera scanning, photo reading, and bulk import from screenshots (for moving off Klarna/Stocard).
- **Catima:** import of Catima exports, plus JSON export of your own cards.
- **Household accounts:** invite-only, passkeys with a password fallback, per-card sharing, favourites.
- **Offline:** read-only offline mode on the phone.
- **Logos:** optional store logos through logo.dev, downloaded and served by your own server.
- **Self-hosting:** Docker image published to `ghcr.io/crcgroupltd/loyalty-cards` (amd64 + arm64), with data in a named volume.
