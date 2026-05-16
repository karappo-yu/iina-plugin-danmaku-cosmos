# Danmaku Cosmos — Project Guide

## Overview

An IINA danmaku plugin supporting Niconico (XML / V1 JSON) and Bilibili (XML) formats with dual CSS and Canvas rendering modes.

## Tech Constraints

- **IINA plugin environment**: No build tools, bundlers, or npm package managers
- **Rendering engine**: IINA uses Safari (WebKit) internally
- **Language**: Plain vanilla JavaScript (ES5/ES6 mixed), no TypeScript
- **Modularity**: Overlay files are loaded via `<script>` tags in order, sharing global functions and variables through the `window` object. `main.js` (plugin entry) and `sidebar/` run in separate contexts.

## Project Structure

```
Danmaku Cosmos/
├── Info.json                 # Plugin metadata & preference defaults
├── main.js                   # Plugin entry: IINA API, file loading, message relay
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
- Supports both HTML5 and Flash danmaku (auto-detection like default mode)
- Tracks reverse state per danmaku, reanimates when `@reverse` activates/deactivates

### Canvas Mode (niconicomments original)

Based on the original niconicomments library. Supports Auto / HTML5 / Flash modes. Not recommended to modify Canvas mode internals.

### CSS Mode (plugin's own renderer.js)

The plugin also has its own CSS rendering system (`renderer.js`, `lane.js`, etc.) for non-Niconico V1 JSON formats (Niconico XML, Bilibili XML). This is separate from the niconicomments CSSRenderer.

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

- **Communication encoding**: Danmaku XML/JSON content is encoded with `encodeURIComponent()` (via the `encodeContent` function) in `main.js` before sending to overlay, then decoded with `decodeURIComponent()` on the overlay side. Do not change this encoding protocol unless replacing it entirely (both ends must stay in sync).

### CSS Mode (niconicomments) Render Flow

1. `time-update` fires → `canvasRenderLoop` calls `niconiComments.drawCanvas(vpos)`
2. `drawCanvas` with `cssRenderer` calls `cssRenderer.updateComments(timeline, vpos, frameActiveState)`
3. `updateComments` diffs visible comments vs `activeElements`, creates/recycles DOM elements
4. CSS animations drive movement; Web Animations API handles pause/resume
5. When video pauses, `pauseCSS()` pauses all active animations; `resumeCSS()` resumes them

### CSS Mode (plugin's own) Render Flow

1. `time-update` fires on each time change → `main.js` scans `allDanmaku` for entries ≤ current time
2. `createDanmaku()` gets a DOM element from the object pool (`danmakuPool`), applies styles
3. Lane allocation (`lane.js`): tries Level 0 first, then Level 1/2, falls back to forced
4. CSS animations drive movement; `animationend` event triggers element return to the pool

### Canvas Mode

Based on the `niconicomments` third-party library. Only available for Niconico V1 JSON format. Not recommended to modify Canvas mode internals.

## Coding Conventions

- **Variable declarations**: `var` (main.js/sidebar) and `let` (overlay) are both used. Prefer `let` in new code.
- **Naming**: camelCase. Private/run-time fields prefix with `_` (e.g., `_layer`, `_lane`)
- **DOM operations**: Danmaku DOM elements **must** be obtained from the object pool (`getDanmakuElement()`) and returned via `recycleDanmakuElement()`. Do NOT use `createElement` / `removeChild` directly.
- **Communication**: `iina.postMessage(key, value)` / `iina.onMessage(key, callback)` is the standard pattern. Keep naming consistent.
- **Danmaku toggle**: Use the shared `toggleDanmaku()` or `ensureDanmakuEnabled()` functions. Do not manually repeat `preferences.set` + `overlay.postMessage` logic.

## Known Limitations

- `canvas.width = 1920; canvas.height = 1080` is hardcoded and does not adapt to window aspect ratio
- Filenames containing `[` or `]` may cause auto-load to fail (regex matching in `extractEpisodeNumber`)
- Restoring from window minimize triggers a full `handleSeek` re-render
- Canvas mode does not support CSS-mode-specific settings (font scale, scroll duration, blocking, lane limits)
- CSS mode (niconicomments) Comment Art vertical positioning may differ slightly from Canvas mode
- `preferences.sync()` is called on every change with no debounce

## Avoid

- ❌ Do not introduce any build tools or npm packaging
- ❌ Do not modify files under `overlay/lib/` (third-party libraries)
- ❌ Do not create a direct communication channel between overlay and sidebar
- ❌ Do not change the `<script>` loading order in the overlay HTML
- ❌ Do not use `console.log` for high-frequency output in production code (especially in `time-update` callbacks)
- ❌ Do not create or remove danmaku DOM elements directly — always use the object pool

## Related Repository

- **niconicomments (forked)**: https://github.com/karappo-yu/niconicomments — The fork adds `CSSRenderer` (`src/renderer/css.ts`) and `mode: "css"` support. Changes are on the `develop` branch.
