// telegram.js — signing in with Telegram, and asking for a location.
//
// The site is read in two places and behaves differently in each:
//
//   inside Telegram   the client hands the page a signed `initData`, so the
//     (Mini App)      reader is signed in without touching anything, and
//                     Telegram's own location manager can be asked for a fix
//
//   an ordinary       the reader presses the Telegram login button; location
//     browser         has to be asked for in their chat with the bot, and the
//                     answer reaches the site through the webhook
//
// Every call here is safe to make when the API is not configured, when the
// Telegram script is blocked, or when the reader is offline: each one settles
// into «not available» rather than throwing.

const SDK = 'https://telegram.org/js/telegram-web-app.js';
const WIDGET = 'https://telegram.org/js/telegram-widget.js?22';

// ---------- the Mini App context ----------

// Telegram opens the page with its parameters in the hash. They are also the
// only reliable sign of a Mini App before the SDK has loaded.
export const inTelegram = () =>
  typeof window !== 'undefined' &&
  (/[#&?]tgWebApp/.test(window.location.hash) ||
    typeof window.TelegramWebviewProxy !== 'undefined' ||
    Boolean(window.Telegram?.WebApp?.initData));

const scripts = new Map();

function loadScript(src, attrs) {
  if (typeof document === 'undefined') return Promise.reject(new Error('no dom'));
  if (scripts.has(src)) return scripts.get(src);
  const p = new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = src;
    el.async = true;
    Object.entries(attrs || {}).forEach(([k, v]) => el.setAttribute(k, v));
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error(`load ${src}`));
    document.head.appendChild(el);
  });
  scripts.set(src, p);
  return p;
}

let sdk = null;

// Loads Telegram's script — only inside Telegram, so an ordinary reader of the
// book never fetches it — and then takes tgWebApp* out of the hash, which the
// reader's route otherwise shares. The promise is kept rather than the result,
// so two callers racing on load still share one `ready()`.
export function initMiniApp() {
  if (sdk) return sdk;
  if (!inTelegram()) return Promise.resolve(null);
  sdk = loadScript(SDK)
    .then(() => {
      const tg = window.Telegram?.WebApp || null;
      if (!tg) return null;
      try {
        tg.ready();
        tg.expand?.();
      } catch { /* an older client: the page works regardless */ }
      cleanHash();
      return tg;
    })
    .catch(() => null);
  return sdk;
}

// The SDK has read the hash by now; leaving it in place would make the reader
// share a URL carrying their signed initData.
function cleanHash() {
  const hash = window.location.hash.replace(/^#/, '');
  if (!/(^|[&?])tgWebApp/.test(hash)) return;
  const kept = hash
    .split(/[&]/)
    .filter((part) => part && !part.startsWith('tgWebApp'))
    .join('&');
  try {
    window.history.replaceState(null, '', window.location.pathname + window.location.search + (kept ? `#${kept}` : ''));
  } catch { /* history is unavailable in some webviews */ }
}

// ---------- the API ----------

async function call(path, options) {
  const res = await fetch(path, {
    credentials: 'same-origin',
    cache: 'no-store',
    ...options,
    headers: { 'content-type': 'application/json', ...(options && options.headers) },
  });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, ...body };
}

const post = (path, body) =>
  call(path, { method: 'POST', body: JSON.stringify(body || {}) });

export const fetchMe = () => call('/api/me');
export const logout = () => post('/api/logout');
export const loginWithWidget = (payload) => post('/api/login/widget', payload);
export const loginWithInitData = (initData) => post('/api/login/webapp', { initData });
export const saveLocation = (location) => post('/api/location', location);
export const fetchLocation = () => call('/api/location');
export const forgetLocation = () => call('/api/location', { method: 'DELETE' });
export const requestLocationViaBot = () => post('/api/location/request');

// ---------- the login button ----------

// Telegram's widget only renders itself into a container it is appended to,
// and only talks back through a global. `onAuth` gets the signed payload.
export function mountLoginButton(container, { bot, onAuth, lang = 'fa' }) {
  if (!container || !bot) return () => {};
  const name = `ketabTgAuth_${Math.random().toString(36).slice(2, 9)}`;
  window[name] = (user) => onAuth(user);

  const el = document.createElement('script');
  el.src = WIDGET;
  el.async = true;
  el.setAttribute('data-telegram-login', bot);
  el.setAttribute('data-size', 'medium');
  el.setAttribute('data-radius', '8');
  el.setAttribute('data-userpic', 'false');
  el.setAttribute('data-request-access', 'write');   // lets the bot message back
  el.setAttribute('data-lang', lang);
  el.setAttribute('data-onauth', `${name}(user)`);
  container.appendChild(el);

  return () => {
    delete window[name];
    container.replaceChildren();
  };
}

// ---------- location ----------

export const NO_LOCATION = { ok: false, reason: 'unavailable' };

// Telegram's own location manager (Bot API 8.0). Older clients, and clients
// where the reader has refused access, resolve to a reason instead of a fix.
function miniAppLocation(tg) {
  return new Promise((resolve) => {
    const lm = tg.LocationManager;
    if (!lm || !tg.isVersionAtLeast?.('8.0')) { resolve({ ok: false, reason: 'old_client' }); return; }

    const ask = () => {
      if (!lm.isLocationAvailable) { resolve({ ok: false, reason: 'unavailable' }); return; }
      lm.getLocation((loc) => {
        if (!loc) { resolve({ ok: false, reason: 'denied', openSettings: () => lm.openSettings?.() }); return; }
        resolve({
          ok: true,
          location: {
            latitude: loc.latitude,
            longitude: loc.longitude,
            accuracy: loc.horizontal_accuracy ?? null,
            source: 'miniapp',
          },
        });
      });
    };

    if (lm.isInited) ask();
    else lm.init(ask);
  });
}

// Outside Telegram there is no Telegram location API at all, so the browser's
// own is the honest fallback — the reader is told which one is being used.
function browserLocation() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) { resolve({ ok: false, reason: 'unavailable' }); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({
        ok: true,
        location: {
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy ?? null,
          source: 'browser',
        },
      }),
      (err) => resolve({ ok: false, reason: err && err.code === 1 ? 'denied' : 'unavailable' }),
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 60000 }
    );
  });
}

export async function readLocation() {
  const tg = await initMiniApp();
  if (tg) {
    const viaTelegram = await miniAppLocation(tg);
    if (viaTelegram.ok || viaTelegram.reason === 'denied') return viaTelegram;
  }
  return browserLocation();
}
