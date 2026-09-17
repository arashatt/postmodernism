// session.js — a signed cookie, so the API can trust «this request is
// Telegram user N» without a session table. Payload is readable by the
// client (it is the reader's own identity); the signature is what matters.

const enc = new TextEncoder();

const COOKIE = 'ketab_tg';
export const SESSION_TTL = 30 * 24 * 60 * 60;   // 30 days

const b64url = (bytes) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const unb64url = (s) => {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};

async function sign(data, secret) {
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  return b64url(new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(data))));
}

export async function issue(user, secret) {
  const payload = b64url(enc.encode(JSON.stringify({
    id: user.id,
    name: [user.first_name, user.last_name].filter(Boolean).join(' '),
    username: user.username || '',
    photo: user.photo_url || '',
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL,
  })));
  return `${payload}.${await sign(payload, secret)}`;
}

export async function read(token, secret) {
  if (typeof token !== 'string') return null;
  const dot = token.lastIndexOf('.');
  if (dot < 1) return null;
  const payload = token.slice(0, dot);
  const mac = token.slice(dot + 1);

  let expected;
  try { expected = await sign(payload, secret); } catch { return null; }
  if (expected.length !== mac.length) return null;
  let diff = 0;
  for (let i = 0; i < mac.length; i++) diff |= expected.charCodeAt(i) ^ mac.charCodeAt(i);
  if (diff !== 0) return null;

  let claims;
  try { claims = JSON.parse(new TextDecoder().decode(unb64url(payload))); } catch { return null; }
  if (!claims || !claims.id) return null;
  if (!claims.exp || claims.exp < Math.floor(Date.now() / 1000)) return null;
  return claims;
}

export function fromRequest(request, secret) {
  const header = request.headers.get('cookie') || '';
  const hit = header.split(';').map((p) => p.trim()).find((p) => p.startsWith(`${COOKIE}=`));
  if (!hit) return null;
  return read(decodeURIComponent(hit.slice(COOKIE.length + 1)), secret);
}

// `Secure` is dropped on plain http so that `wrangler dev` on localhost can
// still set the cookie; deployments are https and keep it.
export function cookie(value, url, maxAge = SESSION_TTL) {
  const secure = url.protocol === 'https:' ? '; Secure' : '';
  return `${COOKIE}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure}`;
}

export const clearCookie = (url) => cookie('', url, 0);
