// offlineAudio.js — «ذخیرهٔ خوانش»: keeping a chapter's narration on the device.
//
// The page does the downloading and writes straight into the `ketab-audio`
// cache; the service worker only reads that cache back, answering the range
// requests <audio> makes (see the `narration` handler in sw.js). The cache is
// the single source of truth for what is saved — no parallel bookkeeping to
// drift out of step with it.
//
// Every call degrades to a no-op where the Cache API is missing (private mode,
// plain http:, old WebViews): the player keeps streaming as before.

const CACHE = 'ketab-audio';

export const supported = () => typeof caches !== 'undefined' && typeof window !== 'undefined';

const open = () => caches.open(CACHE);

// Bytes held for these urls, or 0 when nothing is saved.
export async function savedSize(urls) {
  if (!supported()) return 0;
  try {
    const cache = await open();
    let total = 0;
    for (const url of urls.filter(Boolean)) {
      const hit = await cache.match(url);
      if (!hit) continue;
      const len = Number(hit.headers.get('Content-Length'));
      total += Number.isFinite(len) && len > 0 ? len : (await hit.clone().blob()).size;
    }
    return total;
  } catch { return 0; }
}

// Saved only when the recording itself is here; cues are a bonus.
export async function isSaved(audioUrl) {
  if (!supported() || !audioUrl) return false;
  try { return !!(await (await open()).match(audioUrl)); } catch { return false; }
}

// Ask the browser not to evict this cache under storage pressure. Chrome grants
// it silently to installed apps, Firefox prompts, Safari decides on its own —
// a refusal is not an error, the download just becomes evictable.
export async function persist() {
  try { await navigator.storage?.persist?.(); } catch { /* not available */ }
}

// Download and store. onProgress gets 0..1, or null while the size is unknown
// (a server that sends no Content-Length still downloads, just silently).
export async function save(urls, onProgress) {
  if (!supported()) throw new Error('cache unavailable');
  await persist();
  const cache = await open();
  const [audioUrl, ...rest] = urls.filter(Boolean);

  const res = await fetch(audioUrl);
  if (!res.ok) throw new Error(`download ${audioUrl}: ${res.status}`);

  const total = Number(res.headers.get('Content-Length')) || 0;
  const type = res.headers.get('Content-Type') || 'audio/mpeg';

  let body;
  if (res.body && total) {
    const reader = res.body.getReader();
    const chunks = [];
    let seen = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      seen += value.byteLength;
      onProgress?.(Math.min(seen / total, 1));
    }
    body = new Blob(chunks, { type });
  } else {
    onProgress?.(null);
    body = await res.blob();
  }

  // Store with the length the worker will need to slice ranges against.
  await cache.put(audioUrl, new Response(body, {
    status: 200,
    headers: { 'Content-Type': type, 'Content-Length': String(body.size) },
  }));

  // The timing file rides along, so read-along works offline too. It is small
  // and optional: a chapter without cues still gets its audio.
  for (const url of rest) {
    try {
      const cue = await fetch(url);
      if (cue.ok) await cache.put(url, cue);
    } catch { /* no cues for this chapter */ }
  }

  onProgress?.(1);
  return body.size;
}

export async function drop(urls) {
  if (!supported()) return;
  try {
    const cache = await open();
    await Promise.all(urls.filter(Boolean).map((url) => cache.delete(url).catch(() => {})));
  } catch { /* nothing to remove */ }
}

// «۱۲٫۴ مگابایت» — Persian digits, decimal separator and unit.
export function faSize(bytes) {
  if (!bytes) return '';
  const mb = bytes / (1024 * 1024);
  const n = mb >= 10 ? Math.round(mb).toString() : mb.toFixed(1);
  return `${n.replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[+d]).replace('.', '٫')} مگابایت`;
}
