import { useEffect, useState } from 'react';
import { canInstall, isIOS, isStandalone, onInstallChange, promptInstall } from '../lib/pwa.js';

// «افزودن به صفحهٔ اصلی», shown in the drawer. Android/Chrome hands us a real
// install prompt; iOS Safari has none, so there the reader gets the two steps.
export default function InstallHint() {
  const [installable, setInstallable] = useState(canInstall);
  const [installed, setInstalled] = useState(isStandalone);

  useEffect(() => onInstallChange(() => {
    setInstallable(canInstall());
    setInstalled(isStandalone());
  }), []);

  const ios = isIOS();
  if (installed || (!installable && !ios)) return null;

  return (
    <div className="menu-section menu-install">
      <div className="menu-h"><span>روی گوشی</span></div>
      {installable ? (
        <>
          <p className="install-note">
            کتاب را مانند یک برنامه روی صفحهٔ اصلی بگذارید؛ بی‌اینترنت هم خوانده می‌شود.
          </p>
          <button className="install-btn" onClick={() => { promptInstall(); }}>
            نصب برنامه
          </button>
        </>
      ) : (
        <p className="install-note">
          برای داشتن کتاب روی صفحهٔ اصلی: در سافاری دکمهٔ هم‌رسانی
          <span className="ios-share" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none"
                 stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 15V3" /><path d="M8.5 6.5 12 3l3.5 3.5" />
              <path d="M6 11H4.8v9.2h14.4V11H18" />
            </svg>
          </span>
          را بزنید و «افزودن به صفحهٔ اصلی» را انتخاب کنید.
        </p>
      )}
    </div>
  );
}
