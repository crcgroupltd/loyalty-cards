import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ORIGIN, SETUP_TOKEN, client, inviteUser, makeApp, setupAdmin } from './helpers.js';

test('setup needs the token and only works once', async () => {
  const app = await makeApp();
  const c = client(app);
  assert.equal((await c.get('/api/status')).body.setupRequired, true);
  assert.equal((await c.post('/api/setup', { token: 'wrong', name: 'a', password: 'long enough pw' })).status, 403);
  assert.equal((await c.post('/api/setup', { token: SETUP_TOKEN, name: 'a', password: 'short' })).status, 400);
  assert.equal((await c.post('/api/setup', { token: SETUP_TOKEN, name: 'alice', password: 'long enough pw' })).status, 200);
  assert.equal((await c.get('/api/me')).body.user.isAdmin, true);
  const again = await client(app).post('/api/setup', { token: SETUP_TOKEN, name: 'mallory', password: 'long enough pw' });
  assert.equal(again.status, 410);
  assert.equal((await c.get('/api/status')).body.setupRequired, false);
  await app.close();
});

test('login, logout and wrong passwords', async () => {
  const app = await makeApp();
  await setupAdmin(app);
  const c = client(app);
  assert.equal((await c.get('/api/me')).status, 401);
  assert.equal((await c.post('/api/auth/login', { name: 'alice', password: 'nope nope nope' })).status, 401);
  assert.equal((await c.post('/api/auth/login', { name: 'nobody', password: 'nope nope nope' })).status, 401);
  assert.equal((await c.post('/api/auth/login', { name: 'ALICE', password: 'correct horse battery' })).status, 200);
  assert.equal((await c.get('/api/me')).body.user.name, 'alice');
  await c.post('/api/auth/logout');
  assert.equal((await c.get('/api/me')).status, 401);
  await app.close();
});

test('mutating requests from another origin are refused', async () => {
  const app = await makeApp();
  const res = await app.inject({
    method: 'POST',
    url: '/api/setup',
    payload: { token: SETUP_TOKEN, name: 'x', password: 'long enough pw' },
    headers: { origin: 'https://evil.example' },
  });
  assert.equal(res.statusCode, 403);
  const noOrigin = await app.inject({ method: 'POST', url: '/api/auth/logout' });
  assert.equal(noOrigin.statusCode, 403);
  await app.close();
});

test('invites are single use and only admins create them', async () => {
  const app = await makeApp();
  const admin = await setupAdmin(app);
  const { body } = await admin.post('/api/admin/invites');
  assert.ok(body.url.startsWith(`${ORIGIN}/#/link/`));
  const token = body.url.split('/').pop();
  const bob = client(app);
  assert.equal((await bob.get(`/api/auth/link/${token}`)).body.kind, 'signup');
  assert.equal((await bob.post('/api/auth/signup', { token, name: 'bob', password: 'bobs long password' })).status, 200);
  const eve = client(app);
  assert.equal((await eve.post('/api/auth/signup', { token, name: 'eve', password: 'eves long password' })).status, 404);
  assert.equal((await bob.post('/api/admin/invites')).status, 403);
  await app.close();
});

test('reset links set a new password and sign out other sessions', async () => {
  const app = await makeApp();
  const admin = await setupAdmin(app);
  const bob = await inviteUser(app, admin, 'bob');
  const users = (await admin.get('/api/admin/users')).body;
  const bobId = users.find((u) => u.name === 'bob').id;
  const { body } = await admin.post(`/api/admin/users/${bobId}/reset`);
  const token = body.url.split('/').pop();
  const fresh = client(app);
  assert.equal((await fresh.get(`/api/auth/link/${token}`)).body.name, 'bob');
  assert.equal((await fresh.post('/api/auth/reset', { token, password: 'brand new password' })).status, 200);
  assert.equal((await bob.get('/api/me')).status, 401, 'old session revoked');
  assert.equal((await fresh.get('/api/me')).body.user.name, 'bob');
  assert.equal((await client(app).post('/api/auth/reset', { token, password: 'another new password' })).status, 404);
  await app.close();
});
