// store.js — reading position + bookmarks in localStorage.
// Every access is guarded: Safari private mode and some WebViews throw.

const K_POS = 'ketab:pos';
const K_MARKS = 'ketab:marks';

export function getPos() {
  try { return JSON.parse(localStorage.getItem(K_POS)); } catch { return null; }
}
export function setPos(pos) {
  try { localStorage.setItem(K_POS, JSON.stringify(pos)); } catch { /* storage unavailable */ }
}

export function getMarks() {
  try { return JSON.parse(localStorage.getItem(K_MARKS)) || []; } catch { return []; }
}
export function saveMarks(marks) {
  try { localStorage.setItem(K_MARKS, JSON.stringify(marks)); } catch { /* storage unavailable */ }
}
export function addMark(mark) {
  const marks = getMarks();
  marks.unshift({ id: Date.now() + ':' + Math.random().toString(36).slice(2, 7), ...mark });
  saveMarks(marks.slice(0, 100));
  return getMarks();
}
export function removeMark(id) {
  saveMarks(getMarks().filter((m) => m.id !== id));
  return getMarks();
}

const K_SET = 'ketab:settings';
const DEFAULTS = { fontScale: 1, theme: 'day', font: 'amiri' };

export function getSettings() {
  try { return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(K_SET)) || {}) }; }
  catch { return { ...DEFAULTS }; }
}
export function setSettings(next) {
  try { localStorage.setItem(K_SET, JSON.stringify(next)); } catch { /* unavailable */ }
  return next;
}

// Chapter ids the reader has already been told about, so a chapter added to
// the manifest later can announce itself exactly once. null = never recorded,
// which is a first visit: nothing to announce.
const K_SEEN = 'ketab:chapters';

export function getSeenChapters() {
  try { return JSON.parse(localStorage.getItem(K_SEEN)); } catch { return null; }
}
export function setSeenChapters(ids) {
  try { localStorage.setItem(K_SEEN, JSON.stringify(ids)); } catch { /* unavailable */ }
  return ids;
}
