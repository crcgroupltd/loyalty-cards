// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 CRC Group LTD

import { h, field, toast } from './dom.js';
import { api, navigate, state } from './state.js';

const DEFAULT_SOURCE_URL = 'https://github.com/BossManC0/loyalty-cards';

// AGPL section 13: every user of a hosted copy is offered its source code.
export function sourceFooter() {
  const url = state.status?.sourceUrl ?? DEFAULT_SOURCE_URL;
  return h('footer', { class: 'source-footer' },
    'Loyalty Cards is free software under the AGPL-3.0. ',
    h('a', { href: url, target: '_blank', rel: 'noopener' }, 'Source code'));
}

// Wraps a form submit: disables the button and shows errors inline.
export function formHandler(handler) {
  return async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type=submit]');
    const error = form.querySelector('.form-error');
    if (error) error.textContent = '';
    if (button) button.disabled = true;
    try {
      await handler(new FormData(form), form);
    } catch (e) {
      if (error) error.textContent = e.message;
      else toast(e.message, 'error');
    } finally {
      if (button) button.disabled = false;
    }
  };
}

const passwordInput = (name = 'password', autocomplete = 'new-password') =>
  h('input', { type: 'password', name, required: true, minlength: '10', autocomplete });

function authPage(title, intro, ...content) {
  return h('section', { class: 'auth' },
    h('img', { src: '/icons/icon-192.png', alt: '', class: 'auth-logo', width: '72', height: '72' }),
    h('h1', null, title),
    intro && h('p', { class: 'muted' }, intro),
    ...content,
    sourceFooter(),
  );
}

export function setupView({ signedIn }) {
  return authPage('Set up your wallet', 'Create the admin account. The setup token is in your server logs or your SETUP_TOKEN setting.',
    h('form', { class: 'stack', onsubmit: formHandler(async (fd) => {
      await api('POST', '/api/setup', Object.fromEntries(fd));
      await signedIn();
    }) },
      field('Setup token', h('input', { name: 'token', required: true, autocomplete: 'off' })),
      field('Your name', h('input', { name: 'name', required: true, autocomplete: 'username', maxlength: '40' })),
      field('Password', passwordInput(), 'At least 10 characters. You can add Face ID (a passkey) after.'),
      h('p', { class: 'form-error', role: 'alert' }),
      h('button', { type: 'submit', class: 'btn btn-primary' }, 'Create admin account'),
    ),
  );
}

export function loginView({ signedIn, passkeyLogin }) {
  return authPage('Loyalty Cards', null,
    window.PublicKeyCredential &&
      h('button', { class: 'btn btn-primary btn-wide', onclick: async (e) => {
        const button = e.currentTarget;
        button.disabled = true;
        try {
          await passkeyLogin();
          await signedIn();
        } catch (err) {
          if (err.name !== 'NotAllowedError') toast(err.message, 'error');
        } finally {
          button.disabled = false;
        }
      } }, 'Sign in with passkey'),
    h('p', { class: 'divider' }, 'or use your password'),
    h('form', { class: 'stack', onsubmit: formHandler(async (fd) => {
      await api('POST', '/api/auth/login', Object.fromEntries(fd));
      await signedIn();
    }) },
      field('Name', h('input', { name: 'name', required: true, autocomplete: 'username', autocapitalize: 'none' })),
      field('Password', passwordInput('password', 'current-password')),
      h('p', { class: 'form-error', role: 'alert' }),
      h('button', { type: 'submit', class: 'btn' }, 'Sign in'),
    ),
  );
}

// Invite (signup) and password-reset links share one URL shape.
export async function linkView({ token, signedIn }) {
  let link;
  try {
    link = await api('GET', `/api/auth/link/${encodeURIComponent(token)}`);
  } catch (e) {
    return authPage('Link not valid', e.message, h('a', { href: '#/login', class: 'btn' }, 'Go to sign in'));
  }
  if (link.kind === 'signup') {
    return authPage('Join the wallet', 'You were invited. Pick a name and password.',
      h('form', { class: 'stack', onsubmit: formHandler(async (fd) => {
        await api('POST', '/api/auth/signup', { token, ...Object.fromEntries(fd) });
        await signedIn();
        navigate('#/settings');
        toast('Welcome! Add a passkey to sign in with Face ID.');
      }) },
        field('Your name', h('input', { name: 'name', required: true, autocomplete: 'username', maxlength: '40' })),
        field('Password', passwordInput(), 'At least 10 characters.'),
        h('p', { class: 'form-error', role: 'alert' }),
        h('button', { type: 'submit', class: 'btn btn-primary' }, 'Create account'),
      ),
    );
  }
  return authPage(`Reset password for ${link.name}`, 'This signs you out on your other devices.',
    h('form', { class: 'stack', onsubmit: formHandler(async (fd) => {
      await api('POST', '/api/auth/reset', { token, ...Object.fromEntries(fd) });
      await signedIn();
      toast('Password changed');
    }) },
      field('New password', passwordInput()),
      h('p', { class: 'form-error', role: 'alert' }),
      h('button', { type: 'submit', class: 'btn btn-primary' }, 'Set password'),
    ),
  );
}
