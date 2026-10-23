// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 CRC Group LTD

import { FORMATS, FORMAT_KEYS, validate } from '../formats.js';
import { renderBarcode } from './barcode.js';
import { h, clear, field, initials, toast } from './dom.js';
import { decodeImage, startLiveScan } from './scan.js';
import { api, navigate, refreshCards, state } from './state.js';
import { formHandler } from './views-auth.js';

const icon = (name) => h('span', { class: `icon icon-${name}`, 'aria-hidden': 'true' });

export function topBar(title, { back, actions = [] } = {}) {
  return h('header', { class: 'topbar' },
    back ? h('a', { href: back, class: 'btn-icon', 'aria-label': 'Back' }, icon('back')) : h('span', { class: 'topbar-spacer' }),
    h('h1', { class: 'topbar-title' }, title),
    h('div', { class: 'topbar-actions' }, ...actions),
  );
}

export function offlineBanner() {
  if (!state.offline) return null;
  const when = state.syncedAt ? new Date(state.syncedAt).toLocaleString() : 'unknown';
  return h('p', { class: 'banner' }, `Offline. Showing cards saved on this device (last synced ${when}). Editing is off until you reconnect.`);
}

function logoOrInitials(card, cls) {
  if (card.logo_url) return h('img', { class: cls, src: card.logo_url, alt: '', loading: 'lazy' });
  return h('span', { class: `${cls} logo-initials` }, initials(card.name));
}

function tile(card) {
  return h('a', { href: `#/card/${card.id}`, class: 'tile', style: { '--card-color': card.color } },
    logoOrInitials(card, 'tile-logo'),
    h('span', { class: 'tile-name' }, card.name),
    !card.is_owner && h('span', { class: 'tile-badge' }, `from ${card.owner_name}`),
  );
}

export function listView() {
  const grid = h('div');
  const search = h('input', {
    type: 'search', class: 'search', placeholder: 'Search cards', 'aria-label': 'Search cards',
    oninput: () => draw(),
  });

  function draw() {
    clear(grid);
    const q = search.value.trim().toLowerCase();
    const cards = state.cards.filter((c) => !q || c.name.toLowerCase().includes(q) || c.card_number.toLowerCase().includes(q));
    if (state.cards.length === 0) {
      grid.append(h('div', { class: 'empty' },
        h('p', null, 'No cards yet.'),
        !state.offline && h('div', { class: 'row' },
          h('a', { href: '#/add', class: 'btn btn-primary' }, 'Add a card'),
          h('a', { href: '#/import', class: 'btn' }, 'Import screenshots'),
        ),
      ));
      return;
    }
    const favs = cards.filter((c) => c.favorite);
    if (favs.length && !q) {
      grid.append(h('h2', { class: 'section-title' }, 'Favourites'), h('div', { class: 'tiles' }, favs.map(tile)));
      grid.append(h('h2', { class: 'section-title' }, 'All cards'));
    }
    grid.append(cards.length ? h('div', { class: 'tiles' }, cards.map(tile)) : h('p', { class: 'muted center' }, 'No matches'));
  }
  draw();

  return h('section', null,
    topBar('Cards', {
      actions: [
        !state.offline && h('a', { href: '#/import', class: 'btn-icon', 'aria-label': 'Import cards' }, icon('import')),
        h('a', { href: '#/settings', class: 'btn-icon', 'aria-label': 'Settings' }, icon('settings')),
        !state.offline && h('a', { href: '#/add', class: 'btn-icon btn-icon-primary', 'aria-label': 'Add card' }, icon('add')),
      ],
    }),
    offlineBanner(),
    state.cards.length > 0 && h('div', { class: 'search-wrap' }, search),
    grid,
  );
}

// Keeps the screen on while a barcode is shown (iOS 18.4+ in home-screen apps).
function keepAwake() {
  let lock = null;
  let active = true;
  const request = async () => {
    if (!active || !('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
    try {
      lock = await navigator.wakeLock.request('screen');
    } catch {}
  };
  const onVisible = () => request();
  document.addEventListener('visibilitychange', onVisible);
  request();
  return () => {
    active = false;
    document.removeEventListener('visibilitychange', onVisible);
    lock?.release().catch(() => {});
  };
}

export async function cardView({ id }, cleanup) {
  const card = state.cards.find((c) => c.id === Number(id));
  if (!card) return h('section', null, topBar('Not found', { back: '#/' }), h('p', { class: 'muted center' }, 'This card is not available.'));

  cleanup(keepAwake());
  const star = h('button', {
    class: `btn-icon ${card.favorite ? 'is-on' : ''}`, 'aria-label': 'Favourite', 'aria-pressed': String(card.favorite),
    disabled: state.offline,
    onclick: async () => {
      try {
        await api('PUT', `/api/cards/${card.id}/favorite`, { favorite: !card.favorite });
        await refreshCards();
        navigate(`#/card/${card.id}`);
      } catch (e) {
        toast(e.message, 'error');
      }
    },
  }, icon('star'));

  return h('section', { class: 'card-view' },
    topBar(card.name, {
      back: '#/',
      actions: [star, card.is_owner && !state.offline && h('a', { href: `#/card/${card.id}/edit`, class: 'btn-icon', 'aria-label': 'Edit' }, icon('edit'))],
    }),
    h('div', { class: 'card-face', style: { '--card-color': card.color } },
      h('div', { class: 'card-head' }, logoOrInitials(card, 'card-logo'), h('span', null, card.name)),
      h('div', { class: 'card-body' },
        await renderBarcode(card.barcode_type, card.barcode_value),
        h('p', { class: 'card-number' }, card.card_number || card.barcode_value),
      ),
    ),
    h('p', { class: 'muted center small' }, 'Turn your screen brightness up if the scanner struggles.'),
    card.notes && h('p', { class: 'notes' }, card.notes),
    !card.is_owner && h('p', { class: 'muted center' }, `Shared with you by ${card.owner_name}`),
    card.is_owner && !state.offline && await shareSection(card),
  );
}

async function shareSection(card) {
  if (!state.users.length) {
    try {
      state.users = await api('GET', '/api/users');
    } catch {}
  }
  if (!state.users.length) return null;
  const shared = new Set(card.shared_with);
  const boxes = state.users.map((u) => h('label', { class: 'check' },
    h('input', { type: 'checkbox', value: String(u.id), checked: shared.has(u.id) }), u.name));
  return h('details', { class: 'panel' },
    h('summary', null, card.shared_with.length ? `Shared with ${card.shared_with.length}` : 'Share with household'),
    h('div', { class: 'stack' }, ...boxes,
      h('button', { class: 'btn', onclick: async () => {
        const ids = boxes.map((b) => b.querySelector('input')).filter((i) => i.checked).map((i) => Number(i.value));
        try {
          await api('PUT', `/api/cards/${card.id}/shares`, { user_ids: ids });
          await refreshCards();
          toast('Sharing updated');
          navigate(`#/card/${card.id}`);
        } catch (e) {
          toast(e.message, 'error');
        }
      } }, 'Save sharing')),
  );
}

export function typeSelect(value, onchange) {
  return h('select', { name: 'barcode_type', required: true, value: value ?? '', onchange },
    !value && h('option', { value: '' }, 'Choose type…'),
    FORMAT_KEYS.map((k) => h('option', { value: k }, FORMATS[k].label)));
}

// Full-screen camera scanner. Resolves to { type, value } or null if closed.
export function scanDialog() {
  return new Promise((resolve) => {
    const video = h('video', { class: 'scan-video', playsinline: true, muted: true });
    const msg = h('p', { class: 'scan-msg' }, 'Starting camera…');
    let stop = () => {};
    const close = (result) => {
      stop();
      overlay.remove();
      resolve(result);
    };
    const overlay = h('div', { class: 'scan-overlay', role: 'dialog', 'aria-label': 'Scan barcode' },
      video, h('div', { class: 'scan-frame' }), msg,
      h('button', { class: 'btn scan-close', onclick: () => close(null) }, 'Cancel'));
    document.body.append(overlay);
    startLiveScan(video, (found) => close(found))
      .then((s) => {
        stop = s;
        msg.textContent = 'Point at the barcode';
      })
      .catch((e) => {
        msg.textContent = e.name === 'NotAllowedError' ? 'Camera access was denied. Allow it in Settings, or use a photo.' : `Camera unavailable: ${e.message}`;
      });
  });
}

export async function editView({ id }) {
  const existing = id ? state.cards.find((c) => c.id === Number(id) && c.is_owner) : null;
  if (id && !existing) return h('section', null, topBar('Not found', { back: '#/' }), h('p', { class: 'muted center' }, 'You can only edit your own cards.'));
  if (state.offline) return h('section', null, topBar('Offline', { back: '#/' }), offlineBanner());

  const c = existing ?? { name: '', card_number: '', barcode_value: '', barcode_type: '', color: '', notes: '' };
  const name = h('input', { name: 'name', required: true, maxlength: '60', value: c.name, autocomplete: 'off' });
  const value = h('input', { name: 'barcode_value', required: true, value: c.barcode_value, autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false', oninput: () => preview() });
  const number = h('input', { name: 'card_number', value: c.card_number, autocomplete: 'off', placeholder: 'Same as barcode' });
  const type = typeSelect(c.barcode_type, () => preview());
  const color = h('input', { type: 'color', name: 'color', value: c.color || '#0f766e' });
  const notes = h('textarea', { name: 'notes', rows: '2', maxlength: '2000' }, c.notes);
  const previewBox = h('div', { class: 'preview' });
  let pendingLogo; // undefined = unchanged, null = remove, { file, domain } = set

  let previewSeq = 0;
  async function preview() {
    const seq = ++previewSeq;
    if (!type.value || !value.value) {
      clear(previewBox);
      return;
    }
    const el = await renderBarcode(type.value, value.value);
    if (seq === previewSeq) clear(previewBox).append(el);
  }
  preview();

  const fill = (found, source) => {
    if (!found) {
      toast(`No barcode found in the ${source}`, 'error');
      return;
    }
    type.value = found.type;
    value.value = found.value;
    if (!number.value) number.placeholder = found.value;
    preview();
    toast(`Read ${FORMATS[found.type].label}`);
  };

  const photoInput = h('input', { type: 'file', accept: 'image/*', hidden: true, onchange: async () => {
    const file = photoInput.files[0];
    photoInput.value = '';
    if (file) fill(await decodeImage(file).catch(() => null), 'photo');
  } });

  const logoArea = state.status?.logos ? logoPicker(existing, name, (choice) => { pendingLogo = choice; }) : null;

  const form = h('form', { class: 'stack', onsubmit: formHandler(async () => {
    const body = {
      name: name.value,
      barcode_type: type.value,
      barcode_value: value.value,
      card_number: number.value,
      color: color.value,
      notes: notes.value,
    };
    const err = validate(body.barcode_type, body.barcode_value);
    if (err) throw new Error(err);
    const saved = existing ? await api('PUT', `/api/cards/${existing.id}`, body) : await api('POST', '/api/cards', body);
    if (pendingLogo !== undefined) {
      await api('PUT', `/api/cards/${saved.id}/logo`, pendingLogo ? pendingLogo : { file: null });
    }
    await refreshCards();
    navigate(`#/card/${saved.id}`);
  }) },
    field('Store name', name),
    h('div', { class: 'row' },
      h('button', { type: 'button', class: 'btn', onclick: async () => {
        const found = await scanDialog();
        if (found) fill(found, 'camera');
      } }, icon('camera'), ' Scan'),
      h('button', { type: 'button', class: 'btn', onclick: () => photoInput.click() }, icon('image'), ' From photo'),
      photoInput,
    ),
    field('Barcode type', type),
    field('Barcode value', value, 'Exactly what the barcode contains. Scanning fills this in.'),
    previewBox,
    field('Card number shown', number, 'Optional, if the printed number differs from the barcode.'),
    logoArea,
    field('Colour', color),
    field('Notes', notes),
    h('p', { class: 'form-error', role: 'alert' }),
    h('button', { type: 'submit', class: 'btn btn-primary' }, existing ? 'Save' : 'Add card'),
    existing && h('button', { type: 'button', class: 'btn btn-danger', onclick: async () => {
      if (!confirm(`Delete ${existing.name}? This removes it for everyone it is shared with.`)) return;
      try {
        await api('DELETE', `/api/cards/${existing.id}`);
        await refreshCards();
        navigate('#/');
      } catch (e) {
        toast(e.message, 'error');
      }
    } }, 'Delete card'),
  );

  return h('section', null, topBar(existing ? 'Edit card' : 'Add card', { back: existing ? `#/card/${existing.id}` : '#/' }), form);
}

function logoPicker(existing, nameInput, onPick) {
  const current = h('div', { class: 'logo-current' });
  const results = h('div', { class: 'logo-results' });
  const showCurrent = (url) => {
    clear(current).append(url ? h('img', { src: url, alt: 'Current logo', class: 'logo-thumb' }) : h('span', { class: 'muted' }, 'No logo'));
  };
  showCurrent(existing?.logo_url);

  const search = async () => {
    const q = nameInput.value.trim();
    if (!q) return toast('Enter the store name first', 'error');
    clear(results).append(h('span', { class: 'muted' }, 'Searching…'));
    try {
      const { results: found } = await api('GET', `/api/logos/search?q=${encodeURIComponent(q)}`);
      clear(results);
      if (!found.length) results.append(h('span', { class: 'muted' }, 'No logos found'));
      for (const r of found) {
        results.append(h('button', { type: 'button', class: 'logo-option', title: `${r.name} (${r.domain})`, onclick: () => {
          onPick({ file: r.file, domain: r.domain });
          showCurrent(r.logo_url);
          clear(results);
        } }, h('img', { src: r.logo_url, alt: r.name, class: 'logo-thumb' }), h('small', null, r.domain)));
      }
    } catch (e) {
      clear(results).append(h('span', { class: 'form-error' }, e.message));
    }
  };

  return h('div', { class: 'field' },
    h('span', { class: 'field-label' }, 'Logo'),
    h('div', { class: 'row' }, current,
      h('button', { type: 'button', class: 'btn', onclick: search }, 'Find logo'),
      h('button', { type: 'button', class: 'btn btn-quiet', onclick: () => { onPick(null); showCurrent(null); } }, 'Remove')),
    results,
  );
}
