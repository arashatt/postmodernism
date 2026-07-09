import { useEffect, useState } from 'react';
import Home from './components/Home.jsx';
import Chapter from './components/Chapter.jsx';
import Menu from './components/Menu.jsx';
import Glossary from './components/Glossary.jsx';
import { parseBookML } from './lib/bookml.js';
import { getPos, getMarks, addMark, removeMark, getSettings, setSettings } from './lib/store.js';
import { blockTexts, paginate } from './lib/bookml.js';
import { indexRow } from './lib/search.js';

function useHashRoute() {
  const parse = () => {
    const h = window.location.hash.replace(/^#\/?/, '');
    const [id, anchor] = h.split('/').filter(Boolean);
    return { id: id || null, anchor: anchor || null };
  };
  const [route, setRoute] = useState(parse);
  useEffect(() => {
    const onChange = () => setRoute(parse());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

function RunningHead({ title, folio, onMenu, showBookmark, onBookmark, marked }) {
  return (
    <header className="runhead" aria-label="سرصفحه">
      <button className="menu-btn" onClick={onMenu} aria-label="فهرست"
              data-tip="فهرستِ فصل‌ها، نشان‌ها و ادامهٔ خواندن">
        <span className="burger" aria-hidden="true"><i /><i /><i /></span>
      </button>
      <a className="rh-title" href="#/">{title}</a>
      <span className="rh-end">
        {showBookmark && (
          <button className={`bm-btn${marked ? ' done' : ''}`} onClick={onBookmark}
                  data-tip="جای فعلیِ خواندن را نشان می‌گذارد؛ نشان‌ها در فهرست (☰) نگه‌داری می‌شوند">
            {marked ? '✓ نشان شد' : 'نشان'}
          </button>
        )}
        <span className="folio" aria-hidden="true">{folio}</span>
      </span>
    </header>
  );
}

export default function App() {
  const [manifest, setManifest] = useState(null);
  const [headings, setHeadings] = useState({});
  const [terms, setTerms] = useState([]);
  const [error, setError] = useState(false);
  const [folio, setFolio] = useState('الف');
  const [menuOpen, setMenuOpen] = useState(false);
  const [marks, setMarks] = useState(getMarks);
  const [justMarked, setJustMarked] = useState(false);
  const [searchIdx, setSearchIdx] = useState([]);
  const [pagesInfo, setPagesInfo] = useState({});
  const [settings, setSettingsState] = useState(getSettings);
  const route = useHashRoute();

  useEffect(() => {
    if (settings.theme && settings.theme !== 'day') {
      document.documentElement.dataset.theme = settings.theme;
    } else {
      delete document.documentElement.dataset.theme;
    }
    if (settings.font && settings.font !== 'amiri') {
      document.documentElement.dataset.font = settings.font;
    } else {
      delete document.documentElement.dataset.font;
    }
    document.documentElement.style.setProperty('--fontscale', settings.fontScale);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = settings.theme === 'night' ? '#121212'
      : settings.theme === 'sepia' ? '#f5ede1' : '#ffffff';
  }, [settings]);

  const updateSettings = (patch) =>
    setSettingsState((prev) => setSettings({ ...prev, ...patch }));

  useEffect(() => {
    fetch('chapters/manifest.json')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setManifest)
      .catch(() => setError(true));
  }, []);

  // Prefetch chapter files once: TOC section headings + glossary terms.
  useEffect(() => {
    if (!manifest) return;
    let live = true;
    Promise.all(
      manifest.chapters.map((c) =>
        fetch(c.file)
          .then((r) => (r.ok ? r.text() : ''))
          .then((t) => {
            const p = parseBookML(t);
            const off = p.epigraph ? 1 : 0;   // shared bi convention: epigraph = bi 0
            return {
              id: c.id,
              headings: p.blocks.filter((b) => b.type === 'h2').map((b) => b.text),
              pages: paginate(p, manifest.book.pageWords || 600).count,
              terms: p.footnotes
                .filter((f) => f.kind === 'latin' && f.term)   // «term»[[gloss]] only; bare [[…]] are citations
                .map((f) => ({ latin: f.text, term: f.term, block: f.block + off, chapterId: c.id })),
              search: blockTexts(p).map((row) => indexRow({ ...row, chapterId: c.id })),
            };
          })
          .catch(() => ({ id: c.id, headings: [], terms: [], search: [], pages: 1 }))
      )
    ).then((rows) => {
      if (!live) return;
      setHeadings(Object.fromEntries(rows.map((r) => [r.id, r.headings])));
      setPagesInfo(Object.fromEntries(rows.map((r) => [r.id, r.pages || 1])));
      setTerms(rows.flatMap((r) => r.terms));
      setSearchIdx(rows.flatMap((r) => r.search || []));
    });
    return () => { live = false; };
  }, [manifest]);

  useEffect(() => {
    if (route.id && !route.anchor) window.scrollTo(0, 0);
    setMenuOpen(false);
  }, [route.id, route.anchor]);

  if (error) return <div className="notfound">فهرست کتاب بارگذاری نشد.</div>;
  if (!manifest) return <div className="loading">…</div>;

  const onGlossary = route.id === 'vajenameh';
  const chapterIndex = route.id && !onGlossary
    ? manifest.chapters.findIndex((c) => c.id === route.id)
    : -1;
  const onChapterPage = chapterIndex >= 0;

  const bookmarkHere = () => {
    const pos = getPos();
    if (!pos || pos.chapterId !== route.id) return;
    setMarks(addMark({ chapterId: pos.chapterId, block: pos.block, snippet: pos.snippet }));
    setJustMarked(true);
    setTimeout(() => setJustMarked(false), 1600);
  };

  return (
    <>
      <RunningHead
        title={manifest.book.title}
        folio={folio}
        onMenu={() => setMenuOpen(true)}
        showBookmark={onChapterPage}
        onBookmark={bookmarkHere}
        marked={justMarked}
      />
      <Menu
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        manifest={manifest}
        headings={headings}
        pos={getPos()}
        marks={marks}
        hasGlossary={terms.length > 0}
        onRemoveMark={(id) => setMarks(removeMark(id))}
        searchIdx={searchIdx}
        settings={settings}
        onSettings={updateSettings}
      />
      {onGlossary ? (
        <Glossary manifest={manifest} terms={terms} setFolio={setFolio} />
      ) : onChapterPage ? (
        <Chapter
          key={route.id}
          manifest={manifest}
          index={chapterIndex}
          anchor={route.anchor}
          setFolio={setFolio}
          pagesInfo={pagesInfo}
        />
      ) : (
        <Home manifest={manifest} headings={headings} setFolio={setFolio} pos={getPos()} hasGlossary={terms.length > 0} />
      )}
      <footer>
        <div className="ornament" role="presentation"><span>٭</span></div>
        <p>{manifest.book.publisher} ــ {manifest.book.city}، {manifest.book.year}</p>
        <p>همهٔ حقوق این اثر برای ناشر محفوظ است.</p>
      </footer>
    </>
  );
}
