// bookml.js — Persian utilities + the chapter file format parser.
//
// Chapter files are plain UTF-8 text ("BookML"), documented in README.md:
//   @ epigraph line            chapter epigraph (سرسخن)
//   @@ source                  epigraph source
//   ## heading                 section heading
//   > paragraph                quotation block (نقل‌قول)
//   ~ mesra | mesra            one beyt (poem line, two hemistichs)
//   ~~ poet                    poem attribution
//   ***                        ornament divider ٭ ٭ ٭
//   [[l'expression latine]]    Latin-equivalent footnote at this point
//   [[م: یادداشت مترجم]]        translator's footnote (renders «… ــ م.»)
//   blank line                 paragraph separator

export const faDigits = (s) =>
  String(s).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);

export const ORDINALS = [
  'نخست','دوم','سوم','چهارم','پنجم','ششم','هفتم','هشتم','نهم','دهم',
  'یازدهم','دوازدهم','سیزدهم','چهاردهم','پانزدهم','شانزدهم','هفدهم',
  'هجدهم','نوزدهم','بیستم',
];

export const ABJAD = [
  'الف','ب','ج','د','ه','و','ز','ح','ط','ی','یا','یب','یج','ید','یه',
  'یو','یز','یح','یط','ک','کا','کب','کج','کد','که','کو','کز','کح','کط','ل',
];

// Normalization for audio↔text matching. Note: Persian punctuation
// (؛ ، ؟) lives inside U+0600–U+06FF and must be stripped explicitly.
export function normalize(w) {
  return w
    .replace(/[\u200c\u200f\u200e\u0640]/g, '')
    .replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/[\u0600-\u0620\u066A-\u066D\u06D4]/g, '')
    .replace(/[يى]/g, 'ی').replace(/ك/g, 'ک')
    .replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/ؤ/g, 'و').replace(/ئ/g, 'ی')
    .replace(/[^\u0600-\u06FF0-9a-zA-Z]/g, '')
    .toLowerCase();
}

// Inline pass: split text on [[...]] footnote markers.
// Returns [{ t: 'text', text } | { t: 'note', kind: 'latin'|'fa', text }]
function parseInline(text) {
  const out = [];
  let last = 0;
  const re = /\[\[([^\]]+)\]\]/g;
  let m;
  while ((m = re.exec(text))) {
    const before = text.slice(last, m.index);
    if (before) out.push({ t: 'text', text: before });
    const body = m[1].trim();
    if (body.startsWith('م:')) {
      out.push({ t: 'note', kind: 'fa', text: body.slice(2).trim(), term: null });
    } else {
      // pair the Latin with the Persian term it glosses: «term»[[latin]]
      const tm = before.match(/«([^»]+)»[\s‌]*$/);
      const term = tm ? tm[1].trim() : null;
      out.push({ t: 'note', kind: 'latin', text: body, term });
    }
    last = re.lastIndex;
  }
  if (last < text.length) out.push({ t: 'text', text: text.slice(last) });
  return out;
}

// Block pass. Returns { epigraph, blocks, footnotes } where footnotes are
// collected in reading order and numbered from ۱ within the chapter.
export function parseBookML(source) {
  const lines = source.replace(/\r/g, '').split('\n');
  const blocks = [];
  const footnotes = [];
  const epigraph = { lines: [], source: null };

  const withNotes = (text, bi) =>
    parseInline(text).map((seg) => {
      if (seg.t !== 'note') return seg;
      footnotes.push({
        kind: seg.kind, text: seg.text, term: seg.term,
        block: bi != null ? bi : blocks.length,
      });
      return { t: 'ref', n: footnotes.length };
    });

  let para = [];
  let poem = null;

  const flushPara = () => {
    if (para.length) {
      blocks.push({ type: 'p', segs: withNotes(para.join(' ')) });
      para = [];
    }
  };
  const flushPoem = () => {
    if (poem) { blocks.push(poem); poem = null; }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const trimmed = line.trim();

    if (!trimmed) { flushPara(); flushPoem(); continue; }

    if (trimmed.startsWith('@@')) { epigraph.source = trimmed.slice(2).trim(); continue; }
    if (trimmed.startsWith('@'))  { epigraph.lines.push(trimmed.slice(1).trim()); continue; }

    if (trimmed === '***') { flushPara(); flushPoem(); blocks.push({ type: 'divider' }); continue; }

    if (trimmed.startsWith('## ')) {
      flushPara(); flushPoem();
      blocks.push({ type: 'h2', text: trimmed.slice(3).trim() });
      continue;
    }

    if (trimmed.startsWith('~~')) {
      if (poem) poem.poet = trimmed.slice(2).trim();
      continue;
    }
    if (trimmed.startsWith('~')) {
      flushPara();
      if (!poem) poem = { type: 'poem', beyts: [], poet: null };
      const [a, b] = trimmed.slice(1).split('|').map((s) => (s || '').trim());
      poem.beyts.push([a, b || '']);
      continue;
    }

    if (trimmed.startsWith('> ')) {
      flushPara(); flushPoem();
      const prev = blocks[blocks.length - 1];
      const text = trimmed.slice(2).trim();
      if (prev && prev.type === 'quote') prev.segs.push({ t: 'text', text: ' ' }, ...withNotes(text, blocks.length - 1));
      else blocks.push({ type: 'quote', segs: withNotes(text) });
      continue;
    }

    para.push(trimmed);
  }
  flushPara(); flushPoem();

  return { epigraph: epigraph.lines.length ? epigraph : null, blocks, footnotes };
}

// Extract section headings for the table of contents.
export function extractHeadings(source) {
  return source
    .replace(/\r/g, '').split('\n')
    .filter((l) => l.trim().startsWith('## '))
    .map((l) => l.trim().slice(3).trim());
}

// Plain text of each top-level block, indexed to match the chapter page's
// DOM children (epigraph first if present, dividers counted) — so search
// results can deep-link with the same #/id/b-N anchors bookmarks use.
export function blockTexts(parsed) {
  const rows = [];
  let bi = 0;
  if (parsed.epigraph) {
    rows.push({ bi, text: parsed.epigraph.lines.join(' ') });
    bi += 1;
  }
  for (const b of parsed.blocks) {
    let t = '';
    if (b.type === 'p' || b.type === 'quote') {
      t = b.segs.filter((x) => x.t === 'text').map((x) => x.text).join('');
    } else if (b.type === 'h2') {
      t = b.text;
    } else if (b.type === 'poem') {
      t = b.beyts.map(([a, z]) => `${a} ${z}`).join(' ');
    }
    t = t.replace(/\s+/g, ' ').trim();
    if (t) rows.push({ bi, text: t });
    bi += 1;
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Pagination: every «##» heading starts a new page; content before the first
// heading (plus the epigraph) is page 1. A chapter with no headings is a
// single page. Block indices ("bi") follow the same convention as blockTexts:
// bi 0 = epigraph (when present), then parsed.blocks shifted by that offset —
// the convention bookmarks, search, and the glossary all share.
export function paginate(parsed) {
  const off = parsed.epigraph ? 1 : 0;
  const blockPage = [];          // page of parsed.blocks[i]
  const pages = [{ heading: null }];
  const headingPage = [];        // page of the k-th h2 (for sec-K links)
  let page = 1;
  parsed.blocks.forEach((b, i) => {
    if (b.type === 'h2') {
      if (i > 0) { page += 1; pages.push({ heading: b.text }); }
      else pages[0].heading = b.text;
      headingPage.push(page);
    }
    blockPage.push(page);
  });
  const count = page;
  const pageOfBi = (bi) => {
    if (off && bi === 0) return 1;
    const i = bi - off;
    if (i < 0) return 1;
    if (i >= blockPage.length) return count;
    return blockPage[i];
  };
  return { count, pages, blockPage, headingPage, off, pageOfBi };
}
