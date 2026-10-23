# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 CRC Group LTD
FROM node:24-slim

LABEL org.opencontainers.image.title="Loyalty Cards" \
      org.opencontainers.image.description="Self-hosted loyalty card wallet" \
      org.opencontainers.image.source="https://github.com/crcgroupltd/loyalty-cards" \
      org.opencontainers.image.licenses="AGPL-3.0-or-later" \
      org.opencontainers.image.vendor="CRC Group LTD"

ENV NODE_ENV=production \
    DATA_DIR=/data \
    PORT=3000

WORKDIR /app

# Dependencies first for better layer caching. Install scripts are skipped:
# better-sqlite3 ships prebuilt binaries for linux x64/arm64 and loads them at
# runtime, but npm would otherwise try to compile it (no compiler in this
# image). The vendor step below replaces our own postinstall script.
COPY package.json package-lock.json LICENSE THIRD_PARTY_NOTICES.md ./
COPY scripts ./scripts
COPY licenses ./licenses
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force \
 && node -e "require('better-sqlite3')(':memory:').close()"

COPY server ./server
COPY public ./public
RUN node scripts/vendor.js && node scripts/make-icons.js

RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:3000/api/status').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/index.js"]
