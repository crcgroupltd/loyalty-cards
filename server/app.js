import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import multipart from '@fastify/multipart';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { authRoutes } from './auth.js';
import { cardRoutes } from './cards.js';
import { adminRoutes } from './admin.js';
import { importRoutes } from './import-catima.js';
import { logoRoutes } from './logos.js';

const publicDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "connect-src 'self'",
  "worker-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'",
].join('; ');

export async function buildApp(config, { logger = { level: config.logLevel }, logoProvider } = {}) {
  const app = Fastify({ logger, trustProxy: config.trustProxy, bodyLimit: 2 * 1024 * 1024 });
  const db = openDb(config.dataDir);
  const logoDir = config.dataDir === ':memory:' ? null : join(config.dataDir, 'logos');
  if (logoDir) mkdirSync(logoDir, { recursive: true });

  app.decorate('config', config);
  app.decorate('db', db);
  app.decorate('logoDir', logoDir);
  app.addHook('onClose', async () => db.close());

  await app.register(cookie);
  await app.register(rateLimit, { global: false });
  await app.register(multipart, { limits: { fileSize: 20 * 1024 * 1024, files: 1 } });

  app.addHook('onSend', async (request, reply, payload) => {
    reply.header('Content-Security-Policy', CSP);
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
    if (request.url.startsWith('/api/') && !reply.hasHeader('Cache-Control')) reply.header('Cache-Control', 'no-store');
    return payload;
  });

  // CSRF protection: every state-changing API request must come from our own
  // origin. Browsers always send Origin on cross-site and same-origin POSTs.
  app.addHook('onRequest', async (request, reply) => {
    if (!request.url.startsWith('/api/')) return;
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return;
    if (request.headers.origin !== config.origin) {
      return reply.code(403).send({ error: 'Bad origin' });
    }
  });

  await app.register(authRoutes);
  await app.register(cardRoutes);
  await app.register(adminRoutes);
  await app.register(importRoutes);
  await app.register(logoRoutes, { provider: logoProvider });

  await app.register(fastifyStatic, {
    root: publicDir,
    cacheControl: false,
    setHeaders(reply, path) {
      // The service worker and app shell must revalidate so updates ship;
      // vendored libraries are versioned by the install and can be cached.
      if (/[\\/]vendor[\\/]/.test(path)) reply.header('Cache-Control', 'public, max-age=86400');
      else reply.header('Cache-Control', 'no-cache');
      if (path.endsWith('.webmanifest')) reply.header('Content-Type', 'application/manifest+json');
    },
  });

  app.setNotFoundHandler((request, reply) => {
    reply.code(404).send({ error: 'Not found' });
  });

  return app;
}
