// pwa.js — service-worker registration and the «افزودن به صفحهٔ اصلی» plumbing.
// Every browser API here is optional: iOS Safari has no install prompt, older
// WebViews have no service worker at all, so each call degrades to a no-op.

// Relative to the document, so a deploy in a subdirectory registers its own
// worker with its own scope. Hash routes never change the document path.
const SW_URL = 'sw.js';

export const supported = () =>
  typeof navigator !== 'undefined' && 'serviceWorker' in navigator;

export function isStandalone() {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    window.matchMedia?.('(display-mode: fullscreen)').matches ||
    window.navigator.standalone === true                       // iOS
  );
}

export function isIOS() {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  return (
    /iphone|ipad|ipod/i.test(ua) ||
    // iPadOS 13+ reports itself as a Mac; touch points give it away.
    (/macintosh/i.test(ua) && navigator.maxTouchPoints > 1)
  );
}

// Registers the worker. An update is announced through onUpdateReady() once a
// newer worker is installed and parked.
export function registerServiceWorker() {
  if (!supported()) return;
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register(SW_URL, { updateViaCache: 'none' });

      // Only report an update when a worker is already in charge; on the very
      // first visit the freshly installed worker is not an «update».
      const announce = () => {
        if (reg.waiting && navigator.serviceWorker.controller) setUpdateReady();
      };
      announce();
      reg.addEventListener('updatefound', () => {
        const sw = reg.installing;
        sw?.addEventListener('statechange', () => { if (sw.state === 'installed') announce(); });
      });

      // Pick up a release published while the app stayed open.
      setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') reg.update().catch(() => {});
      });
    } catch { /* http:, private mode, unsupported: the site works unchanged */ }
  });
}

// ---------- update banner ----------

let updateWaiting = false;
const updateListeners = new Set();

function setUpdateReady() {
  if (updateWaiting) return;
  updateWaiting = true;
  updateListeners.forEach((fn) => fn(true));
}

export const updateReady = () => updateWaiting;

export function onUpdateReady(fn) {
  updateListeners.add(fn);
  return () => updateListeners.delete(fn);
}

// Hand over to the waiting worker and reload once it takes control.
export function applyUpdate() {
  if (!supported()) { window.location.reload(); return; }
  navigator.serviceWorker.getRegistration().then((reg) => {
    if (!reg?.waiting) { window.location.reload(); return; }
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloaded) return;
      reloaded = true;
      window.location.reload();
    });
    reg.waiting.postMessage({ type: 'SKIP_WAITING' });
  });
}

// Development: make sure a worker installed by an earlier production build on
// the same origin (localhost) cannot serve stale files.
export function unregisterServiceWorkers() {
  if (!supported()) return;
  navigator.serviceWorker.getRegistrations?.()
    .then((regs) => regs.forEach((r) => r.unregister()))
    .catch(() => {});
}

// ---------- install prompt ----------

let deferred = null;
const listeners = new Set();
const notify = () => listeners.forEach((fn) => fn());

if (typeof window !== 'undefined') {
  // Chrome/Edge on Android fire this instead of showing their own banner.
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    notify();
  });
}

export const canInstall = () => deferred !== null;

export function onInstallChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export async function promptInstall() {
  if (!deferred) return false;
  const e = deferred;
  deferred = null;
  notify();
  try {
    e.prompt();
    const { outcome } = await e.userChoice;
    return outcome === 'accepted';
  } catch {
    return false;
  }
}
