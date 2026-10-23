import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { hash as argonHash, verify as argonVerify } from '@node-rs/argon2';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';

const DAY = 24 * 60 * 60 * 1000;
const SESSION_TTL = 180 * DAY;
const SESSION_RENEW_BELOW = 90 * DAY;
const CHALLENGE_TTL = 5 * 60 * 1000;
const SESSION_COOKIE = 'sid';
const CHALLENGE_COOKIE = 'wac';
const MIN_PASSWORD = 10;

// Strict limit for anything that checks a secret (password, token, passkey).
export const authRateLimit = { rateLimit: { max: 10, timeWindow: '1 minute' } };

export function newToken() {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token) {
  return createHash('sha256').update(token).digest('base64url');
}

export const hashPassword = (password) => argonHash(password);

// Used so a login for an unknown user costs the same as a real one.
const dummyHash = await argonHash(newToken());

export function validateName(name) {
  if (typeof name !== 'string') return 'Name is required';
  const trimmed = name.trim();
  if (trimmed.length < 1 || trimmed.length > 40) return 'Name must be 1 to 40 characters';
  return null;
}

export function validatePassword(password) {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD) {
    return `Password must be at least ${MIN_PASSWORD} characters`;
  }
  if (password.length > 512) return 'Password is too long';
  return null;
}

export function currentUser(request) {
  const token = request.cookies[SESSION_COOKIE];
  if (!token) return null;
  const db = request.server.db;
  const row = db
    .prepare(
      `SELECT s.token_hash, s.expires_at, u.id, u.name, u.is_admin
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ?`,
    )
    .get(hashToken(token));
  if (!row) return null;
  const now = Date.now();
  if (row.expires_at < now) {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(row.token_hash);
    return null;
  }
  if (row.expires_at - now < SESSION_RENEW_BELOW) {
    db.prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?').run(now + SESSION_TTL, row.token_hash);
  }
  return { id: row.id, name: row.name, isAdmin: row.is_admin === 1 };
}

// preHandler: rejects anonymous requests and attaches request.user.
export async function requireUser(request, reply) {
  request.user = currentUser(request);
  if (!request.user) return reply.code(401).send({ error: 'Not signed in' });
}

export async function requireAdmin(request, reply) {
  await requireUser(request, reply);
  if (reply.sent) return;
  if (!request.user.isAdmin) return reply.code(403).send({ error: 'Admins only' });
}

export function startSession(request, reply, userId) {
  const token = newToken();
  const now = Date.now();
  request.server.db
    .prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .run(hashToken(token), userId, now, now + SESSION_TTL);
  reply.setCookie(SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: request.server.config.cookieSecure,
    maxAge: SESSION_TTL / 1000,
  });
}

export function createUser(db, { name, password_hash, isAdmin = false }) {
  const info = db
    .prepare(
      'INSERT INTO users (name, password_hash, is_admin, webauthn_user_id, created_at) VALUES (?, ?, ?, ?, ?)',
    )
    .run(name.trim(), password_hash, isAdmin ? 1 : 0, randomBytes(16).toString('base64url'), Date.now());
  return Number(info.lastInsertRowid);
}

// Looks up an unused, unexpired invite or reset link.
export function findInvite(db, token, kind) {
  if (typeof token !== 'string' || token.length > 100) return null;
  const row = db
    .prepare('SELECT * FROM invites WHERE token_hash = ? AND kind = ? AND used_at IS NULL')
    .get(hashToken(token), kind);
  if (!row || row.expires_at < Date.now()) return null;
  return row;
}

function sameSecret(a, b) {
  const ha = createHash('sha256').update(String(a)).digest();
  const hb = createHash('sha256').update(String(b)).digest();
  return timingSafeEqual(ha, hb);
}

export async function authRoutes(app) {
  const { db, config } = app;
  const userCount = () => db.prepare('SELECT COUNT(*) AS n FROM users').get().n;

  // With no SETUP_TOKEN configured, a random one is generated and logged on
  // each boot until the first admin exists. It only ever works once.
  let setupToken = config.setupToken;
  app.addHook('onReady', async () => {
    if (userCount() > 0) return;
    if (!setupToken) {
      setupToken = newToken();
      app.log.warn(`No users yet. Open ${config.origin}/#/setup and use setup token: ${setupToken}`);
    } else {
      app.log.warn(`No users yet. Open ${config.origin}/#/setup and use the SETUP_TOKEN from your environment.`);
    }
  });

  app.get('/api/status', async () => ({
    setupRequired: userCount() === 0,
    logos: Boolean(config.logoApiKey),
  }));

  app.post('/api/setup', { config: authRateLimit }, async (request, reply) => {
    const { token, name, password } = request.body ?? {};
    if (userCount() > 0 || !setupToken) return reply.code(410).send({ error: 'Setup is already done' });
    if (!sameSecret(token, setupToken)) return reply.code(403).send({ error: 'Wrong setup token' });
    const err = validateName(name) ?? validatePassword(password);
    if (err) return reply.code(400).send({ error: err });
    const password_hash = await hashPassword(password);
    // Re-check inside the transaction so two racing requests can't both win.
    const userId = db.transaction(() => {
      if (userCount() > 0) return null;
      return createUser(db, { name, password_hash, isAdmin: true });
    })();
    if (!userId) return reply.code(410).send({ error: 'Setup is already done' });
    setupToken = null;
    startSession(request, reply, userId);
    return { ok: true };
  });

  app.get('/api/me', async (request, reply) => {
    const user = currentUser(request);
    if (!user) return reply.code(401).send({ error: 'Not signed in' });
    const passkeys = db
      .prepare('SELECT id, label, created_at, last_used_at FROM passkeys WHERE user_id = ? ORDER BY created_at')
      .all(user.id);
    return { user, passkeys };
  });

  app.post('/api/auth/login', { config: authRateLimit }, async (request, reply) => {
    const { name, password } = request.body ?? {};
    if (typeof name !== 'string' || typeof password !== 'string') {
      return reply.code(400).send({ error: 'Name and password are required' });
    }
    const row = db.prepare('SELECT id, password_hash FROM users WHERE name = ?').get(name.trim());
    const ok = await argonVerify(row?.password_hash ?? dummyHash, password);
    if (!row || !row.password_hash || !ok) return reply.code(401).send({ error: 'Wrong name or password' });
    startSession(request, reply, row.id);
    return { ok: true };
  });

  app.post('/api/auth/logout', async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE];
    if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.post('/api/auth/password', { config: authRateLimit, preHandler: requireUser }, async (request, reply) => {
    const { current, password } = request.body ?? {};
    const err = validatePassword(password);
    if (err) return reply.code(400).send({ error: err });
    const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(request.user.id);
    if (row.password_hash && !(typeof current === 'string' && (await argonVerify(row.password_hash, current)))) {
      return reply.code(403).send({ error: 'Current password is wrong' });
    }
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await hashPassword(password), request.user.id);
    return { ok: true };
  });

  // Invite and reset links: look one up so the page can show the right form.
  app.get('/api/auth/link/:token', { config: authRateLimit }, async (request, reply) => {
    const { token } = request.params;
    const signup = findInvite(db, token, 'signup');
    if (signup) return { kind: 'signup' };
    const reset = findInvite(db, token, 'reset');
    if (reset) {
      const user = db.prepare('SELECT name FROM users WHERE id = ?').get(reset.user_id);
      return { kind: 'reset', name: user?.name };
    }
    return reply.code(404).send({ error: 'This link is invalid or has expired' });
  });

  app.post('/api/auth/signup', { config: authRateLimit }, async (request, reply) => {
    const { token, name, password } = request.body ?? {};
    const err = validateName(name) ?? validatePassword(password);
    if (err) return reply.code(400).send({ error: err });
    const password_hash = await hashPassword(password);
    const result = db.transaction(() => {
      const invite = findInvite(db, token, 'signup');
      if (!invite) return { status: 404, error: 'This invite is invalid or has expired' };
      if (db.prepare('SELECT 1 FROM users WHERE name = ?').get(name.trim())) {
        return { status: 409, error: 'That name is taken' };
      }
      const userId = createUser(db, { name, password_hash });
      db.prepare('UPDATE invites SET used_at = ? WHERE id = ?').run(Date.now(), invite.id);
      return { userId };
    })();
    if (result.error) return reply.code(result.status).send({ error: result.error });
    startSession(request, reply, result.userId);
    return { ok: true };
  });

  app.post('/api/auth/reset', { config: authRateLimit }, async (request, reply) => {
    const { token, password } = request.body ?? {};
    const err = validatePassword(password);
    if (err) return reply.code(400).send({ error: err });
    const password_hash = await hashPassword(password);
    const userId = db.transaction(() => {
      const invite = findInvite(db, token, 'reset');
      if (!invite) return null;
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(password_hash, invite.user_id);
      db.prepare('UPDATE invites SET used_at = ? WHERE id = ?').run(Date.now(), invite.id);
      // A reset means the old credentials may be compromised: sign out everywhere.
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(invite.user_id);
      return invite.user_id;
    })();
    if (!userId) return reply.code(404).send({ error: 'This link is invalid or has expired' });
    startSession(request, reply, userId);
    return { ok: true };
  });

  // ---- Passkeys ----
  // Pending challenges, keyed by a short-lived random cookie. In-memory is
  // fine: one process, and a restart only means retrying the passkey prompt.
  const challenges = new Map();
  const putChallenge = (reply, value) => {
    const id = newToken();
    challenges.set(id, { ...value, expires: Date.now() + CHALLENGE_TTL });
    for (const [k, v] of challenges) if (v.expires < Date.now()) challenges.delete(k);
    reply.setCookie(CHALLENGE_COOKIE, id, {
      path: '/api/auth/passkey',
      httpOnly: true,
      sameSite: 'strict',
      secure: config.cookieSecure,
      maxAge: CHALLENGE_TTL / 1000,
    });
  };
  const takeChallenge = (request, reply) => {
    const id = request.cookies[CHALLENGE_COOKIE];
    const value = id && challenges.get(id);
    if (id) challenges.delete(id);
    reply.clearCookie(CHALLENGE_COOKIE, { path: '/api/auth/passkey' });
    if (!value || value.expires < Date.now()) return null;
    return value;
  };

  app.post('/api/auth/passkey/register/options', { preHandler: requireUser }, async (request, reply) => {
    const user = db.prepare('SELECT id, name, webauthn_user_id FROM users WHERE id = ?').get(request.user.id);
    const existing = db.prepare('SELECT id, transports FROM passkeys WHERE user_id = ?').all(user.id);
    const options = await generateRegistrationOptions({
      rpName: config.rpName,
      rpID: config.rpId,
      userName: user.name,
      userID: Buffer.from(user.webauthn_user_id, 'base64url'),
      attestationType: 'none',
      excludeCredentials: existing.map((p) => ({ id: p.id, transports: JSON.parse(p.transports ?? '[]') })),
      authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
    });
    putChallenge(reply, { challenge: options.challenge, userId: user.id, kind: 'register' });
    return options;
  });

  app.post('/api/auth/passkey/register/verify', { preHandler: requireUser }, async (request, reply) => {
    const pending = takeChallenge(request, reply);
    if (!pending || pending.kind !== 'register' || pending.userId !== request.user.id) {
      return reply.code(400).send({ error: 'Passkey request expired, try again' });
    }
    const { response, label } = request.body ?? {};
    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response,
        expectedChallenge: pending.challenge,
        expectedOrigin: config.origin,
        expectedRPID: config.rpId,
        requireUserVerification: false,
      });
    } catch (e) {
      return reply.code(400).send({ error: `Passkey not accepted: ${e.message}` });
    }
    if (!verification.verified) return reply.code(400).send({ error: 'Passkey not accepted' });
    const { credential } = verification.registrationInfo;
    db.prepare(
      'INSERT INTO passkeys (id, user_id, public_key, counter, transports, label, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(
      credential.id,
      request.user.id,
      Buffer.from(credential.publicKey),
      credential.counter,
      JSON.stringify(credential.transports ?? []),
      typeof label === 'string' ? label.slice(0, 60) : '',
      Date.now(),
    );
    return { ok: true };
  });

  app.post('/api/auth/passkey/login/options', { config: authRateLimit }, async (request, reply) => {
    // Discoverable credentials: no allow-list, the device offers its passkeys.
    const options = await generateAuthenticationOptions({ rpID: config.rpId, userVerification: 'preferred' });
    putChallenge(reply, { challenge: options.challenge, kind: 'login' });
    return options;
  });

  app.post('/api/auth/passkey/login/verify', { config: authRateLimit }, async (request, reply) => {
    const pending = takeChallenge(request, reply);
    if (!pending || pending.kind !== 'login') {
      return reply.code(400).send({ error: 'Passkey request expired, try again' });
    }
    const response = request.body?.response;
    const passkey = typeof response?.id === 'string' && db.prepare('SELECT * FROM passkeys WHERE id = ?').get(response.id);
    if (!passkey) return reply.code(401).send({ error: 'This passkey is not registered here' });
    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response,
        expectedChallenge: pending.challenge,
        expectedOrigin: config.origin,
        expectedRPID: config.rpId,
        credential: {
          id: passkey.id,
          publicKey: new Uint8Array(passkey.public_key),
          counter: passkey.counter,
          transports: JSON.parse(passkey.transports ?? '[]'),
        },
        requireUserVerification: false,
      });
    } catch (e) {
      return reply.code(401).send({ error: `Passkey not accepted: ${e.message}` });
    }
    if (!verification.verified) return reply.code(401).send({ error: 'Passkey not accepted' });
    db.prepare('UPDATE passkeys SET counter = ?, last_used_at = ? WHERE id = ?').run(
      verification.authenticationInfo.newCounter,
      Date.now(),
      passkey.id,
    );
    startSession(request, reply, passkey.user_id);
    return { ok: true };
  });

  app.delete('/api/auth/passkeys/:id', { preHandler: requireUser }, async (request, reply) => {
    const info = db.prepare('DELETE FROM passkeys WHERE id = ? AND user_id = ?').run(request.params.id, request.user.id);
    if (!info.changes) return reply.code(404).send({ error: 'Passkey not found' });
    return { ok: true };
  });
}
