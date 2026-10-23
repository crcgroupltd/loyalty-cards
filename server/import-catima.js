// Parses Catima exports (Android loyalty card app). The export is a zip
// holding catima.csv. Format version 2 has three CSV tables separated by
// blank lines: groups, cards, card-group links. Version 1 is a single cards
// table. Parsed cards go back to the browser for review; nothing is saved here.
import { unzipSync, strFromU8 } from 'fflate';
import { FORMATS, validate } from '../public/formats.js';
import { requireUser } from './auth.js';
import { colorFor } from './cards.js';

// RFC 4180 CSV parser. Returns rows of fields; a blank line is an empty row.
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  let i = 0;
  text = text.replace(/^﻿/, '');
  while (i < text.length) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i += 2;
        continue;
      }
      if (ch === '"') quoted = false;
      else field += ch;
      i++;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\r' || ch === '\n') {
      row.push(field);
      rows.push(row.length === 1 && row[0] === '' ? [] : row);
      row = [];
      field = '';
      if (ch === '\r' && text[i + 1] === '\n') i++;
    } else field += ch;
    i++;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

// Splits rows into tables at blank lines; each table becomes header-keyed objects.
function tables(rows) {
  const out = [];
  let current = null;
  for (const row of rows) {
    if (row.length === 0) {
      current = null;
      continue;
    }
    if (!current) {
      current = { header: row, rows: [] };
      out.push(current);
    } else {
      current.rows.push(Object.fromEntries(current.header.map((h, j) => [h, row[j] ?? ''])));
    }
  }
  return out;
}

// Android stores colours as signed 32-bit ARGB integers.
function androidColor(value) {
  if (!/^-?\d+$/.test(value ?? '')) return null;
  return `#${(Number(value) >>> 0 & 0xffffff).toString(16).padStart(6, '0')}`;
}

export function parseCatimaCsv(text) {
  const rows = parseCsv(text);
  let body = rows;
  if (rows[0]?.length === 1 && /^\d+$/.test(rows[0][0])) {
    const version = Number(rows[0][0]);
    if (version !== 2) throw new Error(`Unsupported Catima export version ${version}`);
    body = rows.slice(1);
  }
  const cardsTable = tables(body).find((t) => t.header.includes('store'));
  if (!cardsTable) throw new Error('No cards found in this Catima export');

  return cardsTable.rows.map((r) => {
    const name = (r.store ?? '').trim().slice(0, 60) || 'Unnamed card';
    const cardNumber = (r.cardid ?? '').trim();
    // Catima shows cardid and encodes barcodeid when set, else cardid.
    const barcode_value = r.barcodeid || r.cardid || '';
    const barcode_type = FORMATS[r.barcodetype] ? r.barcodetype : null;
    const card = {
      name,
      card_number: cardNumber,
      barcode_value,
      barcode_type,
      color: androidColor(r.headercolor) ?? colorFor(name),
      notes: (r.note ?? '').trim(),
    };
    if (!barcode_type) card.error = r.barcodetype ? `Unsupported barcode type ${r.barcodetype}` : 'No barcode type in export';
    else card.error = validate(barcode_type, barcode_value) ?? undefined;
    return card;
  });
}

export function parseCatimaUpload(buf) {
  const isZip = buf[0] === 0x50 && buf[1] === 0x4b;
  if (!isZip) return parseCatimaCsv(buf.toString('utf8'));
  let files;
  try {
    files = unzipSync(new Uint8Array(buf), { filter: (f) => f.name.endsWith('.csv') });
  } catch (e) {
    // zip4j AES-encrypted entries use compression method 99.
    if (/compression/i.test(e.message)) throw new Error('This export is password protected. Export again from Catima without a password.');
    throw new Error('Could not read this zip file');
  }
  const csv = files['catima.csv'] ?? Object.values(files)[0];
  if (!csv) throw new Error('No catima.csv in this zip');
  return parseCatimaCsv(strFromU8(csv));
}

export async function importRoutes(app) {
  app.post('/api/import/catima', { preHandler: requireUser }, async (request, reply) => {
    const file = await request.file();
    if (!file) return reply.code(400).send({ error: 'Choose a Catima export file' });
    const buf = await file.toBuffer();
    try {
      return { cards: parseCatimaUpload(buf) };
    } catch (e) {
      return reply.code(400).send({ error: e.message });
    }
  });
}
