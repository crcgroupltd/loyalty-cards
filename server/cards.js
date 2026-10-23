// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 CRC Group LTD

import { FORMATS, validate } from '../public/formats.js';
import { requireUser } from './auth.js';
import { releaseLogo } from './logos.js';

const MAX_BATCH = 500;

// Validates and normalises a card from a request body. Only text fields are
// trimmed; the barcode value is stored exactly as given.
export function parseCardInput(body) {
  if (!body || typeof body !== 'object') return { error: 'Card is required' };
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name || name.length > 60) return { error: 'Name must be 1 to 60 characters' };
  const barcode_type = body.barcode_type;
  const barcode_value = body.barcode_value;
  const barcodeError = validate(barcode_type, barcode_value);
  if (barcodeError) return { error: `${name}: ${barcodeError}` };
  const card_number = typeof body.card_number === 'string' ? body.card_number.trim() : '';
  if (card_number.length > 100) return { error: 'Card number is too long' };
  const notes = typeof body.notes === 'string' ? body.notes.trim() : '';
  if (notes.length > 2000) return { error: 'Notes are too long' };
  const color = typeof body.color === 'string' && /^#[0-9a-f]{6}$/i.test(body.color) ? body.color.toLowerCase() : colorFor(name);
  return { card: { name, card_number, barcode_value, barcode_type, color, notes } };
}

// Stable fallback colour from the store name.
export function colorFor(name) {
  let h = 0;
  for (const ch of name.toLowerCase()) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  const hue = h % 360;
  return hslToHex(hue, 55, 42);
}

function hslToHex(h, s, l) {
  s /= 100;
  l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))));
  return `#${[f(0), f(8), f(4)].map((x) => x.toString(16).padStart(2, '0')).join('')}`;
}

// Cards the user can see: their own plus those shared with them.
export function visibleCards(db, userId) {
  const rows = db
    .prepare(
      `SELECT c.*, u.name AS owner_name, (f.card_id IS NOT NULL) AS favorite
       FROM cards c
       JOIN users u ON u.id = c.owner_id
       LEFT JOIN favorites f ON f.card_id = c.id AND f.user_id = @userId
       WHERE c.owner_id = @userId
          OR c.id IN (SELECT card_id FROM card_shares WHERE user_id = @userId)
       ORDER BY c.name COLLATE NOCASE`,
    )
    .all({ userId });
  const shares = db
    .prepare(
      `SELECT s.card_id, s.user_id FROM card_shares s JOIN cards c ON c.id = s.card_id WHERE c.owner_id = ?`,
    )
    .all(userId);
  const sharedWith = new Map();
  for (const s of shares) {
    if (!sharedWith.has(s.card_id)) sharedWith.set(s.card_id, []);
    sharedWith.get(s.card_id).push(s.user_id);
  }
  return rows.map((r) => toApi(r, userId, sharedWith.get(r.id) ?? []));
}

function toApi(row, userId, sharedWith) {
  const isOwner = row.owner_id === userId;
  return {
    id: row.id,
    name: row.name,
    card_number: row.card_number,
    barcode_value: row.barcode_value,
    barcode_type: row.barcode_type,
    color: row.color,
    notes: row.notes,
    logo_url: row.logo_file ? `/api/logos/${row.logo_file}` : null,
    logo_domain: row.logo_domain,
    favorite: Boolean(row.favorite),
    is_owner: isOwner,
    owner_name: row.owner_name,
    shared_with: isOwner ? sharedWith : [],
    updated_at: row.updated_at,
  };
}

export function insertCard(db, ownerId, card) {
  const now = Date.now();
  const info = db
    .prepare(
      `INSERT INTO cards (owner_id, name, card_number, barcode_value, barcode_type, color, notes, created_at, updated_at)
       VALUES (@ownerId, @name, @card_number, @barcode_value, @barcode_type, @color, @notes, @now, @now)`,
    )
    .run({ ...card, ownerId, now });
  return Number(info.lastInsertRowid);
}

export function canSee(db, userId, cardId) {
  return Boolean(
    db
      .prepare(
        `SELECT 1 FROM cards WHERE id = @cardId AND (owner_id = @userId
           OR id IN (SELECT card_id FROM card_shares WHERE user_id = @userId))`,
      )
      .get({ cardId, userId }),
  );
}

export function ownedCard(db, userId, cardId) {
  return db.prepare('SELECT * FROM cards WHERE id = ? AND owner_id = ?').get(cardId, userId);
}

export async function cardRoutes(app) {
  const { db } = app;
  app.addHook('preHandler', requireUser);

  const cardId = (request) => Number.parseInt(request.params.id, 10);
  const one = (userId, id) => visibleCards(db, userId).find((c) => c.id === id);

  app.get('/api/formats', async () =>
    Object.entries(FORMATS).map(([key, f]) => ({ key, label: f.label })),
  );

  // Household members, for the share picker.
  app.get('/api/users', async (request) =>
    db.prepare('SELECT id, name FROM users WHERE id != ? ORDER BY name COLLATE NOCASE').all(request.user.id),
  );

  // The full list doubles as the offline sync payload; a household's cards
  // are small enough that sending everything beats tracking deltas.
  app.get('/api/cards', async (request) => ({ cards: visibleCards(db, request.user.id), synced_at: Date.now() }));

  app.post('/api/cards', async (request, reply) => {
    const { card, error } = parseCardInput(request.body);
    if (error) return reply.code(400).send({ error });
    const id = insertCard(db, request.user.id, card);
    return reply.code(201).send(one(request.user.id, id));
  });

  app.post('/api/cards/batch', async (request, reply) => {
    const input = request.body?.cards;
    if (!Array.isArray(input) || input.length === 0) return reply.code(400).send({ error: 'No cards given' });
    if (input.length > MAX_BATCH) return reply.code(400).send({ error: `At most ${MAX_BATCH} cards at once` });
    const parsed = input.map(parseCardInput);
    const errors = parsed.flatMap((p, i) => (p.error ? [{ index: i, error: p.error }] : []));
    if (errors.length) return reply.code(400).send({ error: 'Some cards are invalid', errors });
    const ids = db.transaction(() => parsed.map((p) => insertCard(db, request.user.id, p.card)))();
    return reply.code(201).send({ created: ids.length, ids });
  });

  app.put('/api/cards/:id', async (request, reply) => {
    const id = cardId(request);
    if (!ownedCard(db, request.user.id, id)) return reply.code(404).send({ error: 'Card not found or not yours' });
    const { card, error } = parseCardInput(request.body);
    if (error) return reply.code(400).send({ error });
    db.prepare(
      `UPDATE cards SET name = @name, card_number = @card_number, barcode_value = @barcode_value,
         barcode_type = @barcode_type, color = @color, notes = @notes, updated_at = @now WHERE id = @id`,
    ).run({ ...card, id, now: Date.now() });
    return one(request.user.id, id);
  });

  app.delete('/api/cards/:id', async (request, reply) => {
    const id = cardId(request);
    const card = ownedCard(db, request.user.id, id);
    if (!card) return reply.code(404).send({ error: 'Card not found or not yours' });
    db.prepare('DELETE FROM cards WHERE id = ?').run(id);
    releaseLogo(app, card.logo_file);
    return { ok: true };
  });

  app.put('/api/cards/:id/favorite', async (request, reply) => {
    const id = cardId(request);
    if (!canSee(db, request.user.id, id)) return reply.code(404).send({ error: 'Card not found' });
    if (request.body?.favorite) {
      db.prepare('INSERT OR IGNORE INTO favorites (user_id, card_id) VALUES (?, ?)').run(request.user.id, id);
    } else {
      db.prepare('DELETE FROM favorites WHERE user_id = ? AND card_id = ?').run(request.user.id, id);
    }
    return { ok: true };
  });

  app.put('/api/cards/:id/shares', async (request, reply) => {
    const id = cardId(request);
    if (!ownedCard(db, request.user.id, id)) return reply.code(404).send({ error: 'Card not found or not yours' });
    const userIds = request.body?.user_ids;
    if (!Array.isArray(userIds) || !userIds.every(Number.isInteger)) {
      return reply.code(400).send({ error: 'user_ids must be a list of user ids' });
    }
    const valid = new Set(
      db.prepare('SELECT id FROM users WHERE id != ?').all(request.user.id).map((u) => u.id),
    );
    if (!userIds.every((u) => valid.has(u))) return reply.code(400).send({ error: 'Unknown user' });
    db.transaction(() => {
      db.prepare('DELETE FROM card_shares WHERE card_id = ?').run(id);
      const add = db.prepare('INSERT INTO card_shares (card_id, user_id) VALUES (?, ?)');
      for (const u of new Set(userIds)) add.run(id, u);
      // Drop favourites of people who lost access.
      db.prepare(
        'DELETE FROM favorites WHERE card_id = ? AND user_id != ? AND user_id NOT IN (SELECT user_id FROM card_shares WHERE card_id = ?)',
      ).run(id, request.user.id, id);
      db.prepare('UPDATE cards SET updated_at = ? WHERE id = ?').run(Date.now(), id);
    })();
    return one(request.user.id, id);
  });

  // Your own cards as JSON, so your data is never locked in.
  app.get('/api/export', async (request, reply) => {
    const cards = db
      .prepare(
        `SELECT name, card_number, barcode_value, barcode_type, color, notes, logo_domain, created_at, updated_at
         FROM cards WHERE owner_id = ? ORDER BY name COLLATE NOCASE`,
      )
      .all(request.user.id);
    const date = new Date().toISOString().slice(0, 10);
    reply.header('Content-Disposition', `attachment; filename="loyalty-cards-${date}.json"`);
    return { format: 'bmc-loyalty-cards', version: 1, exported_at: new Date().toISOString(), cards };
  });
}
