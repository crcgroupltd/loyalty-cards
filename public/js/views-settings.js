// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 CRC Group LTD

import { h, clear, field, toast } from './dom.js';
import { api, navigate, state } from './state.js';
import { offlineBanner, topBar } from './views-cards.js';
import { formHandler, sourceFooter } from './views-auth.js';

const fmtDate = (ms) => (ms ? new Date(ms).toLocaleDateString() : 'never');

export async function settingsView({ signOut, addPasskey, reloadMe }) {
  const offline = state.offline;
  const passkeyList = h('ul', { class: 'list' },
    state.passkeys.length === 0 && h('li', { class: 'muted' }, 'No passkeys yet.'),
    state.passkeys.map((p) => h('li', { class: 'list-row' },
      h('span', { class: 'grow' }, p.label || 'Passkey', h('small', { class: 'muted block' }, `Added ${fmtDate(p.created_at)}, last used ${fmtDate(p.last_used_at)}`)),
      !offline && h('button', { class: 'btn btn-quiet', onclick: async () => {
        if (!confirm('Remove this passkey?')) return;
        await api('DELETE', `/api/auth/passkeys/${encodeURIComponent(p.id)}`).catch((e) => toast(e.message, 'error'));
        await reloadMe();
        navigate('#/settings');
      } }, 'Remove'))),
  );

  return h('section', null,
    topBar('Settings', { back: '#/' }),
    offlineBanner(),
    h('div', { class: 'panel stack' },
      h('p', null, 'Signed in as ', h('strong', null, state.me?.name ?? '')),
      state.me?.isAdmin && !offline && h('a', { href: '#/admin', class: 'btn' }, 'Household and invites'),
    ),
    h('div', { class: 'panel stack' },
      h('h2', null, 'Passkeys'),
      h('p', { class: 'muted' }, 'Sign in with Face ID instead of your password.'),
      passkeyList,
      !offline && window.PublicKeyCredential && h('button', { class: 'btn btn-primary', onclick: async (e) => {
        const button = e.currentTarget;
        button.disabled = true;
        try {
          await addPasskey(navigator.platform?.startsWith('iP') ? 'iPhone' : 'This device');
          await reloadMe();
          toast('Passkey added');
          navigate('#/settings');
        } catch (err) {
          if (err.name !== 'NotAllowedError') toast(err.message, 'error');
        } finally {
          button.disabled = false;
        }
      } }, 'Add a passkey'),
    ),
    !offline && h('details', { class: 'panel' },
      h('summary', null, 'Change password'),
      h('form', { class: 'stack', onsubmit: formHandler(async (fd, form) => {
        await api('POST', '/api/auth/password', Object.fromEntries(fd));
        form.reset();
        toast('Password changed');
      }) },
        field('Current password', h('input', { type: 'password', name: 'current', autocomplete: 'current-password' })),
        field('New password', h('input', { type: 'password', name: 'password', required: true, minlength: '10', autocomplete: 'new-password' })),
        h('p', { class: 'form-error', role: 'alert' }),
        h('button', { type: 'submit', class: 'btn' }, 'Change password'))),
    h('div', { class: 'panel stack' },
      h('h2', null, 'Your data'),
      !offline && h('a', { href: '/api/export', class: 'btn', download: '' }, 'Export my cards (JSON)'),
      h('button', { class: 'btn btn-danger', onclick: signOut }, 'Sign out'),
      h('small', { class: 'muted' }, 'Signing out also removes saved cards from this device.'),
    ),
    sourceFooter(),
  );
}

export async function adminView() {
  if (state.offline) return h('section', null, topBar('Household', { back: '#/settings' }), offlineBanner());
  const [users, invites] = await Promise.all([api('GET', '/api/admin/users'), api('GET', '/api/admin/invites')]);
  const linkBox = h('div');

  const showLink = (title, { url, expires_at }) => {
    const input = h('input', { readonly: true, value: url, onfocus: (e) => e.target.select() });
    clear(linkBox).append(h('div', { class: 'panel stack highlight' },
      h('strong', null, title),
      input,
      h('small', { class: 'muted' }, `Works once, until ${new Date(expires_at).toLocaleString()}. It cannot be shown again.`),
      h('div', { class: 'row' },
        navigator.share && h('button', { class: 'btn btn-primary', onclick: () => navigator.share({ url }).catch(() => {}) }, 'Share'),
        h('button', { class: 'btn', onclick: async () => {
          await navigator.clipboard.writeText(url).then(() => toast('Copied'), () => input.select());
        } }, 'Copy'))));
    linkBox.scrollIntoView({ behavior: 'smooth' });
  };

  const act = async (fn) => {
    try {
      await fn();
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  return h('section', null,
    topBar('Household', { back: '#/settings' }),
    linkBox,
    h('div', { class: 'panel stack' },
      h('h2', null, 'People'),
      h('ul', { class: 'list' }, users.map((u) => h('li', { class: 'list-row' },
        h('span', { class: 'grow' }, u.name, u.is_admin && h('span', { class: 'tag' }, 'admin'),
          h('small', { class: 'muted block' }, `${u.cards} cards, ${u.passkeys} passkeys`)),
        u.id !== state.me.id && h('details', { class: 'menu' },
          h('summary', { class: 'btn btn-quiet' }, 'Manage'),
          h('div', { class: 'menu-items' },
            h('button', { class: 'btn', onclick: () => act(async () => showLink(`Password reset link for ${u.name}`, await api('POST', `/api/admin/users/${u.id}/reset`))) }, 'Reset link'),
            h('button', { class: 'btn', onclick: () => act(async () => {
              await api('PUT', `/api/admin/users/${u.id}`, { is_admin: !u.is_admin });
              navigate('#/admin');
            }) }, u.is_admin ? 'Remove admin' : 'Make admin'),
            h('button', { class: 'btn btn-danger', onclick: () => act(async () => {
              if (!confirm(`Delete ${u.name} and all their cards?`)) return;
              await api('DELETE', `/api/admin/users/${u.id}`);
              navigate('#/admin');
            }) }, 'Delete'))))))),
    h('div', { class: 'panel stack' },
      h('h2', null, 'Invites'),
      h('button', { class: 'btn btn-primary', onclick: () => act(async () => {
        showLink('Invite link', await api('POST', '/api/admin/invites'));
      }) }, 'Create invite link'),
      invites.length > 0 && h('ul', { class: 'list' }, invites.map((i) => h('li', { class: 'list-row' },
        h('span', { class: 'grow' }, i.kind === 'reset' ? `Reset for ${i.for_user}` : 'Invite',
          h('small', { class: 'muted block' }, `Expires ${new Date(i.expires_at).toLocaleString()}`)),
        h('button', { class: 'btn btn-quiet', onclick: () => act(async () => {
          await api('DELETE', `/api/admin/invites/${i.id}`);
          navigate('#/admin');
        }) }, 'Revoke')))),
    ),
  );
}
