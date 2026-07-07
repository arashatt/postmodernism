import { useEffect, useRef, useState } from 'react';
import { parseBookML, ORDINALS } from '../lib/bookml.js';

// Plain prose renderer (no read-along) for the about text.
function Prose({ parsed }) {
  const seg = (s, k) =>
    s.t === 'ref'
      ? <sup className="noteref" key={k}>{'۰۱۲۳۴۵۶۷۸۹'[s.n] || s.n}</sup>
      : <span key={k}>{s.text}</span>;
  return (
    <>
      {parsed.blocks.map((b, i) => {
        if (b.type === 'p') return <p key={i}>{b.segs.map(seg)}</p>;
        if (b.type === 'quote') return <blockquote key={i}>{b.segs.map(seg)}</blockquote>;
        return null;
      })}
      {parsed.footnotes.length > 0 && (
        <ol className="footnotes">
          {parsed.footnotes.map((f, i) => (
            <li key={i} data-n={'۰۱۲۳۴۵۶۷۸۹'[i + 1] || i + 1}>
              {f.kind === 'latin' ? <span className="lr">{f.text}</span> : `${f.text} ــ م.`}
            </li>
          ))}
        </ol>
      )}
    </>
  );
}

export default function Home({ manifest, headings, setFolio, pos, hasGlossary }) {
  const { book, chapters } = manifest;
  const [about, setAbout] = useState(null);
  const rootRef = useRef(null);
  const posChapter = pos && chapters.find((c) => c.id === pos.chapterId);

  useEffect(() => {
    if (!book.about) return;
    fetch(book.about)
      .then((r) => (r.ok ? r.text() : Promise.reject()))
      .then((t) => setAbout(parseBookML(t)))
      .catch(() => {});
  }, [book.about]);

  // Abjad folio scroll-spy + reveal animation.
  useEffect(() => {
    const root = rootRef.current;
    const spy = new IntersectionObserver(
      (es) => es.forEach((e) => e.isIntersecting && setFolio(e.target.dataset.abjad)),
      { rootMargin: '-40% 0px -55% 0px' }
    );
    root.querySelectorAll('[data-abjad]').forEach((el) => spy.observe(el));
    const ro = new IntersectionObserver(
      (es) => es.forEach((e) => e.target.classList.toggle('in', e.isIntersecting)),
      { rootMargin: '12% 0px 12% 0px', threshold: 0 }
    );
    root.querySelectorAll('.reveal').forEach((el) => ro.observe(el));
    return () => { spy.disconnect(); ro.disconnect(); };
  }, [about, headings, setFolio]);

  let chapterNo = 0;

  return (
    <main ref={rootRef}>
      <section className="titlepage" data-abjad="الف" style={{ paddingBottom: 0 }}>
        {book.series && (<>
          <p className="series">{book.series}</p>
          <div className="series-rule" role="presentation" />
        </>)}
        <h1>{book.title}</h1>
        {book.subtitle && <p className="subtitle">{book.subtitle}</p>}
        <p className="author">{book.author}</p>
        {book.translator && <p className="translator">ترجمهٔ {book.translator}</p>}
        <div className="ornament" role="presentation"><span>٭</span></div>
        <p className="imprint">{book.publisher}<small>{book.city}، {book.year}</small></p>
        {posChapter ? (
          <a className="continue-strip" href={`#/${pos.chapterId}/resume`}>
            <span className="cs-label">ادامهٔ خواندن</span>
            <span className="cs-title">{posChapter.title}</span>
          </a>
        ) : (
          <a className="down" href="#about">دربارهٔ کتاب ↓</a>
        )}
      </section>

      {about && (
        <section id="about" data-abjad="ب">
          <div className="sec-head reveal">
            <div className="ornament" role="presentation"><span>٭</span></div>
            <h2>دربارهٔ کتاب</h2>
          </div>
          <div className="reveal"><Prose parsed={about} /></div>
        </section>
      )}

      <section id="toc" data-abjad="ج">
        <div className="sec-head reveal">
          <div className="ornament" role="presentation"><span>٭</span></div>
          <h2>فهرست</h2>
        </div>
        <div className="toc reveal">
          {chapters.map((c) => {
            const isChapter = c.kind === 'chapter';
            if (isChapter) chapterNo += 1;
            const label = isChapter
              ? `فصل ${ORDINALS[chapterNo - 1] || chapterNo} ــ ${c.title}`
              : c.title;
            return (
              <div key={c.id}>
                <a className="toc-row chapter" href={`#/${c.id}`}>
                  <span>{label}</span><span className="leader" />
                </a>
                {(headings[c.id] || []).map((h, k) => (
                  <a className="toc-row section-row" key={k} href={`#/${c.id}/sec-${k}`}>
                    <span>{h}</span><span className="leader" />
                  </a>
                ))}
              </div>
            );
          })}
          {hasGlossary && (
            <a className="toc-row chapter" href="#/vajenameh">
              <span>واژه‌نامه</span><span className="leader" />
            </a>
          )}
        </div>
      </section>

      <section id="details" data-abjad="د">
        <div className="sec-head reveal">
          <div className="ornament" role="presentation"><span>٭</span></div>
          <h2>مشخصات نشر</h2>
        </div>
        <div className="colophon reveal">
          <dl>
            <dt>عنوان</dt><dd>{book.title}{book.subtitle ? `؛ ${book.subtitle}` : ''}</dd>
            {book.originalTitle && (<><dt>عنوان اصلی</dt><dd><span className="lr">{book.originalTitle}</span></dd></>)}
            {book.translator && (<><dt>مترجم</dt><dd>{book.translator}</dd></>)}
            <dt>ناشر</dt><dd>{book.publisher}، {book.city}</dd>
            {book.edition && (<><dt>چاپ</dt><dd>{book.edition}</dd></>)}
            {book.format && (<><dt>قطع</dt><dd>{book.format}</dd></>)}
            {book.isbn && (<><dt>شابک</dt><dd><span className="lr" style={{ fontStyle: 'normal' }}>{book.isbn}</span></dd></>)}
          </dl>
        </div>
      </section>

      <div className="order" id="order" data-abjad="ه">
        <a href={book.orderUrl || '#'}>سفارش کتاب</a>
        <p>از کتاب‌فروشی‌های سراسر کشور و فروشگاه‌های اینترنتی</p>
      </div>
    </main>
  );
}
