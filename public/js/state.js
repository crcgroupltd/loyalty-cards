// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 CRC Group LTD

import { getMirror, saveMirror } from './store.js';

export const state = {
  status: null, // { setupRequired, logos }
  me: null, // { id, name, isAdmin }
  passkeys: [],
  cards: [],
  users: [],
  offline: false,
  syncedAt: null,
};

export class ApiError extends Error {
  constructor(status, body) {
    super(body?.error ?? `Request failed (${status})`);
    this.status = status;
    this.body = body;
  }
}

export class OfflineError extends Error {
  constructor() {
    super('You are offline');
  }
}

const listeners = new Set();
export const onChange = (fn) => listeners.add(fn);
export const emit = () => listeners.forEach((fn) => fn());

export async function api(method, url, body) {
  const init = { method, credentials: 'same-origin', headers: {} };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) {
    init.headers['content-type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(url, init);
  } catch {
    setOffline(true);
    throw new OfflineError();
  }
  setOffline(false);
  const data = res.headers.get('content-type')?.includes('application/json') ? await res.json() : null;
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}

function setOffline(value) {
  if (state.offline !== value) {
    state.offline = value;
    emit();
  }
}

// Pulls the full card list and saves it to the device for offline use.
export async function refreshCards() {
  const data = await api('GET', '/api/cards');
  state.cards = data.cards;
  state.syncedAt = data.synced_at;
  await saveMirror({ me: state.me, cards: state.cards, syncedAt: state.syncedAt });
  emit();
}

export async function loadMirror() {
  const mirror = await getMirror();
  if (!mirror) return false;
  state.me = mirror.me;
  state.cards = mirror.cards;
  state.syncedAt = mirror.syncedAt;
  return true;
}

export const navigate = (hash) => {
  if (location.hash === hash) window.dispatchEvent(new HashChangeEvent('hashchange'));
  else location.hash = hash;
};
