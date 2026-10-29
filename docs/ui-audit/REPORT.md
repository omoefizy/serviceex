# ServiceEx UI audit

29 October 2026. This report only records what we found; nothing has been redesigned yet.

**How it was made.** `node scripts/ui-audit.ts` builds the main process and serves the renderer with Vite. It then runs the app with Playwright on a fresh temporary data folder, so the real library is never opened, and seeds invented sample data: 6 songs, 2 services, 6 generated gradient backgrounds, and a Psalm 23 item from the bundled KJV. For each state it saves a screenshot and measures every visible element (fonts, colors, spacing, radius, targets, contrast). It also scans `src/index.css` and the components directly. Its outputs are `metrics.json` and `static.json` next to the 83 PNGs in this folder. Re-run the script to regenerate everything; the folder is git-ignored except for this report.

**Caveats.**
- Plan gating is off (`ENFORCE_ENTITLEMENTS = false`), so every screen is reachable.
- A dev build shows the "AI developer key" Settings section, which customers never see.
- The signed-in account, device chips, transfers and Inbox are invented data injected into the renderer's stores. Sharing itself stayed off, so nothing was advertised on the network.
- Counts below are element instances summed over every screen at both sizes. They are useful for proportions, not as absolute figures.

## Screens captured

Each operator screen is saved at `@1280` (1280×720) and `@1920` (1920×1080).

| # | Screen | Notes |
|---|---|---|
| 01 | First run, no data | Fresh data folder; the bundled Bible and built-in themes are present |
| 02 | Main, empty | The newest service is open with no items |
| 03–05 | Song list, Add song modal, Song editor | |
| 06–08 | Scripture: reference, word search, unknown book | 08 is a "no results" error state |
| 09–10 | Media library, Presentations (empty) | |
| 11–13 | Main with a service loaded, with a slide live, and on Black | |
| 14 | Schedule: New service modal | |
| 15 | Theme editor | |
| 16 | Settings (top) | Every section is also cropped on its own: `31-settings-01…20` |
| 17, 27 | Plans and Credits | 17 is this build (no server); 27 is signed in |
| 18–19 | Sermons, Stream | |
| 20–21 | **Help** | There is no Help screen. The command palette is the nearest thing |
| 22–23 | Device chips and transfers; Inbox open | |
| 24–26 | Account: unconfigured, signed out, signed in | |
| 28 | Main, light appearance | |
| 29–30 | Errors: song deleted while open; a panel that crashed | |
| 40–42 | Output window (scripture, song), stage display | |

## Biggest problems first

1. **At 1280×720 the operator screen does not fit.** The page overflows sideways on every main screen (`pageScrolls.horizontal` is true on all 1280 shots).
   - The Alerts button, the Settings gear and the right part of the Schedule (including its "Sermon" button) are cut off.
   - `body` has `overflow: hidden`, so there is no scrollbar. When focus or a click lands off-screen, the whole app slides left and clips the left edge instead (seen in the theme editor and Plans shots before the script reset the scroll).
   - Cause: the column minimums (library 300 + centre 360 + preview 360 + schedule 280, plus splitters) add up to more than 1280. The toolbar wraps to two rows, or three rows with sharing on, which costs 100–145 px of 720.
2. **Empty and first-run states are a single line of 12 px grey text** ("No songs yet.", "Create a service to start a run list.", "Select a song or look up scripture to see its slides."). There is no icon, no next step and no welcome. Three-quarters of the first-run screen is blank panels, black preview boxes and a disabled red Go Live button.
3. **Error states show raw developer text.**
   - The panel boundary prints "Cannot read properties of null (reading 'find')", or a minified React error with a reactjs.org URL (seen when the toolbar crashed during the first run).
   - Plans and Credits shows only a red "This build of ServiceEx is not set up to connect", and its order history stays on "Loading…" forever.
4. **Buttons have no single size.** `.button` alone renders at 8 heights (23, 25, 27, 31, 33, 34, 37 and 38 px). There are 76 distinct button style combinations and 15 different paddings.
5. **The toolbar is visually loud.** Five mode buttons each have their own colored border (green fill, grey, sky, violet, amber), plus keyboard hint chips and a full-width LIVE pill. The eye has nowhere to rest, and the one thing that matters most (what is live) competes with all of it.

## 1. Inconsistencies

### Type
- **Families rendered:** Inter (bundled, 5,073 text elements), the monospace stack for `kbd` (332), and **Arial at 13.33 px on 153 form controls**. Chromium's default control font leaks through wherever an `<input>` or `<select>` lacks `font: inherit`, because the global reset only covers `button`.
- **Sizes rendered:** 10, 11, 12, 13, 13.33, 14, 15 and 16 px. The stylesheet declares 17 distinct `font-size` values, including 9 px, 11.5 px, 0.72em and three different `clamp()`s.
- 10 px is used 569 times (kbd hints, slide numbers, section labels, the Inbox badge). That is too small for a dim booth.
- **Weights:** 400, 500, 600, 700 and 800.
- **Panel titles come in three styles:**
  - 13 px uppercase muted `h2` ("SONGS", "LIVE", "SCHEDULE", "SETTINGS")
  - 15 px sentence case ("Slides", "Morning Light Rising", "Edit song")
  - "SONGS" repeated directly under an active "Songs" tab

### Color
- **Tokens:** 27 in `:root`, covering dark and light backgrounds, text, accent, live and modes. Outside the tokens the stylesheet hard-codes **26 distinct hex values (84 uses) and 30 distinct rgba values (42 uses)**.
- **Rendered:** 11 text colors, 35 background colors and 20 border colors.
- **Near duplicates** (CIE ΔE < 6) found on screen:
  - `--accent` #4f8cff vs `--next` #3b82f6
  - #101010 vs #000000
  - #9ca3af (stage, hard-coded) vs `--text-muted` #8b92a0
  - #ff9f0a vs #f59e0b
  - #0057d9 vs #2563eb
  - light-mode `--panel-raised` #f2f4f7 vs `--bg` #eef0f4, which are almost indistinguishable
- **Six ambers and no warning token:** #f59e0b (16 uses), #f5a524, #d97706, #d9a400, #b58900, #ff9f0a, plus five rgba tints of 245,158,11.
- **No `--success`, `--warning` or `--error` tokens.**
  - Errors use `--live` red (#e5484d), so an error message looks exactly like the LIVE state.
  - Success uses `--mode-show` green.
- **Hex values in components** (outside the stylesheet): StageView (#9ca3af, #facc15, #000, #fff), ScriptureDisplay (6 highlight colors), ThemeEditor (#333, #5a7bc4), StreamView (#ff00ff). The output and stage colors are content, but the stage's chrome greys should be tokens.

### Spacing
- This is the healthiest area. There are 452 `var(--space-*)` uses, and only 31 raw px declarations, mostly 1–3 px nudges. The rendered scale is 2/4/6/8/10/12/16/24, which matches the tokens.
- Strays: 1, 3, 5, 14 and 20 px, plus negative 4 and 6 px margins.
- The scale has too many small steps (2, 4, 6, 8, 10, 12), which is why panels feel dense rather than rhythmic.

### Radius and shadow
- **Radius:** 8 values render (6 px used 3,720 times, 4 px 1,579, 8 px 544, then 999 px, 50%, 2 px, 12 px and 1 px).
  - The only token, `--radius: 8px`, appears in 21 of 141 radius declarations.
  - The most common radius, 6 px, has no token.
- **Shadow:** 14 distinct `box-shadow` declarations. Only `--shadow` is tokenised. Focus rings are built three different ways: 2 px solid `--next`, 1 px inset accent, and 3 px `--accent-soft`.
- **Motion:** one `transition` in 6,686 lines of CSS, so every hover and selection change snaps.

### Buttons and inputs
- **Buttons:** heights of 16, 18, 22, 23, 25, 26, 27, 31, 33, 34, 36, 37, 38 and 44 px across `.button`, `.icon-button`, `.rt-button`, `.chip`, `.version-item`, `.mode-button`, `.toolbar-search`, `.library-tab`, `.transfer-action` and others.
  - Primary buttons are flat accent fills with white text at 3.2:1 contrast.
  - Disabled primary buttons fade to 50% opacity: the disabled Go Live is a washed-out red, which still reads as "live".
- **Inputs:** `select.input` renders at 23, 27, 29 and 37 px; `input.input` at 27, 38 and 40 px.
  - The song editor's Save button overlaps the right end of the Title field at 1280 (`05-song-editor@1280`).
  - Segmented controls (Appearance, Speech engine) leave an empty trailing slot.

### Icons
- Lucide is used everywhere with stroke 2 throughout, which is consistent.
- Sizes vary at random: 14 px (1,570), 15 (1,001), 18 (671), 16 (454), 13 (365) and 11 (108). Toolbar icons are 18, panel actions 15 or 16, chips 13 or 14, transfer chips 11.
- The two schedule icon buttons (Export and Import package) sit unlabeled on their own rows under New service.

### Hard-coded styles versus shared CSS
- Almost everything goes through the one 6,686-line `src/index.css`, which is good. 49 inline `style={{…}}` sit in 19 components, and most are legitimate: slide geometry in ThemedSlide (15), LowerThird (5), StreamView (4), meters and font previews.
- The real problem is that the shared CSS is per-component classes rather than shared primitives. For example, `.chip`, `.stale-chip`, `.suggestion-chip`, `.translation-chip`, `.device-chip`, `.transfer-chip` and `.alert-chip` are separate implementations of one idea.

### Missing hover, focus and disabled states
There is no global `:focus-visible` rule. Classes without their own rule fall back to Chromium's default ring, which looks different from the custom rings.

| State | Button classes missing it (of 35) |
|---|---|
| Hover | 12, including `chapter-button`, `device-chip`, `version-item`, `link-button`, `palette-item`, `highlight-swatch`, `presentation-main`, `slide-format-pick` |
| Custom focus | 22, including `chip`, `chapter-button`, `rt-button`, all four `suggestion-*`, `translation-chip`, `transfer-action`, `sermons-list-item`, `version-item` |
| Disabled | 31. Only `.button`, `.icon-button`, `.rt-button` and a few others define one |

- `.rt-surface:focus { outline: none }` removes the focus indicator from the rich text editor surface.
- `.palette-input input` also sets `outline: none`, though the palette makes up for it with its own frame.

### Low contrast
There are 22 unique failures of WCAG AA (4.5:1, or 3:1 for large text), excluding slide content:

| Where | Ratio | Notes |
|---|---|---|
| White on primary accent (#4f8cff): "Add song", Inbox badge | 3.22 | Used on every primary button |
| White on Show green (#16a34a) | 3.30 | |
| LIVE label: #e5484d on its pill (#362128) | 3.82 | The single most important word in the app |
| White on Go Live red (#e5484d) | 3.91 | |
| Section labels on slide cards: white on amber "Chorus" (#f59e0b) | 2.15 | 10 px |
| Section labels: white on teal "Verse" (#14b8a6) | 2.49 | 10 px |
| `kbd` hints (muted at 70% opacity) | 2.8–3.6 | 10 px |
| Offline device chip name | 3.8 | Light mode |
| Error text #e5484d on panel #171a21 | 4.45 | 12 px |
| Disabled buttons at 50% opacity | 1.9–2.4 | Exempt under WCAG, but makes disabled primary buttons look broken |

### Click targets under 32 px
There are 180 unique small targets.

| Control | Size | Notes |
|---|---|---|
| `.icon-button` | 26×26 | 56 kinds: hide schedule, remove item, song actions, Export and Import package |
| `.rt-button` | 26×26 | Highlight and format toolbar |
| `.chapter-button` | 28×22 | Scripture chapter grid |
| `.highlight-swatch` | 18×18 | |
| `.transfer-action` | 60×16 | Cancel and Decline. These are destructive and the smallest of all |
| Grid and List view toggle | 34×27 | |
| `.version-item` | 64×27 | |
| `.chip` | 74×25 | Song play-order buttons |
| `<summary>` (Saved lines, Points, Animation) | 17 px tall | |
| Small `.button` (Go Back, Preview Output) | 23 px tall | |
| Splitters | 7 px wide | Fine for a drag handle, but there is no wider hit area |
| Native-sized `select.input` | 23–29 px tall | |

### Layout at 1280×720
- Horizontal overflow on every operator screen (see "Biggest problems" 1).
- The toolbar wraps to two rows; with sharing on, three rows (`22-device-chips@1280`), and the LIVE pill collapses to a clipped "LIVE" stub.
- Library tabs truncate to "Scri…" and "Pres…". They also truncate at 1920, because the library column is fixed at 300 px.
- The scripture results list is about 190 px wide because the version rail (All, KJV, WEB, Import) takes a column. Verses wrap every 3–4 words.
- Settings, the editors, Sermons and Account open in the 360 px centre column (Settings content is about 330 px wide).
  - Settings is one scroll of 20 sections. "Sermon listener" alone is 2,000 px tall.
  - Long file paths are not wrapped and run out of the card (`31-settings-08-sermon-listener`).
- The theme editor's Song, Scripture and Lower third tabs truncate ("L…").
- The schedule's Announcement, Presentation and Sermon buttons wrap into two rows, and Sermon is cut off.

### Layout at 1920×1080
- Everything fits.
- The slide grid uses a fixed small thumbnail: three 220 px cards sit in a 950 px wide panel, leaving about 70% of the centre empty (`12-main-live@1920`).
- The schedule column is mostly blank below 6 items, while its three add buttons sit pinned to the bottom, far from the list.
- Light mode at 1920 with sharing on: the LIVE pill shrinks to a stub that clips its own label (`28-main-live-light@1920`).

### Screens that look unfinished
- **First run** (01) and **Presentations empty** (10): one line of grey text in an otherwise empty panel.
- **Plans and Credits** (17, 27): a nearly empty modal with a red error line, and "Order history / Loading…" that never resolves.
- **Error panel** (30): a raw exception message, a small grey heading, and one "Reload panel" button aligned to the top-left of the panel.
- **Schedule header**: two unlabeled icon buttons stacked vertically between "New service" and the list.
- **Settings, Account** (24–26):
  - The feature list shows lock icons on most features while the copy below says "Plan limits are not enforced yet: every feature works".
  - Usage bars sit next to long run-on sentences ("Monthly AI uses: 62 percent left, resets on…").
- **Help:** does not exist. The command palette lists actions but no help, documentation or shortcuts sheet, and no "?" entry point.
- **Settings sections** are walls of explanatory paragraphs (Live PowerPoint diagnostics, Sermon listener), with no grouping or progressive disclosure.

The finished-looking screens are the command palette (20–21), the Inbox (23), the media grid (09), the output (40–41) and the stage display (42).

## 2. Proposed design tokens (not applied)

These build on the existing names where they work, so the migration can be mostly find-and-replace.

```css
:root {
  /* Background levels: app → panel → raised → overlay */
  --bg-0: #0d0f13;            /* app background (was --bg #0f1115) */
  --bg-1: #15181e;            /* panels (was --panel #171a21) */
  --bg-2: #1d2128;            /* raised: inputs, cards, hovers (was --panel-raised #1f232c) */
  --bg-3: #262b34;            /* pressed / selected rows */
  --surface-overlay: #1b1f26; /* modals, menus, popovers */
  --scrim: rgb(0 0 0 / 0.6);  /* behind modals (replaces 0.55/0.6/0.65/0.7) */

  /* Borders */
  --border-subtle: #22262e;
  --border: #2d323c;          /* default (was #2a2f3a) */
  --border-strong: #3c4350;   /* inputs, hover */

  /* Text */
  --text-1: #eceef2;          /* primary */
  --text-2: #a3aab7;          /* secondary; 7.6:1 on --bg-1 (current muted is 5.6:1) */
  --text-3: #7d8594;          /* hints, placeholders; 4.8:1 on --bg-1 — the floor */
  --text-on-accent: #ffffff;

  /* Accent (one blue, replaces --accent and --next) */
  --accent: #3370e6;          /* fills: 4.56:1 with white text (today's #4f8cff is 3.2:1) */
  --accent-hover: #4580ec;
  --accent-text: #6f9dff;     /* accent used as text or icon on dark: 6.7:1 on --bg-1 */
  --accent-soft: rgb(51 112 230 / 0.16);
  --focus-ring: 0 0 0 2px var(--bg-1), 0 0 0 4px var(--accent);

  /* Live: reserved for "on air", never for errors */
  --live: #e5484d;
  --live-strong: #d13438;     /* fills with white text: 4.9:1 */
  --live-text: #ff7a7e;       /* LIVE label on its pill: 5.9:1 */
  --live-soft: rgb(229 72 77 / 0.16);

  /* Status */
  --success: #2fb36b;  --success-soft: rgb(47 179 107 / 0.15);
  --warning: #f2a516;  --warning-soft: rgb(242 165 22 / 0.15);  /* the one amber */
  --error:   #f0626a;  --error-soft:   rgb(240 98 106 / 0.14);  /* distinct from --live */
  --info:    var(--accent);

  /* Output modes stay, as tokens used only for the active mode */
  --mode-show: #16a34a; --mode-black: #4b5563; --mode-clear: #0284c7; --mode-logo: #7c3aed; --mode-alert: #d97706;

  /* Type: one family, five sizes */
  --font-ui: Inter, system-ui, -apple-system, 'Segoe UI', sans-serif;
  --font-mono: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
  --text-xs: 11px;   /* kbd, badges, captions (no more 9 or 10px) */
  --text-sm: 12px;   /* secondary, hints, meta */
  --text-md: 13px;   /* body default for dense panels */
  --text-lg: 15px;   /* panel titles, list primary */
  --text-xl: 18px;   /* modal and screen titles */
  --leading-tight: 1.25; --leading: 1.45;
  --weight-regular: 400; --weight-medium: 500; --weight-semibold: 600;  /* drop 700/800 in UI */

  /* Spacing: 4px base, fewer steps */
  --space-1: 4px; --space-2: 8px; --space-3: 12px; --space-4: 16px; --space-5: 20px; --space-6: 24px; --space-8: 32px; --space-10: 40px;
  /* --space-0-5, -1-5, -2-5 kept only as aliases during migration */

  /* Radius */
  --radius-sm: 4px;    /* chips, kbd, checkboxes */
  --radius-md: 6px;    /* buttons, inputs, list rows (today's de facto default) */
  --radius-lg: 10px;   /* cards, panels, popovers, modals */
  --radius-full: 999px;

  /* Shadow (elevation) */
  --shadow-1: 0 1px 2px rgb(0 0 0 / 0.3);              /* raised cards */
  --shadow-2: 0 8px 24px rgb(0 0 0 / 0.4);             /* menus, popovers */
  --shadow-3: 0 16px 40px rgb(0 0 0 / 0.5);            /* modals */
  --shadow-inset-hairline: inset 0 0 0 1px rgb(0 0 0 / 0.25);

  /* Sizing and motion */
  --control-sm: 28px;  /* only inside dense toolbars, with a 32px hit area */
  --control-md: 32px;  /* default button, input, select, icon button */
  --control-lg: 40px;  /* primary actions in modals, the mode bar */
  --duration-fast: 120ms; --duration: 180ms; --ease: cubic-bezier(.2,.8,.2,1);
}
```

Light mode redefines the same roles. Two changes to the current light values: give `--bg-1` and `--bg-2` more separation than #f2f4f7 vs #eef0f4, and set `--accent` to #2563eb (white text at 5.2:1).

### Shared components we need

| Component | Replaces today | Notes |
|---|---|---|
| **Button** (primary, secondary, ghost, danger; sizes sm, md, lg) | `.button` at 8 heights, `.link-button`, `.transfer-action`, `go-back-button`, `preview-output-toggle` | Hover, active, focus-visible and disabled built in; disabled lowers contrast without fading primary red to pink |
| **IconButton** | `.icon-button`, `.rt-button`, `.toolbar-icon`, `.song-action`, the schedule remove × | Requires `aria-label` and a tooltip; 32 px hit area even when the glyph is 16 px |
| **Input** | `.input` text and search, the palette input | One height per size; `font: inherit`; clear button slot |
| **Select** | `select.input` at 4 heights, native selects showing Arial | Same metrics as Input |
| **Toggle** | Checkbox rows ("Auto go live…"), the Appearance and Speech engine segmented controls | Switch for on/off; a separate SegmentedControl with no empty trailing slot |
| **Tabs** | `.library-tab`, theme editor tabs, Settings sections later | Overflow menu instead of truncating to "Scri…" |
| **Card** | `.settings-section`, inbox items, media tiles, model cards | Header slot, body, footer actions |
| **Modal** | Add song, New service, Plans and Credits, Slide format, Lyrics diff | Title, body, footer; scrim token; focus trap |
| **Toast** | `.sharing-message`, inline "All changes saved", status text in many panels | One place for transient success and error messages |
| **Chip** | `.chip`, `.stale-chip`, `.suggestion-chip`, `.translation-chip`, `.device-chip`, `.transfer-chip`, `.alert-chip`, `.custom-chip`, section labels | Variants: neutral, accent, live, success, warning, error; optional dot, icon and action |
| **EmptyState** | Every "No … yet" line, "Select a song…", the error boundary | Icon, title, one sentence, primary action; an error variant with friendly copy and a "Details" disclosure |
| **PanelHeader** | The three title styles (uppercase `h2`, 15 px title, repeated tab label) | One title style, an optional subtitle, a right-aligned actions slot of IconButtons and Buttons |

Also needed soon: Tooltip (titles are used everywhere as tooltips today), Menu (Live, Layout, Send to), Kbd, and ProgressBar (account usage, transfers, model downloads).

## 3. Five screens that would most improve the first impression for the least work

| Rank | Screen | Why it matters first | What to do | Effort |
|---|---|---|---|---|
| 1 | **Main operator screen at 1280×720** (01, 02, 12 `@1280`) | Most church laptops run at or below this size; today the first thing a new user sees has clipped buttons and a schedule they cannot reach | Lower the column minimums (library 240, preview 300, schedule 240) or auto-collapse the schedule below 1440 px; let `.operator` scroll rather than `body` clip; keep the toolbar to one row by moving device chips and transfers into a second strip only when sharing is on | Small: CSS grid limits plus one toolbar breakpoint |
| 2 | **First run and empty states** (01, 10, empty schedule, empty slide grid) | It is literally the first impression, and it is currently four blank panels and grey 12 px sentences | Build EmptyState once; give Songs ("Add your first song", Import), Schedule ("New service"), Slides (a short "how it works" with the three keys) and Presentations a real empty state; hide the disabled Go Live until something is selected | Small: one component, 5 call sites |
| 3 | **Toolbar** (every screen) | It is on every screenshot and sets the tone; it is the loudest element and wraps at 1280 | One segmented mode bar with neutral borders and only the active mode filled; consistent 18 px icons; shorter LIVE pill with `--live-text`; settings and help grouped at the right | Small to medium |
| 4 | **Error and account states** (17, 27, 29, 30, 24) | Raw stack-trace text and a perpetual "Loading…" read as a broken product to anyone who meets them | EmptyState error variant with plain words ("This panel stopped working. Your service is safe.") and a hidden Details section; Plans and Credits shows prices offline with a calm notice and stops "Loading…" on failure; hide the lock icons while plans are not enforced | Small |
| 5 | **Schedule panel** (11, 12) | It is the run sheet operators stare at during a service; today it has orphan icon rows, floating add buttons and a clipped "Sermon" | PanelHeader with service picker plus IconButtons (Export, Import, Host); one "Add" button with a menu directly under the list; larger remove targets | Small |

Next after these: split Settings into a sidebar of sections in its own wider view instead of one 20-section scroll in the 360 px centre column. That is the biggest visual win left, but medium work. Also add a Help and shortcuts sheet, which is cheap since the shortcut data in `src/lib/shortcuts.ts` and the command palette already exists.
