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
├── main.js                   # Plugin entry: IINA API, file loading, message relay, DDP integration
├── global.js                 # Global entry (logging only)
├── overlay/                  # Danmaku render layer (WebView container)
│   ├── index.html            # Entry point
│   ├── index.css             # Render styles
│   ├── input.js              # Danmaku data parser (Niconico XML, Bilibili XML)
│   ├── main.js               # Engine entry: message handling, render mode, state mgmt
│   └── lib/                  # Third-party libs (read-only, do not modify)
│       └── niconicomments.min.js  # Forked niconicomments with CSSRenderer
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

- Creates a 16:9 aspect ratio container (`[data-dm-css-container]`) centered in the viewport
- Uses `--dm-unit` CSS custom property (`min(100vh, 56.25vw) / 1080`) for responsive coordinate mapping
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
  flash: { gulim: 'normal 600 [size]px gulim, <stack>, Arial', simsun: '...' },  // Flash mode removed; keep template for validation
  html5: {
    gothic: { font: <family>, offset: <n>, weight: <n> },   // offsets must be within ±1024
    mincho: { font: <family>, offset: <n>, weight: <n> },
    defont: { font: <family>, offset: <n>, weight: <n> },
  },
}
```

CSS mode `applyFont()` reads `config.fonts.html5[type].font` / `.weight` per danmaku; Canvas mode reads the same source. When no custom font is set, default stacks (Yu Gothic / Yu Mincho / Hiragino Sans) with engine-default offsets are used so appearance matches stock. Weight range 100–900 (validated ≤1000).

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

`applyStylePreset()` sets state + slider UI and fires 4 messages: `set-fontscale`, `set-danmaku-font`, `set-stroke-width`, `set-scroll-speed`. The selected preset is persisted via `set-style-preset` → `preferences.set("stylePreset")` and restored on startup through `request-state`, so the dropdown matches actual settings after restart. Manual slider tweaks do NOT rewrite the preset selection (deliberate simplification).

### Font Settings

- Font family: preset dropdown (Japanese/Chinese/Generic groups) or custom input → `set-danmaku-font` `{fontFamily, fontWeight}` → `applyDanmakuFont()` (main.js: persist + forward) → overlay rebuilds renderer via `initCanvasRenderer()` (instant apply, no reload)
- Font weight: slider 100–900 (step 50)
- Custom font selection is guarded: selecting "Custom" with an empty input does NOT send anything (prevents the dropdown jumping back to Default); typing applies; clearing the input reverts to default

### Font Scale

Slider 25%–100% (step 5) → `set-fontscale` → `canvasFontScale`. CSS mode keeps small fonts crisp (system text rendering) — this is the main reason CSS mode is the default.

### Scroll Speed (real speed control — NOT `nakaCommentSpeedOffset`)

The engine's `nakaCommentSpeedOffset` only scales the `width × offset` term in `speed = (commentDrawRange + width×offset) / (long + 100)` and is diluted by the fixed 1920px draw range (~10–26% effect over the UI range) — it does NOT provide perceivable speed control. Real control is implemented by injecting the nicoscript duration command into scrolling danmaku:

- **Command format is `@<seconds>`** (e.g. `@3` = 3s), NOT `long:3` (`RE_LONG = /^[@＠]([0-9.]+)/` in engine parseCommand)
- Target multiplier `k` (0.25–1.0 from the slider) → `longSecs = 4/k - 1` (exact for the `+100` offset in the denominator); `k >= 1` (100%) skips injection entirely
- **Scroll danmaku detection**: explicit `naka` in commands OR (no `ue` AND no `shita`) — local nico XML default danmaku have an EMPTY mail attribute (naka is implicit); DDP conversion pushes explicit `naka`
- Danmaku with their own `@N` duration command are skipped (respect the original)
- Fixed danmaku (ue/shita) are never touched

Three data paths in `overlay/main.js`:
- **formatted** (local XML, DDP): `rawFormattedData` kept pristine; `applyScrollSpeed()` maps a fresh copy with `@N` appended to `mail`
- **nico-json v1** (`thread.comments[].commands` array) and **legacy** (`thread.chat[].mail` string): `rawNicoJsonData` kept pristine (deep-copied via `JSON.parse(JSON.stringify())`); `applyScrollSpeedToNicoJson()` mutates the copy, writing string `mail` back joined
- `set-scroll-speed` re-applies from the pristine copy + rebuilds the renderer (no double injection)

### Time Offset

`set-danmaku-offset` → `applyDanmakuOffset()` (persist + forward). Overlay adds `danmakuTimeOffsetSec` inside `canvasGetCurrentTime()` (base time + offset), so both CSS and Canvas modes shift instantly. Sidebar: number input (±30s, step 0.5) and A/D keys (only when sidebar has focus; step = |current offset|, fallback 1 — quirky but works; `adjust-danmaku-offset` handler in main.js is dead code, never sent).

## Dandanplay Network Danmaku

### Auto-Match Flow

1. **Hash exact match** (`/api/v2/match`) → `isMatched=true` → auto-load
2. **Filename fuzzy match** → `isMatched=false` → show candidate list in sidebar
3. **Manual search** → user searches by anime name → selects episode

### Cache

- Single hash-keyed cache file per video: `@data/danmaku-cache/{pathHash}.json`
- Contains `{episodeId, animeTitle, episodeTitle, cachedAt, comments}` (converted nico format)
- 24h TTL; each new DDP load overwrites previous cache for same video path
- Cache is NOT discoverable as a local file — only loaded via `ddpReadVideoCache()`

### Priority (auto-network toggle)

| Setting | Behavior |
|---------|----------|
| **ON** (`dandanplayAutoNetwork=true`) | Network-first: auto-load DDP cache/network, background auto-match |
| **OFF** (`dandanplayAutoNetwork=false`) | Local-first: load local files, DDP cache shown in list but not auto-loaded |

### DDP Comment Conversion

DDP `p` format: `time,mode,color,userId` → converted to nico-like internal format with `_dateSec: 1767196800` (2026-01-01) for correct Canvas Auto HTML5 detection. Note DDP conversion **explicitly pushes `naka`** to commands — this is why scroll-speed injection matches DDP danmaku.

### API Credentials

Hardcoded in `main.js:29-30` as fallback defaults. No user configuration needed.

## Architecture Key Conventions

### Message Communication (Core Pattern)

All communication uses `postMessage` / `onMessage` across three channels:

| Channel | Direction | Purpose |
|---------|-----------|---------|
| `main.js ↔ overlay` | Bidirectional | Danmaku data, time updates, render params, mode switching |
| `main.js ↔ sidebar` | Bidirectional | Sidebar UI state sync, operation commands |
| `overlay → main.js` | One-way | Canvas unsupported notice, jump commands, seek state |
| `sidebar → main.js` | One-way | Toggle, param changes, file operations |

Customization messages (sidebar → main.js → overlay): `set-fontscale`, `set-stroke-width`, `set-stroke-opacity`, `set-stroke-color`, `set-stroke-inversion-color`, `set-comment-limit`, `set-scroll-speed` (multiplier 0.25–1.0), `set-danmaku-offset`, `set-danmaku-font`, `set-style-preset` (persisted in main.js only, not forwarded).

**Important**: overlay and sidebar do **NOT** communicate directly — all traffic goes through `main.js`.

**Sidebar lazy loading**: IINA sidebar tabs are lazy — the sidebar WebView doesn't exist until the user opens it. Therefore, sidebar uses a **pull pattern** for state sync:
1. After loading, sidebar sends `request-state` proactively
2. `main.js` pushes the full current state in the `request-state` callback (including `stylePreset`, `danmakuFontFamily/Weight`)
3. Subsequent state changes use event-driven incremental `sidebar.postMessage` updates
4. Never assume `main.js` can push messages to sidebar at initialization time

**Backtick sanitization**: U+0060 backtick in any string causes IINA IPC to silently drop `sidebar.postMessage` messages. Always sanitize with `.replace(/[`\u2018\u2019]/g, "'")` before sending.

**sidebar.postMessage must receive plain objects**, not pre-serialized JSON strings. IINA may silently drop messages wrapped in `JSON.stringify()`.

### Overlay Script Load Order (Immutable)

```
niconicomments.min.js → input.js → main.js
```

Later scripts depend on functions mounted on `window` by earlier scripts (e.g., `window.parseDanmaku` from `input.js`). Do not reorder the `<script>` tags.

### Data Format

- **Danmaku data object** field conventions (created in `input.js` and `main.js:ddpConvertComments`):
  - `t` — vpos time (1/100 sec)
  - `text` — display text
  - `_isOwner` — whether posted by the video owner
  - `_commands` — array of mail commands (e.g., `['naka', '#ffffff', 'big']`)
  - `_userId` — user ID (number or string)
  - `_dateSec` — Unix timestamp in seconds
  - `_reverse` — whether reverse danmaku (mode 6)
  - `_layer` — CA layer ID (-1 = default layer, assigned at runtime by niconicomments)

- **Overlay data paths** (`prepareCanvasSource` in `overlay/main.js`):
  - `nico-json` type → `JSON.parse` directly, format detected by `detectNicoFormat` (`v1` when `data[0].comments`, else `legacy`) — pristine copy kept in `rawNicoJsonData`
  - everything else → `buildFormattedCanvasData(parsedList, type)` → pristine copy kept in `rawFormattedData`
  - Both paths then apply scroll-speed injection (see Scroll Speed section)

- **Communication encoding**: Danmaku XML/JSON content is encoded with `encodeURIComponent()` (via the `encodeContent` function) in `main.js` before sending to overlay, then decoded with `decodeURIComponent()` on the overlay side. Do not change this encoding protocol unless replacing it entirely (both ends must stay in sync).

### CSS Mode (niconicomments) Render Flow

1. `time-update` fires → `canvasSyncAnchor()` → `startCanvasLoop()` (rAF)
2. `canvasRenderLoop` calls `niconiComments.drawCanvas(vpos)` where `vpos = canvasGetCurrentTime() * 100` (includes time offset)
3. `drawCanvas` with `cssRenderer` calls `cssRenderer.updateComments(timeline, vpos, frameActiveState)`
4. `updateComments` diffs visible comments vs `activeElements`, creates/recycles DOM elements
5. Scroll danmaku get inline `animation: dm-scroll <remainingSec>s linear forwards` with `--dm-from/--dm-to` CSS vars; fixed danmaku use `dm-fade`
6. When video pauses, `pauseCSS()` pauses all active animations; `resumeCSS()` resumes them

### Canvas Mode

Based on the `niconicomments` third-party library. All formats are normalized via `buildFormattedCanvasData()` before being passed to NiconiComments. Not recommended to modify Canvas mode internals.

## Release Workflow

- Push a `v*` tag (e.g. `v3.11`) → `.github/workflows/release.yml` auto-packages `danmaku-cosmos.iinaplgz` (excludes `.github`, `png/*`, README, etc.) and creates a GitHub release
- **`generate_release_notes: true` only produces content for merged PRs** — direct-push commits yield an EMPTY notes body (just a changelog link). Always manually fill notes after release: `gh release edit vX.Y --notes "..."`
- Keep `Info.json` `version` in sync with the tag (bump + commit before tagging)

## Coding Conventions

- **Variable declarations**: `var` (main.js/sidebar) and `let` (overlay) are both used. Prefer `let` in new code.
- **Naming**: camelCase. Private/run-time fields prefix with `_` (e.g., `_layer`, `_commands`)
- **Communication**: `iina.postMessage(key, value)` / `iina.onMessage(key, callback)` is the standard pattern. Keep naming consistent.
- **Danmaku toggle**: Use the shared `toggleDanmaku()` or `ensureDanmakuEnabled()` functions. Do not manually repeat `preferences.set` + `overlay.postMessage` logic.
- **Network requests**: Use `iina.http` module. DDP API uses `X-AppId`/`X-AppSecret` header auth.
- **Backtick sanitization**: Always sanitize strings with U+0060 backtick before `sidebar.postMessage`.
- **Preferences sync**: Use `syncPreferencesSoon()` (debounced) instead of calling `preferences.sync()` directly.
- **i18n**: Two dictionaries, both with three languages (`en` plain, `ja`/`zh` as `\uXXXX` escapes). Sidebar UI strings live in `sidebar/index.js` `i18n` dict (language from `navigator.language`, applied via `data-i18n` / `data-i18n-placeholder` attributes and `t(key)`). OSD, menu items, and file-dialog titles live in `main.js` `PLUGIN_I18N` dict (language from `iina.utils.preferredLocalizations()`, accessed via `t(key, vars)` — supports `{name}` interpolation). New strings must be added to all three languages of the relevant dict. Never hardcode UI strings in either language. Japanese terminology follows niconico official usage: use コメント (not 弾幕) except when matching literal folder names.
- **Style presets**: New presets = one entry in `STYLE_PRESETS` + an `<option>` in `sidebar/index.html`. Parameters must fit existing slider ranges (fontScale 25–100%, weight 100–900 step 50, strokeWidth 1–8, scrollSpeed 0.25–1.0).

### Logging Conventions

- **No verbose debug logging in production code.** Only log errors and one-time initialization messages.
- **Never** use `console.log` in high-frequency callbacks (especially `time-update` / `canvasRenderLoop`).
- Error logs in `catch` blocks are acceptable (e.g., `console.log('[ddp] saveVideoCache error: ' + e)`).
- The sidebar relays its debug output via `iina.postMessage("sidebar-log", ...)` to `main.js`, gated by a `DEBUG_LOG` flag (default `false`).
- When debugging is needed, temporarily add logs and remove them before committing — do not leave trace-level logging in shipped code.

## Known Limitations

- `canvas.width = 1920; canvas.height = 1080` is hardcoded and does not adapt to window aspect ratio
- Filenames containing `[` or `]` may cause auto-load to fail (regex matching in `extractNumberFromName`, `[n]`-style only; special formats like `第3话` often fail)
- Canvas mode does not support CSS-mode-specific settings (font scale, scroll duration, blocking, lane limits)
- CSS mode (niconicomments) Comment Art vertical positioning may differ slightly from Canvas mode
- DDP cache only stores the last loaded episode per video (hash overwrite)
- Backtick U+0060 in any sidebar message field causes IINA IPC to silently drop the entire message
- Scroll speed: danmaku carrying their own `@N` duration command are excluded from injection (rare, respected by design)
- Style preset dropdown is not rewritten when sliders are manually tweaked (deliberate simplification; preset value persists independently)

## Avoid

- Do not introduce any build tools or npm packaging
- Do not modify files under `overlay/lib/` (third-party libraries)
- Do not create a direct communication channel between overlay and sidebar
- Do not change the `<script>` loading order in the overlay HTML
- Do not use `console.log` for high-frequency output in production code (especially in `time-update` callbacks)
- Do not send `JSON.stringify` payloads to `sidebar.postMessage` — always send plain objects
- Do not pass a partial `fonts` config (missing `flash`) to the engine — validation throws and danmaku vanish

## Related Repository

- **niconicomments (forked)**: https://github.com/karappo-yu/niconicomments — The fork adds `CSSRenderer` (`src/renderer/css.ts`) and `mode: "css"` support. Changes are on the `develop` branch.
