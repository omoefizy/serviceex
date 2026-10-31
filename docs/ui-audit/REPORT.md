# ServiceEx UI audit

29 October 2026. The findings below (sections 1 to 3) record the app as it was first audited. The design tokens and shared components proposed in section 2 have since been applied to the toolbar, the Schedule, the Scripture panel and Settings; **[Tokens and shared components: before and after](#tokens-and-shared-components-before-and-after)** has the numbers. The layout at laptop sizes has since been fixed too; **[Layout at laptop sizes: before and after](#layout-at-laptop-sizes-before-and-after)** has the results of the automated layout check. Empty, error, loading and toast states have since been finished; **[Unfinished states: before and after](#unfinished-states-before-and-after)** has what changed and the new state check.

The operator screen now follows Main2.reference.html; **[Operator screen after Main2.reference.html](#operator-screen-after-main2referencehtml)** has what moved where. Before that, the 2026 visual design (new palette, Figtree and Bricolage Grotesque, the three panel operator screen, the Settings page and the first run welcome) is the latest change; **[2026 design: before and after](#2026-design-before-and-after)** has its numbers.

**How it was made.** `node scripts/ui-audit.ts` builds the main process and serves the renderer with Vite. It then runs the app with Playwright on a fresh temporary data folder, so the real library is never opened, and seeds invented sample data: 6 songs, 2 services, 6 generated gradient backgrounds, and a Psalm 23 item from the bundled KJV. For each state it saves a screenshot and measures every visible element (fonts, colors, spacing, radius, targets, contrast). It also scans the stylesheets (`src/styles/tokens.css`, `src/index.css`, `src/components/ui/ui.css`) and the components directly. It also checks the layout of every screen (see below) and exits with an error if one fails. It also checks the state of every screen (see below). Its outputs are `metrics.json` (with a `totals.headline` summary), `static.json`, `layout.json` and `states.json`, next to 150 PNGs in this folder: the app states at three sizes plus `50-ui-kit.png`, the dev UI kit. Re-run the script to regenerate everything; it keeps this report, and the folder is git-ignored except for the report.

**Caveats.**
- Plan gating is off (`ENFORCE_ENTITLEMENTS = false`), so every screen is reachable.
- A dev build shows the "AI developer key" Settings section, which customers never see.
- The signed-in account, device chips, transfers and Inbox are invented data injected into the renderer's stores. Sharing itself stayed off, so nothing was advertised on the network.
- Counts in sections 1 to 3 are element instances summed over every screen at the two sizes audited then (1280 and 1920). They are useful for proportions, not as absolute figures.

## Operator screen after Main2.reference.html

The operator layout now follows `docs/design/Main2.reference.html` (drawn at 1366×768), which supersedes the operator layout in `Main.reference.html`. Settings and the welcome are unchanged. Only layout and styling changed; every button calls the same store function it did before.

- **Shell:** top bar 56px, status bar 36px, 10px padding and gaps. Three columns: the Order of service (236px), the middle (Heard in the sermon over the finder) and the monitors (352px). Nothing scrolls but the lists inside the cards. The resize splitters and the finder's collapse are gone; the column widths are fixed by the design.
- **Heard in the sermon** fills the rest of the middle column and is always shown (with an empty state). Each row has the reference, the match and how long ago, two lines of the verse, **Preview** and **Show live** (Show live puts it in the preview and sends it on screen, as Enter does). A live row shows LIVE. Add to order, the other readings, Send to device and Dismiss, and for statements Edit, Send to Lower Third, Add to Schedule and Pin to Sermon, are in the row's ⋯ menu.
- **Finder:** 268px, with the tabs, the translation and the search on one row. Search by meaning, the testament and book filters and Import a Bible version are in the options popover beside the search. The chapter buttons became a chapter select in the list heading. Within one chapter and version each row is the verse number and one line of text. The full verse of the keyboard's row is kept for screen readers only.
- **Preview** and **Live** monitors: at most 176px tall, 16:9, shrinking with the column. Preview has Send to live. Live has ON AIR, Prev and Next, and the position ("Verse 1 of 3") in the corner of the screen. Its tools (highlighting, crossfade, translation chips, the output drawn here, Go Back) are in the Live tools popover, and the preview's highlighting and translations in Preview tools. PowerPoint's status, Resend and translation notes sit over the screen.
- **Lower third** opens as a popover from the button in the Live header. Cmd+L and Send to Lower Third open it and focus the headline.
- **Queue / Slides:** the rest of the right column. With a song or presentation in the grid it is **Slides**, a two-column grid of thumbnails (click previews, double-click goes live, the live slide marked). Otherwise it is **Queue**, the live item's slides still to come (what Up next showed). Its grid button opens the full slide grid (theme, format, list view, zoom, Go Live, speaker notes) as a drawer over the finder.
- **Resize rules:** below 1280px wide the search is 160px and the Order of service is a 64px rail. Below 720px tall the finder is 220px and the Queue is hidden. At 1280×720 the monitors give a few pixels so the Queue keeps its header.

**The audit.** `main` is now compared with Main2.reference.html, in the design's state: John 3:16 to 18 live at verse 16, Romans 8:1, Psalm 23:4 and John 3:16 heard (John 3:16 LIVE), and Romans 8:1 in the preview. The finder is found as `.finder`. Layout and state checks pass on all 140 screens at 1280×720, 1366×768 and 1920×1080, and on a one-off run at 1200×700. Two problems the check found and that are fixed: the 40px hit area of status bar icon buttons reached past the 36px bar (the page was 3px too tall with device chips showing), and scrolling a thumbnail into view also scrolled the Slides card under its header.

## 2026 design: before and after

**What changed.** Behaviour and logic are unchanged; every action calls the same store function it did before.
- **Tokens** (`src/styles/tokens.css`): the new palette (bg #070B16, panel #0D1324, raised #141C33, lines at 9% and 18%, text #EEF2FA / #B4BED4 / #8793AF, live red #D62B43, success, warning, error coral #FF8A7A). The accent is one variable, `--accent` (#0087CB); `--accent-bright`, the tint, the selected-row ring and the hover are derived from it, so the final brand color is a one-line change. Radii 8 / 10 / 12 / 16, control heights 32 / 36 / 40 / 44, icon stroke 1.7. The older role names (`--bg-1`, `--text-2`, `--accent-strong`, …) now point at the new values.
- **Fonts:** Figtree (UI) and Bricolage Grotesque (titles, wordmark) are bundled with `@fontsource` and imported in `src/main.tsx`; no network font links.
- **Content colors** (slide, stage and Stream defaults saved into themes and settings) moved out of components into `src/styles/contentColors.ts`. They stay hex because themes and color inputs need hex.
- **Components** (`src/components/ui/`): Button gains `xl` (44px) and is outlined by default; IconButton has a 40px hit area; new **Switch** (button, role switch, 48×28), **StatusDot** and **Panel**; Toggle now draws a Switch; Input and Select gain `sm`; `Segmented` alias. The UI kit (`#/ui-kit`) shows them.
- **Operator screen:** top bar 60px (logo mark, wordmark, service button with "Saved just now", listening chip, BLACK / CLEAR / ON AIR group, Alerts, More, Settings last). Order of service on the left (300px, count badge, Add menu, 34px type tiles, done checks, NOW in the accent tint and ring, NEXT, footer button). Centre: On screen (LIVE chip, output selector), Previous and Next (Next primary, both with key hints), then a scroll region with Up next (three thumbnails, hidden below 1366), the slides, Preview and the lower third. Finder on the right (400px, 340px below 1366) with Scripture, Songs, Slides and Media tabs, "Heard in the sermon" above them, the translation as a select. Status bar 44px: listener state, level, latest transcript line, Transcript (opens the listener as a drawer), devices and plan. Both side panels collapse to 44px rails and remember it; the 12px gaps are the resize handles.
- **More menu** holds what the old Live menu and Search did: Go Back, Logo, the output windows, Logo Layer, test pattern, Themes, Studio (Stream), Sermons, layouts, Devices, Sharing, Search and Help.
- **Settings** is a page of its own, not a column over the app: Back to service, a 300px nav built from the sections on the page (Account, Service, Devices, Support), the section in view marked, a 760px column of cards with one setting per row, and the plan card with Manage plan.
- **First run welcome:** split screen, shown once on a computer that is not signed in; Create a free account and Log in open Settings at Account.

**The audit.** Same script and data. It now reads colors given as `color(srgb …)`, `oklab()` and `oklch()` (the derived accent tokens), shoots the welcome (`00-welcome`), uses the Slides tab name, and gives up on a stuck step after 30 seconds instead of hanging. 128 screens, up from 125.

| Measure | Before | After |
|---|---|---|
| Hex colors written outside the tokens, stylesheets | 0 | **0** |
| Hex colors written in components | 20 in 9 files (slide and stage defaults) | **0**; they are in `contentColors.ts` |
| Distinct colors rendered (text + background + border) | 52 (9 + 37 + 24) | 51 (11 + 37 + 21) |
| Font families rendered | 2 (Inter or the system font, mono) | **3 by design:** Figtree, Bricolage Grotesque, mono |
| Control button heights | 28, 32, 33, 34, 38, 40 | **32, 36, 40, 44** |
| Distinct button style combinations | 91 | 92 |
| Input and select heights | 23, 25, 27, 29, 32, 37, 38, 40 | 25, 32, 36, 37, 38, 40 |
| Click targets under 32px (unique) | 84 | **6** |
| Contrast failures, WCAG AA (unique) | 11 (2 on enabled controls) | **4 (2 on enabled controls)** |
| Screens failing the layout check at 1280×720 | 0 of 43 | **0 of 44** (0 of 42 at 1366, 0 of 42 at 1920) |

**Contrast, the pairs that matter:** ink #031018 on the accent 4.88; white on the live red 4.90; muted on panel 6.01 and on raised 5.49; bright accent on panel 7.38; error on panel 8.07. Two fixes came from the audit itself: Go Live had picked up ink text on red (3.93, now white) and the key hints on Previous and Next were at 85% opacity (4.17, now full).

**What is left.**
- The 2 enabled contrast failures are the white song section labels on the teal and amber section colors (2.49 and 2.15), slide content that was failing before too.
- The 6 small targets: the two 12px splitters (they are the gaps between panels, full height), the thumbnail size and crossfade range sliders (16px tall), the command palette's search field (25px), and the Switch itself (48×28, the size asked for; its label row is the larger target in Settings).
- Inputs at 37 and 38px are the older `.input` fields inside the editors, which keep their padding; they were not part of this pass.
- "Heard in the sermon" offers **Show in preview**, not "Show on screen": the suggestion goes to the preview, as it always has, and Enter or Go Live puts it on screen. Making it go straight to air would change behaviour.
- At 1280×720 the scroll region under Previous and Next is about 180px tall; the slides scroll inside it.

## Unfinished states: before and after

**The check.** Every screen is now also checked for its state, saved to `states.json`. The script fails (exit code 1) when:
- text written for developers is visible: a stack frame, "Cannot read properties of …", "… is not a function", an "Error invoking remote method" wrapper, a minified React error;
- a toast is drawn in a live red (`--live`, `--live-strong` or `--live-text`).

It also lists, without failing, any line that is only "Loading…" and any old one line `.empty` state still showing, and it records each screen's empty states (title and buttons), error notes (and whether they have Show details) and toasts (tone and text). The static scan adds `liveRedInStatusRules`: toast, error and warning rules in the stylesheets that use a live red token.

| Measure | Before | After |
|---|---|---|
| Screens with developer text on screen | 3 (`30-error-panel-crashed` at each size): "Cannot read properties of null (reading 'find')" | **0 of 125** |
| Toasts in the live red | none drawn as toasts; the floating sharing message was grey, its error text rose | **0**; toasts are info blue, success green, warning amber or error rose, each with its tint (`32-toast-*`) |
| Stylesheet rules for errors or warnings using a live red | 2 (`.duplicate-flag` and `.import-problems summary` used `--live`) | **0** |
| "Loading…" that never resolves | Plans and Credits (order history and prices), with no server | **0**; skeletons, then a timeout after 20 seconds |
| One line `.empty` states in the five areas asked for (songs, schedule, media, scripture, Inbox) | 6 ("No songs yet.", "No songs match.", the media line, the media picker line, the Inbox line, scripture's grey "try fewer words") | **0** |
| One line `.empty` states elsewhere | – | 3 (Slides, Preview, Presentations; see Still to watch) |
| Contrast failures on enabled controls (unique) | 3 | **2**, the white text on user-chosen teal and amber section labels. The new LIVE and PREVIEW tags in the schedule failed at first (3.5 to 4.25 on their tints) and now use the solid live and accent fills (4.65 and 4.56) |
| Click targets under 32 px (unique) | 74 | 84 over 125 screens (was 96). None are in the components changed here: all are the legacy controls listed under What is left, such as the format toolbar, highlight swatches, splitters and the song list's hover actions |

**What changed.**
- **Empty states** use EmptyState, each with one short line, one primary action and, where it helps, a sample action:
  - *Songs, first run:* "Your song library is empty", **Add your first song**, and *Add a sample song* (Amazing Grace, public domain; a second click opens the one already added). A search with no match says what was searched and offers Clear search.
  - *Schedule, no service:* "No service yet", **New service**, and *Create a sample service* (a welcome slide, Amazing Grace and Psalm 23 in the default translation). *Empty service:* "Nothing in this service yet", **Browse songs** (opens the library's Songs tab, unfolding the library if it was collapsed), and *Add a welcome slide*.
  - *Media library:* "No backgrounds yet" with **Import media**; a search or tag with no match offers Clear search. The background picker has the same states.
  - *Scripture, no results:* "No verses found for “…”" (or no passages, for Search by meaning). The primary action is the change most likely to find something: Search the whole Bible when a testament or book filter is set, else Search every version when more than one is installed, else Clear search. The sample action is *Try John 3:16*.
  - *Inbox:* "Your Inbox is empty", **Import a package**, and *Sharing settings*. The header's Import package button is hidden while the empty state offers it.
  - *Song editor, song deleted while open (29):* "This song is no longer in the library" with **Close the editor**, instead of a red line.
- **Errors** go through `describeError` (`src/lib/errors.ts`):
  - Known codes have their own sentence: file system (ENOENT, EACCES/EPERM, ENOSPC, EROFS, EBUSY, EEXIST, EMFILE), network (EADDRINUSE, ENOTFOUND, ECONNREFUSED, timeouts, "Failed to fetch"), SQLite (BUSY, FULL, READONLY, CORRUPT, CONSTRAINT), and the ServiceEx server's codes, whose sentences were already in `shared/serviceErrors.ts`.
  - Developer text (TypeErrors, React errors, JSON parse errors, stack frames, "Bad …" from the font parser) becomes "Something went wrong. Try again; if it keeps happening, copy the diagnostics for support." A sentence ServiceEx itself wrote is shown as it is, without Electron's "Error invoking remote method" wrapper.
  - The original text and stack go behind **Show details** (the new ErrorNote and DetailsToggle components), and into the **diagnostics report** with the panel's name. About 100 places that printed `err.message` or its own stripped copy now go through it, in 34 components and 6 libraries.
- **Diagnostics report** (`src/lib/diagnostics.ts`): the version, system, Electron and Chrome versions, locale, online or not, window size, then the last 50 problems with their technical details. **Copy diagnostics** puts it on the clipboard; nothing is sent anywhere. It is in the panel crash fallback and in a new Settings section, Diagnostics. The main process answers `log:appInfo` for the version and system.
- **Panel crash fallback (30):** a centred error state, "The Schedule panel stopped working" (named), "Your service, songs and what is on the screen are safe. Reload the panel to carry on.", **Reload panel** and **Copy diagnostics**, and the exception only behind Show details. The toolbar's fallback is one row, so a crash there does not push the panels down.
- **Plans and Credits and Account** never sit on "Loading…":
  - A skeleton shows while waiting. After **20 seconds** without an answer: "Could not reach the server." with **Retry** (`27-plans-timeout`).
  - Offline (the browser's `navigator.onLine`): "This computer is offline. Prices show once it is back on the internet. Everything else in ServiceEx keeps working offline." with Retry. Coming back online retries by itself. Prices already loaded stay, with a note that buying needs the internet, and Buy is disabled.
  - Account shows a skeleton until the main process answers, and the same timeout with Retry. Offline, a note says the licence, hours and allowance are as last confirmed; Refresh is disabled. Sign in, Send code, Refresh and Deactivate give up after 20 seconds with the same sentence, instead of staying busy.
  - A build with no server address says so once, without Retry.
- **Toasts:** the floating sharing message is now the Toast component, with a tone per message (success for sent, paired, received and saved; warning for declined and stopped transfers; error for failures, with Show details) and a dismiss button. Errors stay 12 seconds, warnings 8, the rest 5. Each tone tints the toast and colors its edge and icon; none uses `--live`.
- **Schedule panel** (11, 12, `13-schedule-empty`):
  - Every row is 40 px, whatever its type.
  - A grip handle at the start of each row shows it can be dragged, stronger on hover. The drop line no longer moves the rows.
  - The type icon (song, scripture, announcement, presentation thumbnail) sits in one 28 px box, so titles line up.
  - The item in the preview has an accent bar and tint and a PREVIEW tag. The item on the projector has the live red bar and a LIVE tag; both are read out to screen readers.
  - Remove (×) appears on hover, focus and the selected row (always on touch screens), so the list reads as titles.

**Screens added:** `01-first-run-media`, `08-scripture-no-results`, `13-schedule-empty`, `23-inbox-empty`, `26-account-offline`, `27-plans-offline`, `32-toast-success`, `32-toast-warning` and `32-toast-error` at each size, and `27-plans-loading` and `27-plans-timeout` at 1280 (the timeout waits the full 20 seconds). The layout check passed on all 125 screens.

**Still to watch.**
- The Slides panel ("Select a song or look up scripture to see its slides."), the Preview box ("Select something to preview") and the empty Presentations library still use one grey line. They were not in this round; the state check lists them.
- Media has no sample action: adding sample backgrounds needs the main process to accept generated files, which it does not yet.
- Offline is what the browser reports. A network that is up but cannot reach the server shows as the 20 second timeout instead.
- In `27-plans-timeout` the order history shows "You are signed out": the audit invents the signed in account in the renderer only, so the real main process answers as signed out.
- Some error sentences shown in status lines (the translation note under Live and Preview, Scripture display) have no Show details; their details still go to the diagnostics report.
- One existing test, `electron/sharing/sharing.test.ts` (a declined transfer), fails now and then when the whole suite runs. It is timing dependent and fails the same way without these changes.

## Layout at laptop sizes: before and after

**The check.** `node scripts/ui-audit.ts` (also `npm run audit:ui`) now runs every operator screen at **1280×720, 1366×768 and 1920×1080** and fails (exit code 1, with each problem listed and saved to `layout.json`) when:
- the page, `.app` or `.operator` is wider than the window (horizontal overflow);
- the toolbar is taller than one row (64 px);
- a visible control lies outside the window;
- a control is cut off by a box that clips it, or runs past its own panel column into the next one. A control scrolled out of sight inside a list that scrolls up and down is fine; one cut off sideways is not.

Run against the code before this change (same script, same data), and after:

| Size | Screens failing, before | Before: what failed | Screens failing, after |
|---|---|---|---|
| 1280×720 | **30 of 30** | All 30 scroll sideways and the toolbar wraps (97 px, or 137 px with sharing on). Alerts, Settings, Hide schedule, the service picker and every schedule Remove button are off the window; the slide zoom slider runs under the Live column (19 screens) | **0 of 32** |
| 1366×768 | **24 of 30** | The toolbar wraps with sharing on (9); the zoom slider (17) and the theme editor's controls are cut off | **0 of 32** |
| 1920×1080 | **9 of 30** | The toolbar wraps to two rows with sharing on; with the Inbox open, its item buttons ran off the bottom of the window | **0 of 32** |

The two extra screens after are `21-more-menu` and `22-status-popover`, the new menus open.

**What changed.**
- **Panels give way instead of overflowing.** Each side column (library, Live/Preview, schedule) is its saved width when there is room, and shrinks towards a floor (200, 240 and 200 px) when there is not. The centre keeps 280 px, or 520 px while an editor or Settings is open there. Columns can be narrower than their contents, which wrap or scroll inside them. At 1280 the default layout now fits with room to spare.
- **Collapsible library**, like the schedule: a ‹ button in the library tabs folds it to a 36 px rail labelled "Library"; the whole rail brings it back. Both collapsed states are remembered (`serviceex.libraryCollapsed`, `serviceex.scheduleCollapsed`).
- **Resizing** works as before (drag or arrow keys, within the same limits). It now starts from the width actually drawn, so a panel squeezed by a narrow window responds at once rather than after a dead zone.
- **Toolbar: always one row.** Service, LIVE status, Live menu, Show/Black/Clear/Logo, Alerts, the status area, Search, More and Settings. Settings is always last and never shrinks. Below 1600 px the keyboard hints drop from the mode buttons and Search (they stay in the tooltips). Below 1366 px Search becomes an icon. The service name and live title shorten first.
- **More menu (…):** the layout picker (with Edit layouts…), Stage Display, Stream, Sermons and Themes. The button shows as pressed while one of those screens is open, with a dot while the stage display or Stream output is open. The separate Layout button and the screens' icon strip are gone.
- **Status area:** one compact button replaces the device chips, transfer chips, network hint and account. It shows sharing on/off, the number of computers online, the overall transfer percentage, whether you are signed in, and a warning sign when something needs attention. Its popover holds the account (plan, email, Account and Plans and Credits buttons) and sharing (device chips, transfers with Cancel/Retry/Decline, the network hint, Sharing settings). Dragging files or a shared item over the button opens the popover, so they can still be dropped on a device chip. The Inbox and cue tray stay as their own icons beside it. Sharing messages float below the toolbar instead of pushing it aside.
- **Smaller fixes found by the check:** the slide panel's header actions wrap in a narrow centre; the theme editor stacks its theme list above the form when the centre is under 600 px; the font picker fits its card; the schedule's Host and Join buttons shorten long service and computer names; library tabs have less padding (Songs and Media now read in full at 1366).

**Still to watch.**
- At 1280 with an editor open, the side columns sit near their floors. Library tabs then read "S…", "P…". The library rail is the way to get the room back.
- The check covers the operator window at the three sizes. The output and stage windows, and the cropped Settings sections, are pictures only.

## Tokens and shared components: before and after

**What changed.**
- `src/styles/tokens.css` holds every color, type size, space, radius, shadow and control height. `src/index.css` imports it. The old names (`--bg`, `--panel`, `--text-muted`, `--next`, …) remain as aliases, so the rest of the stylesheet kept working unchanged.
- `src/components/ui/` has Button, IconButton, Input, Select, Toggle (with SegmentedControl), Tabs, Card, Chip, Modal, Toast, EmptyState and PanelHeader. Each has hover, focus-visible, active and disabled states, and their styles are in `ui.css`.
- Migrated: the toolbar (with the Layout menu, Cues, Inbox and sharing chips), the Schedule (with the shared service bar), the Scripture panel (with its results table), and every Settings section (with Account, Default themes and Scripture display).
- The dev-only UI kit is at `#/ui-kit` (`src/dev/UiKit.tsx`). It shows every component and state, with a dark and light switch. Production builds leave it out.

**How the audit changed.**
- A target now counts its invisible `::before` hit area and its `<label>`. Before, it counted only the drawn box. No control had a hit area before, so the two runs are comparable.
- The static scan reads the token file separately from the stylesheets that use the tokens.

| Measure | Before | After |
|---|---|---|
| Hex colors written outside the tokens (stylesheets) | 26 distinct, 84 uses | **0** |
| rgba colors written outside the tokens | 30 distinct, 42 uses | **0** |
| Ambers in the stylesheet | 6 hex + 2 rgba families | **1** (`--warning`, with `--warning-fill` for amber behind text) |
| `--success`, `--warning`, `--error` tokens | none; errors used `--live` | all three; errors are rose, at least 13 ΔE from every live red |
| Distinct colors rendered (text + background + border) | 49 (11 + 35 + 20) | 49 (10 + 36 + 22) |
| Near-duplicate color groups rendered | 6 | 8, all intended (see below) |
| Font families rendered | 3 (Arial leaked into 148 form controls) | **2** |
| Button heights in the four migrated areas | 16, 22, 25, 26, 27, 34, 42, 44, plus `.button` at 25 to 38 | **28, 32, 40**. Two exceptions keep their drawn size inside a 32 px hit area: device chips (27) and transfer Cancel/Decline (16). |
| Button heights, whole app | 14 values for button controls | shared components: 28, 32, 40; legacy `.button` elsewhere: 25, 27, 33, 34, 37, 38 |
| Distinct button style combinations | 76 | 74 |
| Input and select heights in the migrated areas | 23, 25, 27, 29, 37, 38, 40 | **32** (40 for `size="lg"`) |
| Click targets under 32 px (unique) | 168 | **74**; none in the migrated areas |
| Contrast failures, WCAG AA (unique) | 22 (15 on enabled controls) | **12 (3 on enabled controls)** |
| `:focus-visible` rules / global focus ring | 19 / none | 26 / one (`:where(…):focus-visible`) |
| `transition` declarations | 1 | 9 |

The before figures come from the saved measurements of the first run. The 180 small targets quoted in section 1 counted a few more duplicates. Counts span every screen at both sizes, so the screens not yet migrated still carry most of what is left.

**Contrast, the pairs that matter.** Each hue is kept; only lightness moves.

| Where | Before | After | How |
|---|---|---|---|
| Primary button text (white on accent) | 3.22 | **4.56** | fill `--accent-strong` #3370e6; `--accent` #4f8cff stays for text, borders and icons |
| LIVE label on its pill | 3.82 (light 4.14) | **4.88** (light 4.91) | `--live-text` #ec6a6e (light #c81e1e) |
| Go Live and other live fills, white text | 3.91 | **4.65** | `--live-strong` #d6393e |
| Show mode, active | 3.30 | **5.02** | `--mode-show` #15803d; Clear #027bba (4.62) |
| Error text | 4.45 (live red) | **7.17** | `--error` #fb7fa0 |
| Inbox and Cues badges | 3.22 | **4.56** | `--accent-strong` |
| `kbd` hints | 2.8–3.6 (70% opacity) | **pass** | full-strength text; only the border is softened |

**What is left.**
- **Colors.** The 8 near-duplicate groups that remain are intended:
  - the background levels;
  - `--text-2` and `--text-3`;
  - the live dot and its fill (#e5484d and #d6393e);
  - the accent fill and its hover (#3370e6 and #2b64d4);
  - the format toolbar's text color swatches (#ffd60a, #ff9f0a, #0057d9), which are slide content.
  - Slide and stage content colors written in components (ScriptureDisplay's highlight palette, StreamView's chroma green) are content, not chrome, and stay as data.
- **Contrast.** 3 failures on enabled controls remain, all outside the migrated areas:
  - white on the teal and amber section labels of slide cards (2.49 and 2.15). These are section colors that users choose.
  - the offline device name in light mode (3.8).
  - The other 9 failures are disabled controls.
- **Small targets.** The 74 left are in screens not migrated yet:
  - the slide panel and Live/Preview (format toolbar, highlight swatches, transition picker, Go Back, Preview Output);
  - the song list's hover actions, the song and theme editors, Stream, the command palette input;
  - the splitters (7 px, drag handles).
- **Legacy classes.** `.button`, `.icon-button` and `.input` still style those screens. Migrating them is the same mechanical change.
- **Layout.** The 1280×720 horizontal overflow (Biggest problems, 1) was not a token problem; it has since been fixed (see Layout at laptop sizes, above).

## Screens captured

Each operator screen is saved at `@1280` (1280×720), `@1366` (1366×768) and `@1920` (1920×1080).

| # | Screen | Notes |
|---|---|---|
| 01 | First run, no data | Fresh data folder; the bundled Bible and built-in themes are present. `01-first-run-media`: the Media tab, empty |
| 02 | Main, empty | The newest service is open with no items |
| 03–05 | Song list, Add song modal, Song editor | |
| 06–08 | Scripture: reference, word search, unknown book, no results | `08-scripture-no-results`: a word search with no match |
| 09–10 | Media library, Presentations (empty) | |
| 11–13 | Main with a service loaded, with a slide live, and on Black | |
| 13 | Schedule, empty service | `13-schedule-empty`: the second seeded service, with nothing in it |
| 14 | Schedule: New service modal | |
| 15 | Theme editor | |
| 16 | Settings (top) | Every section is also cropped on its own: `31-settings-01…21` |
| 17, 27 | Plans and Credits | 17 is this build (no server); 27 is signed in; `27-plans-offline`; `27-plans-loading` and `27-plans-timeout` (1280 only, a server that never answers) |
| 18–19 | Sermons, Stream | |
| 20–21 | **Help** | There is no Help screen. The command palette is the nearest thing |
| 21 | More menu | `21-more-menu`: layouts, Stage Display, Stream, Sermons, Themes |
| 22–23 | Device chips and transfers (in the status popover); Inbox open | `23-inbox-empty`: the Inbox with nothing in it |
| 24–26 | Account: unconfigured, signed out, signed in | `26-account-offline`: signed in, offline |
| 28 | Main, light appearance | |
| 29–30 | Errors: song deleted while open; a panel that crashed | |
| 32 | Toasts | `32-toast-success`, `-warning`, `-error` |
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

## 2. Proposed design tokens (applied; see before and after above)

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
