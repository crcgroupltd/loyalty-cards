// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 CRC Group LTD

// IndexedDB copy of the signed-in user's cards, so they show with no signal.
const DB_NAME = 'wallet';
const STORE = 'kv';

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run(mode, fn) {
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req?.result);
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export const getMirror = () => run('readonly', (s) => s.get('mirror')).catch(() => null);
export const saveMirror = (mirror) => run('readwrite', (s) => s.put(mirror, 'mirror')).catch(() => {});

// Called on sign-out: removes cards and cached logos from this device.
export async function clearDevice() {
  await run('readwrite', (s) => s.clear()).catch(() => {});
  if ('caches' in self) await caches.delete('logos').catch(() => {});
}
