import { useEffect, useMemo, useRef, useState } from 'react';
import { parseBookML, paginate, normalize, faDigits, ORDINALS, ABJAD } from '../lib/bookml.js';
import { parseCues, cueWords, align } from '../lib/readalong.js';
import { getPos, setPos } from '../lib/store.js';
import QuoteCapture from './QuoteCard.jsx';

const RATES = [1, 1.25, 1.5, 0.75];

// Module-scope renderers: defining these inside the component would create
// new component types every render, remounting every word span — wiping
// read-along classes mid-playback and detaching footnote markers mid-tap.
const W = ({ item, els }) =>
  item.sp !== undefined ? item.sp : (
    <span className="w" data-wi={item.i}
          ref={(el) => { els.current[item.i] = el; }}>{item.w}</span>
  );
const Items = ({ items, els }) => items.map((it, k) => <W key={k} item={it} els={els} />);
const Segs = ({ segs, els }) =>
  segs.map((s, k) =>
    s.t === 'ref'
      ? <sup className="noteref" key={k} data-n={s.n}>{faDigits(s.n)}</sup>
      : <Items key={k} items={s.items} els={els} />
  );
const reduceMotion = () =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Tokenize parsed BookML into a render plan + normalized word list.
// Every readable word gets a global index shared with the aligner, and a
// page number so the read-along can flip pages as narration advances.
function tokenize(parsed, maxWords) {
  const pagination = paginate(parsed, maxWords);
  const norms = [];
  const wordPage = [];
  let curPage = 1;
  const words = (text) =>
    text.split(/(\s+)/).filter(Boolean).map((p) => {
      if (/^\s+$/.test(p)) return { sp: p };
      const n = normalize(p);
      if (!n) return { sp: p };
      const i = norms.length;
      norms.push(n);
      wordPage.push(curPage);
      return { w: p, i };
    });
  const segs = (list) =>
    list.map((s) => (s.t === 'ref' ? s : { t: 'words', items: words(s.text) }));

  const epigraph = parsed.epigraph
    ? { lines: parsed.epigraph.lines.map(words), source: parsed.epigraph.source }
    : null;

  let sec = 0;
  const blocks = parsed.blocks.map((b, i) => {
    curPage = pagination.blockPage[i];
    if (b.type === 'p' || b.type === 'quote') return { ...b, segs: segs(b.segs) };
    if (b.type === 'h2') return { ...b, sec: sec++, items: words(b.text) };
    if (b.type === 'poem')
      return { ...b, beyts: b.beyts.map(([a, z]) => [words(a), words(z)]) };
    return b;
  });
  return { epigraph, blocks, footnotes: parsed.footnotes, norms, wordPage, pagination };
}

export default function Chapter({ manifest, index, anchor, setFolio, pagesInfo }) {
  const meta = manifest.chapters[index];
  const dev = new URLSearchParams(window.location.search).has('dev');

  const [text, setText] = useState(null);
  const [missing, setMissing] = useState(false);
  const [page, setPage] = useState(1);
  const [audioSrc, setAudioSrc] = useState(null);
  const [hasSync, setHasSync] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [rateIdx, setRateIdx] = useState(0);
  const [prog, setProg] = useState({ t: 0, d: 0 });
  const [hint, setHint] = useState('');
  const [note, setNote] = useState(null);   // {n, x, y} footnote popover

  const audioRef = useRef(null);
  const bodyRef = useRef(null);
  const wordEls = useRef([]);
  const timesRef = useRef(null);
  const timedRef = useRef([]);
  const lastRef = useRef(-1);
  const rafRef = useRef(null);
  const msPosRef = useRef(0);
  const pageRef = useRef(1);
  const flipRef = useRef(0);
  const pendingBiRef = useRef(null);
  const navRef = useRef({});
  const wantAutoplayRef = useRef(false);

  const chapterNo = manifest.chapters
    .slice(0, index + 1)
    .filter((c) => c.kind === 'chapter').length;
  const chLabel = meta.kind === 'chapter'
    ? `فصل ${ORDINALS[chapterNo - 1] || faDigits(chapterNo)}` : null;

  useEffect(() => { setFolio(ABJAD[index] || faDigits(index + 1)); }, [index, setFolio]);

  // arrow-key paging — RTL reading order: ← advances, → goes back
  useEffect(() => {
    const onKey = (e) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      const t = e.target;
      if (t.closest?.('input,textarea,select,[contenteditable],.track')) return;
      if (document.querySelector('.menu-root.open, .quote-modal')) return;
      const { prev, next } = navRef.current;
      if (e.key === 'ArrowLeft' && next && !next.home) {
        e.preventDefault();
        window.location.hash = next.href;
      } else if (e.key === 'ArrowRight' && prev) {
        e.preventDefault();
        window.location.hash = prev.href;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => { pageRef.current = page; }, [page]);

  // ---- chapter text ----
  useEffect(() => {
    fetch(meta.file)
      .then((r) => (r.ok ? r.text() : Promise.reject()))
      .then(setText)
      .catch(() => setMissing(true));
  }, [meta.file]);

  const maxWords = manifest.book.pageWords || 600;
  const doc = useMemo(
    () => (text ? tokenize(parseBookML(text), maxWords) : null),
    [text, maxWords]
  );
  const pageCount = doc ? doc.pagination.count : 1;

  // ---- route anchor -> page (+ optional scroll target) ----
  // p-N: page N.  sec-K: page of the K-th heading.  b-N / resume: page of a
  // block, then scroll to it. All pre-pagination links keep working.
  useEffect(() => {
    if (!doc) return;
    const pg = doc.pagination;
    let target = 1;
    let bi = null;
    if (!anchor) target = 1;
    else if (anchor.startsWith('p-')) target = Math.min(Math.max(+anchor.slice(2) || 1, 1), pg.count);
    else if (anchor.startsWith('sec-')) target = pg.headingPage[+anchor.slice(4)] || 1;
    else if (anchor.startsWith('b-')) { bi = +anchor.slice(2); target = pg.pageOfBi(bi); }
    else if (anchor === 'resume') {
      const pos = getPos();
      if (pos && pos.chapterId === meta.id) { bi = pos.block; target = pg.pageOfBi(bi); }
    }
    pendingBiRef.current = bi;
    setPage(target);
    if (bi == null) window.scrollTo(0, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, anchor, meta.id]);

  // after the page's blocks mount: scroll to a pending block, restore highlight
  useEffect(() => {
    if (!doc) return;
    const bi = pendingBiRef.current;
    if (bi != null) {
      pendingBiRef.current = null;
      requestAnimationFrame(() => {
        bodyRef.current?.querySelector(`[data-bi="${bi}"]`)
          ?.scrollIntoView({ behavior: 'auto', block: 'start' });
      });
    }
    // re-mark read words on the freshly mounted page
    lastRef.current = -1;
    requestAnimationFrame(() => paint());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, page]);

  const gotoPage = (p) => {
    window.location.hash = `#/${meta.id}${p > 1 ? `/p-${p}` : ''}`;
  };

  // ---- audio + cues detection (convention: audio/<id>.mp3 + .srt) ----
  useEffect(() => {
    let live = true;
    // continuous listening: the previous chapter's audio just ended and
    // navigated here — resume playback as soon as this chapter's audio loads
    try {
      if (sessionStorage.getItem('ketab:autoplay') === '1') {
        sessionStorage.removeItem('ketab:autoplay');
        wantAutoplayRef.current = true;
      }
    } catch { /* private mode */ }
    const audioCandidates = meta.audio ? [meta.audio] : [`audio/${meta.id}.mp3`, `audio/${meta.id}.m4a`, `audio/${meta.id}.ogg`];
    const cueCandidates = meta.cues ? [meta.cues] : [`audio/${meta.id}.srt`, `audio/${meta.id}.vtt`];
    (async () => {
      for (const src of audioCandidates) {
        try {
          const r = await fetch(src, { method: 'HEAD' });
          if (r.ok && live) { setAudioSrc(src); break; }
        } catch { /* not uploaded yet */ }
      }
      for (const src of cueCandidates) {
        try {
          const r = await fetch(src);
          if (r.ok && live) { applyCues(await r.text()); break; }
        } catch { /* no cues yet */ }
      }
    })();
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meta.id, doc]);

  function applyCues(cueText) {
    if (!doc) return;
    const { times, matched } = align(doc.norms, cueWords(parseCues(cueText)));
    timesRef.current = times;
    timedRef.current = times
      .map((t, i) => ({ t, i }))
      .filter((x) => x.t != null)
      .sort((a, b) => a.t - b.t);
    lastRef.current = -1;
    wordEls.current.forEach((el) => el && el.classList.remove('read', 'current'));
    setHasSync(matched > 0);
    if (dev) setHint(matched > 0
      ? `هم‌خوانی فعال شد (${faDigits(matched)} واژه)`
      : 'هیچ واژه‌ای هم‌خوان نشد؛ فایل زمان‌بندی را بررسی کنید.');
  }

  // ---- media session: lock-screen / notification playback ----
  useEffect(() => {
    if (!('mediaSession' in navigator) || !audioSrc) return;
    const ms = navigator.mediaSession;
    try {
      ms.metadata = new MediaMetadata({
        title: meta.title,
        artist: manifest.book.translator ? `خوانش: ${manifest.book.translator}` : manifest.book.author,
        album: manifest.book.title,
        artwork: [{ src: manifest.book.cover || 'cover.png', sizes: '512x512', type: 'image/png' }],
      });
    } catch { /* unavailable */ }
    const a = () => audioRef.current;
    const H = (name, fn) => { try { ms.setActionHandler(name, fn); } catch { /* unsupported */ } };
    H('play', () => a()?.play());
    H('pause', () => a()?.pause());
    H('seekbackward', (d) => seekTo((a()?.currentTime || 0) - (d.seekOffset || 10)));
    H('seekforward', (d) => seekTo((a()?.currentTime || 0) + (d.seekOffset || 10)));
    H('seekto', (d) => { if (d.seekTime != null) seekTo(d.seekTime); });
    const prevCh = manifest.chapters[index - 1];
    const nextCh = manifest.chapters[index + 1];
    H('previoustrack', prevCh ? () => { window.location.hash = `#/${prevCh.id}`; } : null);
    H('nexttrack', nextCh ? () => { window.location.hash = `#/${nextCh.id}`; } : null);
    return () => {
      ['play', 'pause', 'seekbackward', 'seekforward', 'seekto', 'previoustrack', 'nexttrack']
        .forEach((n) => { try { ms.setActionHandler(n, null); } catch { /* noop */ } });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioSrc, meta.id, index]);

  // ---- painting ----
  function keepInView(el) {
    const r = el.getBoundingClientRect();
    const top = window.innerHeight * 0.28;
    const bottom = window.innerHeight * 0.72;
    if (r.top < top || r.bottom > bottom) {
      el.scrollIntoView({ block: 'center', behavior: reduceMotion() ? 'auto' : 'smooth' });
    }
  }
  function paint() {
    const audio = audioRef.current;
    const timed = timedRef.current;
    if (!audio || !timed.length) return;
    const t = audio.currentTime;
    let lo = 0, hi = timed.length - 1, idx = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (timed[mid].t <= t) { idx = mid; lo = mid + 1; } else hi = mid - 1;
    }
    const el = (k) => wordEls.current[timed[k].i];
    // narration moved onto a word that lives on another page: flip to it
    if (idx >= 0 && !el(idx) && doc) {
      const p = doc.wordPage[timed[idx].i];
      if (p && p !== pageRef.current && Date.now() - flipRef.current > 700) {
        flipRef.current = Date.now();
        gotoPage(p);
      }
      return;
    }
    const last = lastRef.current;
    if (idx === last) return;
    if (last >= 0 && el(last)) el(last).classList.remove('current');
    if (idx > last) {
      for (let i = Math.max(last, 0); i <= idx; i++) el(i)?.classList.add('read');
    } else {
      for (let i = idx + 1; i <= last; i++) el(i)?.classList.remove('read');
    }
    if (idx >= 0 && el(idx)) {
      el(idx).classList.add('current', 'read');
      keepInView(el(idx));
    }
    lastRef.current = idx;
  }
  function tick() {
    paint();
    const a = audioRef.current;
    if (a) {
      setProg({ t: a.currentTime, d: a.duration || 0 });
      const now = performance.now();
      if ('mediaSession' in navigator && a.duration && now - msPosRef.current > 1000) {
        msPosRef.current = now;
        try {
          navigator.mediaSession.setPositionState({
            duration: a.duration, playbackRate: a.playbackRate, position: a.currentTime,
          });
        } catch { /* unsupported */ }
      }
    }
    rafRef.current = a && !a.paused ? requestAnimationFrame(tick) : null;
  }
  useEffect(() => () => rafRef.current && cancelAnimationFrame(rafRef.current), []);

  const barVisible = Boolean(audioSrc) || dev;
  useEffect(() => {
    document.body.classList.toggle('has-player', barVisible);
    return () => document.body.classList.remove('has-player');
  }, [barVisible]);

  // footnote popover dismissal
  useEffect(() => {
    if (!note) return;
    const hide = () => setNote(null);
    const onDocClick = (e) => {
      if (!e.target.closest('.noteref') && !e.target.closest('.note-pop')) hide();
    };
    const onEsc = (e) => { if (e.key === 'Escape') hide(); };
    window.addEventListener('scroll', hide, { passive: true });
    document.addEventListener('click', onDocClick);
    window.addEventListener('keydown', onEsc);
    return () => {
      window.removeEventListener('scroll', hide);
      document.removeEventListener('click', onDocClick);
      window.removeEventListener('keydown', onEsc);
    };
  }, [note]);

  // reveal blocks as the reader scrolls — replayable, per page
  useEffect(() => {
    if (!doc) return;
    const ro = new IntersectionObserver((es) => {
      es.forEach((e) => e.target.classList.toggle('in', e.isIntersecting));
    }, { rootMargin: '12% 0px 12% 0px', threshold: 0 });
    Array.from(bodyRef.current?.children || []).forEach((el) => ro.observe(el));
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, page]);

  // track reading position (global block index via data-bi)
  useEffect(() => {
    if (!doc) return;
    let timer = 0;
    const save = () => {
      const els = Array.from(bodyRef.current?.querySelectorAll('[data-bi]') || []);
      if (!els.length) return;
      const line = window.innerHeight * 0.2 + 60;
      let el = els[0];
      for (const e of els) {
        if (e.getBoundingClientRect().bottom > line) { el = e; break; }
      }
      const snippet = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 55);
      setPos({ chapterId: meta.id, block: +el.dataset.bi, snippet, at: Date.now() });
    };
    const onScroll = () => {
      if (!timer) timer = setTimeout(() => { timer = 0; save(); }, 400);
    };
    save();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => { window.removeEventListener('scroll', onScroll); if (timer) clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, meta.id, page]);

  // ---- controls ----
  const fmt = (t) => {
    t = Math.max(0, t | 0);
    return faDigits(`${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`);
  };
  const toggle = () => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) a.play(); else a.pause();
  };
  const seekTo = (sec) => {
    const a = audioRef.current;
    if (!a || !a.duration) return;
    a.currentTime = Math.min(Math.max(sec, 0), a.duration);
    lastRef.current = -1;
    paint();
    setProg({ t: a.currentTime, d: a.duration });
  };
  const onTrackPointer = (e) => {
    const track = e.currentTarget;
    const move = (ev) => {
      const r = track.getBoundingClientRect();
      const x = (ev.touches ? ev.touches[0].clientX : ev.clientX) - r.left;
      const a = audioRef.current;
      if (a && a.duration) seekTo((x / r.width) * a.duration);
    };
    move(e);
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const cycleRate = () => {
    const next = (rateIdx + 1) % RATES.length;
    setRateIdx(next);
    if (audioRef.current) audioRef.current.playbackRate = RATES[next];
  };
  const noteAt = (sup) => {
    const r = sup.getBoundingClientRect();
    return {
      n: +sup.dataset.n,
      x: Math.min(Math.max(r.left + r.width / 2, 16), window.innerWidth - 16),
      y: r.top,
    };
  };
  const onBodyOver = (e) => {
    if (!window.matchMedia('(hover: hover)').matches) return;  // touch: tap owns it
    const sup = e.target.closest?.('.noteref');
    if (sup && sup.dataset.n && note?.n !== +sup.dataset.n) setNote(noteAt(sup));
  };
  const onWordClick = (e) => {
    const sup = e.target.closest('.noteref');
    if (sup && sup.dataset.n) {
      e.preventDefault();
      if (window.matchMedia('(hover: hover)').matches) {
        setNote(noteAt(sup));          // hover already showed it; click keeps it
      } else {
        setNote((cur) => (cur && cur.n === +sup.dataset.n ? null : noteAt(sup)));
      }
      return;
    }
    if (!window.getSelection()?.isCollapsed) return;
    const s = e.target.closest('.w');
    if (!s || !hasSync) return;
    const t = timesRef.current?.[+s.dataset.wi];
    if (t != null && audioRef.current) {
      seekTo(t + 0.01);
      if (audioRef.current.paused) audioRef.current.play();
    }
  };

  // dev pickers
  const audioFileRef = useRef(null);
  const cueFileRef = useRef(null);
  const pickAudio = () => {
    const f = audioFileRef.current.files[0];
    if (f) setAudioSrc(URL.createObjectURL(f));
  };
  const pickCues = () => {
    const f = cueFileRef.current.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => applyCues(r.result);
    r.readAsText(f);
  };

  if (missing) return <main><div className="notfound">این فصل یافت نشد.</div></main>;
  if (!doc) return <main><div className="loading">…</div></main>;

  const pg = doc.pagination;
  const off = pg.off;
  const paged = pageCount > 1;
  const prevCh = manifest.chapters[index - 1];
  const nextCh = manifest.chapters[index + 1];

  // page-local footnotes, keeping their chapter-global numbers
  const pageNotes = doc.footnotes
    .map((f, i) => ({ ...f, n: i + 1 }))
    .filter((f) => pg.blockPage[f.block] === page);

  // nav targets — continuation pages carry their section's name
  const pageLabel = (p) => {
    const info = pg.pages[p - 1];
    if (!info) return '';
    if (info.heading) return info.heading;
    if (info.cont) return info.section ? `${info.section} ــ ادامه` : 'ادامه';
    return p === 1 ? 'آغاز فصل' : 'ادامه';
  };
  const prevNav = page > 1
    ? { href: `#/${meta.id}${page - 1 > 1 ? `/p-${page - 1}` : ''}`, label: pageLabel(page - 1) }
    : prevCh
      ? { href: `#/${prevCh.id}${(pagesInfo?.[prevCh.id] || 1) > 1 ? `/p-${pagesInfo[prevCh.id]}` : ''}`,
          label: prevCh.title }
      : null;
  const nextNav = page < pageCount
    ? { href: `#/${meta.id}/p-${page + 1}`, label: pageLabel(page + 1) }
    : nextCh
      ? { href: `#/${nextCh.id}`, label: nextCh.title }
      : { href: '#/', label: 'بازگشت به فهرست', home: true };

  navRef.current = { prev: prevNav, next: nextNav };

  return (
    <main>
      {page === 1 ? (
        <div className="chapter-open">
          {chLabel && <p className="chlabel">{chLabel}</p>}
          <div className="ornament" role="presentation"><span>٭</span></div>
          <h1>{meta.title}</h1>
          {paged && <p className="pg-top">بخشِ {faDigits(page)} از {faDigits(pageCount)}</p>}
        </div>
      ) : (
        <div className="chapter-open compact">
          <p className="chlabel">{chLabel ? `${chLabel} ــ ` : ''}{meta.title}</p>
          <p className="pg-top">بخشِ {faDigits(page)} از {faDigits(pageCount)}</p>
        </div>
      )}

      <div
        className={`chapter-body${hasSync ? ' has-sync' : ''}`}
        ref={bodyRef}
        onClick={onWordClick}
        onMouseOver={onBodyOver}
      >
        {page === 1 && doc.epigraph && (
          <div className="epigraph reveal" data-bi={0}>
            <div className="inner">
              {doc.epigraph.lines.map((items, k) => (
                <div key={k}><Items items={items} els={wordEls} /></div>
              ))}
              {doc.epigraph.source && <div className="src">ــ {doc.epigraph.source}</div>}
            </div>
          </div>
        )}

        {doc.blocks.map((b, i) => {
          if (pg.blockPage[i] !== page) return null;
          const bi = off + i;
          if (b.type === 'p') return <p key={i} className="reveal" data-bi={bi}><Segs segs={b.segs} els={wordEls} /></p>;
          if (b.type === 'quote') return <blockquote key={i} className="reveal" data-bi={bi}><Segs segs={b.segs} els={wordEls} /></blockquote>;
          if (b.type === 'h2') return <h2 key={i} className="reveal" data-bi={bi} id={`sec-${b.sec}`}><Items items={b.items} els={wordEls} /></h2>;
          if (b.type === 'divider') return (
            <div key={i} className="ornament reveal" data-bi={bi} style={{ margin: '2.2rem auto' }}>
              <span>٭&emsp;٭&emsp;٭</span>
            </div>
          );
          if (b.type === 'poem') return (
            <div key={i} className="beyt-block reveal" data-bi={bi}>
              {b.beyts.map(([a, z], k) => (
                <div className="beyt" key={k}>
                  <span className="mesra"><Items items={a} els={wordEls} /></span>
                  <span className="mesra"><Items items={z} els={wordEls} /></span>
                </div>
              ))}
              {b.poet && <p className="poet">ــ {b.poet}</p>}
            </div>
          );
          return null;
        })}

        {pageNotes.length > 0 && (
          <ol className="footnotes reveal">
            {pageNotes.map((f) => (
              <li key={f.n} data-n={faDigits(f.n)}>
                {f.kind === 'latin' ? <span className="lr">{f.text}</span> : `${f.text} ــ م.`}
              </li>
            ))}
          </ol>
        )}
      </div>

      {note && doc.footnotes[note.n - 1] && (
        <div
          className="note-pop"
          role="tooltip"
          style={{ left: note.x, bottom: window.innerHeight - note.y + 8 }}
        >
          {doc.footnotes[note.n - 1].kind === 'latin'
            ? <span className="lr">{doc.footnotes[note.n - 1].text}</span>
            : `${doc.footnotes[note.n - 1].text} ــ م.`}
        </div>
      )}

      <QuoteCapture bodyRef={bodyRef} book={manifest.book} chapterTitle={meta.title} />

      <nav className="chapter-nav">
        <span>{prevNav && <a href={prevNav.href}>→ {prevNav.label}</a>}</span>
        {paged && <span className="pg-ind">{faDigits(page)} / {faDigits(pageCount)}</span>}
        <span>
          <a className={nextNav.home ? 'home-link' : undefined} href={nextNav.href}>
            {nextNav.label} {nextNav.home ? '' : '←'}
          </a>
        </span>
      </nav>

      {barVisible && (
        <div className={`player${dev ? ' dev' : ''}`}>
          <button className="playtoggle" onClick={toggle} disabled={!audioSrc}
                  aria-label={playing ? 'توقف' : 'پخش'}>
            {playing ? '❚❚' : '▶'}
          </button>
          <span className="label">خوانش با صدای مترجم</span>
          <span className="seek">
            <span className="ptime">{fmt(prog.t)} / {fmt(prog.d)}</span>
            <span className="track" role="slider" tabIndex={0}
                  aria-label="نوار پیشرفت" aria-valuemin={0} aria-valuemax={100}
                  aria-valuenow={prog.d ? Math.round((prog.t / prog.d) * 100) : 0}
                  onPointerDown={onTrackPointer}
                  onKeyDown={(e) => {
                    if (e.key === 'ArrowLeft') seekTo(prog.t - 5);
                    if (e.key === 'ArrowRight') seekTo(prog.t + 5);
                  }}>
              <span className="fill" style={{ width: prog.d ? `${(prog.t / prog.d) * 100}%` : 0 }} />
              <span className="knob" style={{ left: prog.d ? `${(prog.t / prog.d) * 100}%` : 0 }} />
            </span>
          </span>
          <button className="rate" onClick={cycleRate} aria-label="سرعت پخش">
            ×{faDigits(String(RATES[rateIdx])).replace('.', '٫')}
          </button>
          {dev && (<>
            <button className="pbtn dev-only" onClick={() => audioFileRef.current.click()}>فایل صدا</button>
            <button className="pbtn dev-only" onClick={() => cueFileRef.current.click()}>زمان‌بندی (SRT/VTT)</button>
            <span className="hint dev-only">{hint}</span>
            <input type="file" ref={audioFileRef} className="visually-hidden" accept="audio/*" onChange={pickAudio} />
            <input type="file" ref={cueFileRef} className="visually-hidden" accept=".srt,.vtt,text/vtt,text/plain" onChange={pickCues} />
          </>)}
          <audio
            ref={audioRef}
            src={audioSrc || undefined}
            preload="metadata"
            onPlay={() => {
              setPlaying(true);
              try { navigator.mediaSession.playbackState = 'playing'; } catch { /* noop */ }
              if (!rafRef.current) rafRef.current = requestAnimationFrame(tick);
            }}
            onPause={() => {
              setPlaying(false);
              try { navigator.mediaSession.playbackState = 'paused'; } catch { /* noop */ }
            }}
            onEnded={() => {
              setPlaying(false);
              const nx = manifest.chapters[index + 1];
              if (nx) {
                try { sessionStorage.setItem('ketab:autoplay', '1'); } catch { /* noop */ }
                window.location.hash = `#/${nx.id}`;
              }
            }}
            onLoadedMetadata={(e) => {
              setProg({ t: 0, d: e.target.duration || 0 });
              if (wantAutoplayRef.current) {
                wantAutoplayRef.current = false;
                e.target.play().catch(() => { /* autoplay blocked by browser */ });
              }
            }}
          />
        </div>
      )}
    </main>
  );
}
