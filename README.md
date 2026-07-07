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
│   └── audio/             ← voiceover files (see below)
├── src/                   ← app code; you should not need to touch it
└── dist/                  ← the built site (after `npm run build`)
```

## Running

```sh
npm install
npm run dev        # local dev server
npm run build      # production build → dist/
```

Deploy by copying `dist/` to any static host (LiteSpeed, nginx, Apache —
no server-side code). `vite.config.js` uses `base: './'`, so it works from
the domain root or any subdirectory.

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

Applied in code: `viewport-fit=cover` + safe-area insets on the header,
player bar, and drawer (notch / home-indicator devices); `100vh` fallback
before `svh` for iOS < 15.4; ≥ 44 px tap targets on all controls;
`touch-action: manipulation` (no double-tap-zoom delay on player buttons);
`-webkit-text-size-adjust: 100%`; beyt hemistichs stack below 640 px so
verse never overflows; drawer uses momentum scrolling; audio starts only on
tap (satisfies mobile autoplay policies); fonts load with `display=swap`
so text renders before Amiri arrives.

Worth a quick on-device pass after deploy: play/pause and seek on iOS
Safari, word-tap seeking accuracy, and the drawer over the notch in
landscape.

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
