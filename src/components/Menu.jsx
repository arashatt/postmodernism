import { useEffect, useMemo, useRef, useState } from 'react';
import { ORDINALS } from '../lib/bookml.js';
import { searchBlocks } from '../lib/search.js';

// Slide-in drawer: search · continue · فهرست · نشان‌ها · settings.
export default function Menu({
  open, onClose, manifest, headings, pos, marks, hasGlossary, onRemoveMark,
  searchIdx, settings, onSettings,
}) {
  const { book, chapters } = manifest;
  const [q, setQ] = useState('');
  const searchRef = useRef(null);

  // lock body scroll while open; Esc closes; focus search on open
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    const t = setTimeout(() => searchRef.current?.focus(), 320);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
      clearTimeout(t);
    };
  }, [open, onClose]);

  useEffect(() => { if (!open) setQ(''); }, [open]);

  const results = useMemo(
    () => (q.trim() ? searchBlocks(searchIdx, q, 24) : []),
    [q, searchIdx]
  );

  const chapterTitle = (id) => chapters.find((c) => c.id === id)?.title || id;
  const posChapter = pos && chapters.find((c) => c.id === pos.chapterId);
  let chapterNo = 0;

  const scales = [
    { v: 0.9, label: 'ک' },
    { v: 1, label: 'م' },
    { v: 1.15, label: 'ب' },
    { v: 1.3, label: 'خ' },
  ];
  const themes = [
    { v: 'day', label: 'روز' },
    { v: 'sepia', label: 'کاهی' },
    { v: 'night', label: 'شب' },
  ];

  return (
    <div className={`menu-root${open ? ' open' : ''}`} aria-hidden={!open}>
      <div className="menu-scrim" onClick={onClose} />
      <nav className="menu-drawer" role="dialog" aria-modal="true" aria-label="فهرست کتاب">
        <div className="menu-top">
          <span className="menu-title">{book.title}</span>
          <button className="menu-close" onClick={onClose} aria-label="بستن">×</button>
        </div>

        {searchIdx && searchIdx.length > 0 && (
          <div className="menu-search">
            <svg className="search-ic" viewBox="0 0 24 24" aria-hidden="true" width="18" height="18">
              <circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" strokeWidth="1.6" />
              <line x1="16.5" y1="16.5" x2="21" y2="21" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
            <input
              ref={searchRef}
              className="search-input"
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="جست‌وجو در متن کتاب…"
              aria-label="جست‌وجو"
            />
            {q && <button className="search-clear" onClick={() => setQ('')} aria-label="پاک کردن">×</button>}
          </div>
        )}

        {q.trim() ? (
          <div className="menu-section search-results">
            <div className="menu-h"><span>{results.length ? `${results.length} یافته` : 'یافته‌ای نبود'}</span></div>
            {results.map((r, i) => (
              <a className="result-row" key={i} href={`#/${r.chapterId}/b-${r.bi}`} onClick={onClose}>
                <span className="result-ch">{chapterTitle(r.chapterId)}</span>
                <span className="result-snip">
                  {r.before}<mark>{r.match}</mark>{r.after}
                </span>
              </a>
            ))}
          </div>
        ) : (
          <>
            {posChapter && (
              <a className="menu-continue" href={`#/${pos.chapterId}/resume`} onClick={onClose}>
                <span className="mc-label">ادامهٔ خواندن</span>
                <span className="mc-title">{posChapter.title}</span>
                {pos.snippet && <span className="mc-snippet">…{pos.snippet}…</span>}
              </a>
            )}

            <div className="menu-section">
              <div className="menu-h"><span>فهرست</span></div>
              {chapters.map((c) => {
                const isChapter = c.kind === 'chapter';
                if (isChapter) chapterNo += 1;
                return (
                  <div key={c.id}>
                    <a className="toc-row chapter" href={`#/${c.id}`} onClick={onClose}>
                      <span>{isChapter ? `فصل ${ORDINALS[chapterNo - 1] || chapterNo} ــ ${c.title}` : c.title}</span>
                    </a>
                    {(headings[c.id] || []).map((h, k) => (
                      <a className="toc-row section-row" key={k} href={`#/${c.id}/sec-${k}`} onClick={onClose}>
                        <span>{h}</span>
                      </a>
                    ))}
                  </div>
                );
              })}
              {hasGlossary && (
                <a className="toc-row chapter" href="#/vajenameh" onClick={onClose}>
                  <span>واژه‌نامه</span>
                </a>
              )}
            </div>

            {marks.length > 0 && (
              <div className="menu-section">
                <div className="menu-h"><span>نشان‌ها</span></div>
                {marks.map((m) => {
                  const ch = chapters.find((c) => c.id === m.chapterId);
                  if (!ch) return null;
                  return (
                    <div className="mark-row" key={m.id}>
                      <a href={`#/${m.chapterId}/b-${m.block}`} onClick={onClose}>
                        <span className="mark-ch">{ch.title}</span>
                        {m.snippet && <span className="mark-snippet">…{m.snippet}…</span>}
                      </a>
                      <button className="mark-del" aria-label="حذف نشان"
                              onClick={() => onRemoveMark(m.id)}>×</button>
                    </div>
                  );
                })}
              </div>
            )}

            {settings && onSettings && (
              <div className="menu-section menu-settings">
                <div className="menu-h"><span>نمایش</span></div>
                <div className="set-row">
                  <span className="set-label">اندازهٔ متن</span>
                  <div className="seg" role="group" aria-label="اندازهٔ متن">
                    {scales.map((s) => (
                      <button key={s.v}
                        className={`seg-b${Math.abs(settings.fontScale - s.v) < 0.01 ? ' on' : ''}`}
                        style={{ fontSize: `${0.82 + (s.v - 0.9) * 1.1}rem` }}
                        onClick={() => onSettings({ fontScale: s.v })}
                        aria-pressed={Math.abs(settings.fontScale - s.v) < 0.01}>
                        {s.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="set-row">
                  <span className="set-label">حال‌وهوا</span>
                  <div className="seg" role="group" aria-label="حال‌وهوا">
                    {themes.map((t) => (
                      <button key={t.v}
                        className={`seg-b${settings.theme === t.v ? ' on' : ''}`}
                        onClick={() => onSettings({ theme: t.v })}
                        aria-pressed={settings.theme === t.v}>
                        {t.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        <div className="menu-foot">
          <a href={book.orderUrl || '#/'} onClick={onClose}>سفارش کتاب</a>
        </div>
      </nav>
    </div>
  );
}
