// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 CRC Group LTD

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import bwipjs from 'bwip-js/node';
import { inviteUser, makeApp, sampleCard, setupAdmin } from './helpers.js';

test('logo search stores images locally and cards reference them', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bmc-logos-'));
  const png = await bwipjs.toBuffer({ bcid: 'qrcode', text: 'logo' });
  const fakeProvider = {
    search: async (q) => [{ name: `${q} Inc`, domain: 'grocer.example' }, { name: 'Svg Only', domain: 'svg.example' }],
    download: async (domain) => (domain === 'grocer.example' ? png : Buffer.from('<svg/>')),
  };
  const app = await makeApp({ env: { DATA_DIR: dir }, logoProvider: fakeProvider });
  try {
    const alice = await setupAdmin(app);
    const bob = await inviteUser(app, alice, 'bob');
    const { body: card } = await alice.post('/api/cards', sampleCard());

    const search = await alice.get('/api/logos/search?q=Grocer');
    assert.equal(search.body.results.length, 1, 'non-raster images are dropped');
    const [hit] = search.body.results;

    assert.equal((await bob.put(`/api/cards/${card.id}/logo`, { file: hit.file })).status, 404);
    assert.equal((await alice.put(`/api/cards/${card.id}/logo`, { file: '../../etc/passwd' })).status, 400);
    const set = await alice.put(`/api/cards/${card.id}/logo`, { file: hit.file, domain: hit.domain });
    assert.equal(set.body.logo_url, `/api/logos/${hit.file}`);

    const img = await alice.get(set.body.logo_url);
    assert.equal(img.res.headers['content-type'], 'image/png');
    assert.equal((await alice.get('/api/cards')).body.cards[0].logo_url, set.body.logo_url);

    await alice.del(`/api/cards/${card.id}`);
    assert.deepEqual(readdirSync(join(dir, 'logos')), [], 'logo file removed with its last card');
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
