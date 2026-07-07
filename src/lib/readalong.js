// readalong.js — SRT/VTT parsing + cue-to-page word alignment.
// The alignment handles Whisper's habits: it splits ZWNJ compounds
// («قطعه‌وار» → «قطعه وار»), so each page word is also tested against
// 2–3 concatenated cue words (and each cue word against 2 page words);
// long jumps on common words require confirmation from the next pair.

import { normalize } from './bookml.js';

function parseTimestamp(s) {
  const m = s.trim().match(/(?:(\d+):)?(\d+):(\d+)[.,](\d{1,3})/);
  if (!m) return null;
  const h = m[1] ? +m[1] : 0;
  return h * 3600 + +m[2] * 60 + +m[3] + +m[4].padEnd(3, '0') / 1000;
}

export function parseCues(text) {
  const cues = [];
  const blocks = text.replace(/\r/g, '').replace(/^WEBVTT.*?\n\n/s, '').split(/\n\n+/);
  for (const b of blocks) {
    const lines = b.split('\n').filter(Boolean);
    const ti = lines.findIndex((l) => l.includes('-->'));
    if (ti < 0) continue;
    const [a, z] = lines[ti].split('-->');
    const start = parseTimestamp(a);
    const end = parseTimestamp(z);
    if (start == null || end == null) continue;
    const cueText = lines.slice(ti + 1).join(' ').replace(/<[^>]+>/g, '');
    if (cueText.trim()) cues.push({ start, end, text: cueText });
  }
  return cues;
}

// Per-word times inside each cue, weighted by word length.
export function cueWords(cues) {
  const out = [];
  for (const c of cues) {
    const ws = c.text.split(/\s+/).map(normalize).filter(Boolean);
    if (!ws.length) continue;
    const weights = ws.map((w) => w.length + 1);
    const total = weights.reduce((a, b) => a + b, 0);
    let t = c.start;
    const span = c.end - c.start;
    for (let i = 0; i < ws.length; i++) {
      out.push({ norm: ws[i], t });
      t += (span * weights[i]) / total;
    }
  }
  return out;
}

// Align cue words to page words (array of normalized strings).
// Returns { times, matched } — times[i] is a seconds value or null;
// unmatched words between anchors get interpolated times so the
// highlight sweep never stalls.
export function align(pageNorms, cws) {
  const times = new Array(pageNorms.length).fill(null);
  let pi = 0;
  let matched = 0;
  const WINDOW = 8;

  for (let ci = 0; ci < cws.length; ci++) {
    const w1 = cws[ci].norm;
    const w2 = ci + 1 < cws.length ? w1 + cws[ci + 1].norm : null;
    const w3 = ci + 2 < cws.length ? w2 + cws[ci + 2].norm : null;
    // until the first match, scan wide: the recording may start anywhere
    // in the chapter (e.g. the reader skips the epigraph)
    const win = matched === 0 ? Math.min(pageNorms.length, 400) : WINDOW;
    for (let j = pi; j < Math.min(pi + win, pageNorms.length); j++) {
      const pn = pageNorms[j];
      const confirmed = () =>
        j - pi <= 3 ||
        ci + 1 >= cws.length ||
        j + 1 >= pageNorms.length ||
        cws[ci + 1].norm === pageNorms[j + 1];
      if (pn === w1 && confirmed()) { times[j] = cws[ci].t; pi = j + 1; matched++; break; }
      if (w2 && pn === w2) { times[j] = cws[ci].t; ci += 1; pi = j + 1; matched++; break; }
      if (w3 && pn === w3) { times[j] = cws[ci].t; ci += 2; pi = j + 1; matched++; break; }
      if (j + 1 < pageNorms.length && pn + pageNorms[j + 1] === w1) {
        times[j] = cws[ci].t; pi = j + 2; matched++; break;
      }
    }
  }

  // Interpolate gaps between anchors.
  let last = -1;
  for (let i = 0; i <= times.length; i++) {
    const isAnchor = i < times.length && times[i] != null;
    if (isAnchor || i === times.length) {
      if (last >= 0 && i - last > 1 && isAnchor) {
        const t0 = times[last];
        const t1 = times[i];
        const n = i - last;
        for (let k = 1; k < n; k++) times[last + k] = t0 + ((t1 - t0) * k) / n;
      }
      if (isAnchor) last = i;
    }
  }
  return { times, matched };
}
