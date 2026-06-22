# Danmaku Cosmos — Project Guide

## Overview

An IINA danmaku plugin supporting Niconico (XML / V1 JSON), Bilibili (XML), and **Dandanplay network danmaku** with dual CSS and Canvas rendering modes. This is a niconico-style danmaku plugin — Bilibili and other Chinese formats have limited support and are rendered in niconico style.

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
│   ├── index.html
│   ├── index.css
│   └── index.js
└── .github/workflows/        # Release packaging
    └── release.yml
```

## Dual Rendering Architecture

### CSS Mode (niconicomments CSSRenderer)

When `mode: "css"` is passed to NiconiComments, a `CSSRenderer` is created instead of using canvas drawing. The CSSRenderer:

- Creates a 16:9 aspect ratio container (`[data-dm-css-container]`) centered in the viewport
- Uses `--dm-unit` CSS custom property (`min(100vh, 56.25vw) / 1080`) for responsive coordinate mapping
- Renders each danmaku as a `div[data-dm-comment]` with `will-change: transform, opacity; contain: layout style`
- Scroll danmaku: Web Animations API `translateX()` animation, matching `getPosX()` formula
- Fixed danmaku (ue/shita): CSS `@keyframes dm-fade` animation
- Stroke: `-webkit-text-stroke` + `paint-order: stroke fill`
- Object pool (max 512 elements) for DOM reuse
- Pause/resume via Web Animations API `pause()`/`play()`
- Tracks reverse state per danmaku, reanimates when `@reverse` activates/deactivates

### Canvas Mode (niconicomments original)

Based on the original niconicomments library. Supports Auto mode only (HTML5 and Flash modes have been removed). Not recommended to modify Canvas mode internals.

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

### Render Mode Toggle

| Setting | Mode |
|---------|------|
| **OFF** (default) | CSS Auto (`'css'`) |
| **ON** | Canvas Auto (`'default'`) |

HTML5 and Flash modes have been removed.

### DDP Comment Conversion

DDP `p` format: `time,mode,color,userId` → converted to nico-like internal format with `_dateSec: 1767196800` (2026-01-01) for correct Canvas Auto HTML5 detection.

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

**Important**: overlay and sidebar do **NOT** communicate directly — all traffic goes through `main.js`.

**Sidebar lazy loading**: IINA sidebar tabs are lazy — the sidebar WebView doesn't exist until the user opens it. Therefore, sidebar uses a **pull pattern** for state sync:
1. After loading, sidebar sends `request-state` proactively
2. `main.js` pushes the full current state in the `request-state` callback
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

- **Communication encoding**: Danmaku XML/JSON content is encoded with `encodeURIComponent()` (via the `encodeContent` function) in `main.js` before sending to overlay, then decoded with `decodeURIComponent()` on the overlay side. Do not change this encoding protocol unless replacing it entirely (both ends must stay in sync).

### CSS Mode (niconicomments) Render Flow

1. `time-update` fires → `canvasRenderLoop` calls `niconiComments.drawCanvas(vpos)`
2. `drawCanvas` with `cssRenderer` calls `cssRenderer.updateComments(timeline, vpos, frameActiveState)`
3. `updateComments` diffs visible comments vs `activeElements`, creates/recycles DOM elements
4. CSS animations drive movement; Web Animations API handles pause/resume
5. When video pauses, `pauseCSS()` pauses all active animations; `resumeCSS()` resumes them

### Canvas Mode

Based on the `niconicomments` third-party library. All formats (Niconico XML, Bilibili XML, DDP converted) are normalized via `buildFormattedCanvasData()` in `overlay/main.js` before being passed to NiconiComments. Not recommended to modify Canvas mode internals.

## Coding Conventions

- **Variable declarations**: `var` (main.js/sidebar) and `let` (overlay) are both used. Prefer `let` in new code.
- **Naming**: camelCase. Private/run-time fields prefix with `_` (e.g., `_layer`, `_commands`)
- **Communication**: `iina.postMessage(key, value)` / `iina.onMessage(key, callback)` is the standard pattern. Keep naming consistent.
- **Danmaku toggle**: Use the shared `toggleDanmaku()` or `ensureDanmakuEnabled()` functions. Do not manually repeat `preferences.set` + `overlay.postMessage` logic.
- **Network requests**: Use `iina.http` module. DDP API uses `X-AppId`/`X-AppSecret` header auth.
- **Backtick sanitization**: Always sanitize strings with U+0060 backtick before `sidebar.postMessage`.
- **Preferences sync**: Use `syncPreferencesSoon()` (debounced) instead of calling `preferences.sync()` directly.

### Logging Conventions

- **No verbose debug logging in production code.** Only log errors and one-time initialization messages.
- **Never** use `console.log` in high-frequency callbacks (especially `time-update` / `canvasRenderLoop`).
- Error logs in `catch` blocks are acceptable (e.g., `console.log('[ddp] saveVideoCache error: ' + e)`).
- The sidebar relays its debug output via `iina.postMessage("sidebar-log", ...)` to `main.js`, gated by a `DEBUG_LOG` flag (default `false`).
- When debugging is needed, temporarily add logs and remove them before committing — do not leave trace-level logging in shipped code.

## Known Limitations

- `canvas.width = 1920; canvas.height = 1080` is hardcoded and does not adapt to window aspect ratio
- Filenames containing `[` or `]` may cause auto-load to fail (regex matching in `extractEpisodeNumber`)
- Canvas mode does not support CSS-mode-specific settings (font scale, scroll duration, blocking, lane limits)
- CSS mode (niconicomments) Comment Art vertical positioning may differ slightly from Canvas mode
- DDP cache only stores the last loaded episode per video (hash overwrite)
- Backtick U+0060 in any sidebar message field causes IINA IPC to silently drop the entire message

## Avoid

- Do not introduce any build tools or npm packaging
- Do not modify files under `overlay/lib/` (third-party libraries)
- Do not create a direct communication channel between overlay and sidebar
- Do not change the `<script>` loading order in the overlay HTML
- Do not use `console.log` for high-frequency output in production code (especially in `time-update` callbacks)
- Do not send `JSON.stringify` payloads to `sidebar.postMessage` — always send plain objects

## Related Repository

- **niconicomments (forked)**: https://github.com/karappo-yu/niconicomments — The fork adds `CSSRenderer` (`src/renderer/css.ts`) and `mode: "css"` support. Changes are on the `develop` branch.
