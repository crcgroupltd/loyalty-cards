import { h, clear, toast } from './js/dom.js';
import { preloadBarcodes } from './js/barcode.js';
import { clearDevice } from './js/store.js';
import { ApiError, OfflineError, api, loadMirror, navigate, onChange, refreshCards, state } from './js/state.js';
import { linkView, loginView, setupView } from './js/views-auth.js';
import { cardView, editView, listView } from './js/views-cards.js';
import { importView } from './js/views-import.js';
import { adminView, settingsView } from './js/views-settings.js';

const root = document.getElementById('app');

// ---- Passkeys (library loads only when used) ----
const webauthn = () => import('./vendor/simplewebauthn/index.js');

async function passkeyLogin() {
  const { startAuthentication } = await webauthn();
  const optionsJSON = await api('POST', '/api/auth/passkey/login/options');
  const response = await startAuthentication({ optionsJSON });
  await api('POST', '/api/auth/passkey/login/verify', { response });
}

async function addPasskey(label) {
  const { startRegistration } = await webauthn();
  const optionsJSON = await api('POST', '/api/auth/passkey/register/options');
  const response = await startRegistration({ optionsJSON });
  await api('POST', '/api/auth/passkey/register/verify', { response, label });
}

async function reloadMe() {
  const me = await api('GET', '/api/me');
  state.me = me.user;
  state.passkeys = me.passkeys;
}

async function signedIn() {
  await reloadMe();
  await refreshCards();
  navigate('#/');
}

async function signOut() {
  await api('POST', '/api/auth/logout').catch(() => {});
  await clearDevice();
  Object.assign(state, { me: null, cards: [], passkeys: [], users: [] });
  navigate('#/login');
}

// ---- Routing ----
const routes = [
  [/^#\/setup$/, () => setupView({ signedIn }), { public: true }],
  [/^#\/login$/, () => loginView({ signedIn, passkeyLogin }), { public: true }],
  [/^#\/link\/([\w-]+)$/, ([token]) => linkView({ token, signedIn }), { public: true }],
  [/^#\/card\/(\d+)\/edit$/, ([id]) => editView({ id })],
  [/^#\/card\/(\d+)$/, ([id], cleanup) => cardView({ id }, cleanup)],
  [/^#\/add$/, () => editView({})],
  [/^#\/import$/, () => importView()],
  [/^#\/settings$/, () => settingsView({ signOut, addPasskey, reloadMe })],
  [/^#\/admin$/, () => adminView()],
  [/^(#\/?)?$/, () => listView()],
];

let cleanups = [];
let renderSeq = 0;

async function render() {
  const seq = ++renderSeq;
  cleanups.forEach((fn) => fn());
  cleanups = [];
  const hash = location.hash;
  const match = routes.find(([re]) => re.test(hash));
  if (!match) return navigate('#/');
  const [re, view, opts = {}] = match;
  if (!opts.public && !state.me) return navigate('#/login');
  try {
    const el = await view(hash.match(re).slice(1), (fn) => cleanups.push(fn));
    if (seq !== renderSeq) return;
    clear(root).append(el);
    window.scrollTo(0, 0);
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) return navigate('#/login');
    if (seq !== renderSeq) return;
    clear(root).append(h('p', { class: 'muted center' }, e.message), h('p', { class: 'center' }, h('a', { href: '#/', class: 'btn' }, 'Back to cards')));
  }
}

window.addEventListener('hashchange', render);

// Re-render the list when going on/offline so edit controls appear/disappear.
onChange(() => {
  if (/^(#\/?)?$/.test(location.hash)) render();
});

// ---- Startup ----
async function boot() {
  try {
    state.status = await api('GET', '/api/status');
  } catch (e) {
    if (!(e instanceof OfflineError)) throw e;
    // No connection: show what this device has saved, read-only.
    if (await loadMirror()) {
      state.offline = true;
      if (!location.hash.startsWith('#/card/')) location.hash = '#/';
      return render();
    }
    clear(root).append(h('p', { class: 'muted center' }, 'You are offline and no cards are saved on this device yet.'));
    return;
  }

  if (state.status.setupRequired) {
    location.hash = '#/setup';
    return render();
  }
  try {
    await reloadMe();
    await refreshCards();
    preloadBarcodes();
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) {
      await clearDevice();
      if (!/^#\/(login|link\/)/.test(location.hash)) location.hash = '#/login';
    } else if (e instanceof OfflineError && (await loadMirror())) {
      state.offline = true;
    } else throw e;
  }
  if (/^#\/(login|setup)$/.test(location.hash) && state.me) location.hash = '#/';
  render();
}

// Refresh cards when the app comes back to the foreground or online.
async function resync() {
  if (!state.me) return;
  try {
    await refreshCards();
  } catch {}
}
document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && resync());
window.addEventListener('online', resync);

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

boot().catch((e) => {
  clear(root).append(h('p', { class: 'muted center' }, `Something went wrong: ${e.message}`));
  toast(e.message, 'error');
});
