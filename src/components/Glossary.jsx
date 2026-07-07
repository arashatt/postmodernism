import { useEffect, useMemo } from 'react';
import { ORDINALS } from '../lib/bookml.js';

// واژه‌نامه — built automatically from «term»[[latin]] markers across all
// chapters. Duplicate Latin terms merge; each occurrence deep-links to the
// paragraph (#/chapter/b-N) where the term appears.
export default function Glossary({ manifest, terms, setFolio }) {
  useEffect(() => { setFolio('٭'); }, [setFolio]);

  const entries = useMemo(() => {
    const map = new Map();
    for (const t of terms) {
      const key = t.latin.trim().toLowerCase();
      if (!map.has(key)) map.set(key, { latin: t.latin.trim(), terms: new Set(), occ: [] });
      const e = map.get(key);
      if (t.term) e.terms.add(t.term);
      e.occ.push({ chapterId: t.chapterId, block: t.block });
    }
    return [...map.values()]
      .map((e) => ({ ...e, fa: [...e.terms].join('؛ ') || '—' }))
      .sort((a, b) => a.fa.localeCompare(b.fa, 'fa'));
  }, [terms]);

  const chapterLabel = (id) => {
    const idx = manifest.chapters.findIndex((c) => c.id === id);
    if (idx < 0) return id;
    const c = manifest.chapters[idx];
    if (c.kind !== 'chapter') return c.title;
    const no = manifest.chapters.slice(0, idx + 1).filter((x) => x.kind === 'chapter').length;
    return `فصل ${ORDINALS[no - 1] || no}`;
  };

  return (
    <main>
      <div className="chapter-open">
        <div className="ornament" role="presentation"><span>٭</span></div>
        <h1>واژه‌نامه</h1>
        <p className="gloss-intro">
          برابرنهادهای این ترجمه، با پیوند به جای‌گاهِ هر اصطلاح در متن.
        </p>
      </div>

      {entries.length === 0 ? (
        <div className="notfound">اصطلاحی یافت نشد.</div>
      ) : (
        <div className="glossary">
          {entries.map((e, i) => (
            <div className="gloss-row" key={i}>
              <div className="gloss-terms">
                <span className="gloss-fa">{e.fa}</span>
                <span className="gloss-latin"><span className="lr">{e.latin}</span></span>
              </div>
              <div className="gloss-occ">
                {e.occ.map((o, k) => (
                  <a key={k} href={`#/${o.chapterId}/b-${o.block}`}>{chapterLabel(o.chapterId)}</a>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <nav className="chapter-nav">
        <span />
        <span><a className="home-link" href="#/">بازگشت به فهرست</a></span>
      </nav>
    </main>
  );
}
