// telegram.js — everything that needs the bot token: verifying the two kinds
// of Telegram sign-in payload, and the handful of Bot API calls we make.
//
// Both signatures are HMAC-SHA256 over the same «data check string» — the
// fields sorted by key, joined with newlines — and differ only in the key:
//
//   Login Widget   key = SHA256(bot_token)
//   Mini App       key = HMAC-SHA256("WebAppData", bot_token)
//
// https://core.telegram.org/widgets/login#checking-authorization
// https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app

const enc = new TextEncoder();

async function hmac(key, message) {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(message)));
}

const hex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');

// Compare without leaking where two digests start to differ.
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function dataCheckString(fields) {
  return Object.keys(fields)
    .filter((k) => k !== 'hash')
    .sort()
    .map((k) => `${k}=${fields[k]}`)
    .join('\n');
}

// Telegram signs `auth_date`; anything older than this is a replayed payload.
const MAX_AUTH_AGE = 24 * 60 * 60;

function freshEnough(authDate) {
  const at = Number(authDate);
  if (!Number.isFinite(at)) return false;
  const age = Math.floor(Date.now() / 1000) - at;
  return age >= -60 && age < MAX_AUTH_AGE;   // -60: tolerate a skewed clock
}

// ---------- Login Widget (the button on the website) ----------

// `payload` is the object the widget hands its callback.
export async function verifyLoginWidget(payload, botToken) {
  const fields = {};
  for (const [k, v] of Object.entries(payload || {})) {
    if (v !== null && v !== undefined && typeof v !== 'object') fields[k] = String(v);
  }
  if (!fields.hash || !fields.id || !fields.auth_date) return null;
  if (!freshEnough(fields.auth_date)) return null;

  const secret = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(botToken)));
  const expected = hex(await hmac(secret, dataCheckString(fields)));
  if (!timingSafeEqual(expected, String(fields.hash).toLowerCase())) return null;

  return {
    id: String(fields.id),
    first_name: fields.first_name || '',
    last_name: fields.last_name || '',
    username: fields.username || '',
    photo_url: fields.photo_url || '',
    auth_date: Number(fields.auth_date),
  };
}

// ---------- Mini App (the site opened inside Telegram) ----------

// `initData` is the raw query string from Telegram.WebApp.initData.
export async function verifyInitData(initData, botToken) {
  if (typeof initData !== 'string' || !initData) return null;

  const params = new URLSearchParams(initData);
  const fields = {};
  for (const [k, v] of params) fields[k] = v;
  if (!fields.hash || !fields.auth_date || !fields.user) return null;
  if (!freshEnough(fields.auth_date)) return null;

  const secret = await hmac(enc.encode('WebAppData'), botToken);
  const expected = hex(await hmac(secret, dataCheckString(fields)));
  if (!timingSafeEqual(expected, String(fields.hash).toLowerCase())) return null;

  let user;
  try { user = JSON.parse(fields.user); } catch { return null; }
  if (!user || !user.id) return null;

  return {
    id: String(user.id),
    first_name: user.first_name || '',
    last_name: user.last_name || '',
    username: user.username || '',
    photo_url: user.photo_url || '',
    auth_date: Number(fields.auth_date),
  };
}

// ---------- Bot API ----------

async function callBot(botToken, method, body) {
  const res = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok && data.ok === true, data };
}

// Asks the reader, in their own chat with the bot, to share a location. The
// keyboard button is the only way a bot can obtain one: there is no API that
// reads a user's position without them tapping it.
export function askForLocation(botToken, chatId, text, buttonText) {
  return callBot(botToken, 'sendMessage', {
    chat_id: chatId,
    text,
    reply_markup: {
      keyboard: [[{ text: buttonText, request_location: true }]],
      resize_keyboard: true,
      one_time_keyboard: true,
      is_persistent: false,
    },
  });
}

export function sendMessage(botToken, chatId, text) {
  return callBot(botToken, 'sendMessage', {
    chat_id: chatId,
    text,
    reply_markup: { remove_keyboard: true },
  });
}
