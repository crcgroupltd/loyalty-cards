// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 CRC Group LTD

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zipSync, strToU8 } from 'fflate';
import { parseCatimaCsv, parseCatimaUpload } from '../server/import-catima.js';
import { ORIGIN, client, makeApp, setupAdmin } from './helpers.js';

// Shaped like CatimaExporter.writeCSV output (format version 2).
const CSV = [
  '2',
  '',
  '_id',
  'Groceries',
  '',
  '_id,store,note,validfrom,expiry,balance,balancetype,cardid,barcodeid,barcodetype,barcodeencoding,headercolor,starstatus,lastused,archive',
  '1,Grocer,"Note, with comma",,,0,,4006381333931,,EAN_13,,-16776961,1,0,0',
  '2,Pharmacy,,,,0,,1234 5678,00012345678,CODE_128,,-65536,0,0,0',
  '3,Library,"multi',
  'line",,,0,,40156,,CODABAR,,,0,0,0',
  '4,Mystery,,,,0,,ABC,,,,,0,0,0',
  '5,Bad EAN,,,,0,,4006381333932,,EAN_13,,,0,0,0',
  '',
  'cardId,groupId',
  '1,Groceries',
  '',
].join('\r\n');

test('parses Catima v2 CSV', () => {
  const cards = parseCatimaCsv(CSV);
  assert.equal(cards.length, 5);
  assert.deepEqual(cards[0], {
    name: 'Grocer',
    card_number: '4006381333931',
    barcode_value: '4006381333931',
    barcode_type: 'EAN_13',
    color: '#0000ff',
    notes: 'Note, with comma',
    error: undefined,
  });
  assert.equal(cards[1].card_number, '1234 5678');
  assert.equal(cards[1].barcode_value, '00012345678', 'barcodeid wins over cardid');
  assert.equal(cards[1].color, '#ff0000');
  assert.equal(cards[2].notes, 'multi\r\nline');
  assert.equal(cards[2].barcode_type, 'CODABAR');
  assert.match(cards[3].error, /No barcode type/);
  assert.match(cards[4].error, /check digit/);
});

test('reads the zip and reports password-protected exports', () => {
  const zip = zipSync({ 'catima.csv': strToU8(CSV), 'card_1_front.png': new Uint8Array([1, 2, 3]) });
  assert.equal(parseCatimaUpload(Buffer.from(zip)).length, 5);
  assert.throws(() => parseCatimaUpload(Buffer.from('2\r\n\r\n_id\r\n')), /No cards/);
});

test('upload endpoint returns parsed cards for review', async () => {
  const app = await makeApp();
  const admin = await setupAdmin(app);
  const boundary = '----test';
  const payload = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="catima.csv"\r\nContent-Type: text/csv\r\n\r\n`),
    Buffer.from(CSV),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const res = await app.inject({
    method: 'POST',
    url: '/api/import/catima',
    payload,
    headers: { origin: ORIGIN, cookie: admin.cookie(), 'content-type': `multipart/form-data; boundary=${boundary}` },
  });
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(res.json().cards.length, 5);
  const anon = await client(app).post('/api/import/catima');
  assert.equal(anon.status, 401);
  await app.close();
});
