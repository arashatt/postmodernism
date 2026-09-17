// test.mjs — `npm test`. Plain node, no framework: the signatures Telegram
// sends are rebuilt here with node:crypto — an implementation independent of
// the worker's WebCrypto one — and the routes are driven with stubbed
// bindings, so a forged payload that started to pass would show up at once.
//
// Nothing here talks to Telegram: `fetch` is replaced, and the Bot API calls
// the worker makes are inspected instead of sent.

import { createHash, createHmac } from 'node:crypto';
import worker from './index.js';
import { verifyLoginWidget, verifyInitData } from './telegram.js';
import * as session from './session.js';

const TOKEN = '123456:AAHfake-bot-token-for-tests_xyz';
const SECRET = 'a-long-random-session-secret';
const HOOK = 'webhook-secret';
const now = () => Math.floor(Date.now() / 1000);

let pass = 0;
let fail = 0;
const t = (name, cond, extra) => {
  if (cond) { pass += 1; console.log('  ok  ', name); }
  else { fail += 1; console.log('  FAIL', name, extra ?? ''); }
};
const head = (s) => console.log(`\n${s}`);

// The «data check string» Telegram signs: every field but `hash`, sorted,
// one `key=value` per line.
const dcs = (o) => Object.keys(o).filter((k) => k !== 'hash').sort().map((k) => `${k}=${o[k]}`).join('\n');

const widget = (fields) => ({
  ...fields,
  hash: createHmac('sha256', createHash('sha256').update(TOKEN).digest()).update(dcs(fields)).digest('hex'),
});

function initData(user, extra = {}) {
  const fields = { auth_date: String(now()), user: JSON.stringify(user), ...extra };
  const secret = createHmac('sha256', 'WebAppData').update(TOKEN).digest();
  const hash = createHmac('sha256', secret).update(dcs(fields)).digest('hex');
  return new URLSearchParams({ ...fields, hash }).toString();
}

// ---------------------------------------------------------------- signatures

head('login widget signatures');
{
  const good = widget({ id: 4242, first_name: 'آرش', username: 'arash', auth_date: now() });
  t('valid payload verifies', (await verifyLoginWidget(good, TOKEN))?.id === '4242');
  t('tampered id rejected', (await verifyLoginWidget({ ...good, id: 9999 }, TOKEN)) === null);
  t('another bot token rejected', (await verifyLoginWidget(good, `${TOKEN}x`)) === null);
  t('missing hash rejected', (await verifyLoginWidget({ ...good, hash: undefined }, TOKEN)) === null);
  t('stale auth_date rejected',
    (await verifyLoginWidget(widget({ id: 1, auth_date: now() - 25 * 3600 }), TOKEN)) === null);
  t('auth_date from the future rejected',
    (await verifyLoginWidget(widget({ id: 1, auth_date: now() + 600 }), TOKEN)) === null);
  t('an upper-case hash is still accepted',
    (await verifyLoginWidget({ ...good, hash: good.hash.toUpperCase() }, TOKEN))?.id === '4242');
}

head('mini app initData');
{
  const ok = initData({ id: 777, first_name: 'ن', last_name: 'ب', username: 'nb' }, { query_id: 'AAE' });
  t('valid initData verifies', (await verifyInitData(ok, TOKEN))?.id === '777');
  t('the user record is carried over', (await verifyInitData(ok, TOKEN))?.username === 'nb');
  t('a tampered user is rejected',
    (await verifyInitData(ok.replace('%22id%22%3A777', '%22id%22%3A778'), TOKEN)) === null);
  t('empty initData rejected', (await verifyInitData('', TOKEN)) === null);
  t('a non-string rejected', (await verifyInitData(null, TOKEN)) === null);
}

head('session cookie');
{
  const token = await session.issue({ id: '4242', first_name: 'آرش', username: 'arash' }, SECRET);
  t('round-trips', (await session.read(token, SECRET))?.name === 'آرش');
  t('another secret rejected', (await session.read(token, `${SECRET}x`)) === null);
  t('a swapped payload rejected',
    (await session.read(`eyJpZCI6Ijk5OSJ9.${token.split('.')[1]}`, SECRET)) === null);
  t('garbage rejected', (await session.read('nonsense', SECRET)) === null);

  const claims = JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString());
  t('expiry is set and bounded', claims.exp > now() && claims.exp <= now() + 30 * 24 * 3600);

  const https = session.cookie('v', new URL('https://example.com/'));
  t('HttpOnly + Secure + SameSite on https',
    /HttpOnly/.test(https) && /Secure/.test(https) && /SameSite=Lax/.test(https));
  t('no Secure on http, so wrangler dev works',
    !/Secure/.test(session.cookie('v', new URL('http://localhost:8787/'))));
  t('clearing expires it at once', /Max-Age=0/.test(session.clearCookie(new URL('https://x.com/'))));

  const req = new Request('https://x.com/api/me', {
    headers: { cookie: `other=1; ketab_tg=${encodeURIComponent(token)}` },
  });
  t('read out of a multi-cookie header', (await session.fromRequest(req, SECRET))?.id === '4242');
  t('an absent cookie is null',
    (await session.fromRequest(new Request('https://x.com/api/me'), SECRET)) === null);
}

// -------------------------------------------------------------------- routes

function kv() {
  const m = new Map();
  return {
    store: m,
    get: async (k, type) => (m.has(k) ? (type === 'json' ? JSON.parse(m.get(k)) : m.get(k)) : null),
    put: async (k, v) => { m.set(k, v); },
    delete: async (k) => { m.delete(k); },
  };
}

const assets = { fetch: async () => new Response('the book', { headers: { 'content-type': 'text/html' } }) };

// Bot API calls are captured, never made.
const botCalls = [];
let botReply = { ok: true, result: {} };
globalThis.fetch = async (url, init) => {
  botCalls.push({ url: String(url), body: JSON.parse(init.body) });
  return new Response(JSON.stringify(botReply), { headers: { 'content-type': 'application/json' } });
};

const env = () => ({
  ASSETS: assets,
  TELEGRAM_BOT_TOKEN: TOKEN,
  SESSION_SECRET: SECRET,
  TELEGRAM_BOT_USERNAME: 'ketab_bot',
  TELEGRAM_WEBHOOK_SECRET: HOOK,
  LOCATIONS: kv(),
});

const call = (e, path, init) => worker.fetch(new Request(`https://book.example${path}`, init), e);
const json = async (res) => { try { return await res.json(); } catch { return null; } };
const post = (body, headers) => ({
  method: 'POST',
  body: JSON.stringify(body),
  headers: { 'content-type': 'application/json', ...headers },
});
const cookieOf = (res) => (res.headers.get('set-cookie') || '').split(';')[0];

head('static assets');
{
  const e = env();
  t('the home page comes from the assets binding', (await (await call(e, '/')).text()) === 'the book');
  t('so does a chapter file', (await (await call(e, '/chapters/fasl-1.md')).text()) === 'the book');
}

head('/api/me');
{
  const e = env();
  const res = await call(e, '/api/me');
  const body = await json(res);
  t('reports configured and the bot name', body.configured === true && body.bot === 'ketab_bot', body);
  t('nobody is signed in yet', body.user === null && body.location === null);
  t('is never cached', res.headers.get('cache-control') === 'no-store');
  t('a trailing slash still routes', (await json(await call(e, '/api/me/'))).configured === true);
}

head('a deployment with no bot configured');
{
  const bare = { ASSETS: assets };
  const body = await json(await call(bare, '/api/me'));
  t('says it is unconfigured', body.configured === false && body.user === null);
  t('refuses sign-in with 503', (await call(bare, '/api/login/widget', post({}))).status === 503);
}

let signedIn;
head('signing in from the website');
{
  const e = env();
  t('a forged payload is 401',
    (await call(e, '/api/login/widget', post({ id: 5, auth_date: now(), hash: 'deadbeef' }))).status === 401);
  t('a malformed body is 401, not a crash',
    (await call(e, '/api/login/widget',
      { method: 'POST', body: '{oops', headers: { 'content-type': 'application/json' } })).status === 401);

  const res = await call(e, '/api/login/widget',
    post(widget({ id: 4242, first_name: 'آرش', username: 'arash', auth_date: now() })));
  const body = await json(res);
  signedIn = cookieOf(res);
  t('a signed payload returns the reader', body.user?.id === '4242' && body.user.username === 'arash', body);
  t('the session cookie is HttpOnly', /HttpOnly/.test(res.headers.get('set-cookie') || ''));
  t('and signs later requests in',
    (await json(await call(e, '/api/me', { headers: { cookie: signedIn } }))).user?.id === '4242');
}

head('signing in inside Telegram');
{
  const e = env();
  const body = await json(await call(e, '/api/login/webapp', post({ initData: initData({ id: 777, first_name: 'ن' }) })));
  t('initData signs the reader in', body.user?.id === '777', body);
  t('an unsigned initData is 401',
    (await call(e, '/api/login/webapp', post({ initData: 'user=x&hash=00' }))).status === 401);
}

head('location is private to a session');
{
  const e = env();
  t('GET is 401', (await call(e, '/api/location')).status === 401);
  t('POST is 401', (await call(e, '/api/location', post({ latitude: 35, longitude: 51 }))).status === 401);
  t('asking the bot is 401', (await call(e, '/api/location/request', post({}))).status === 401);
  t('a forged cookie is 401',
    (await call(e, '/api/location', { headers: { cookie: 'ketab_tg=eyJpZCI6IjEifQ.zzzz' } })).status === 401);
  t('an unknown route is 404',
    (await call(e, '/api/nope', { headers: { cookie: signedIn } })).status === 404);
}

head('a fix handed over by the page');
{
  const e = env();
  const auth = { cookie: signedIn };
  const saved = await json(await call(e, '/api/location',
    post({ latitude: 35.6892, longitude: 51.389, accuracy: 25, source: 'miniapp' }, auth)));
  t('is stored', saved.stored === true && saved.location.latitude === 35.6892, saved);
  t('keeps where it came from', saved.location.source === 'miniapp');
  t('reads back', (await json(await call(e, '/api/location', { headers: auth }))).location?.longitude === 51.389);
  t('and rides along on /api/me',
    (await json(await call(e, '/api/me', { headers: auth }))).location?.latitude === 35.6892);
  t('a browser fix is labelled as one',
    (await json(await call(e, '/api/location', post({ latitude: 1, longitude: 2, source: 'browser' }, auth))))
      .location.source === 'browser');
  t('an out-of-range latitude is 400',
    (await call(e, '/api/location', post({ latitude: 999, longitude: 0 }, auth))).status === 400);
  t('a non-numeric pair is 400',
    (await call(e, '/api/location', post({ latitude: 'x', longitude: 'y' }, auth))).status === 400);

  t('DELETE forgets it', (await json(await call(e, '/api/location', { method: 'DELETE', headers: auth }))).location === null);
  t('and it stays forgotten', (await json(await call(e, '/api/location', { headers: auth }))).location === null);
}

head('asking through the bot');
{
  const e = env();
  const auth = { cookie: signedIn };
  botCalls.length = 0;
  botReply = { ok: true, result: {} };

  t('the request reports sent', (await json(await call(e, '/api/location/request', post({}, auth)))).sent === true);
  t('sendMessage was called', botCalls[0]?.url.includes(`/bot${TOKEN}/sendMessage`));
  t('with a request_location keyboard',
    botCalls[0]?.body.reply_markup.keyboard[0][0].request_location === true, botCalls[0]?.body);
  t('addressed to the signed-in reader', botCalls[0]?.body.chat_id === '4242');
  t('a second ask inside a minute is throttled',
    (await call(e, '/api/location/request', post({}, auth))).status === 429);

  botReply = { ok: false, error_code: 403, description: 'bot was blocked' };
  const blocked = await call(env(), '/api/location/request', post({}, auth));
  t('a reader who never started the bot gets start_bot_first',
    blocked.status === 409 && (await json(blocked)).error === 'start_bot_first');

  botReply = { ok: true, result: {} };
  t('with no KV the flow says so rather than half-working',
    (await call({ ...env(), LOCATIONS: undefined }, '/api/location/request', post({}, auth))).status === 501);
}

head('the webhook');
{
  const e = env();
  const update = {
    message: {
      from: { id: 4242 },
      chat: { id: 4242 },
      location: { latitude: 35.7, longitude: 51.4, horizontal_accuracy: 12 },
    },
  };
  t('an unsigned update is 403', (await call(e, '/api/telegram/webhook', post(update))).status === 403);
  t('a wrongly signed update is 403',
    (await call(e, '/api/telegram/webhook',
      post(update, { 'x-telegram-bot-api-secret-token': 'nope' }))).status === 403);

  botCalls.length = 0;
  t('a signed update is accepted',
    (await call(e, '/api/telegram/webhook', post(update, { 'x-telegram-bot-api-secret-token': HOOK }))).status === 200);
  const stored = await e.LOCATIONS.get('loc:4242', 'json');
  t('the location is stored for that reader', stored?.latitude === 35.7 && stored.source === 'telegram', stored);
  t('accuracy comes along', stored?.accuracy === 12);
  t('the reader is told it arrived', botCalls.some((c) => c.body.text?.includes('دریافت شد')));
  t('and the page can now read it',
    (await json(await call(e, '/api/location', { headers: { cookie: signedIn } }))).location?.latitude === 35.7);

  await call(e, '/api/telegram/webhook',
    post({ edited_message: { from: { id: 4242 }, location: { latitude: 36.1, longitude: 50.2 } } },
      { 'x-telegram-bot-api-secret-token': HOOK }));
  t('a live-location edit updates the fix', (await e.LOCATIONS.get('loc:4242', 'json')).latitude === 36.1);

  botCalls.length = 0;
  await call(e, '/api/telegram/webhook',
    post({ message: { from: { id: 9 }, text: '/start' } }, { 'x-telegram-bot-api-secret-token': HOOK }));
  t('/start is greeted', botCalls.length === 1 && botCalls[0].body.chat_id === '9');

  t('anything else is ignored quietly',
    (await call(e, '/api/telegram/webhook',
      post({ message: { from: { id: 9 }, text: 'سلام' } }, { 'x-telegram-bot-api-secret-token': HOOK }))).status === 200);
}

head('signing out');
{
  const res = await call(env(), '/api/logout', post({}, { cookie: signedIn }));
  t('clears the cookie', /Max-Age=0/.test(res.headers.get('set-cookie') || ''));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
