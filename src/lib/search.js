// search.js — client-side full-text search over chapter blocks.
//
// Matching runs on a concatenated stream of normalized words, so word
// boundaries are transparent: «قطعه وار» finds «قطعه‌وار» (ZWNJ compound),
// «میرود» finds «می‌رود», diacritic and ي/ك variants all match. Character
// offsets map back to word indices for the snippet.

import { normalize } from './bookml.js';

export function indexRow(row) {
  const words = row.text.split(' ');
  const norms = words.map(normalize);
  const starts = [];
  let off = 0;
  for (const n of norms) { starts.push(off); off += n.length; }
  return { ...row, words, norms, starts, concat: norms.join('') };
}

function wordAt(starts, charIdx) {
  let lo = 0, hi = starts.length - 1, ans = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (starts[mid] <= charIdx) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

export function searchBlocks(rows, query, limit = 20) {
  const qc = query.trim().split(/\s+/).map(normalize).join('');
  if (qc.length < 2) return [];
  const out = [];
  for (const r of rows) {
    const idx = r.concat.indexOf(qc);
    if (idx < 0) continue;
    const i = wordAt(r.starts, idx);
    const j = wordAt(r.starts, idx + qc.length - 1);
    const s = Math.max(0, i - 4);
    const e = Math.min(r.words.length, j + 6);
    out.push({
      chapterId: r.chapterId,
      bi: r.bi,
      before: (s > 0 ? '… ' : '') + r.words.slice(s, i).join(' '),
      match: r.words.slice(i, j + 1).join(' '),
      after: r.words.slice(j + 1, e).join(' ') + (e < r.words.length ? ' …' : ''),
    });
    if (out.length >= limit) break;
  }
  return out;
}
