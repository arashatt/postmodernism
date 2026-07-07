import { useEffect, useMemo, useRef, useState } from 'react';
import { parseBookML, normalize, faDigits, ORDINALS, ABJAD } from '../lib/bookml.js';
import { parseCues, cueWords, align } from '../lib/readalong.js';
import { getPos, setPos } from '../lib/store.js';
import QuoteCapture from './QuoteCard.jsx';

const RATES = [1, 1.25, 1.5, 0.75];
const reduceMotion = () =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Tokenize parsed BookML into a render plan + normalized word list.
// Every readable word gets a global index shared with the aligner.
function tokenize(parsed) {
  const norms = [];
  const words = (text) =>
    text.split(/(\s+)/).filter(Boolean).map((p) => {
      if (/^\s+$/.test(p)) return { sp: p };
      const n = normalize(p);
      if (!n) return { sp: p };
      const i = norms.length;
      norms.push(n);
      return { w: p, i };
    });
  const segs = (list) =>
    list.map((s) => (s.t === 'ref' ? s : { t: 'words', items: words(s.text) }));

  let sec = 0;
  const blocks = parsed.blocks.map((b) => {
    if (b.type === 'p' || b.type === 'quote') return { ...b, segs: segs(b.segs) };
    if (b.type === 'h2') return { ...b, sec: sec++, items: words(b.text) };
    if (b.type === 'poem')
      return { ...b, beyts: b.beyts.map(([a, z]) => [words(a), words(z)]) };
    return b;
  });
  const epigraph = parsed.epigraph
    ? { lines: parsed.epigraph.lines.map(words), source: parsed.epigraph.source }
    : null;
  return { epigraph, blocks, footnotes: parsed.footnotes, norms };
}

export default function Chapter({ manifest, index, anchor, setFolio }) {
  const meta = manifest.chapters[index];
  const dev = new URLSearchParams(window.location.search).has('dev');

  const [text, setText] = useState(null);
  const [missing, setMissing] = useState(false);
  const [audioSrc, setAudioSrc] = useState(null);
  const [hasSync, setHasSync] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [rateIdx, setRateIdx] = useState(0);
  const [prog, setProg] = useState({ t: 0, d: 0 });
  const [hint, setHint] = useState('');

  const audioRef = useRef(null);
  const bodyRef = useRef(null);
  const wordEls = useRef([]);
  const timesRef = useRef(null);   // number|null per word index
  const timedRef = useRef([]);     // [{t, i}] sorted by t
  const lastRef = useRef(-1);
  const rafRef = useRef(null);
  const msPosRef = useRef(0);

  const chapterNo = manifest.chapters
    .slice(0, index + 1)
    .filter((c) => c.kind === 'chapter').length;

  useEffect(() => { setFolio(ABJAD[index] || faDigits(index + 1)); }, [index, setFolio]);

  // ---- chapter text ----
  useEffect(() => {
    fetch(meta.file)
      .then((r) => (r.ok ? r.text() : Promise.reject()))
      .then(setText)
      .catch(() => setMissing(true));
  }, [meta.file]);

  const doc = useMemo(() => (text ? tokenize(parseBookML(text)) : null), [text]);

  // ---- audio + cues detection (convention: audio/<id>.mp3 + .srt) ----
  useEffect(() => {
    let live = true;
    const audioCandidates = meta.audio ? [meta.audio] : [`audio/${meta.id}.mp3`, `audio/${meta.id}.m4a`, `audio/${meta.id}.ogg`];
    const cueCandidates = meta.cues ? [meta.cues] : [`audio/${meta.id}.srt`, `audio/${meta.id}.vtt`];
    (async () => {
      for (const src of audioCandidates) {
        try {
          const r = await fetch(src, { method: 'HEAD' });
          if (r.ok && live) { setAudioSrc(src); break; }
        } catch { /* server file not there yet */ }
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

  const bodyEls = () => Array.from(bodyRef.current?.children || []);

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
    const last = lastRef.current;
    if (idx === last) return;
    const el = (k) => wordEls.current[timed[k].i];
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
        } catch { /* not supported */ }
      }
    }
    rafRef.current = a && !a.paused ? requestAnimationFrame(tick) : null;
  }
  useEffect(() => () => rafRef.current && cancelAnimationFrame(rafRef.current), []);

  // Media Session: notification-shade (Android) and lock-screen /
  // Control Center (iOS) playback with chapter metadata and cover art.
  useEffect(() => {
    if (!('mediaSession' in navigator) || !audioSrc) return;
    const ms = navigator.mediaSession;
    try {
      ms.metadata = new MediaMetadata({
        title: meta.title,
        artist: manifest.book.translator ? `خوانش: ${manifest.book.translator}` : manifest.book.author,
        album: manifest.book.title,
        artwork: [
          { src: manifest.book.cover || 'cover.png', sizes: '512x512', type: 'image/png' },
        ],
      });
    } catch { /* MediaMetadata unavailable */ }
    const a = () => audioRef.current;
    const H = (name, fn) => { try { ms.setActionHandler(name, fn); } catch { /* unsupported action */ } };
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

  // body padding while the bar is visible
  const barVisible = Boolean(audioSrc) || dev;
  useEffect(() => {
    document.body.classList.toggle('has-player', barVisible);
    return () => document.body.classList.remove('has-player');
  }, [barVisible]);

  // reveal blocks as the reader scrolls — replayable: leaving the viewport
  // resets a block, so scrolling back up animates it again. The extended
  // rootMargin keeps partially-visible blocks from flickering at the edges.
  useEffect(() => {
    if (!doc) return;
    const ro = new IntersectionObserver((es) => {
      es.forEach((e) => e.target.classList.toggle('in', e.isIntersecting));
    }, { rootMargin: '12% 0px 12% 0px', threshold: 0 });
    bodyEls().forEach((el) => ro.observe(el));
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc]);

  // track reading position (throttled) — powers «ادامهٔ خواندن» and bookmarks
  useEffect(() => {
    if (!doc) return;
    let timer = 0;
    const save = () => {
      const els = bodyEls();
      if (!els.length) return;
      const line = window.innerHeight * 0.2 + 60;
      let bi = 0;
      for (let i = 0; i < els.length; i++) {
        if (els[i].getBoundingClientRect().bottom > line) { bi = i; break; }
      }
      const snippet = (els[bi]?.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 55);
      setPos({ chapterId: meta.id, block: bi, snippet, at: Date.now() });
    };
    const onScroll = () => {
      if (!timer) timer = setTimeout(() => { timer = 0; save(); }, 400);
    };
    save();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => { window.removeEventListener('scroll', onScroll); if (timer) clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, meta.id]);

  // anchor scrolling: sec-N (TOC sections), b-N (bookmarks), resume (saved position)
  useEffect(() => {
    if (!doc || !anchor) return;
    let target = null;
    if (anchor === 'resume') {
      const pos = getPos();
      if (pos && pos.chapterId === meta.id) target = bodyEls()[pos.block];
    } else if (anchor.startsWith('b-')) {
      target = bodyEls()[+anchor.slice(2)];
    } else {
      target = document.getElementById(anchor);
    }
    if (target) {
      requestAnimationFrame(() =>
        target.scrollIntoView({ behavior: 'auto', block: 'start' }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, anchor, meta.id]);

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
  const onWordClick = (e) => {
    // a drag-selection ends in a click; don't treat it as a seek
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

  // ---- rendering helpers ----
  const W = ({ item }) =>
    item.sp !== undefined ? item.sp : (
      <span className="w" data-wi={item.i}
            ref={(el) => { wordEls.current[item.i] = el; }}>{item.w}</span>
    );
  const Items = ({ items }) => items.map((it, k) => <W key={k} item={it} />);
  const Segs = ({ segs }) =>
    segs.map((s, k) =>
      s.t === 'ref'
        ? <sup className="noteref" key={k}>{faDigits(s.n)}</sup>
        : <Items key={k} items={s.items} />
    );

  if (missing) return <main><div className="notfound">این فصل یافت نشد.</div></main>;
  if (!doc) return <main><div className="loading">…</div></main>;

  const prev = manifest.chapters[index - 1];
  const next = manifest.chapters[index + 1];

  return (
    <main>
      <div className="chapter-open">
        {meta.kind === 'chapter' && (
          <p className="chlabel">فصل {ORDINALS[chapterNo - 1] || faDigits(chapterNo)}</p>
        )}
        <div className="ornament" role="presentation"><span>٭</span></div>
        <h1>{meta.title}</h1>
      </div>

      <div
        className={`chapter-body${hasSync ? ' has-sync' : ''}`}
        ref={bodyRef}
        onClick={onWordClick}
      >
        {doc.epigraph && (
          <div className="epigraph reveal">
            <div className="inner">
              {doc.epigraph.lines.map((items, k) => (
                <div key={k}><Items items={items} /></div>
              ))}
              {doc.epigraph.source && <div className="src">ــ {doc.epigraph.source}</div>}
            </div>
          </div>
        )}

        {doc.blocks.map((b, i) => {
          if (b.type === 'p') return <p key={i} className="reveal"><Segs segs={b.segs} /></p>;
          if (b.type === 'quote') return <blockquote key={i} className="reveal"><Segs segs={b.segs} /></blockquote>;
          if (b.type === 'h2') return <h2 key={i} className="reveal" id={`sec-${b.sec}`}><Items items={b.items} /></h2>;
          if (b.type === 'divider') return (
            <div key={i} className="ornament reveal" style={{ margin: '2.2rem auto' }}>
              <span>٭&emsp;٭&emsp;٭</span>
            </div>
          );
          if (b.type === 'poem') return (
            <div key={i} className="beyt-block reveal">
              {b.beyts.map(([a, z], k) => (
                <div className="beyt" key={k}>
                  <span className="mesra"><Items items={a} /></span>
                  <span className="mesra"><Items items={z} /></span>
                </div>
              ))}
              {b.poet && <p className="poet">ــ {b.poet}</p>}
            </div>
          );
          return null;
        })}

        {doc.footnotes.length > 0 && (
          <ol className="footnotes reveal">
            {doc.footnotes.map((f, i) => (
              <li key={i} data-n={faDigits(i + 1)}>
                {f.kind === 'latin' ? <span className="lr">{f.text}</span> : `${f.text} ــ م.`}
              </li>
            ))}
          </ol>
        )}
      </div>

      <QuoteCapture bodyRef={bodyRef} book={manifest.book} chapterTitle={meta.title} />

      <nav className="chapter-nav">
        <span>{prev && <a href={`#/${prev.id}`}>→ {prev.title}</a>}</span>
        <span>{next ? <a href={`#/${next.id}`}>{next.title} ←</a> : <a className="home-link" href="#/">بازگشت به فهرست</a>}</span>
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
            onEnded={() => setPlaying(false)}
            onLoadedMetadata={(e) => setProg({ t: 0, d: e.target.duration || 0 })}
          />
        </div>
      )}
    </main>
  );
}
