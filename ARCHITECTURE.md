# Canonical danmaku boundaries

The plugin caches `DanmakuDocument` objects, never source text or IPC-encoded strings. Local files, network comment responses and old DDP disk caches enter through `parseDanmakuSource()` in `danmaku-document.js`. Document source fields and command arrays are immutable; `simplifiedText` is the only writable memo. Native dates, premium status and owner commands are retained for engine compatibility.

`projectDanmaku()` applies date selection, density quotas, memoized conversion and blocking, then builds shared static dedupe groups. Owners/easy/undated comments survive date slicing; owners/easy and comments with at least three nicoru do not consume density quotas. A window with incomplete ordering signals uses evenly spaced sampling. The cached projection supplies screen comments, sidebar rows and statistics. Dedupe uses an inclusive window from the earliest member and groups by text, position and blocked state; owners are excluded. Both scrolling and fixed comments use that static policy. Native fixed progressive combo is disabled for projected data.

`postSafeMessage()` alone serializes data for WebViews. Payloads containing template syntax, backslashes or curly quotes use a URI-encoded JSON envelope; both WebViews decode it in `onPluginMessage()`. Paths and text remain literal in business code. Overlay accepts formatted arrays and performs no source parsing. List chunks use the same envelope.

`pluginState` owns settings and session metadata. `commitState()` writes changed preferences through the existing debounce and sends incremental notifications. Sidebar requests one initial snapshot after registering handlers, then sends user intents. Documents, cached projections and native callback handles are runtime resources outside the settings snapshot.

OpenCC is loaded with package-local `require` while the main entry script is executing. IINA's native resolver depends on that script stack, so asynchronous callbacks only construct/use the converter. The bundle loads once and converter construction remains lazy; no WebView path reports or eval are used.

The overlay clock stores pure video time. Offset is applied only at drawing. Enabling and loading carry `{enabled, time, paused, speed}` atomically; pause/speed changes reanchor pure video time. Seek detection compares actual movement with elapsed wall time at the current playback rate. Only `overlay-ready` completes initialization. A pending load slot always points to the latest selected source/settings.

The forked engine owns `scrollSpeed`, including CSS transitions, Canvas displacement, derived visibility ranges and collision sampling. `setScrollSpeed()` retains parsed comment instances, native `long`/`@N`, measured glyphs and existing CSS nodes. Runtime changes recalculate the timeline and lanes under the new speed; positions reflect the new motion model. This is not constant-time, and no order-of-magnitude performance claim is made. The plugin does not inject duration commands or rebuild the renderer when only speed changes.

DDP writes are serialized and failures do not poison the queue. A versioned cache stores canonical comments; old cache rows are normalized on read. Independent request generations reject obsolete matching, searches and bangumi responses.

## Engine provenance and validation

The bundled `overlay/lib/niconicomments.min.js` is generated from the sibling `niconicomments-dom` repository, commit `4fbbf42`, on `codex/canonical-danmaku-ir`. Use the fork's existing `rolldown -c rolldown.config.mjs` build and copy `dist/bundle.js`; do not hand-edit the vendored file.

- Plugin: `node --test test/*.test.js` and syntax checks for all entry/module files.
- Engine: TypeScript check, `vitest run`, and `playwright test -c playwright.motion.config.ts` (WebKit).
- The WebKit motion test verifies DOM/instance reuse, paused state, bottom alignment, colored suffixes and the shared horizontal motion formula.
- An additional local WebKit smoke run loaded the plugin's actual overlay and sidebar HTML, exercised mixed Flash/HTML5 comments and literal template characters, and confirmed snapshot/settings traffic without page errors.

The plugin still has no build step or runtime package manager. Release packaging includes `danmaku-document.js` and omits the retired `overlay/input.js`.
