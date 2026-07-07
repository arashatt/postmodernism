import { useEffect, useRef, useState } from 'react';

// نقل — select a passage in a chapter, tap the floating «نقل» button, and
// get a black-and-white quote card (canvas → PNG) in the book's idiom:
// hairline double frame, Amiri, ornament, imprint line. Share or download.

const INK = '#0a0a0a';
const PAPER = '#ffffff';
const MAXLEN = 420;

async function renderCard({ text, book, chapterTitle }) {
  const W = 1080;
  const H = 1080;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d');

  try {
    await Promise.all([
      document.fonts.load('700 54px Amiri'),
      document.fonts.load('400 34px Amiri'),
    ]);
  } catch { /* fall back to system serif */ }

  x.fillStyle = PAPER;
  x.fillRect(0, 0, W, H);
  x.strokeStyle = INK;
  x.lineWidth = 3;
  x.strokeRect(42, 42, W - 84, H - 84);
  x.lineWidth = 1.4;
  x.strokeRect(68, 68, W - 136, H - 136);

  // quote block — RTL, right-aligned, size adapts to length
  const quote = `«${text}»`;
  const size = text.length > 300 ? 38 : text.length > 170 ? 46 : 54;
  x.font = `700 ${size}px Amiri, serif`;
  x.fillStyle = INK;
  x.direction = 'rtl';
  x.textAlign = 'right';
  const margin = 132;
  const maxW = W - margin * 2;
  const lines = [];
  let line = '';
  for (const w of quote.split(/\s+/)) {
    const t = line ? `${line} ${w}` : w;
    if (x.measureText(t).width > maxW && line) { lines.push(line); line = w; }
    else line = t;
  }
  lines.push(line);
  const lh = size * 1.85;
  const footer = 300;
  const blockH = lines.length * lh;
  let y = Math.max(190, ((H - footer) - blockH) / 2 + size);
  for (const l of lines) { x.fillText(l, W - margin, y); y += lh; }

  // ornament: hairline ٭ hairline
  const oy = H - 258;
  x.lineWidth = 1.4;
  x.beginPath();
  x.moveTo(W / 2 - 110, oy); x.lineTo(W / 2 - 34, oy);
  x.moveTo(W / 2 + 34, oy); x.lineTo(W / 2 + 110, oy);
  x.stroke();
  x.textAlign = 'center';
  x.font = '400 30px Amiri, serif';
  x.fillText('٭', W / 2, oy + 10);

  // imprint
  x.font = '700 40px Amiri, serif';
  x.fillText(book.title, W / 2, H - 186);
  x.font = '400 30px Amiri, serif';
  const credit = book.translator ? `${book.author} ــ ترجمهٔ ${book.translator}` : book.author;
  x.fillText(credit, W / 2, H - 134);
  if (chapterTitle) {
    x.font = '400 26px Amiri, serif';
    x.fillText(chapterTitle, W / 2, H - 88);
  }
  return c;
}

export default function QuoteCapture({ bodyRef, book, chapterTitle }) {
  const [btn, setBtn] = useState(null);        // {top, left}
  const [card, setCard] = useState(null);      // {url, blob}
  const pendingText = useRef('');

  // floating «نقل» button follows text selection inside the chapter body
  useEffect(() => {
    const onSel = () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !bodyRef.current) { setBtn(null); return; }
      const text = sel.toString().replace(/\s+/g, ' ').trim();
      if (text.length < 8) { setBtn(null); return; }
      const range = sel.getRangeAt(0);
      if (!bodyRef.current.contains(range.commonAncestorContainer)) { setBtn(null); return; }
      const r = range.getBoundingClientRect();
      pendingText.current = text.length > MAXLEN ? `${text.slice(0, MAXLEN)}…` : text;
      setBtn({
        top: Math.max(r.top - 52, 70),
        left: Math.min(Math.max(r.left + r.width / 2, 70), window.innerWidth - 70),
      });
    };
    document.addEventListener('selectionchange', onSel);
    return () => document.removeEventListener('selectionchange', onSel);
  }, [bodyRef]);

  const makeCard = async () => {
    const text = pendingText.current;
    setBtn(null);
    if (!text) return;
    const canvas = await renderCard({ text, book, chapterTitle });
    const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
    setCard({ url: URL.createObjectURL(blob), blob });
  };

  const canShare = () => {
    if (!card || !navigator.canShare) return false;
    try {
      return navigator.canShare({ files: [new File([card.blob], 'naghl.png', { type: 'image/png' })] });
    } catch { return false; }
  };
  const share = async () => {
    const file = new File([card.blob], 'naghl.png', { type: 'image/png' });
    try { await navigator.share({ files: [file], title: book.title }); }
    catch { /* user dismissed */ }
  };
  const close = () => {
    if (card) URL.revokeObjectURL(card.url);
    setCard(null);
  };

  return (
    <>
      {btn && (
        <button
          className="quote-fab"
          style={{ top: btn.top, left: btn.left }}
          onPointerDown={(e) => { e.preventDefault(); makeCard(); }}
        >
          نقل
        </button>
      )}
      {card && (
        <div className="quote-modal" role="dialog" aria-modal="true" aria-label="کارت نقل‌قول">
          <div className="quote-scrim" onClick={close} />
          <div className="quote-box">
            <img src={card.url} alt="کارت نقل‌قول" />
            <div className="quote-actions">
              <a className="pbtn" href={card.url} download="naghl.png">دانلود</a>
              {canShare() && <button className="pbtn" onClick={share}>هم‌رسانی</button>}
              <button className="pbtn" onClick={close}>بستن</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
