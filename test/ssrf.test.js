// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 CRC Group LTD

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkUrl, guardedLookup, isBlockedAddress, safeFetch } from '../server/ssrf.js';

test('private, loopback and special addresses are blocked', () => {
  for (const ip of [
    '127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1',
    '0.0.0.0', '::1', '::', 'fe80::1', 'fd00::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1', 'not-an-ip',
  ]) assert.equal(isBlockedAddress(ip), true, ip);
  for (const ip of ['93.184.216.34', '1.1.1.1', '2606:4700:4700::1111']) {
    assert.equal(isBlockedAddress(ip), false, ip);
  }
});

test('only plain https hostnames are allowed', () => {
  assert.throws(() => checkUrl('http://example.com/x.png'), /https/);
  assert.throws(() => checkUrl('https://127.0.0.1/x.png'), /IP address/);
  assert.throws(() => checkUrl('https://[::1]/x.png'), /IP address/);
  assert.throws(() => checkUrl('https://user:pw@example.com/'), /Credentials/);
  assert.throws(() => checkUrl('file:///etc/passwd'), /https/);
  assert.equal(checkUrl('https://example.com/a').hostname, 'example.com');
});

test('a hostname resolving to a private address is refused at connect time', async () => {
  // Simulates DNS rebinding: a public-looking name that resolves internally.
  const evilDns = (host, opts, cb) => cb(null, [{ address: '192.168.0.10', family: 4 }]);
  await assert.rejects(safeFetch('https://rebind.example/', { lookup: evilDns }), /Blocked address/);

  const mixed = (host, opts, cb) => cb(null, [{ address: '1.1.1.1', family: 4 }, { address: '127.0.0.1', family: 4 }]);
  await new Promise((resolve) => {
    guardedLookup(mixed)('x.example', { all: true }, (err) => {
      assert.match(err.message, /Blocked/);
      resolve();
    });
  });
});
