// Runtime configuration from environment variables. See .env.example.
export function loadConfig(env = process.env) {
  const port = Number(env.PORT ?? 3000);
  const origin = (env.ORIGIN ?? `http://localhost:${port}`).replace(/\/+$/, '');
  return {
    port,
    host: env.HOST ?? '0.0.0.0',
    dataDir: env.DATA_DIR ?? './data',
    // Public URL the browser uses, e.g. https://cards.example.com. Mutating
    // requests must carry this exact Origin, and passkeys are bound to it.
    origin,
    rpId: env.RP_ID ?? new URL(origin).hostname,
    rpName: env.RP_NAME ?? 'Loyalty Cards',
    // Only trust X-Forwarded-* from the reverse proxy. Accepts what Fastify's
    // trustProxy accepts: "true", a hop count, or comma-separated IPs/CIDRs.
    trustProxy: parseTrustProxy(env.TRUST_PROXY),
    cookieSecure: env.COOKIE_SECURE ? env.COOKIE_SECURE === 'true' : origin.startsWith('https://'),
    setupToken: env.SETUP_TOKEN || null,
    logoApiKey: env.LOGO_API_KEY || null,
    logoProvider: env.LOGO_PROVIDER ?? 'logodev',
    logLevel: env.LOG_LEVEL ?? 'info',
  };
}

function parseTrustProxy(value) {
  if (!value || value === 'false') return false;
  if (value === 'true') return true;
  if (/^\d+$/.test(value)) return Number(value);
  return value.split(',').map((s) => s.trim());
}
