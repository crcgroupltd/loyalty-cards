// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 CRC Group LTD

// Store logos, found by store name through a logo provider and downloaded by
// the server. Phones only ever load logos from this server.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { requireUser } from './auth.js';
import { ownedCard } from './cards.js';
import { safeFetch } from './ssrf.js';

const FILE_RE = /^[a-f0-9]{64}\.(png|jpg|webp)$/;
const CONTENT_TYPES = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' };
const CANDIDATES = 4;

// Identifies an image by its magic bytes. SVG is deliberately not accepted.
export function sniffImage(buf) {
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}

// logo.dev: search by name, then download through the brand logo API, which
// is the route their terms allow for storing logos yourself.
export function logoDevProvider(apiKey, fetcher = safeFetch) {
  const auth = { authorization: `Bearer ${apiKey}` };
  const getJson = async (url) => {
    const res = await fetcher(url, { headers: auth });
    if (res.status !== 200) throw new Error(`logo.dev responded ${res.status}`);
    return JSON.parse(res.body.toString('utf8'));
  };
  return {
    async search(query) {
      const json = await getJson(`https://api.logo.dev/v2/search?q=${encodeURIComponent(query)}&limit=${CANDIDATES}`);
      return (json.data ?? []).map((d) => ({ name: d.name, domain: d.domain })).filter((d) => d.domain);
    },
    async download(domain) {
      const json = await getJson(`https://api.logo.dev/v2/brands/logo?domain=${encodeURIComponent(domain)}`);
      if (!json.data?.url) return null;
      const url = new URL(json.data.url);
      url.searchParams.set('format', 'png');
      url.searchParams.set('size', '256');
      const res = await fetcher(url.href);
      if (res.status !== 200) return null;
      return res.body;
    },
  };
}

export function releaseLogo(app, file) {
  if (!file || !app.logoDir) return;
  const used = app.db.prepare('SELECT 1 FROM cards WHERE logo_file = ? LIMIT 1').get(file);
  if (!used) {
    try {
      unlinkSync(join(app.logoDir, file));
    } catch {}
  }
}

export async function logoRoutes(app, { provider } = {}) {
  const { db, config, logoDir } = app;
  provider ??= config.logoApiKey && config.logoProvider === 'logodev' ? logoDevProvider(config.logoApiKey) : null;

  const saveImage = (buf) => {
    const ext = sniffImage(buf);
    if (!ext || !logoDir) return null;
    const file = `${createHash('sha256').update(buf).digest('hex')}.${ext}`;
    const path = join(logoDir, file);
    if (!existsSync(path)) writeFileSync(path, buf);
    return file;
  };

  // Search results download candidate logos before one is picked; remove
  // the ones nobody chose once they are a day old.
  app.addHook('onReady', async () => {
    if (!logoDir) return;
    const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
    const used = new Set(db.prepare('SELECT logo_file FROM cards WHERE logo_file IS NOT NULL').all().map((r) => r.logo_file));
    for (const file of readdirSync(logoDir)) {
      if (!used.has(file) && statSync(join(logoDir, file)).mtimeMs < dayAgo) unlinkSync(join(logoDir, file));
    }
  });

  app.get('/api/logos/search', { preHandler: requireUser, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (request, reply) => {
    if (!provider) return reply.code(404).send({ error: 'Logo search is not configured' });
    const q = String(request.query.q ?? '').trim();
    if (!q || q.length > 60) return reply.code(400).send({ error: 'Search for 1 to 60 characters' });
    let found;
    try {
      found = await provider.search(q);
    } catch (e) {
      request.log.warn({ err: e }, 'logo search failed');
      return reply.code(502).send({ error: 'Logo search failed' });
    }
    const results = await Promise.all(
      found.slice(0, CANDIDATES).map(async (c) => {
        try {
          const buf = await provider.download(c.domain);
          const file = buf && saveImage(buf);
          return file ? { name: c.name, domain: c.domain, file, logo_url: `/api/logos/${file}` } : null;
        } catch (e) {
          request.log.info({ err: e, domain: c.domain }, 'logo download failed');
          return null;
        }
      }),
    );
    return { results: results.filter(Boolean) };
  });

  app.put('/api/cards/:id/logo', { preHandler: requireUser }, async (request, reply) => {
    const id = Number.parseInt(request.params.id, 10);
    const card = ownedCard(db, request.user.id, id);
    if (!card) return reply.code(404).send({ error: 'Card not found or not yours' });
    const { file, domain } = request.body ?? {};
    if (file !== null && !(typeof file === 'string' && FILE_RE.test(file) && logoDir && existsSync(join(logoDir, file)))) {
      return reply.code(400).send({ error: 'Unknown logo' });
    }
    const cleanDomain = file && typeof domain === 'string' ? domain.slice(0, 253) : null;
    db.prepare('UPDATE cards SET logo_file = ?, logo_domain = ?, updated_at = ? WHERE id = ?').run(file, cleanDomain, Date.now(), id);
    if (card.logo_file !== file) releaseLogo(app, card.logo_file);
    return { ok: true, logo_url: file ? `/api/logos/${file}` : null };
  });

  app.get('/api/logos/:file', { preHandler: requireUser }, async (request, reply) => {
    const { file } = request.params;
    if (!FILE_RE.test(file) || !logoDir || !existsSync(join(logoDir, file))) {
      return reply.code(404).send({ error: 'Not found' });
    }
    // Content-addressed, so it can be cached forever (overrides no-store).
    reply.header('Content-Type', CONTENT_TYPES[file.split('.').pop()]);
    reply.header('Cache-Control', 'private, max-age=31536000, immutable');
    return reply.send(readFileSync(join(logoDir, file)));
  });
}
