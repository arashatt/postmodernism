import { faDigits } from '../lib/bookml.js';

// Shown once when the manifest gained a chapter since this reader's last visit
// — the book grows a file at a time, and the arrival used to be silent.
export default function NewChapterBar({ chapters, onClose }) {
  if (!chapters || chapters.length === 0) return null;
  const first = chapters[0];
  return (
    <div className="update-bar" role="status">
      <span>
        {chapters.length === 1
          ? <>فصل تازه: {first.title}</>
          : <>{faDigits(String(chapters.length))} فصل تازه افزوده شد</>}
      </span>
      <a className="update-go" href={`#/${first.id}`} onClick={onClose}>بخوانید</a>
      <button className="update-x" onClick={onClose} aria-label="بستن">×</button>
    </div>
  );
}
