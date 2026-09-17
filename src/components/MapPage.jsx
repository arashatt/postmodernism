import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AUTH_EVENT, fetchLocation, fetchMe, forgetLocation, inTelegram, readLocation,
  requestLocationViaBot, saveLocation,
} from '../lib/telegram.js';

const fa = (s) => String(s).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);
const coord = (n) => fa(Number(n).toFixed(5)).replace('.', '٫');

function countdown(until) {
  const left = Math.max(0, until - Math.floor(Date.now() / 1000));
  const m = Math.floor(left / 60);
  if (m >= 60) return `${fa(Math.floor(m / 60))} ساعت دیگر`;
  if (m >= 1) return `${fa(m)} دقیقه دیگر`;
  return `${fa(left)} ثانیه دیگر`;
}

function when(seconds) {
  if (!seconds) return '';
  const mins = Math.max(0, Math.round((Date.now() / 1000 - seconds) / 60));
  if (mins < 1) return 'هم‌اکنون';
  if (mins < 60) return `${fa(mins)} دقیقه پیش`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${fa(hours)} ساعت پیش`;
  return `${fa(Math.round(hours / 24))} روز پیش`;
}

const isLive = (loc) => Boolean(loc && loc.liveUntil && loc.liveUntil > Date.now() / 1000);

const SOURCE = { telegram: 'از تلگرام', miniapp: 'از تلگرام', browser: 'از این دستگاه' };

// How often the page asks the server for a newer fix. Telegram pushes an edit
// to the webhook whenever the sender moves; this is how the page notices.
const POLL_MS = 10000;

// «نقشه» — a full-page map of where the reader last was, refreshing itself
// while a live location is running. Leaflet is imported dynamically so the
// book never pays for it: readers who do not open this page fetch nothing.
export default function MapPage({ setFolio }) {
  const [state, setState] = useState({ loading: true, configured: false, user: null, location: null, trail: [] });
  const [note, setNote] = useState('');
  const [tracking, setTracking] = useState(false);
  const [busy, setBusy] = useState('');
  const [, tick] = useState(0);
  const [ready, setReady] = useState(false);

  const holder = useRef(null);
  const map = useRef(null);
  const marker = useRef(null);
  const halo = useRef(null);
  const path = useRef(null);
  const L = useRef(null);
  const centred = useRef(false);
  const live = useRef(true);

  useEffect(() => {
    setFolio?.('نقشه');
    live.current = true;
    return () => { live.current = false; };
  }, [setFolio]);

  // Re-render once a second so the «live» countdown stays honest even when no
  // new fix has arrived.
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const apply = useCallback((patch) => {
    if (live.current) setState((prev) => ({ ...prev, ...patch }));
  }, []);

  // ---------- data ----------

  const refresh = useCallback(async () => {
    const res = await fetchLocation().catch(() => ({}));
    if (res && res.location !== undefined) {
      apply({ location: res.location, trail: Array.isArray(res.trail) ? res.trail : [] });
    }
  }, [apply]);

  const load = useCallback(async () => {
    const me = await fetchMe().catch(() => ({}));
    const signedIn = Boolean(me.user);
    apply({
      loading: false,
      configured: Boolean(me.configured),
      user: me.user || null,
      location: signedIn ? (me.location || null) : null,
      ...(signedIn ? {} : { trail: [] }),
    });
    if (signedIn) refresh();
  }, [apply, refresh]);

  // Signing in happens in the drawer, which this page knows nothing about, so
  // it listens for the announcement rather than making the reader reload.
  useEffect(() => {
    load();
    const onAuth = () => { centred.current = false; load(); };
    window.addEventListener(AUTH_EVENT, onAuth);
    return () => window.removeEventListener(AUTH_EVENT, onAuth);
  }, [load]);

  // Poll while signed in and the tab is in front. A backgrounded tab would
  // otherwise keep a phone's radio busy for a map nobody is looking at.
  useEffect(() => {
    if (!state.user) return undefined;
    let timer = null;
    const start = () => {
      if (timer) return;
      timer = setInterval(() => { if (!document.hidden) refresh(); }, POLL_MS);
    };
    const onVisible = () => {
      if (document.hidden) { clearInterval(timer); timer = null; }
      else { refresh(); start(); }
    };
    start();
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, [state.user, refresh]);

  // ---------- the map ----------

  useEffect(() => {
    if (state.loading || !state.user || map.current) return undefined;
    let cancelled = false;
    (async () => {
      const [mod] = await Promise.all([import('leaflet'), import('leaflet/dist/leaflet.css')]);
      if (cancelled || !holder.current || map.current) return;
      const lf = mod.default || mod;
      L.current = lf;
      const m = lf.map(holder.current, { zoomControl: true, attributionControl: true })
        .setView([35.6892, 51.389], 11);   // Tehran, until a real fix arrives
      lf.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        // Required by the OpenStreetMap tile usage policy.
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(m);
      map.current = m;
      // The container is sized by CSS that may settle after Leaflet measures it.
      setTimeout(() => m.invalidateSize(), 0);
      // Drawing is left to the effect below; announcing the map is enough to
      // wake it. Calling draw() here would tie this effect to every position
      // change, and a change arriving mid-import would cancel the map itself.
      setReady(true);
    })();
    return () => { cancelled = true; };
  }, [state.loading, state.user]);

  useEffect(() => () => {
    map.current?.remove();
    map.current = null;
  }, []);

  const draw = useCallback(() => {
    const lf = L.current;
    const m = map.current;
    const loc = state.location;
    if (!lf || !m || !loc) return;

    const here = [loc.latitude, loc.longitude];

    if (!marker.current) {
      marker.current = lf.circleMarker(here, {
        radius: 7, weight: 3, color: '#111', fillColor: '#fff', fillOpacity: 1,
      }).addTo(m);
    } else {
      marker.current.setLatLng(here);
    }
    marker.current.setStyle({ color: isLive(loc) ? '#0a7d33' : '#111' });

    // The accuracy circle is in metres, so it shrinks and grows with the zoom.
    if (loc.accuracy) {
      if (!halo.current) {
        halo.current = lf.circle(here, {
          radius: loc.accuracy, weight: 1, color: '#111', opacity: 0.35, fillOpacity: 0.06,
        }).addTo(m);
      } else {
        halo.current.setLatLng(here).setRadius(loc.accuracy);
      }
    } else if (halo.current) {
      halo.current.remove();
      halo.current = null;
    }

    const line = (state.trail || []).map((p) => [p.latitude, p.longitude]);
    if (line.length > 1) {
      if (!path.current) {
        path.current = lf.polyline(line, { weight: 2, color: '#111', opacity: 0.5, dashArray: '4 4' }).addTo(m);
      } else {
        path.current.setLatLngs(line);
      }
    }

    // Centre on the first fix, and keep following only while it is live.
    if (!centred.current) {
      m.setView(here, 15);
      centred.current = true;
    } else if (isLive(loc)) {
      m.panTo(here);
    }
  }, [state.location, state.trail]);

  useEffect(() => { if (ready) draw(); }, [ready, draw]);

  // ---------- actions ----------

  // Turns this device into the source of the live location: every fix the
  // browser reports is posted, and the map follows it like a Telegram one.
  useEffect(() => {
    if (!tracking) return undefined;
    if (!navigator.geolocation) { setNote('این دستگاه موقعیت‌یاب ندارد.'); setTracking(false); return undefined; }
    const id = navigator.geolocation.watchPosition(
      async (pos) => {
        const res = await saveLocation({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy ?? null,
          source: 'browser',
          live: true,
        }).catch(() => ({}));
        if (res.location) refresh();
      },
      (err) => {
        setNote(err && err.code === 1 ? 'اجازهٔ دسترسی به موقعیت داده نشد.' : 'موقعیت‌یابی این دستگاه در دسترس نیست.');
        setTracking(false);
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 }
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [tracking, refresh]);

  const once = async () => {
    setNote(''); setBusy('once');
    const got = await readLocation();
    if (!got.ok) { setBusy(''); setNote('موقعیت خوانده نشد.'); return; }
    await saveLocation(got.location).catch(() => {});
    await refresh();
    setBusy('');
  };

  const askBot = async () => {
    setNote(''); setBusy('bot');
    const res = await requestLocationViaBot().catch(() => ({}));
    setBusy('');
    setNote(res.sent
      ? 'در تلگرام برای هم‌رسانی زنده: 📎 ← Location ← «Share My Live Location».'
      : res.error === 'start_bot_first' ? 'نخست یک‌بار گفت‌وگو با ربات را آغاز کنید.'
      : 'فرستاده نشد؛ دوباره تلاش کنید.');
  };

  const forget = async () => {
    setNote(''); setBusy('forget');
    await forgetLocation().catch(() => {});
    setTracking(false);
    centred.current = false;
    [marker, halo, path].forEach((r) => { r.current?.remove(); r.current = null; });
    apply({ location: null, trail: [] });
    setBusy('');
  };

  // ---------- render ----------

  if (state.loading) return <main className="mappage"><p className="map-empty">…</p></main>;

  if (!state.configured) {
    return (
      <main className="mappage">
        <p className="map-empty">این بخش روی این نصب راه‌اندازی نشده است.</p>
        <p className="map-empty"><a href="#/">بازگشت به کتاب</a></p>
      </main>
    );
  }

  if (!state.user) {
    return (
      <main className="mappage">
        <p className="map-empty">
          برای دیدن نقشه نخست از منوی کتاب (☰) با تلگرام وارد شوید.
        </p>
        <p className="map-empty"><a href="#/">بازگشت به کتاب</a></p>
      </main>
    );
  }

  const loc = state.location;
  const liveNow = isLive(loc);

  return (
    <main className="mappage">
      <div className="map-bar">
        <span className="map-where">
          {loc ? (
            <>
              <span className={`map-dot${liveNow ? ' on' : ''}`} aria-hidden="true" />
              {liveNow ? <b>زنده</b> : 'آخرین موقعیت'}
              {' ــ '}
              <span className="acc-num">{coord(loc.latitude)}</span>{' · '}
              <span className="acc-num">{coord(loc.longitude)}</span>
              <small>
                {liveNow ? ` (تا ${countdown(loc.liveUntil)})` : ` ${when(loc.at)}`}
                {SOURCE[loc.source] ? ` ــ ${SOURCE[loc.source]}` : ''}
              </small>
            </>
          ) : 'هنوز موقعیتی ثبت نشده است.'}
        </span>
        <a className="map-back" href="#/">بازگشت</a>
      </div>

      <div className="map-holder" ref={holder} role="application" aria-label="نقشه" />

      <div className="map-actions">
        <button className="install-btn" onClick={once} disabled={Boolean(busy) || tracking}>
          {busy === 'once' ? 'در حال خواندن…' : 'موقعیت فعلی'}
        </button>
        <button className={`install-btn${tracking ? ' on' : ''}`} onClick={() => { setNote(''); setTracking((t) => !t); }}>
          {tracking ? 'توقف پیگیری' : 'پیگیری از این دستگاه'}
        </button>
        {!inTelegram() && (
          <button className="install-btn" onClick={askBot} disabled={Boolean(busy)}>
            {busy === 'bot' ? 'در حال فرستادن…' : 'زنده از تلگرام'}
          </button>
        )}
        {loc && (
          <button className="install-btn acc-forget" onClick={forget} disabled={Boolean(busy)}>پاک کردن</button>
        )}
      </div>
      {note && <p className="map-note">{note}</p>}
    </main>
  );
}
