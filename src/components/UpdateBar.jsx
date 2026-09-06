import { useEffect, useState } from 'react';
import { applyUpdate, onUpdateReady, updateReady } from '../lib/pwa.js';

// A quiet pill at the foot of the page when a newer build is cached and
// waiting. Nothing reloads behind the reader's back.
export default function UpdateBar() {
  const [ready, setReady] = useState(updateReady);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => onUpdateReady(() => setReady(true)), []);

  if (!ready || dismissed) return null;

  return (
    <div className="update-bar" role="status">
      <span>نسخهٔ تازهٔ کتاب آماده است.</span>
      <button className="update-go" onClick={applyUpdate}>به‌روزرسانی</button>
      <button className="update-x" onClick={() => setDismissed(true)} aria-label="بستن">×</button>
    </div>
  );
}
