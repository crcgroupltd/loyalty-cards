import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inviteUser, makeApp, sampleCard, setupAdmin } from './helpers.js';

test('cards are private until shared, and shared cards are read-only', async () => {
  const app = await makeApp();
  const alice = await setupAdmin(app);
  const bob = await inviteUser(app, alice, 'bob');

  const created = await alice.post('/api/cards', sampleCard());
  assert.equal(created.status, 201);
  const id = created.body.id;
  assert.equal(created.body.barcode_value, '4006381333931');

  assert.equal((await bob.get('/api/cards')).body.cards.length, 0);
  assert.equal((await bob.put(`/api/cards/${id}`, sampleCard({ name: 'Hacked' }))).status, 404);
  assert.equal((await bob.del(`/api/cards/${id}`)).status, 404);
  assert.equal((await bob.put(`/api/cards/${id}/favorite`, { favorite: true })).status, 404);

  const bobId = (await alice.get('/api/users')).body.find((u) => u.name === 'bob').id;
  const shared = await alice.put(`/api/cards/${id}/shares`, { user_ids: [bobId] });
  assert.deepEqual(shared.body.shared_with, [bobId]);

  const bobsView = (await bob.get('/api/cards')).body.cards;
  assert.equal(bobsView.length, 1);
  assert.equal(bobsView[0].is_owner, false);
  assert.equal(bobsView[0].owner_name, 'alice');
  assert.deepEqual(bobsView[0].shared_with, [], 'non-owners do not see the share list');
  assert.equal((await bob.put(`/api/cards/${id}`, sampleCard({ name: 'Hacked' }))).status, 404);
  assert.equal((await bob.put(`/api/cards/${id}/shares`, { user_ids: [] })).status, 404);
  assert.equal((await bob.put(`/api/cards/${id}/favorite`, { favorite: true })).status, 200);
  assert.equal((await bob.get('/api/cards')).body.cards[0].favorite, true);
  assert.equal((await alice.get('/api/cards')).body.cards[0].favorite, false, 'favourites are per user');

  await alice.put(`/api/cards/${id}/shares`, { user_ids: [] });
  assert.equal((await bob.get('/api/cards')).body.cards.length, 0);
  await app.close();
});

test('invalid barcodes are rejected and batch create is all-or-nothing', async () => {
  const app = await makeApp();
  const alice = await setupAdmin(app);
  const bad = await alice.post('/api/cards', sampleCard({ barcode_value: '4006381333932' }));
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /check digit/);

  const batch = await alice.post('/api/cards/batch', {
    cards: [sampleCard({ name: 'One' }), sampleCard({ name: 'Two', barcode_type: 'ITF', barcode_value: '123' })],
  });
  assert.equal(batch.status, 400);
  assert.equal(batch.body.errors[0].index, 1);
  assert.equal((await alice.get('/api/cards')).body.cards.length, 0);

  const ok = await alice.post('/api/cards/batch', {
    cards: [sampleCard({ name: 'One' }), sampleCard({ name: 'Two', barcode_type: 'QR_CODE', barcode_value: ' spaced ' })],
  });
  assert.equal(ok.body.created, 2);
  const cards = (await alice.get('/api/cards')).body.cards;
  assert.equal(cards.find((c) => c.name === 'Two').barcode_value, ' spaced ', 'values are stored untouched');

  const exported = await alice.get('/api/export');
  assert.equal(exported.body.cards.length, 2);
  assert.match(exported.res.headers['content-disposition'], /attachment/);
  await app.close();
});
