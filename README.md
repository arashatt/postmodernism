# وب‌سایت کتاب — React edition

A black-and-white reading site for the book, with per-chapter voiceover and
live word-by-word highlighting. Built with Vite + React, no other runtime
dependencies.

```
book-site/
├── public/
│   ├── chapters/          ← ALL BOOK CONTENT LIVES HERE
│   │   ├── manifest.json  ← the TOC (see below)
│   │   ├── about.md       ← «دربارهٔ کتاب» on the home page
│   │   ├── pishgoftar.md
│   │   ├── fasl-1.md
│   │   └── fasl-2.md
│   ├── audio/             ← voiceover files (see below)
│   ├── icons/             ← app icons (see «نصب روی گوشی»)
│   └── manifest.webmanifest  ← the installable-app entry
├── src/                   ← app code; you should not need to touch it
└── dist/                  ← the built site (after `npm run build`)
```

## Running

```sh
npm install
npm run dev        # local dev server
npm run build      # production build → dist/
```

```sh
npm test           # the worker's own checks (see «ورود با تلگرام»)
npm run deploy     # build + `wrangler deploy` to Cloudflare
```

Deploy by copying `dist/` to any static host (LiteSpeed, nginx, Apache —
the book itself needs no server-side code). `vite.config.js` uses
`base: './'`, so it works from the domain root or any subdirectory.

The one part that is **not** static is the optional Telegram sign-in, which
lives in `worker/` and runs on Cloudflare Workers — see «ورود با تلگرام»
at the end of this file. Leave it unconfigured and the site behaves exactly
as it did before it existed.

**Important:** chapters, the manifest, and audio are fetched at runtime,
not bundled. After the first deploy you never need to rebuild for content:
add or edit files directly in `chapters/` and `audio/` on the server.

---

## Where each chapter file goes

One chapter = one plain-text UTF-8 file in **`public/chapters/`**
(on the deployed server: **`<site>/chapters/`**). Name it however you like
(`fasl-3.md`, `moqaddame.md` …) — the name is referenced from the manifest.

### Chapter file format

Plain paragraphs separated by blank lines, plus a handful of markers:

| Syntax | Meaning |
|---|---|
| `@ متن سرسخن` | chapter epigraph (put before the body; multiple `@` lines allowed) |
| `@@ منبع` | epigraph source line |
| `## عنوان بخش` | section heading — **also becomes a TOC sub-entry automatically** |
| `> متن` | quotation block (نقل‌قول) |
| `~ مصراع نخست \| مصراع دوم` | one beyt; consecutive `~` lines form one poem |
| `~~ حافظ` | poem attribution |
| `***` | ornament divider ٭ ٭ ٭ (alone on a line) |
| `[[the fragmentary]]` | Latin-equivalent footnote at this point, auto-numbered |
| `[[م: متن یادداشت]]` | translator's footnote — rendered «… ــ م.» |

Everything is auto-numbered and auto-formatted (Persian digits, footnote
list at the chapter's end, RTL beyt grid). See `fasl-1.md` for a sample
using every feature.

---

## The table of contents

**The TOC has no separate build step. It is `public/chapters/manifest.json`.**

```json
"chapters": [
  { "id": "pishgoftar", "title": "پیشگفتار مترجم", "kind": "front",   "file": "chapters/pishgoftar.md" },
  { "id": "fasl-1",     "title": "نوشتار و تجربهٔ بیرون", "kind": "chapter", "file": "chapters/fasl-1.md" }
]
```

- **Order of this array = order of the TOC = reading order** (prev/next
  links at the bottom of each chapter follow it too).
- `id` — the URL slug (`#/fasl-1`) and the audio filename convention.
- `kind` — `"chapter"` gets a running «فصل نخست/دوم/…» number; use
  `"front"` (or anything else) for پیشگفتار, مقدمه, پیوست‌ها, so they stay
  unnumbered.
- **Section rows are automatic**: every `## heading` inside a chapter file
  appears indented under that chapter in the TOC and deep-links into it.
  You never list sections in the manifest.

**To add a chapter:** ① upload `chapters/fasl-3.md`, ② add one line to the
`chapters` array in `manifest.json`. Done — no rebuild.

The `book` object at the top of the manifest feeds the title page and the
شناسنامه block (title, translator, ISBN, `orderUrl` for the سفارش button,
and `about` pointing at the home-page text file).

---

## Voiceover (خوانش با هم‌خوانی متن)

Per chapter, upload to **`public/audio/`** (deployed: `<site>/audio/`):

```
audio/<id>.mp3     the recording        (also: .m4a, .ogg)
audio/<id>.srt     the timing file      (also: .vtt)
```

e.g. `audio/fasl-1.mp3` + `audio/fasl-1.srt` for the chapter with
`"id": "fasl-1"`. To use different paths, set `"audio"` and `"cues"`
explicitly on the chapter entry in the manifest.

Behavior:

- No files → readers see no player at all.
- Audio only → a minimal player bar appears (play, seek, speed).
- Audio + SRT/VTT → full read-along: the chapter text dims, read words
  return to ink, the current word inverts, the page auto-scrolls, and
  clicking any word seeks the audio there.

Generating the SRT from your recording (your existing Whisper pipeline):

```sh
whisper audio/fasl-1.mp3 --language fa --output_format srt
# tighter sync: add --word_timestamps True
```

The aligner tolerates Whisper's usual deviations — split ZWNJ compounds
(«قطعه‌وار» → «قطعه وار»), punctuation differences, missing diacritics —
and locks on even if the recording covers only part of the chapter
(e.g. you skip the epigraph or record a single section).

**Testing before upload:** open any chapter with `?dev` in the URL
(`https://…/?dev#/fasl-1`). The player bar appears with file pickers so you
can try a local mp3/srt pair; readers never see these controls.

---


## Reader settings, search, and themes

The ☰ drawer now includes:

- **جست‌وجو** — full-text search across all chapters. Word-based on the same
  normalization the read-along uses, so «قطعه وار» finds «قطعه‌وار», and
  diacritic / ي-ک variants all match. Results deep-link to the exact
  paragraph.
- **نمایش settings** (pinned at the drawer bottom, always reachable):
  - **اندازهٔ متن** — four reading sizes (۰٫۹–۱٫۳×), applied via a
    `--fontscale` custom property on `:root`.
  - **حال‌وهوا** — three themes: روز (day), کاهی (sepia), شب (night). All
    are pure token swaps; the whole site — hairlines, accents, selection,
    the mobile status-bar color — recolors together.
  - **قلم** — امیری (the literary Naskh) or ساده (Vazirmatn, a plain
    modern face) for all Persian text. Latin terms stay EB Garamond, and
    quote-card images keep Amiri for the book idiom.

Both settings persist in `localStorage` and re-apply on load (Safari
private mode degrades gracefully). Themes only ever use flat ink-on-paper
values, keeping the black-and-white character intact even in sepia/night.

## Navigation, bookmarks, reading position

- **TOC menu** — the ☰ button in the running head opens a drawer with the
  full فهرست (chapters + auto-extracted section headings), available on
  every page.
- **Reading position** — saved automatically (localStorage) as the reader
  scrolls. The home hero and the menu show an «ادامهٔ خواندن» shortcut back
  to the exact paragraph. Opening a chapter from the TOC always starts at
  its beginning; only the resume link jumps to the saved spot.
- **Bookmarks (نشان‌ها)** — the «نشان» button in the running head marks the
  current paragraph; bookmarks are listed in the menu with a text snippet
  and can be removed there. Everything is stored client-side; Safari
  private mode degrades gracefully (features off, no errors).
- **Scroll animation** — chapter blocks fade up as they enter the viewport;
  programmatic jumps (resume, bookmarks, section links, audio auto-scroll)
  pre-reveal everything above the target so no text is ever left hidden.
  `prefers-reduced-motion` disables all of it.

## Mobile notes (iOS / Android)

Applied in code: swipe paging (see below), `viewport-fit=cover` + safe-area insets on the header,
player bar, and drawer (notch / home-indicator devices); `100vh` fallback
before `svh` for iOS < 15.4; ≥ 44 px tap targets on all controls;
`touch-action: manipulation` (no double-tap-zoom delay on player buttons);
`-webkit-text-size-adjust: 100%`; beyt hemistichs stack below 640 px so
verse never overflows; drawer uses momentum scrolling; audio starts only on
tap (satisfies mobile autoplay policies); fonts load with `display=swap`
so text renders before Amiri arrives.

Worth a quick on-device pass after deploy: play/pause and seek on iOS
Safari, word-tap seeking accuracy, the drawer over the notch in landscape,
and — once installed to the home screen — the status bar in روز/شب (see
«نصب روی گوشی» below).

## نصب روی گوشی (PWA)

The site installs as an app on Android and iPhone: home-screen icon, no
browser chrome, and the whole book readable with no connection.

**Android / Chrome** — the ☰ drawer shows a «نصب برنامه» button as soon as
the browser offers installation (the standard mini-infobar is suppressed so
the invitation sits inside the book instead).
**iPhone / Safari** — iOS has no install prompt, so the same place in the
drawer spells out the two steps: هم‌رسانی ⬆︎ ← «افزودن به صفحهٔ اصلی».
Once installed, both hints disappear.

Requires HTTPS (or `localhost`); over plain `http:` everything still works,
just without installation or offline.

### What is cached

`src/sw.js` is the service worker; `vite build` writes it to `dist/sw.js`
with the hashed asset names baked in. It keeps two caches:

| | strategy | notes |
|---|---|---|
| app shell (`index.html`, `assets/…`, icons, cover) | precache, cache-first | replaced as a set on each release |
| `chapters/…` (manifest, chapter files, about) | stale-while-revalidate | the **whole book is pulled in on the first visit**, so a reader who opened the home page once can read every chapter offline |
| Google Fonts | cache-first | Amiri/Vazirmatn/EB Garamond survive offline |
| `audio/…` | **never touched** | recordings are streamed with range requests and are far too large to cache; the player and read-along need a connection |

Editing content on the server still needs no rebuild. A reader whose cache
already holds a chapter sees the edited text on their **next** visit — the
worker serves the cached copy and refreshes it in the background.

### Releases and the «به‌روزرسانی» pill

The worker's version is a digest of the build output, so a rebuild that
changes nothing ships a byte-identical worker and no one is nagged. When a
release does change something, readers already on the site get a small pill
at the foot of the page — «نسخهٔ تازهٔ کتاب آماده است» — and nothing reloads
until they tap it. Readers who come back later simply get the new version.

### Icons and the app name

`public/icons/icon.svg` (framed ★, also the browser favicon) and
`public/icons/maskable.svg` (the same star inside a circle, for Android's
mask and the iOS home screen) are the sources; the PNGs beside them are
rasterized copies at 192, 512 and 180 px. Replace all of them together if
you change the mark, keeping the file names.

The home-screen name, colours and description live in
`public/manifest.webmanifest` (`name`, `short_name`, `theme_color`,
`description`) plus the `apple-mobile-web-app-title` meta in `index.html`.
Like the chapters, that file can be edited on the server — no rebuild.
iOS shows no custom splash screen; it fades from `background_color`.

`npm run dev` never registers a worker, and unregisters one left behind by a
production build served from the same origin, so development is never served
stale files.

## Lock-screen / notification playback

The player registers with the **Media Session API**, so a playing chapter
appears in the Android notification shade and on the iOS lock screen /
Control Center with: chapter title, «خوانش: مترجم», the book as album,
cover art, play/pause, ±10 s seek, a scrubber (position state), and
previous/next-chapter buttons that navigate between chapters.

Cover art comes from **`public/cover.png`** (512 × 512) — replace it with
the real cover, or point `"cover"` in the manifest's `book` object at any
image path. iOS support for artwork/actions varies by version; play/pause
and metadata are solid, ±10 s appears on recent iOS.


## Pagination (بخش‌بندی فصل‌ها)

Chapters are automatically paginated by two combined rules:

1. **Every `##` heading starts a new page**; content before the first
   heading (with the epigraph) is page 1.
2. **A word budget** (default 600 words) subdivides any long stretch at
   paragraph boundaries — so long chapters **without any headings** still
   paginate, and an oversized single section splits into continuation
   pages labeled «بخش ــ ادامه». A split is skipped when the remainder is
   small, so no page ends as a tiny fragment.

Tune the budget in the manifest's `book` object: `"pageWords": 450` for
shorter pages, larger for longer. Short chapters stay single-page.

Routes: `#/fasl-1` is page 1, `#/fasl-1/p-2` is page 2, and the back
button walks pages. The nav at the page foot shows the previous/next
**section title** (RTL order: previous on the right, next on the left),
a «۲ / ۳» indicator, and crosses chapter boundaries — the previous-link
from a chapter's first page lands on the *last* page of the previous
chapter, so reading backward is continuous.

Every pre-pagination deep link still works and resolves to the right page:
TOC section links (`sec-K`), bookmarks and search results (`b-N`),
glossary occurrences, «ادامهٔ خواندن» (`resume`), and the printed QR codes
(chapter root → page 1). Footnotes print at the foot of the page they
belong to, keeping their chapter-global numbering.

With a voiceover playing, the read-along **flips pages automatically** as
narration crosses a section boundary — audio remains one file per chapter.

## Keyboard, listening, and reading comforts

- **Arrow keys** page through the book in reading order — ← advances,
  → goes back — crossing chapter boundaries like the foot links. Ignored
  while typing, over the seek bar, or with the menu open.
- **Swipe** does the same on a touch screen: drag the page to the right to
  advance, to the left to go back — the motion of turning the left-hand leaf
  of a Persian book. The page follows the finger and settles back if the drag
  is too short (under ~۱۲٪ of the screen). A gesture that starts out vertical
  is left to scrolling, one that starts in the screen's edge gutters is left
  to the browser's back gesture, and swiping does nothing while the drawer is
  open or text is selected for a quote card. `prefers-reduced-motion` keeps
  the page turn without the slide.
- **Continuous listening**: when a chapter's narration ends, the site
  moves to the next chapter and resumes playback automatically once its
  audio loads. Within-chapter page flips never interrupt audio. (If a
  browser blocks the cross-chapter autoplay, one tap on ▶ resumes.)
- **Footnote popovers**: hover a footnote number to read the note in
  place (tap toggles it on touch); the per-page footnote list at the
  page foot remains for print parity.
- **Wide displays** get a longer measure and slightly larger type
  (42rem at ≥1100px, 46rem at ≥1500px) — more text on screen while
  keeping a book-like line length.

## واژه‌نامه (auto-glossary)

The site builds a glossary page (`#/vajenameh`, linked from the home TOC
and the menu) from your terminology markers. The rule:

- `«امر قطعه‌وار»[[the fragmentary]]` — a **glossed term**: enters the
  glossary, paired Persian ↔ Latin, with deep links to every paragraph
  where it occurs. Duplicate Latin terms merge across chapters.
- `[[Walter Benjamin, „Die Aufgabe des Übersetzers“]]` — a **citation**
  (no preceding «…»): stays a normal footnote, kept out of the glossary.

Nothing to maintain — the page regenerates from the chapter files on load.
The chapter id `vajenameh` is reserved.

## نقل (quote cards)

Selecting a passage inside a chapter raises a floating «نقل» button;
tapping it renders a 1080 × 1080 black-and-white quote card on a canvas —
hairline double frame, the passage in Amiri inside «گیومه», the ornament,
and the book/translator imprint — with **دانلود** and, on devices that
support sharing files, **هم‌رسانی** (Web Share API). Selections are capped
at ~420 characters and the type size adapts to length.

## Tooltips

The ☰ (upper left) and «نشان» buttons show an explanatory tooltip after
hovering ~0.85 s (also on keyboard focus). Tooltips are disabled on touch
devices, where hover doesn't exist.

---

## ورود با تلگرام و فرستادن موقعیت

Readers can sign in with their Telegram account and, if they choose to,
attach their location to that account. **Both are off until you configure
them**: with no bot token set, `/api/me` reports itself unconfigured, the
drawer shows no «حساب تلگرام» section at all, and nothing about the
reading site changes.

### What the reader sees

|  | signing in | location |
|---|---|---|
| **site opened inside Telegram** (Mini App) | automatic — Telegram hands the page a signed `initData` | Telegram's own location manager (Bot API 8.0+ clients) |
| **an ordinary browser** | the Telegram login button | the bot asks in their chat; or, failing that, the browser's own geolocation |

Worth being plain about: **Telegram has no API that reads someone's
position without them tapping for it.** A bot can only send a keyboard
button with `request_location`, and a Mini App can only ask the client,
which asks the reader. Both paths here are a request the reader answers,
and the stored fix is a single latest position they can delete from the
drawer («پاک کردن») at any time. It expires by itself after thirty days.

### Setting it up

**① The bot.** In [@BotFather](https://t.me/BotFather): `/newbot` for the
token, then `/setdomain` pointed at your site — the login widget refuses to
render on a domain the bot has not claimed. To have the site open *inside*
Telegram as well, `/newapp` (or the Menu Button) with the same URL.

**② The secrets**, none of which belong in the repository:

```sh
npx wrangler secret put TELEGRAM_BOT_TOKEN        # from BotFather
npx wrangler secret put SESSION_SECRET            # any long random string
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET   # any long random string
```

`SESSION_SECRET` signs the session cookie; changing it signs everyone out.

**③ The bot's @name** goes in `wrangler.json` — it is public, the widget
needs it:

```json
"vars": { "TELEGRAM_BOT_USERNAME": "your_bot" }
```

**④ Somewhere to keep a location.** Only needed for the bot flow, because
the reader's answer arrives at the webhook rather than in the page. This
repository already carries a namespace binding in `wrangler.json`, so there
is nothing to do here unless you are deploying your own copy:

```sh
npx wrangler kv namespace create LOCATIONS
```

and paste what it prints in place of the existing one:

```json
"kv_namespaces": [{ "binding": "LOCATIONS", "id": "…" }]
```

The binding name is what the worker reads (`env.LOCATIONS`); the namespace's
own title in the Cloudflare dashboard can be anything. Add it to
`wrangler.json` rather than through the dashboard: this project deploys with
Workers Builds, which applies the config file on every build and drops
bindings that only exist in the dashboard. Secrets are unaffected by that.

**⑤ Deploy, then point the webhook at it** (the secret is the one from ②;
Telegram sends it back in a header, and updates arriving without it are
refused):

```sh
npm run deploy
curl "https://api.telegram.org/bot<TOKEN>/setWebhook" \
  -d "url=https://<your-site>/api/telegram/webhook" \
  -d "secret_token=<TELEGRAM_WEBHOOK_SECRET>"
```

### The API

`worker/index.js` serves everything under `/api/`; every other path is the
static site, handed to the assets binding (so the SPA fallback is unchanged).

| route | |
|---|---|
| `GET /api/me` | is the API configured, who is signed in, their stored location |
| `POST /api/login/widget` | verifies a login-widget payload, sets the session cookie |
| `POST /api/login/webapp` | the same for a Mini App's `initData` |
| `POST /api/logout` | clears it |
| `GET·POST·DELETE /api/location` | read (with the recent path), store, forget the latest fix |
| `POST /api/location/request` | have the bot ask the reader for one |
| `POST /api/telegram/webhook` | where the answer arrives |

Both sign-in payloads are checked the way Telegram documents — HMAC-SHA256
over the sorted fields, keyed by `SHA256(token)` for the widget and by
`HMAC("WebAppData", token)` for a Mini App — plus a 24-hour freshness
window, so a captured payload cannot be replayed later. The session is a
signed cookie (`HttpOnly`, `SameSite=Lax`), so there is no session table to
keep. A reader's id is never taken from the page's word for it.

`npm test` covers all of that: it rebuilds Telegram's signatures with
`node:crypto` and drives every route above against stubbed bindings, with
no network and no framework.

### The map (`#/naghsheh`)

A signed-in reader gets a full-page OpenStreetMap of where they last were,
reachable from «حساب تلگرام» in the drawer. It refreshes itself, draws the
path of the last 60 positions, and shows a «زنده» badge with a countdown
while a live location is running. Three ways to feed it:

| | how | how long it stays live |
|---|---|---|
| **موقعیت فعلی** | one fix, from Telegram's location manager or the browser | not live |
| **پیگیری از این دستگاه** | `watchPosition`, posted as it changes | while the page is open (+90s) |
| **زنده از تلگرام** | the reader shares a live location in their chat with the bot | the period Telegram was given |

The important limitation: **a bot cannot ask for a live location.** The
`request_location` keyboard button returns one fix and nothing more. Live
sharing is started by the reader, from 📎 → Location → «Share My Live
Location», and Telegram then edits that one message as they move — which is
why the webhook treats `edited_message` as a position update and answers
only the message that starts the sharing. Confirming each edit would send a
Telegram message per step taken.

`live_period` is stored as a deadline rather than a flag, so if the final
edit that ends sharing never arrives, the badge still goes out on its own.

Leaflet is imported dynamically and kept out of the service worker's
precache: it is a third of the bundle, and a reader who never opens the map
never fetches it. Tiles come straight from `tile.openstreetmap.org` with
the attribution their usage policy requires, greyscaled in CSS to match the
book and inverted in the night theme.

### Notes

- `/api/` is excluded from the service worker, so a reader's own data is
  never served from the offline cache.
- Telegram appends `tgWebApp*` parameters to the URL hash, which the book
  uses for its routes; `src/lib/telegram.js` removes them once the SDK has
  read them (they carry the signed `initData`, so a copied link should not
  keep them) and the router ignores them meanwhile.
- Telegram's scripts are only fetched when they are actually needed — the
  Mini App SDK only inside Telegram, the login widget only when the sign-in
  button is shown — so an ordinary reader of the book loads neither.
