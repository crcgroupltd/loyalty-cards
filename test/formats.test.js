// Round-trip test: render each symbology with bwip-js, decode it with
// zxing-wasm (the same decoder the app uses to scan), and require the exact
// same type and value back. This is what "the barcode matches the card" means.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import bwipjs from 'bwip-js/node';
import { readBarcodes } from 'zxing-wasm/reader';
import {
  FORMATS,
  bwipOptions,
  compressUpcA,
  expandUpcE,
  normalizeDecoded,
  validate,
} from '../public/formats.js';

const cases = [
  ['QR_CODE', 'https://example.com/member/00012345'],
  ['AZTEC', 'MEMBER-0001-ABC'],
  ['DATA_MATRIX', '0049123456789'],
  ['PDF_417', 'LOYALTY|9876543210|GOLD'],
  ['CODE_128', '00123456789012'],
  ['CODE_128', 'Ab-1234/xyz'],
  ['CODE_128', '6337650000123456789012'],
  ['CODE_39', 'CARD 1234'],
  ['CODE_93', 'ABC-123'],
  ['EAN_13', '0012345678905'],
  ['EAN_13', '4006381333931'],
  ['EAN_8', '96385074'],
  ['UPC_A', '036000291452'],
  ['UPC_E', '01234565'],
  ['UPC_E', '04252614'],
  ['ITF', '00123456'],
  ['CODABAR', 'A40156B'],
  // Catima (Java zxing) stores Codabar without start/stop characters; we
  // render them as "A", which zxing-cpp then reports.
  ['CODABAR', '40156', 'A40156A'],
];

// A UPC-A symbol is bar-for-bar an EAN-13 starting with 0, so with every
// format enabled (as the app scans) zxing may report it either way. Tills
// receive the same number from both.
function sameSymbol(a, b) {
  if (a.type === b.type) return a.value === b.value;
  const upc = a.type === 'UPC_A' ? a : b.type === 'UPC_A' ? b : null;
  const ean = a.type === 'EAN_13' ? a : b.type === 'EAN_13' ? b : null;
  return Boolean(upc && ean && ean.value === `0${upc.value}`);
}

for (const [type, value, expected = value] of cases) {
  test(`${type} round-trips ${value}`, async () => {
    assert.equal(validate(type, value), null);
    const png = await bwipjs.toBuffer(bwipOptions(type, value));
    const [result] = await readBarcodes(png, {
      formats: Object.values(FORMATS).map((f) => f.zxing),
      tryHarder: true,
    });
    assert.ok(result, 'nothing decoded');
    const got = normalizeDecoded(result.format, result.text);
    assert.ok(sameSymbol(got, { type, value: expected }), `got ${JSON.stringify(got)}`);
  });
}

test('UPC-E expands and compresses back', () => {
  assert.equal(expandUpcE('01234565'), '012345000065');
  assert.equal(compressUpcA('012345000065'), '01234565');
  assert.equal(compressUpcA('036000291452'), null);
});

test('validate rejects bad check digits and wrong lengths', () => {
  assert.match(validate('EAN_13', '0012345678901'), /check digit/);
  assert.match(validate('UPC_A', '12345'), /UPC-A/);
  assert.match(validate('ITF', '123'), /even/);
  assert.match(validate('NOPE', '1'), /Unknown/);
  assert.equal(validate('EAN_13', '001234567890'), null);
});
