import { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchLocation, fetchMe, forgetLocation, inTelegram, initMiniApp, loginWithInitData,
  loginWithWidget, logout, mountLoginButton, readLocation, requestLocationViaBot, saveLocation,
} from '../lib/telegram.js';

const fa = (s) => String(s).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);

// ٫ is the Persian decimal separator; the book sets numbers that way.
const coord = (n) => fa(Number(n).toFixed(5)).replace('.', '٫');

function when(seconds) {
  if (!seconds) return '';
  const mins = Math.max(0, Math.round((Date.now() / 1000 - seconds) / 60));
  if (mins < 1) return 'هم‌اکنون';
  if (mins < 60) return `${fa(mins)} دقیقه پیش`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${fa(hours)} ساعت پیش`;
  return `${fa(Math.round(hours / 24))} روز پیش`;
}

const MESSAGES = {
  denied: 'اجازهٔ دسترسی به موقعیت داده نشد.',
  old_client: 'نسخهٔ تلگرام شما موقعیت‌یابی درون‌برنامه‌ای ندارد؛ از راه ربات بفرستید.',
  unavailable: 'موقعیت‌یابی روی این دستگاه در دسترس نیست.',
  start_bot_first: 'نخست یک‌بار گفت‌وگو با ربات را آغاز کنید، سپس دوباره بزنید.',
  no_storage: 'فرستادن از راه ربات روی این نصب راه‌اندازی نشده است.',
  too_soon: 'کمی صبر کنید و دوباره بزنید.',
  failed: 'نشد؛ دوباره تلاش کنید.',
};

// «حساب تلگرام», shown in the drawer. Hidden entirely when the site is
// deployed without the API — a reader of a static copy sees no sign-in box.
export default function Account() {
  const [state, setState] = useState({ loading: true, configured: false, bot: '', user: null, location: null });
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState('');
  const [waiting, setWaiting] = useState(false);
  const buttonRef = useRef(null);
  const live = useRef(true);
  const poll = useRef(null);

  // Set on the way in as well as cleared on the way out: StrictMode mounts,
  // unmounts and mounts again in development, and a flag left false there
  // would swallow every later update.
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      clearInterval(poll.current);
    };
  }, []);

  const apply = useCallback((patch) => {
    if (live.current) setState((prev) => ({ ...prev, ...patch }));
  }, []);

  // One look at the API on load: is it configured, and are we already known?
  // Inside Telegram the answer to the second question is «not yet, but here
  // is a signed initData», so sign in with it straight away.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const me = await fetchMe().catch(() => ({}));
      if (cancelled) return;
      const base = {
        loading: false,
        configured: Boolean(me.configured),
        bot: me.bot || '',
        user: me.user || null,
        location: me.location || null,
      };
      if (!base.configured || base.user || !inTelegram()) { apply(base); return; }

      apply({ ...base, loading: true });
      const tg = await initMiniApp();
      const res = tg && tg.initData ? await loginWithInitData(tg.initData).catch(() => ({})) : {};
      if (cancelled) return;
      apply({ ...base, user: res.user || null, location: res.location || base.location });
    })();
    return () => { cancelled = true; };
  }, [apply]);

  // The login widget is a script that renders its own button, so it is mounted
  // by hand once we know the bot's name and that nobody is signed in.
  useEffect(() => {
    if (state.loading || !state.configured || state.user || !state.bot || inTelegram()) return undefined;
    return mountLoginButton(buttonRef.current, {
      bot: state.bot,
      onAuth: async (payload) => {
        setBusy('login');
        const res = await loginWithWidget(payload).catch(() => ({}));
        setBusy('');
        if (res.user) apply({ user: res.user, location: res.location || null });
        else setNote(MESSAGES.failed);
      },
    });
  }, [state.loading, state.configured, state.user, state.bot, apply]);

  const share = async () => {
    setNote('');
    setBusy('share');
    const got = await readLocation();
    if (!got.ok) {
      setBusy('');
      setNote(MESSAGES[got.reason] || MESSAGES.failed);
      got.openSettings?.();
      return;
    }
    const res = await saveLocation(got.location).catch(() => ({}));
    setBusy('');
    if (res.location) {
      apply({ location: res.location });
      if (res.stored === false) setNote('موقعیت خوانده شد، اما روی سرور نگه‌داری نشد.');
    } else {
      setNote(MESSAGES.failed);
    }
  };

  // The bot asks in the reader's chat; the answer arrives at the webhook, so
  // the page watches for it instead of receiving it directly.
  const askBot = async () => {
    setNote('');
    setBusy('bot');
    const res = await requestLocationViaBot().catch(() => ({}));
    setBusy('');
    if (!res.sent) {
      setNote(MESSAGES[res.error] || MESSAGES.failed);
      return;
    }
    setNote('در تلگرام دکمهٔ «فرستادن موقعیت» را بزنید.');
    setWaiting(true);
    const until = Date.now() + 2 * 60 * 1000;
    clearInterval(poll.current);
    poll.current = setInterval(async () => {
      const now = await fetchLocation().catch(() => ({}));
      if (!live.current) return;
      if (now.location) {
        clearInterval(poll.current);
        setWaiting(false);
        setNote('');
        apply({ location: now.location });
      } else if (Date.now() > until) {
        clearInterval(poll.current);
        setWaiting(false);
      }
    }, 3000);
  };

  const forget = async () => {
    setNote('');
    setBusy('forget');
    await forgetLocation().catch(() => {});
    setBusy('');
    clearInterval(poll.current);
    setWaiting(false);
    apply({ location: null });
  };

  const signOut = async () => {
    setNote('');
    setBusy('logout');
    await logout().catch(() => {});
    setBusy('');
    clearInterval(poll.current);
    setWaiting(false);
    apply({ user: null, location: null });
  };

  if (state.loading || !state.configured) return null;

  const { user, location } = state;

  return (
    <div className="menu-section menu-account">
      <div className="menu-h"><span>حساب تلگرام</span></div>

      {!user ? (
        <>
          <p className="acc-note">
            با حساب تلگرامتان وارد شوید تا نشانِ خواندن و موقعیتتان میان دستگاه‌ها یکی بماند.
          </p>
          <div className="acc-login" ref={buttonRef} />
          {busy === 'login' && <p className="acc-note">در حال ورود…</p>}
          {note && <p className="acc-note acc-warn">{note}</p>}
        </>
      ) : (
        <>
          <div className="acc-who">
            {user.photo
              ? <img className="acc-pic" src={user.photo} alt="" width="40" height="40" loading="lazy" />
              : <span className="acc-pic acc-pic-blank" aria-hidden="true">☺</span>}
            <span className="acc-id">
              <span className="acc-name">{user.name || 'خوانندهٔ گرامی'}</span>
              <span className="acc-handle lr">{user.username ? `@${user.username}` : `id ${user.id}`}</span>
            </span>
            <button className="acc-out" onClick={signOut} disabled={busy === 'logout'}>خروج</button>
          </div>

          <div className="acc-loc">
            {location ? (
              <>
                <p className="acc-note">
                  {/* labelled, because a bare pair of numbers gives no hint
                      which way round it reads in a right-to-left line */}
                  موقعیت ثبت‌شده ــ عرض <span className="acc-num">{coord(location.latitude)}</span>{' '}
                  و طول <span className="acc-num">{coord(location.longitude)}</span>
                  {location.at ? ` (${when(location.at)})` : ''}
                </p>
                <p className="acc-note acc-quiet">
                  <a href="#/naghsheh">نمایش روی نقشه</a>
                  {' · '}
                  <a href={`https://www.openstreetmap.org/?mlat=${location.latitude}&mlon=${location.longitude}#map=13/${location.latitude}/${location.longitude}`}
                     target="_blank" rel="noreferrer noopener">در OpenStreetMap</a>
                </p>
              </>
            ) : (
              <>
                <p className="acc-note">
                  موقعیتی ثبت نشده است. فرستادنش اختیاری است و هر وقت بخواهید پاک می‌شود.
                </p>
                <p className="acc-note acc-quiet"><a href="#/naghsheh">نقشه</a></p>
              </>
            )}

            <div className="acc-actions">
              <button className="install-btn" onClick={share} disabled={Boolean(busy)}>
                {busy === 'share' ? 'در حال خواندن…' : location ? 'به‌روزرسانی موقعیت' : 'فرستادن موقعیت'}
              </button>
              {!inTelegram() && (
                <button className="install-btn" onClick={askBot} disabled={Boolean(busy) || waiting}>
                  {waiting ? 'در انتظار تلگرام…' : 'از راه تلگرام'}
                </button>
              )}
              {location && (
                <button className="install-btn acc-forget" onClick={forget} disabled={Boolean(busy)}>
                  پاک کردن
                </button>
              )}
            </div>
            {note && <p className="acc-note acc-warn">{note}</p>}
          </div>
        </>
      )}
    </div>
  );
}
