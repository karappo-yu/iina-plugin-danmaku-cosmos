# Danmaku Cosmos — Project Guide

## Overview

An IINA danmaku plugin supporting Niconico (XML / V1 JSON), Bilibili (XML), and **Dandanplay network danmaku** with dual CSS and Canvas rendering modes. This is a niconico-style danmaku plugin — Bilibili and other Chinese formats have limited support and are rendered in niconico style.

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
├── preferences.html          # IINA preference page (CSS font family/weight/stroke)
├── overlay/                  # Danmaku render layer (WebView container)
│   ├── index.html            # Entry point
│   ├── index.css             # Render styles & animation definitions
│   ├── main.js               # Engine entry: message handling, render mode, state mgmt
│   ├── renderer.js           # CSS mode (plugin's own): DOM creation, object pool, danmaku layout
│   ├── lane.js               # Lane allocation & management (multi-level offset collision)
│   ├── config.js             # Global constants (colors, fonts, size maps)
│   ├── command.js            # mail/commands parser
│   ├── flash.js              # Flash danmaku text preprocessing (ruby super/sub)
│   ├── nicoscript.js         # Nicoscript parser (@reverse/@speed/@default/@ban/@jump/@replace)
│   ├── input.js              # Three-format danmaku data parser
│   ├── ca-score.js           # Comment Art scoring & layer separation
│   └── lib/                  # Third-party libs (read-only, do not modify)
│       ├── niconicomments.min.js  # Forked niconicomments with CSSRenderer
│       ├── niconicomments-plugin-niwango.min.js
│       └── niwango.min.js
├── sidebar/                  # IINA sidebar control panel
│   ├── index.html
│   ├── index.css
│   └── index.js
└── .github/workflows/       # Release packaging
```

## Unified Rendering Architecture

All danmaku formats (Niconico XML, Niconico V1 JSON, Bilibili XML, DDP converted) are rendered through the **niconicomments** library. The plugin does not have its own CSS renderer for nico formats — the CSS renderer is integrated into the forked niconicomments library. For non-nico formats (XML, Bilibili, DDP), the plugin's own renderer (`renderer.js` + `lane.js`) is used.

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
- Supports both HTML5 and Flash danmaku (auto-detection like default mode)
- Tracks reverse state per danmaku, reanimates when `@reverse` activates/deactivates

### Canvas Mode (niconicomments original)

Based on the original niconicomments library. Supports Auto / HTML5 / Flash modes. Not recommended to modify Canvas mode internals.

### CSS Mode (plugin's own renderer.js)

The plugin has its own CSS rendering system (`renderer.js`, `lane.js`) for non-Niconico V1 JSON formats (Niconico XML, Bilibili XML, DDP converted format). Uses object pool pattern with CSS animations.

## Dandanplay Network Danmaku

### Auto-Match Flow

1. **Hash exact match** (`/api/v2/match`) → `isMatched=true` → auto-load
2. **Filename fuzzy match** → `isMatched=false` → show candidate list in sidebar
3. **Manual search** → user searches by anime name → selects episode

### Cache

- Single hash-keyed cache file per video: `@data/danmaku-cache/{pathHash}.json`
- Contains `{episodeId, animeTitle, episodeTitle, cachedAt, comments}` (converted nico format)
- 24h TTL; each new DDP load overwrites previous cache for same video path

### Priority (auto-network toggle)

| Setting | Behavior |
|---------|----------|
| **ON** (`dandanplayAutoNetwork=true`) | Network-first: auto-load DDP cache/network, background auto-match |
| **OFF** (`dandanplayAutoNetwork=false`) | Local-first: load local files, DDP cache shown in list but not auto-loaded |

### Render Mode Toggle

OFF (default) = CSS Auto, ON = Canvas Auto. HTML5/Flash modes removed.

### DDP Comment Conversion

DDP `p` format: `time,mode,color,userId` → nico-like format with `_dateSec: 1767196800` (2026-01-01) for correct Canvas Auto HTML5 detection.

### API Credentials

Hardcoded in `main.js:25-26`. No user configuration needed.

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

**Backtick sanitization**: U+0060 backtick in any string causes IINA IPC to silently drop `sidebar.postMessage` messages. Always sanitize with `.replace(/[`\u2018\u2019]/g, "'")`.

**sidebar.postMessage must receive plain objects**, not `JSON.stringify()` strings.

### Overlay Script Load Order (Immutable)

```
niconicomments.min.js → niconicomments-plugin-niwango.min.js → niwango.min.js
→ config.js → command.js → flash.js → nicoscript.js → lane.js → renderer.js → input.js → ca-score.js → main.js
```

Later scripts depend on functions mounted on `window` by earlier scripts (e.g., `parseMailCommands`, `window.setRendererConfig`, `window.getFreeScrollLane`). Do not reorder the `<script>` tags.

### Data Format

- **Danmaku data object** field conventions (created in `input.js`):
  - `t` — vpos time (1/100 sec)
  - `m` — mode (1-7)
  - `c` — color hex
  - `text` — display text
  - `size` — font size
  - `_isOwner` — whether posted by the video owner
  - `_isFlash` — whether it's a Flash danmaku
  - `_layer` — CA layer ID (-1 = default layer)
  - `_lane` / `_offsetLevel` / `_forced` — lane allocation results (assigned at runtime)
  - `font` / `invisible` / `live` / `full` / `ender` / `patissier` / `durationSec` etc.

- **Communication encoding**: Danmaku content is encoded with `encodeURIComponent()` in `main.js` before sending to overlay, then decoded with `decodeURIComponent()` on the overlay side. Do not change this encoding protocol without updating both ends.

### Render Flow

1. `time-update` fires → `canvasRenderLoop` calls `niconiComments.drawCanvas(vpos)`
2. **CSS mode**: `drawCanvas` with `cssRenderer` calls `cssRenderer.updateComments(timeline, vpos, frameActiveState)` — diffs visible comments vs active elements, creates/recycles DOM
3. **Canvas mode**: `drawCanvas` renders directly to `<canvas>`

For plugin's own CSS renderer (non-nico formats):
- `time-update` → `main.js` scans `allDanmaku` for entries ≤ current time
- `createDanmaku()` from object pool → lane allocation → CSS animation
- `animationend` → element returns to pool

### Danmaku File Auto-Loading

1. Same-name JSON → 2. Same-name XML → 3. Danmaku folder/same-name → 4. Danmaku folder/episode number

DDP cache entries (type `DDP`) are added to file list separately and never discovered as local files.

### Format Detection

`detectDanmakuType()` in `main.js` inspects file content to determine format:
- Niconico V1 JSON: `{ "thread": ... }` structure
- Niconico XML: `<packet>` root element
- Bilibili XML: `<d p="...">` elements
- Unknown: falls back to Bilibili XML parsing

## Coding Conventions

- **Variable declarations**: `var` (main.js/sidebar) and `let` (overlay) are both used. Prefer `let` in new code.
- **Naming**: camelCase. Private/run-time fields prefix with `_` (e.g., `_layer`, `_lane`)
- **DOM operations**: Danmaku DOM elements **must** be obtained from the object pool (`getDanmakuElement()`) and returned via `recycleDanmakuElement()`. Do NOT use `createElement` / `removeChild` directly.
- **Communication**: `iina.postMessage(key, value)` / `iina.onMessage(key, callback)` is the standard pattern. Keep naming consistent.
- **Danmaku toggle**: Use `toggleDanmaku()` or `ensureDanmakuEnabled()`. Do not manually repeat `preferences.set` + `overlay.postMessage` logic.
- **Network requests**: Use `iina.http` module. DDP API uses `X-AppId`/`X-AppSecret` header auth (hardcoded, no user config).
- **File system**: Use `iina.file` module. Paths use `@data/` prefix for plugin data directory.
- **Backtick sanitization**: Always sanitize strings with U+0060 backtick before `sidebar.postMessage`.

## Known Limitations

- `canvas.width = 1920; canvas.height = 1080` is hardcoded and does not adapt to window aspect ratio
- Filenames containing `[` or `]` may cause auto-load to fail
- Restoring from window minimize triggers a full `handleSeek` re-render
- Canvas mode does not support CSS-mode-specific settings (font scale, scroll duration, blocking, lane limits)
- CSS mode Comment Art vertical positioning may differ slightly from Canvas mode
- `preferences.sync()` is called on every change with no debounce
- Bilibili advanced danmaku (mode 7), scripting (mode 8), and BAS (mode 9) are not supported
- DDP cache only stores the last loaded episode per video (hash overwrite)
- Backtick U+0060 in sidebar messages causes IINA IPC to silently drop the entire message

## Avoid

- ❌ Do not introduce any build tools or npm packaging
- ❌ Do not modify files under `overlay/lib/` (third-party libraries)
- ❌ Do not create a direct communication channel between overlay and sidebar
- ❌ Do not change the `<script>` loading order in the overlay HTML
- ❌ Do not use `console.log` for high-frequency output in production code (especially in `time-update` callbacks)
- ❌ Do not create or remove danmaku DOM elements directly — always use the object pool
- ❌ Do not send `JSON.stringify` payloads to `sidebar.postMessage` — always send plain objects

## Related Repository

- **niconicomments (forked)**: https://github.com/karappo-yu/niconicomments — The fork adds `CSSRenderer` (`src/renderer/css.ts`) and `mode: "css"` support. Changes are on the `develop` branch.
