# Danmaku Cosmos — Project Guide

## Overview

An IINA danmaku plugin supporting Niconico (XML / V1 JSON), Bilibili (XML), and **Dandanplay network danmaku** with dual CSS and Canvas rendering modes. The plugin targets **both danmaku style ecosystems**: the native niconico style (large font, fast scroll, bold) and the Chinese/Bilibili style (small font, slow scroll, thin) — switchable via **Style Presets** in the sidebar, plus fine-grained manual controls (font family/weight, font scale, scroll speed, stroke, time offset).

The CSS renderer (a fork addition, `mode: "css"`) renders text via DOM/CSS instead of canvas: small fonts stay crisp (system font pipeline vs canvas bitmap sampling) and scroll animations run on GPU compositing (`transform`), which is smoother than canvas in IINA's WKWebView.

## Reference Links

- **Dandanplay API (Swagger)**: https://api.dandanplay.net/swagger/index.html#/
- **IINA plugin API docs**: https://docs.iina.io/index.html

## Tech Constraints

- **IINA plugin environment**: No build tools, bundlers, or npm package managers
- **Rendering engine**: IINA uses Safari (WebKit) internally
- **Language**: Plain vanilla JavaScript (ES5/ES6 mixed), no TypeScript
- **Modularity**: Overlay files are loaded via `<script>` tags in order, sharing global functions and variables through the `window` object. `main.js` (plugin entry) and `sidebar/` run in separate contexts.
- **Network access**: Requires `permissions: ["network-request"]` and `allowedDomains` in `Info.json`. Use `iina.http` module (not browser `fetch`).

## Project Structure

```
Danmaku Cosmos/
├── Info.json                 # Plugin metadata & preference defaults
├── main.js                   # State, I/O boundaries, IPC, IINA/DDP integration
├── danmaku-document.js       # Canonical parser and shared projection pipeline
├── overlay/                  # Danmaku render layer (WebView container)
│   ├── index.html            # Entry point
│   ├── index.css             # Render styles
│   ├── main.js               # Engine entry: message handling, render mode, state mgmt
│   └── lib/                  # Third-party libs (read-only, do not modify)
│       ├── niconicomments.min.js  # Forked niconicomments with CSSRenderer
│       └── opencc.min.js          # opencc-js v1.4.1 UMD bundle; loaded once from main through package-local require, converter constructed lazily; conversion memoized on IR nodes for all source formats
├── sidebar/                  # IINA sidebar control panel
│   ├── index.html            # Layout (general settings incl. Style Preset; advanced settings)
│   ├── index.css
│   └── index.js              # UI logic, STYLE_PRESETS, i18n dict (en/ja/zh, ja/zh as \uXXXX escapes); main.js has its own PLUGIN_I18N dict for OSD/menu strings
├── png/                      # README screenshots (excluded from release package by release.yml)
└── .github/workflows/        # Release packaging
    └── release.yml
```

## Dual Rendering Architecture

### CSS Mode (niconicomments CSSRenderer) — default

When `mode: "css"` is passed to NiconiComments, a `CSSRenderer` is created instead of using canvas drawing. The CSSRenderer:

- Shares Canvas Auto's per-comment Flash/HTML5 selection: `date < flashThreshold` (1499871600; 2017-07-13 00:00 JST) or `nico:flash` selects Flash unless `gothic`, `mincho` or `defont` is present. New comments (including Bilibili/DDP's synthetic 2026 dates) use HTML5 by default.
- Flash DOM uses `fontSize` / `scale` / `scaleX`, per-run fonts and measured advances, compatibility spacers, and Flash baseline/line offsets. Keep this path separate from HTML5 `charSize`; Flash's `charSize` is zero. The outer element owns animation and the measured collision box; an inner layer resolves fonts at their original size before applying Flash and display scales, preserving WebKit's color-emoji advances.

- Creates a container (`[data-dm-css-container]`) matching the canvas's visible video rectangle, relative to its parent
- Uses `--dm-unit` = displayed video height / 1080 for uniform coordinate mapping; 4:3 retains full-height text rather than shrinking into a 16:9 box
- Renders each danmaku as a `div[data-dm-comment]` with `will-change: transform, opacity; contain: layout style`
- Scroll danmaku: CSS `@keyframes dm-scroll` driven by JS-computed duration (inline `animation` style), matching `getPosX()` formula
- Fixed danmaku (ue/shita): CSS `@keyframes dm-fade` animation
- Stroke: `-webkit-text-stroke` + `paint-order: stroke fill`
- Object pool (max 512 elements) for DOM reuse
- Pause/resume via Web Animations API `pause()`/`play()` (container class-driven)
- Tracks reverse state per danmaku, reanimates when `@reverse` activates/deactivates

### Fonts config (CRITICAL — validation trap)

Fonts are passed to the engine via init config `config.fonts`. **The engine's `isValidFonts` check (typeGuard) requires BOTH `flash` and `html5` key groups** — passing only `{ html5 }` makes the constructor throw `InvalidOptionError` and **all danmaku disappear** (verified in production). Build via `buildDanmakuFontConfig()` in `overlay/main.js`:

```js
{
  flash: { gulim: 'normal 600 [size]px gulim, <stack>, Arial', simsun: '...' },  // Used by old comments in Auto, also required for validation
  html5: {
    gothic: { font: <family>, offset: <n>, weight: <n> },   // offsets must be within ±1024
    mincho: { font: <family>, offset: <n>, weight: <n> },
    defont: { font: <family>, offset: <n>, weight: <n> },
  },
}
```

CSS mode `applyFont()` reads `config.fonts.html5[type].font` / `.weight` for HTML5 fonts, and `config.fonts.flash` templates for Flash `gulim` / `simsun` runs. Flash `defont` runs use the HTML5 defont config, matching Canvas `parseFont()`. When no custom font is set, default stacks (Yu Gothic / Yu Mincho / Hiragino Sans) with engine-default offsets are used so appearance matches stock. Weight range 100–900 (validated ≤1000).

### Canvas Mode (niconicomments original)

Based on the original niconicomments library. Supports Auto mode only (HTML5 and Flash modes have been removed). Not recommended to modify Canvas mode internals.

## Danmaku Appearance Customization

All controls live in the sidebar. General settings (top): Style Preset. Advanced settings: render mode, force-simplified, time offset, font family/weight, comment limit, stroke, scroll speed.

### Style Presets

`STYLE_PRESETS` in `sidebar/index.js` — one-click apply of a parameter bundle (add new presets by extending this map):

```js
var STYLE_PRESETS = {
  nico:     { fontScale: 1.0, fontWeight: "400", strokeWidth: 2.8, scrollSpeed: 1.0 },  // defaults
  balanced: { fontScale: 0.5, fontWeight: "400", strokeWidth: 3, scrollSpeed: 0.5 },
  bilibili: { fontScale: 0.35, fontWeight: "200", strokeWidth: 2.5, scrollSpeed: 0.4 },
};
```

`applyStylePreset()` sets state + slider UI and fires 4 messages: `set-fontscale`, `set-danmaku-font`, `set-stroke-width`, `set-scroll-speed`. Overlay rebuilds are debounced for 80 ms, so the four setting messages result in one renderer rebuild. The selected preset is persisted via `set-style-preset` → `preferences.set("stylePreset")` and restored on startup through `request-state`, so the segmented selection matches the saved preset after restart. Manual slider tweaks do NOT rewrite the preset selection (deliberate simplification).

### Font Settings

- Font family: preset dropdown (Japanese/Chinese/Generic groups) or custom input → `set-danmaku-font` `{fontFamily, fontWeight}` → `applyDanmakuFont()` (main.js: persist + forward) → overlay rebuilds renderer via `initCanvasRenderer()` (instant apply, no reload)
- Font weight: slider 100–900 (step 50)
- Custom font selection is guarded: selecting "Custom" with an empty input does NOT send anything (prevents the dropdown jumping back to Default); typing applies; clearing the input reverts to default

### Font Scale

Slider 25%–100% (step 5) → `set-fontscale` → `canvasFontScale`. CSS mode keeps small fonts crisp (system text rendering) — this is the main reason CSS mode is the default.

### Scroll Speed (native engine motion)

`scrollSpeed` is an independent engine config field (plugin UI: 0.25–1; engine API: 0.25–4). `setScrollSpeed()` updates the existing instance, deriving horizontal speed, visibility windows and collision occupancy from one formula. Native `long` and `@N` commands remain unchanged, including on custom-duration comments. Owner motion and fixed comment lifetimes remain unchanged.

The sidebar previews speed on input and commits on change. Runtime settings coalesce until the next draw, which recalculates lanes/timeline in place and reanimates each surviving CSS node once using alternating keyframe names (no forced layout read); they do not reparse sources, remeasure text, or reconstruct the renderer. Reflow still costs CPU and existing positions reflect the new motion model. Do not promise constant-time or entirely cost-free updates. No plugin-side command injection or duplicate raw source is permitted.

### Time Offset

`set-danmaku-offset` → `applyDanmakuOffset()` (session-only; not persisted). The offset resets to zero on each video load, then forwards to overlay and sidebar. Overlay keeps `getVideoTimeSec()` offset-free and adds `danmakuTimeOffsetSec` only when passing vpos to the renderer. `syncVideoAnchor()` always receives pure video time. Sidebar: number input (±30s, step 0.5) and A/D keys (only when sidebar has focus; step = |current offset|, fallback 1 — quirky but works); both send `set-danmaku-offset`.

### Nico JSON Date Slice

- The sidebar axis uses cumulative dated-comment counts: each day's width is proportional to its comment count before density filtering. Empty days take no width; undated comments remain in the displayed count but do not affect the axis. Only dates with comments are selectable. Handles snap to whole-day boundaries; arrow keys jump to the previous/next populated date, skipping empty days. Only the two handles can be dragged; the range body does not move the selection. Incoming date ranges snap their boundaries to populated dates; an entirely empty range advances to the next populated date.
- `set-danmaku-filter` sends `{startDay, endDay}` as integer calendar-day numbers; both `null` mean the full range. Days use Japan time (UTC+9) for V1 `postedAt` and legacy `chat.date`; day-number arithmetic uses UTC to avoid host timezone/DST changes.
- The canonical document owns dateInfo (source bounds, per-day counts and undated count). `danmaku-filter-info` restores the bounds and selected days to the lazy sidebar. The count on the range previews ordinary comments after the date slice and before density filtering. The density badge shows `filteredCount / sourceTotalCount`, where `sourceTotalCount` is the input after date slicing (including retained owner/easy and undated comments), not the original file total. `projectDanmaku()` records counts at the date and density stages of the same projection.
- `projectDanmaku()` slices normalized comments before density filtering. Owners, easy comments and undated comments are protected from date slicing; owners/easy and nicoru >= 3 are protected from density quotas. Legacy metadata is consumed at the parse boundary and never becomes a comment. Nico XML dates are also supported.
- Date selection resets on source/video changes. Sources without valid dates hide the selector; small files and single-day sources remain supported.

### Danmaku Deduplication (shared static projection)

`mergeProjectedComments()` in `danmaku-document.js` is the only plugin dedupe implementation. It greedily groups from the earliest item within an inclusive window, by displayed text + normalized position + blocked state. Owners never merge. Both fixed and scrolling comments use the same static policy; the first host's style is retained and its `xN` suffix is passed as formatted metadata with a stable accent color.

The sidebar and overlay consume the same merged projection. Engine `fixedCombo` and `nakaDedupeWindow` are disabled for these already-merged arrays. Do not reintroduce independent list merging or progressive fixed counts. The engine still supports those APIs for other consumers.

## Dandanplay Network Danmaku

### Auto-Match Flow

1. **Hash exact match** (`/api/v2/match`) → `isMatched=true` → auto-load
2. **Filename fuzzy match** → `isMatched=false` → show candidate list in sidebar
3. **Manual search** → user searches by anime name → selects episode

### Cache

- Cache writes await directory creation; reads do not create directories. New entries also store `videoPath` to detect hash collisions.
- Single hash-keyed cache file per video: `@data/danmaku-cache/{pathHash}.json`
- Contains `{schemaVersion: 2, videoPath, episodeId, animeTitle, episodeTitle, cachedAt, comments}` (canonical comments); the read boundary also accepts old converted caches. Writes are serialized through `cacheWriteQueue`.
- 24h TTL; each new DDP load overwrites previous cache for same video path (same filename, so expired data is replaced on refresh, never deleted explicitly)
- **Expired cache is NOT deleted on read** — `ddpReadVideoCache()` marks it `stale: true` and keeps the file as a download-failure fallback (`ddpFallbackToLocal()` loads stale cache when no local files exist). It appears in the file list with a `(旧)` suffix but is never auto-loaded, so refresh still happens after TTL expiry; a successful refresh overwrites the file and the suffix is removed (`ddpAddToFileListAndLoad(..., fresh=true)`)
- **Fresh cache (within TTL) fully skips background auto-match** — no hash recompute, no API call (honors the README "replay within 24h skips re-download" promise). Refresh only happens after TTL expiry, or when the user manually triggers matching via the 网络弹幕 panel (`dandanplay-trigger-match`)
- Cache is NOT discoverable as a local file — only loaded via `ddpReadVideoCache()`

### Priority (auto-network toggle)

| Setting | Behavior |
|---------|----------|
| **ON** (`dandanplayAutoNetwork=true`) | Network-first: fresh DDP cache auto-loads without any network traffic; no cache → auto-match |
| **OFF** (`dandanplayAutoNetwork=false`) | Local-first: load local files; no local files → fall back to auto-loading a fresh DDP cache (stale cache is listed but never auto-loaded) |

**Manual DDP loads use `DDP_LOAD_ORIGIN.MANUAL`**: `dandanplay-trigger-match`, `dandanplay-select-match`, and `dandanplay-select-episode` pass the origin through `ddpAutoMatchAndLoad()` / `ddpLoadComments()`. Manual origin forces activation regardless of auto-network priority and bypasses the danmaku-toggle abort guards; background callers pass `DDP_LOAD_ORIGIN.AUTO` and keep the existing toggle/priority semantics.

DDP persistence and activation are separate: `ddpSaveVideoCache()` writes disk cache, `ddpUpsertFileListEntry()` updates the session cache/file list, and `ddpAddToFileListAndLoad(..., forceLoad=true)` delegates activation to `loadDanmakuFile()`. That shared entry owns overlay-readiness queuing, `ensureDanmakuEnabled()`, filter/list notifications, and the `network_loaded` OSD key. Do not reintroduce a separate overlay/pending/enable path in DDP code.

Concurrent match/download operations use a request generation in addition to the video generation. Only the latest operation may activate a source; selecting a local file invalidates pending network work. All failed automatic matching branches fall back to local candidates while the danmaku toggle remains enabled.

### DDP Comment Conversion

DDP `p` format: `time,mode,color,userId` → canonical comments at the network boundary, with `dateSec: 1767196800` (2026-01-01) for Canvas Auto HTML5 detection. Synthetic dates never become density ordering signals. API `chConvert` is fixed to 0 and `withRelated` to true; the dead preference keys were removed. Search and bangumi requests each have generations to reject stale responses.

### API Credentials

Hardcoded in `main.js (`DDP_APP_ID` / `DDP_APP_SECRET`)` as fallback defaults. No user configuration needed.

## Architecture Key Conventions

### Message Communication (Core Pattern)

- Register overlay message handlers after `iina.plugin-overlay-loaded`: IINA ignores registrations before the view exists and `overlay.loadFile()` clears listeners. Main then sends `request-overlay-state`, and overlay answers `overlay-ready`. Only this handshake unlocks the latest pending source; there is no timeout that pretends readiness. Enabling and loading transmit an atomic `{enabled,time,paused,speed}` snapshot.
- Register WebView callbacks through `sidebarOnMessage()` / `overlayOnMessage()` in main. These helpers keep the current function for each message name in a global JS table so IINA's `JSManagedValue` cannot lose an otherwise unreferenced callback during garbage collection. Re-registration replaces the saved function; do not clear the tables on video changes or WebView navigation before new callbacks are installed.
- Main owns the selected file type; overlay no longer echoes `danmaku-type`. Render success/failure uses `danmaku-load-result` with a `loadId`; replies from an older source/video are ignored.
- Use `sidebarPostMessage()` / `overlayPostMessage()` from main. All sends pass through `postSafeMessage()`. Payloads containing actual template syntax, curly quotes or lone surrogates are wrapped in `{__encoded: encodeURIComponent(json)}`; `onPluginMessage()` unwraps it in each WebView. Ordinary JSON quotes, newlines and backslashes do not require an envelope. Lone surrogates are escaped in serialized JSON before URI encoding, preserving code units. Business strings and paths remain lossless. Comment arrays and list chunks use this same envelope; no `xmlContent`, special path codec or Base64 list protocol remains.


All communication uses `postMessage` / `onMessage` across three channels:

| Channel | Direction | Purpose |
|---------|-----------|---------|
| `main.js ↔ overlay` | Bidirectional | Danmaku data, time updates, render params, mode switching |
| `main.js ↔ sidebar` | Bidirectional | Sidebar UI state sync, operation commands |
| `overlay → main.js` | One-way | Jump commands, seek state |
| `sidebar → main.js` | One-way | Toggle, param changes, file operations |

Customization messages (sidebar → main.js → overlay): `set-fontscale`, `set-stroke-width`, `set-stroke-opacity`, `set-stroke-color`, `set-stroke-inversion-color`, `set-comment-limit`, `set-scroll-speed` (multiplier 0.25–1.0), `set-danmaku-offset`, `set-danmaku-font`, `set-style-preset` (persisted in main.js only, not forwarded).

**Important**: overlay and sidebar do **NOT** communicate directly — all traffic goes through `main.js`.

**Sidebar lazy loading**: IINA sidebar tabs are lazy — the sidebar WebView doesn't exist until the user opens it. Therefore, sidebar uses a **pull pattern** for state sync:
1. After loading, sidebar sends `request-state` proactively
2. `main.js` pushes the full current state in the `request-state` callback (including `stylePreset`, `danmakuFontFamily/Weight`)
3. Subsequent state changes use event-driven incremental `sidebar.postMessage` updates
4. Never assume `main.js` can push messages to sidebar at initialization time

**Lossless IPC**: never replace punctuation in business strings. Escape exclusively in `postSafeMessage()` and decode exclusively in `onPluginMessage()`.

**sidebar.postMessage must receive plain objects**, not pre-serialized JSON strings. IINA may silently drop messages wrapped in `JSON.stringify()`.

### Source and IPC boundaries

- `danmaku-document.js` is loaded by main with package-local `require`. `parseDanmakuSource()` is the only XML/JSON/DDP normalization entry; invalid/empty comments are dropped there. IR includes sourceType, duration, dates, decoded text and native rendering metadata. Source fields are immutable; only `simplifiedText` is a lazy memo.
- `danmakuCache[path]` contains a document, never encoded text. List selections reuse the cached IR; an explicit file-dialog selection rereads disk, preserving the old source if the refresh fails. A new video clears the session cache.
- `projectDanmaku(doc, settings)` performs date slicing → density → optional simplification → blocking → shared dedupe, and returns formatted comments, list rows and counts. Main caches the current projection for all consumers. Skip overlay reload when the formatted projection is unchanged. Preserve owner control text (`/`, `@`, `＠` prefixes) during simplification. Do not parse or serialize source content in filters or UI code.
- Overlay script order is `niconicomments.min.js → main.js`. Overlay consumes only `load-danmaku.comments` (formatted arrays); `input.js` has been removed.
- OpenCC's package module is loaded while the main entry is executing. IINA's require resolver uses the current script stack, so do not call it from later native callbacks. Converter creation remains lazy. No WebView-supplied paths, persisted plugin roots or eval.
- `pluginState` owns settings and session metadata; `commitState()` applies patches, writes preferences with `syncPreferencesSoon()`, and sends incremental settings notifications. Runtime resource handles and document/projection caches live separately. Sidebar sends one `request-state` after initializing its handlers and renders the snapshot; it has no independent preference defaults or old blocklist/dedupe/position state events. Batch related state changes and do not manually repeat commitState notifications. Keep focused font drafts/caret intact on state echoes.

### CSS Mode (niconicomments) Render Flow

1. `time-update` fires → `syncVideoAnchor()` → `startCanvasLoop()` (rAF)
2. `canvasRenderLoop` calls `niconiComments.drawCanvas(vpos)` where `vpos = canvasGetCurrentTime() * 100` (includes time offset)
3. `drawCanvas` with `cssRenderer` calls `cssRenderer.updateComments(timeline, vpos, frameActiveState)`
4. `updateComments` diffs visible comments vs `activeElements`, creates/recycles DOM elements
5. Scroll danmaku get inline `animation: dm-scroll <remainingSec>s linear forwards` with `--dm-from/--dm-to` CSS vars; fixed danmaku use `dm-fade`
6. When video pauses, `pauseCSS()` pauses all active animations; `resumeCSS()` resumes them

### Canvas Mode

Based on the `niconicomments` third-party library. All sources arrive as the same canonical formatted projection. Not recommended to modify Canvas mode internals.

### Video Aspect Ratio

- Main reads mpv `video-out-params/aspect` (falls back to `video-params/aspect`, then core video dimensions) and applies the reported rotation. Every load includes `videoAspectRatio`; output-parameter changes forward `set-video-aspect`.
- In windowed mode, overlay fits `#danmaku-viewport` to the video display ratio. Fullscreen expands its horizontal extent to the entire WebView, including pillarboxes, while keeping the video's displayed height and vertical position. Fixed comments keep the same center and vertical alignment; scrolling comments can traverse the black side bars. With unavailable metadata it uses the WebView ratio. Browser resize is observed even while paused.
- Fullscreen state comes from `core.window.fullscreen` on load/overlay readiness, and `iina.window-fs.changed` forwards `set-fullscreen`. The `set-video-aspect` payload also carries the current fullscreen state.
- The canvas keeps a logical height of 1080 and a width proportional to the output rectangle (windowed 4:3 uses 1440, fullscreen on 16:9 uses 1920, 21:9 uses 2520; extreme allocation sizes are bounded). Call the engine's `resize(width, height)`, then redraw; do not rebuild/reparse comments for window or fullscreen changes.
- The engine keeps the native layout stage and centers it in the output. 4:3 exposes the central area without reducing glyph size; intentionally full-width 16:9 CA can be cropped on 4:3. Wide viewports extend scrolling visibility while preserving collision lanes, pause and playback speed.
- Video zoom/pan, embedded black bars and sidebar-specific video offsets are not inferred from aspect alone; such placement needs the actual video rectangle from IINA.

## Release Workflow

- `node --test test/*.test.js` runs without installing dependencies. Regression tests include actual legacy data validated by the bundled engine parser.
- Release CI checks syntax, tests, and tag/version equality. Branch workflow-dispatch runs upload an artifact without creating a GitHub release.


- Push a `v*` tag (e.g. `v3.11`) → `.github/workflows/release.yml` auto-packages `danmaku-cosmos.iinaplgz` (excludes `.github`, `png/*`, README, etc.) and creates a GitHub release
- **`generate_release_notes: true` only produces content for merged PRs** — direct-push commits yield an EMPTY notes body (just a changelog link). Always manually fill notes after release: `gh release edit vX.Y --notes "..."`
- Keep `Info.json` `version` in sync with the tag (bump + commit before tagging)

## Coding Conventions

- **Variable declarations**: `var` (main.js/sidebar) and `let` (overlay) are both used. Prefer `let` in new code.
- **Naming**: camelCase. Private/run-time fields prefix with `_` (e.g., `_commands`)
- **Communication**: `iina.postMessage(key, value)` / `iina.onMessage(key, callback)` is the standard pattern. Keep naming consistent.
- **Danmaku toggle**: Use the shared `toggleDanmaku()` or `ensureDanmakuEnabled()` functions. Do not manually repeat `preferences.set` + `overlay.postMessage` logic.
- **Network requests**: Use `iina.http` module. DDP API uses `X-AppId`/`X-AppSecret` header auth.
- **IPC**: never sanitize business text or encode paths; use the shared lossless envelope.
- **Preferences sync**: Use `syncPreferencesSoon()` (debounced) instead of calling `preferences.sync()` directly.
- **i18n**: Two dictionaries, both with three languages (`en` plain, `ja`/`zh` as `\uXXXX` escapes). Sidebar UI strings live in `sidebar/index.js` `i18n` dict (language from `navigator.language`, applied via `data-i18n` / `data-i18n-placeholder` attributes and `t(key)`). OSD, menu items, and file-dialog titles live in `main.js` `PLUGIN_I18N` dict (language from `iina.utils.preferredLocalizations()`, accessed via `t(key, vars)` — supports `{name}` interpolation). New strings must be added to all three languages of the relevant dict. Never hardcode UI strings in either language. Japanese terminology follows niconico official usage: use コメント (not 弾幕) except when matching literal folder names.
- **Style presets**: New presets = one entry in `STYLE_PRESETS` + a segmented button (`data-preset`) in `sidebar/index.html`. Parameters must fit existing slider ranges (fontScale 25–100%, weight 100–900 step 50, strokeWidth 1–8, scrollSpeed 0.25–1.0).

### Logging Conventions

- **No verbose debug logging in production code.** Only log errors and one-time initialization messages.
- **Never** use `console.log` in high-frequency callbacks (especially `time-update` / `canvasRenderLoop`).
- Error logs in `catch` blocks are acceptable (e.g., `console.log('[ddp] saveVideoCache error: ' + e)`).
- The sidebar relays its debug output via `iina.postMessage("sidebar-log", ...)` to `main.js`, gated by a `DEBUG_LOG` flag (default `false`).
- When debugging is needed, temporarily add logs and remove them before committing — do not leave trace-level logging in shipped code.

## Known Limitations

- Video aspect uses centered contain layout; custom video zoom/pan and sidebars moving the video off-center are not reflected by aspect metadata alone
- Filenames containing `[` or `]` may cause auto-load to fail (regex matching in `extractNumberFromName`, `[n]`-style only; special formats like `第3话` often fail)
- Canvas mode receives the same filtered source content as CSS mode, but does not support CSS-specific animation/layout behavior.
- CSS mode (niconicomments) Comment Art vertical positioning may differ slightly from Canvas mode
- DDP cache only stores the last loaded episode per video (hash overwrite)
- Style preset dropdown is not rewritten when sliders are manually tweaked (deliberate simplification; preset value persists independently)

## Avoid

- Do not introduce any build tools or npm packaging
- Do not hand-edit files under `overlay/lib/`. Engine changes belong in the niconicomments fork; sync only its tested build artifact.
- Do not create a direct communication channel between overlay and sidebar
- Keep the engine script before overlay main; do not add source parsing back to the WebView
- Do not use `console.log` for high-frequency output in production code (especially in `time-update` callbacks)
- Do not send `JSON.stringify` payloads to `sidebar.postMessage` — always send plain objects
- Do not pass a partial `fonts` config (missing `flash`) to the engine — validation throws and danmaku vanish

## Related Repository

- **niconicomments (forked)**: https://github.com/karappo-yu/niconicomments — The fork adds `CSSRenderer` (`src/renderer/css.ts`) and `mode: "css"` support. Changes are on the `develop` branch.
