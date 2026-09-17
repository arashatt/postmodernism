// index.js — the whole server side of the site.
//
// Everything that is not /api/… is a static file, handed straight to the
// assets binding (which keeps the SPA fallback from wrangler.json). The API
// exists for two things the browser cannot do by itself:
//
//   · sign-in       a Telegram payload is only trustworthy once its HMAC has
//                   been checked against the bot token, which is a secret
//   · location      a bot can ask a reader for their position, but the answer
//                   arrives at the webhook, not in the page
//
// With no TELEGRAM_BOT_TOKEN / SESSION_SECRET configured the API reports
// itself unconfigured, the reader is never shown a sign-in box, and the site
// behaves exactly as it did before.
//
// Bindings (see README → «ورود با تلگرام»):
//   TELEGRAM_BOT_TOKEN      secret   from @BotFather
//   SESSION_SECRET          secret   any long random string
//   TELEGRAM_BOT_USERNAME   var      the bot's @name, without the @
//   TELEGRAM_WEBHOOK_SECRET secret   optional; required for the webhook
//   LOCATIONS               KV       optional; required for the bot flow

import { verifyLoginWidget, verifyInitData, askForLocation, sendMessage } from './telegram.js';
import * as session from './session.js';

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });

const configured = (env) => Boolean(env.TELEGRAM_BOT_TOKEN && env.SESSION_SECRET);

// Location is kept for as long as a session lasts and no longer.
const LOCATION_TTL = session.SESSION_TTL;
const locKey = (id) => `loc:${id}`;
const trailKey = (id) => `trail:${id}`;

// How many recent points the map draws a path through. A live location that
// runs for hours would otherwise grow without bound.
const TRAIL_MAX = 60;

// A fix posted by the page counts as live for this long after it arrives. The
// page re-posts far more often than this, so the badge stays on while it is
// tracking and goes out by itself once the tab is closed.
const DEVICE_LIVE_GRACE = 90;

async function readBody(request) {
  try { return await request.json(); } catch { return null; }
}

async function getLocation(env, id) {
  if (!env.LOCATIONS) return null;
  return env.LOCATIONS.get(locKey(id), 'json').catch(() => null);
}

function putLocation(env, id, loc) {
  if (!env.LOCATIONS) return Promise.resolve(false);
  return env.LOCATIONS
    .put(locKey(id), JSON.stringify(loc), { expirationTtl: LOCATION_TTL })
    .then(() => true)
    .catch(() => false);
}

async function getTrail(env, id) {
  if (!env.LOCATIONS) return [];
  const rows = await env.LOCATIONS.get(trailKey(id), 'json').catch(() => null);
  return Array.isArray(rows) ? rows : [];
}

// Appends a point to the path the map draws. Points that repeat the previous
// one to five decimal places (about a metre) are dropped: a phone reporting a
// live location while its owner sits still would otherwise fill the trail.
async function pushTrail(env, id, loc) {
  if (!env.LOCATIONS) return;
  const trail = await getTrail(env, id);
  const last = trail[trail.length - 1];
  const same = last
    && Math.abs(last.latitude - loc.latitude) < 1e-5
    && Math.abs(last.longitude - loc.longitude) < 1e-5;
  if (same) return;
  trail.push({ latitude: loc.latitude, longitude: loc.longitude, at: loc.at });
  await env.LOCATIONS
    .put(trailKey(id), JSON.stringify(trail.slice(-TRAIL_MAX)), { expirationTtl: LOCATION_TTL })
    .catch(() => {});
}

function clearTrail(env, id) {
  if (!env.LOCATIONS) return Promise.resolve();
  return env.LOCATIONS.delete(trailKey(id)).catch(() => {});
}

// A Mini App sends the initData it was opened with; the website sends what the
// login widget handed its callback. Either way the reply is the same session.
async function signIn(request, url, env, user) {
  if (!user) return json({ error: 'bad_signature' }, 401);
  const token = await session.issue(user, env.SESSION_SECRET);
  const claims = await session.read(token, env.SESSION_SECRET);
  return json(
    { user: publicUser(claims), location: await getLocation(env, claims.id) },
    200,
    { 'set-cookie': session.cookie(token, url) }
  );
}

const publicUser = (claims) => claims && ({
  id: claims.id, name: claims.name, username: claims.username, photo: claims.photo,
});

async function api(request, url, env) {
  const path = url.pathname.replace(/\/+$/, '') || '/api';
  const method = request.method.toUpperCase();

  // The webhook is Telegram talking to us, not a reader: no session involved.
  if (path === '/api/telegram/webhook' && method === 'POST') return webhook(request, env);

  if (path === '/api/me' && method === 'GET') {
    const base = { configured: configured(env), bot: env.TELEGRAM_BOT_USERNAME || '' };
    if (!base.configured) return json({ ...base, user: null, location: null });
    const claims = await session.fromRequest(request, env.SESSION_SECRET);
    if (!claims) return json({ ...base, user: null, location: null });
    return json({ ...base, user: publicUser(claims), location: await getLocation(env, claims.id) });
  }

  if (!configured(env)) return json({ error: 'not_configured' }, 503);

  if (path === '/api/login/widget' && method === 'POST') {
    const body = await readBody(request);
    return signIn(request, url, env, await verifyLoginWidget(body, env.TELEGRAM_BOT_TOKEN));
  }

  if (path === '/api/login/webapp' && method === 'POST') {
    const body = await readBody(request);
    return signIn(request, url, env, await verifyInitData(body && body.initData, env.TELEGRAM_BOT_TOKEN));
  }

  if (path === '/api/logout' && method === 'POST') {
    return json({ ok: true }, 200, { 'set-cookie': session.clearCookie(url) });
  }

  // Everything below belongs to a signed-in reader.
  const claims = await session.fromRequest(request, env.SESSION_SECRET);
  if (!claims) return json({ error: 'unauthenticated' }, 401);

  if (path === '/api/location' && method === 'GET') {
    const [location, trail] = await Promise.all([
      getLocation(env, claims.id),
      getTrail(env, claims.id),
    ]);
    return json({ location, trail });
  }

  // The page already has a fix (Mini App location manager, or the browser's
  // own geolocation) and is handing it over to be remembered.
  if (path === '/api/location' && method === 'POST') {
    const body = await readBody(request);
    const lat = Number(body && body.latitude);
    const lon = Number(body && body.longitude);
    if (!Number.isFinite(lat) || Math.abs(lat) > 90 || !Number.isFinite(lon) || Math.abs(lon) > 180) {
      return json({ error: 'bad_location' }, 400);
    }
    const loc = {
      latitude: lat,
      longitude: lon,
      accuracy: Number.isFinite(Number(body.accuracy)) ? Number(body.accuracy) : null,
      source: body.source === 'browser' ? 'browser' : 'miniapp',
      at: Math.floor(Date.now() / 1000),
      // A device that keeps sending while the map is open is live in the same
      // sense a Telegram live location is; it just expires much sooner.
      liveUntil: body.live ? Math.floor(Date.now() / 1000) + DEVICE_LIVE_GRACE : null,
    };
    const stored = await putLocation(env, claims.id, loc);
    if (stored) await pushTrail(env, claims.id, loc);
    return json({ location: loc, stored });
  }

  if (path === '/api/location' && method === 'DELETE') {
    if (env.LOCATIONS) {
      await env.LOCATIONS.delete(locKey(claims.id)).catch(() => {});
      await clearTrail(env, claims.id);
    }
    return json({ location: null, trail: [] });
  }

  // Ask the bot to ask the reader. The answer comes back at the webhook, so
  // without somewhere to keep it this flow has no way to complete.
  if (path === '/api/location/request' && method === 'POST') {
    if (!env.LOCATIONS) return json({ error: 'no_storage' }, 501);

    const throttle = `ask:${claims.id}`;
    if (await env.LOCATIONS.get(throttle).catch(() => null)) return json({ error: 'too_soon' }, 429);
    await env.LOCATIONS.put(throttle, '1', { expirationTtl: 60 }).catch(() => {});

    const { ok, data } = await askForLocation(
      env.TELEGRAM_BOT_TOKEN,
      claims.id,
      'برای فرستادن موقعیتتان دکمهٔ زیر را بزنید.',
      '📍 فرستادن موقعیت'
    );
    if (ok) return json({ sent: true });
    // 403 is Telegram's «this user has never started the bot», which the
    // reader fixes by opening the chat once.
    const blocked = data && (data.error_code === 403 || data.error_code === 400);
    return json({ sent: false, error: blocked ? 'start_bot_first' : 'telegram_error' }, blocked ? 409 : 502);
  }

  return json({ error: 'not_found' }, 404);
}

// ---------- webhook ----------

async function webhook(request, env) {
  // Unsigned updates are refused outright: the URL is guessable, the secret
  // header is not. (Telegram sends it when setWebhook was given one.)
  if (!env.TELEGRAM_WEBHOOK_SECRET || !env.TELEGRAM_BOT_TOKEN) return json({ error: 'not_configured' }, 503);
  if (request.headers.get('x-telegram-bot-api-secret-token') !== env.TELEGRAM_WEBHOOK_SECRET) {
    return json({ error: 'forbidden' }, 403);
  }

  const update = await readBody(request);
  // A live location is one message that Telegram keeps editing as its sender
  // moves, so every position after the first arrives as `edited_message`.
  const edited = Boolean(update && update.edited_message);
  const message = update && (update.message || update.edited_message);
  if (!message || !message.from) return json({ ok: true });

  const id = String(message.from.id);

  if (message.location) {
    const at = Math.floor(Date.now() / 1000);
    // `live_period` is only present while a live location is still running,
    // so its absence on a later edit is how sharing ends. The deadline is
    // stored rather than a flag: if that final edit never arrives, the badge
    // still goes out on its own when the period runs out.
    const period = Number(message.location.live_period);
    const live = Number.isFinite(period) && period > 0;
    const loc = {
      latitude: message.location.latitude,
      longitude: message.location.longitude,
      accuracy: message.location.horizontal_accuracy ?? null,
      heading: Number.isFinite(Number(message.location.heading))
        ? Number(message.location.heading)
        : null,
      source: 'telegram',
      at,
      liveUntil: live ? at + period : null,
    };
    const stored = await putLocation(env, id, loc);
    if (stored) await pushTrail(env, id, loc);

    // Only the message that starts the sharing is answered. Confirming every
    // edit would send one Telegram message per step the sender takes.
    if (!edited) {
      await sendMessage(
        env.TELEGRAM_BOT_TOKEN,
        id,
        stored
          ? (live
              ? 'موقعیت زندهٔ شما دریافت شد؛ تا وقتی هم‌رسانی را نبسته‌اید روی نقشهٔ سایت دنبال می‌شود.'
              : 'موقعیتتان دریافت شد. به صفحهٔ کتاب برگردید.')
          : 'موقعیتتان دریافت شد، اما ذخیره نشد. بعداً دوباره تلاش کنید.'
      ).catch(() => {});
    }
    return json({ ok: true });
  }

  if (typeof message.text === 'string' && message.text.startsWith('/start')) {
    await sendMessage(
      env.TELEGRAM_BOT_TOKEN,
      id,
      'سلام. از همین‌جا می‌توانید وارد سایت کتاب شوید و در صورت تمایل موقعیتتان را بفرستید.'
    ).catch(() => {});
  }

  return json({ ok: true });
}

// ---------- entry ----------

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      try {
        return await api(request, url, env);
      } catch {
        return json({ error: 'server_error' }, 500);
      }
    }
    return env.ASSETS.fetch(request);
  },
};
