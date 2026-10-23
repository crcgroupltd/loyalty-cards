import { buildApp } from '../server/app.js';
import { loadConfig } from '../server/config.js';

export const ORIGIN = 'https://cards.test';
export const SETUP_TOKEN = 'test-setup-token';

export async function makeApp(options = {}) {
  const config = loadConfig({ DATA_DIR: ':memory:', ORIGIN, SETUP_TOKEN, ...options.env });
  const app = await buildApp(config, { logger: false, ...options });
  await app.ready();
  return app;
}

// Minimal cookie-jar client around app.inject.
export function client(app) {
  let cookie = '';
  const call = async (method, url, body) => {
    const res = await app.inject({
      method,
      url,
      payload: body,
      headers: { origin: ORIGIN, ...(cookie ? { cookie } : {}) },
    });
    const sid = res.cookies.find((c) => c.name === 'sid');
    if (sid) cookie = sid.value ? `sid=${sid.value}` : '';
    return { status: res.statusCode, body: res.body ? safeJson(res.body) : null, res };
  };
  return {
    cookie: () => cookie,
    get: (url) => call('GET', url),
    post: (url, body = {}) => call('POST', url, body),
    put: (url, body = {}) => call('PUT', url, body),
    del: (url) => call('DELETE', url),
  };
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// Creates the admin via setup and returns their client.
export async function setupAdmin(app, name = 'alice') {
  const c = client(app);
  const r = await c.post('/api/setup', { token: SETUP_TOKEN, name, password: 'correct horse battery' });
  if (r.status !== 200) throw new Error(`setup failed: ${JSON.stringify(r.body)}`);
  return c;
}

// Has the admin invite a new user and returns that user's client.
export async function inviteUser(app, admin, name) {
  const { body } = await admin.post('/api/admin/invites');
  const token = body.url.split('/').pop();
  const c = client(app);
  const r = await c.post('/api/auth/signup', { token, name, password: 'another long password' });
  if (r.status !== 200) throw new Error(`signup failed: ${JSON.stringify(r.body)}`);
  return c;
}

export const sampleCard = (overrides = {}) => ({
  name: 'Grocer',
  card_number: '4006 3813 3393 1',
  barcode_value: '4006381333931',
  barcode_type: 'EAN_13',
  ...overrides,
});
