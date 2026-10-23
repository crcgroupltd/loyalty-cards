import { hashToken, newToken, requireAdmin } from './auth.js';
import { releaseLogo } from './logos.js';

const DAY = 24 * 60 * 60 * 1000;
const SIGNUP_TTL = 7 * DAY;
const RESET_TTL = 1 * DAY;

export async function adminRoutes(app) {
  const { db, config } = app;
  app.addHook('preHandler', requireAdmin);

  const createLink = (kind, createdBy, userId, ttl) => {
    const token = newToken();
    const now = Date.now();
    db.prepare(
      'INSERT INTO invites (token_hash, kind, user_id, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(hashToken(token), kind, userId, createdBy, now, now + ttl);
    // Only the hash is stored, so this is the one time the link can be shown.
    return { url: `${config.origin}/#/link/${token}`, expires_at: now + ttl };
  };

  app.get('/api/admin/users', async () =>
    db
      .prepare(
        `SELECT u.id, u.name, u.is_admin, u.created_at,
           (SELECT COUNT(*) FROM passkeys p WHERE p.user_id = u.id) AS passkeys,
           (SELECT COUNT(*) FROM cards c WHERE c.owner_id = u.id) AS cards
         FROM users u ORDER BY u.name COLLATE NOCASE`,
      )
      .all()
      .map((u) => ({ ...u, is_admin: u.is_admin === 1 })),
  );

  app.get('/api/admin/invites', async () =>
    db
      .prepare(
        `SELECT i.id, i.kind, i.created_at, i.expires_at, u.name AS for_user
         FROM invites i LEFT JOIN users u ON u.id = i.user_id
         WHERE i.used_at IS NULL AND i.expires_at > ? ORDER BY i.created_at DESC`,
      )
      .all(Date.now()),
  );

  app.post('/api/admin/invites', async (request) => createLink('signup', request.user.id, null, SIGNUP_TTL));

  app.delete('/api/admin/invites/:id', async (request, reply) => {
    const info = db.prepare('DELETE FROM invites WHERE id = ? AND used_at IS NULL').run(Number(request.params.id));
    if (!info.changes) return reply.code(404).send({ error: 'Invite not found' });
    return { ok: true };
  });

  app.post('/api/admin/users/:id/reset', async (request, reply) => {
    const userId = Number(request.params.id);
    if (!db.prepare('SELECT 1 FROM users WHERE id = ?').get(userId)) {
      return reply.code(404).send({ error: 'User not found' });
    }
    return createLink('reset', request.user.id, userId, RESET_TTL);
  });

  app.put('/api/admin/users/:id', async (request, reply) => {
    const userId = Number(request.params.id);
    if (userId === request.user.id) return reply.code(400).send({ error: 'You cannot change your own admin role' });
    const info = db.prepare('UPDATE users SET is_admin = ? WHERE id = ?').run(request.body?.is_admin ? 1 : 0, userId);
    if (!info.changes) return reply.code(404).send({ error: 'User not found' });
    return { ok: true };
  });

  app.delete('/api/admin/users/:id', async (request, reply) => {
    const userId = Number(request.params.id);
    if (userId === request.user.id) return reply.code(400).send({ error: 'You cannot delete yourself' });
    const logos = db.prepare('SELECT logo_file FROM cards WHERE owner_id = ? AND logo_file IS NOT NULL').all(userId);
    const info = db.prepare('DELETE FROM users WHERE id = ?').run(userId);
    if (!info.changes) return reply.code(404).send({ error: 'User not found' });
    for (const { logo_file } of logos) releaseLogo(app, logo_file);
    return { ok: true };
  });
}
