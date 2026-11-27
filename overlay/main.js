function onPluginMessage(name, callback) {
  iina.onMessage(name, function (data) {
    if (data && typeof data.__encoded === 'string') {
      data = JSON.parse(decodeURIComponent(data.__encoded));
    }
    callback(data);
  });
}

let lastTime = null;
let lastTimeUpdateAt = 0;
let currentLoadId = 0;
// Loads and clears share main's monotonic ID, so delayed IPC cannot restore
// an earlier source or clear a newer renderer after a video switch.
let latestMessageId = 0;
let isPaused = false;

let canvasOpacity = 0.8;
let canvasFontScale = 1.0;
let canvasNicoMode = 'css';
let strokeColor = '#000000';
let strokeInversionColor = '#ffffff';
let strokeOpacity = 1;
let strokeWidth = 0;
let cssTextShadowBlur = 2;
let commentLimit = 0;
let scrollSpeed = 1.0;
// Projection leaves fixed comments unmerged; the engine grows their counts
// and extends overlapping display windows progressively.
let fixedComboEnabled = false;
let danmakuTimeOffsetSec = 0;
let danmakuFontFamily = "";
let danmakuFontWeight = "";

let niconiComments = null;
let domEmojiRenderer = null;
let formattedComments = null;
let formattedFileType = null;
let canvasRafId = null;
let canvasLoopGeneration = 0;
let canvasForceDrawPending = false;
let canvasClearPending = false;
let latestTimeUpdateId = 0;
let loadSuccessFrame = null;
let loadSuccessGeneration = 0;
let canvasRebuildTimer = null;
let canvasRebuildPending = false;
let canvasVideoAnchorTime = 0;
let canvasSystemAnchorTime = 0;
let canvasIsPlaying = false;
let playbackSpeed = 1.0;
let danmakuVisible = true;
let videoAspectRatio = 0;
let videoFullscreen = false;
let canvasViewportFrame = null;

let emojiPresentationPattern = null;
let emojiGraphemeSegmenter = null;
try {
  emojiPresentationPattern = new RegExp('\\p{Emoji_Presentation}|\\p{Extended_Pictographic}\\uFE0F|[0-9#*]\\uFE0F?\\u20E3', 'u');
  if (typeof Intl.Segmenter === 'function') {
    emojiGraphemeSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  }
} catch (_) { /* Older WebKit keeps the ordinary text path. */ }

function getRepeatedEmoji(text) {
  if (!emojiPresentationPattern || text.length < 8 || !emojiPresentationPattern.test(text)) return null;
  const first = emojiGraphemeSegmenter
    ? emojiGraphemeSegmenter.segment(text)[Symbol.iterator]().next().value.segment
    : Array.from(text)[0];
  if (!first || first.includes('\uFE0E') || !emojiPresentationPattern.test(first)) return null;
  const count = text.length / first.length;
  if (count < 8 || !Number.isInteger(count) || first.repeat(count) !== text) return null;
  return { glyph: first, count: count };
}

// Long runs of color emoji are expensive to rasterize in every composited DOM
// layer. Share a small glyph tile; the original text still determines layout,
// and the engine keeps ownership of positioning, animation and element reuse.
function createDomEmojiRenderer(container) {
  if (!container || !emojiPresentationPattern || typeof MutationObserver === 'undefined') return null;
  const tiles = new Map();
  const density = Math.min(2, Math.max(1, window.devicePixelRatio || 1));

  function getTile(glyph, style) {
    const fontSize = parseFloat(style.fontSize);
    const lineHeight = parseFloat(style.lineHeight) / fontSize;
    if (!(fontSize > 0) || !isFinite(lineHeight) || lineHeight <= 0) return null;
    const rasterFontSize = Math.max(100, Math.min(256, fontSize));
    const ratio = rasterFontSize / fontSize;
    const strokeWidth = parseFloat(style.webkitTextStrokeWidth) || 0;
    const shadow = style.textShadow.match(/(-?[\d.]+)px\s+(-?[\d.]+)px\s+([\d.]+)px/);
    const shadowOffsetY = shadow ? Number(shadow[2]) : 0;
    const shadowBlur = shadow ? Number(shadow[3]) : 0;
    const rawPadY = Math.ceil(strokeWidth * ratio + (shadow ? (Math.abs(shadowOffsetY) + shadowBlur) * ratio : 0));
    const maxPadY = Math.max(0, Math.floor((1024 / density - lineHeight * rasterFontSize) / 2));
    const padY = Math.min(rawPadY, maxPadY);
    const key = JSON.stringify([glyph, style.fontFamily, style.fontWeight, rasterFontSize,
      lineHeight, style.color, strokeWidth * ratio, style.webkitTextStrokeColor,
      shadow ? shadow.slice(1).map(function (n) { return Number(n) * ratio; }) : null, padY]);
    if (tiles.has(key)) return tiles.get(key);

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const font = style.fontWeight + ' ' + rasterFontSize + 'px ' + style.fontFamily;
    ctx.font = font;
    const width = Math.ceil(ctx.measureText(glyph).width * density);
    const height = Math.ceil((lineHeight * rasterFontSize + padY * 2) * density);
    if (width <= 0 || height <= 0 || width > 1024 || height > 1024) return null;
    canvas.width = width;
    canvas.height = height;
    ctx.scale(density, density);
    ctx.font = font;
    const metrics = ctx.measureText('Ag');
    const ascent = metrics.fontBoundingBoxAscent === undefined ? rasterFontSize * 0.9 : metrics.fontBoundingBoxAscent;
    const descent = metrics.fontBoundingBoxDescent === undefined ? rasterFontSize * 0.1 : metrics.fontBoundingBoxDescent;
    const baseline = padY + (lineHeight * rasterFontSize - ascent - descent) / 2 + ascent;
    ctx.fillStyle = style.color;
    ctx.strokeStyle = style.webkitTextStrokeColor;
    ctx.lineWidth = strokeWidth * ratio;
    if (shadow) {
      ctx.shadowColor = style.webkitTextStrokeColor;
      ctx.shadowOffsetX = Number(shadow[1]) * ratio * density;
      ctx.shadowOffsetY = Number(shadow[2]) * ratio * density;
      ctx.shadowBlur = Number(shadow[3]) * ratio * density;
    }
    if (strokeWidth > 0) ctx.strokeText(glyph, 0, baseline);
    ctx.fillText(glyph, 0, baseline);
    const padEm = padY / rasterFontSize;
    const tile = {
      image: 'url("' + canvas.toDataURL() + '")',
      padEm: padEm,
      tileHeightEm: lineHeight + padEm * 2,
    };
    canvas.width = canvas.height = 0;
    if (tiles.size >= 32) tiles.delete(tiles.keys().next().value);
    tiles.set(key, tile);
    return tile;
  }

  const observer = new MutationObserver(function (records) {
    const pending = new Set();
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node.nodeType === 3) {
          pending.add(node);
        } else if (node.nodeType === 1 && container.contains(node) &&
            !hasEmojiRepeatAncestor(node, container)) {
          const walker = document.createTreeWalker(node, 4);
          let text;
          while ((text = walker.nextNode())) pending.add(text);
        }
      }
    }
    for (const node of pending) {
      const parent = node.parentElement;
      const repeated = getRepeatedEmoji(node.textContent);
      // Most CA runs are not repeated emoji. Reject them before walking their
      // ancestors; WebKit's selector matching can serialize pending styles.
      if (!repeated || !parent || !container.contains(parent) ||
          !isDanmakuEmojiText(parent, container)) continue;
      const tile = getTile(repeated.glyph, getComputedStyle(parent));
      if (!tile) continue;
      const span = document.createElement('span');
      span.setAttribute('data-dm-emoji-repeat', '');
      span.textContent = node.textContent;
      span.style.backgroundImage = tile.image;
      // Match the original run's actual advance, including WebKit rounding.
      span.style.backgroundSize = (100 / repeated.count) + '% ' + tile.tileHeightEm + 'em';
      if (tile.padEm > 0) {
        const padCss = tile.padEm + 'em';
        const negPadCss = '-' + padCss;
        span.style.paddingTop = padCss;
        span.style.paddingBottom = padCss;
        span.style.marginTop = negPadCss;
        span.style.marginBottom = negPadCss;
      }
      parent.replaceChild(span, node);
    }
  });
  observer.observe(container, { childList: true, subtree: true });
  return { destroy: function () { observer.disconnect(); tiles.clear(); } };
}

function hasEmojiRepeatAncestor(element, container) {
  for (let current = element; current && current !== container; current = current.parentElement) {
    if (current.hasAttribute('data-dm-emoji-repeat')) return true;
  }
  return false;
}

function isDanmakuEmojiText(element, container) {
  for (let current = element; current && current !== container; current = current.parentElement) {
    if (current.hasAttribute('data-dm-emoji-repeat')) return false;
    if (current.hasAttribute('data-dm-comment')) return true;
  }
  return false;
}

function syncVideoAnchor(videoTimeSec) {
  canvasVideoAnchorTime = videoTimeSec;
  canvasSystemAnchorTime = performance.now();
  lastTime = videoTimeSec * 100;
  lastTimeUpdateAt = canvasSystemAnchorTime;
}

function getVideoTimeSec() {
  const baseTime = !canvasIsPlaying ? canvasVideoAnchorTime : canvasVideoAnchorTime + ((performance.now() - canvasSystemAnchorTime) / 1000) * playbackSpeed;
  return baseTime;
}

const canvasEventHandlers = {
  seekDisable: () => iina.postMessage("seek-disable", {}),
  seekEnable: () => iina.postMessage("seek-enable", {}),
  jump: (e) => {
    if (e.targetVpos !== null && e.targetVpos !== undefined) {
      iina.postMessage("jump", { targetSec: e.targetVpos / 100, message: e.message });
    } else if (e.to) {
      iina.postMessage("jump-video", { videoId: e.to, message: e.message });
    }
  }
};

function bindCanvasEvents(instance) {
  instance.addEventListener("seekDisable", canvasEventHandlers.seekDisable);
  instance.addEventListener("seekEnable", canvasEventHandlers.seekEnable);
  instance.addEventListener("jump", canvasEventHandlers.jump);
}

function unbindCanvasEvents(instance) {
  if (!instance || typeof instance.removeEventListener !== 'function') return;
  instance.removeEventListener("seekDisable", canvasEventHandlers.seekDisable);
  instance.removeEventListener("seekEnable", canvasEventHandlers.seekEnable);
  instance.removeEventListener("jump", canvasEventHandlers.jump);
}

function disposeCanvasRenderer() {
  cancelPendingCanvasDraw();
  cancelLoadSuccess();
  const emojiRenderer = domEmojiRenderer;
  const renderer = niconiComments;
  domEmojiRenderer = null;
  niconiComments = null;
  function cleanup(name, action) {
    try { action(); }
    catch (error) { console.log('[overlay] ' + name + ' failed: ' + error); }
  }
  if (emojiRenderer) cleanup('emoji destroy', () => emojiRenderer.destroy());
  if (renderer) {
    cleanup('unbind', () => unbindCanvasEvents(renderer));
    cleanup('renderer clear', () => renderer.clear());
    cleanup('renderer destroy', () => renderer.destroy());
  }
  cleanup('CSS removal', () => {
    const cssContainer = document.querySelector('[data-dm-css-container]');
    if (cssContainer) cssContainer.remove();
  });
  cleanup('canvas reset', () => {
    const canvas = document.getElementById('niconicomments-canvas');
    if (!canvas) return;
    // Reset the backing store independently of engine.clear(), including
    // mode switches where canvasNicoMode already holds the new mode.
    canvas.width = canvasNicoMode === 'css' ? 1 : canvas.width;
    if (canvasNicoMode === 'css') canvas.height = 1;
  });
}

var DEFAULT_DANMAKU_FONT_STACKS = {
  gothic: { font: '"游ゴシック体", "游ゴシック", "Yu Gothic", YuGothic, yugothic, YuGo-Medium, "Hiragino Sans", HiraginoSans', offset: -0.04 },
  mincho: { font: '"游明朝体", "游明朝", "Yu Mincho", YuMincho, yumincho, YuMin-Medium, "Hiragino Mincho ProN", HiraMinProN, "Hiragino Mincho ProN W3", HiraMinProN-W3', offset: -0.01 },
  defont: { font: '"Hiragino Sans", "ヒラギノ角ゴシック", HiraginoSans', offset: -0.05 },
};

function buildDanmakuFontConfig() {
  var weight = danmakuFontWeight ? parseInt(danmakuFontWeight, 10) : 500;
  if (isNaN(weight) || weight < 100 || weight > 900) weight = 500;
  var mk = function (type) {
    var def = DEFAULT_DANMAKU_FONT_STACKS[type];
    return {
      font: danmakuFontFamily || def.font,
      offset: danmakuFontFamily ? 0 : def.offset,
      weight: weight,
    };
  };
  return {
    flash: {
      gulim: 'normal 600 [size]px gulim, ' + (danmakuFontFamily || DEFAULT_DANMAKU_FONT_STACKS.gothic.font) + ', Arial',
      simsun: 'normal 400 [size]px simsun, batang, "PMingLiU", MingLiU-ExtB, ' + (danmakuFontFamily || DEFAULT_DANMAKU_FONT_STACKS.mincho.font) + ', Arial',
    },
    html5: {
      gothic: mk('gothic'),
      mincho: mk('mincho'),
      defont: mk('defont'),
    },
  };
}

function reportCanvasError(error) {
  console.log('[overlay] renderer failed: ' + error);
  stopCanvasLoop();
  disposeCanvasRenderer();
  iina.postMessage("danmaku-load-result", { loadId: currentLoadId, success: false });
}

function cancelLoadSuccess() {
  loadSuccessGeneration += 1;
  if (loadSuccessFrame !== null) cancelAnimationFrame(loadSuccessFrame);
  loadSuccessFrame = null;
}

function notifyLoadSuccess() {
  cancelLoadSuccess();
  const loadId = currentLoadId;
  const renderer = niconiComments;
  const generation = loadSuccessGeneration;
  if (!renderer) return;
  const isCurrent = () => generation === loadSuccessGeneration &&
    loadId === currentLoadId && renderer === niconiComments;
  // Two frame callbacks give WebKit rendering opportunities after the draw.
  // They do not confirm compositor presentation, and work while video is paused.
  loadSuccessFrame = requestAnimationFrame(() => {
    if (!isCurrent()) return;
    loadSuccessFrame = requestAnimationFrame(() => {
      if (!isCurrent()) return;
      loadSuccessFrame = null;
      iina.postMessage("danmaku-load-result", {loadId, success: true});
    });
  });
}

// Main keeps the native view transparent while enabling until this frame
// acknowledgment, mirroring the two-callback bound used by load success.
let revealAckFrame = null;

function cancelRevealAck() {
  if (revealAckFrame !== null) cancelAnimationFrame(revealAckFrame);
  revealAckFrame = null;
}

function acknowledgeReveal(revealId) {
  cancelRevealAck();
  revealAckFrame = requestAnimationFrame(() => {
    revealAckFrame = requestAnimationFrame(() => {
      revealAckFrame = null;
      iina.postMessage("danmaku-reveal-ready", {revealId});
    });
  });
}

function scheduleCanvasRebuild() {
  cancelLoadSuccess();
  canvasRebuildPending = true;
  if (canvasRebuildTimer !== null) clearTimeout(canvasRebuildTimer);
  if (!danmakuVisible) { canvasRebuildTimer = null; return; }
  canvasRebuildTimer = setTimeout(function () {
    canvasRebuildTimer = null;
    if (formattedComments && danmakuVisible) {
      try {
        initCanvasRenderer(formattedComments);
        startCanvasLoop();
      } catch (error) { reportCanvasError(error); }
    }
  }, 80);
}

function updateCanvasViewport() {
  const viewport = document.getElementById('danmaku-viewport');
  const canvas = document.getElementById('niconicomments-canvas');
  const width = window.innerWidth;
  const height = window.innerHeight;
  if (!viewport || !canvas || !(width > 0 && height > 0)) return false;
  const aspect = videoAspectRatio > 0 ? videoAspectRatio : width / height;
  const displayHeight = Math.min(height, width / aspect);
  const displayWidth = displayHeight * aspect;
  // Fullscreen scrolls across pillarboxes, while font size and vertical
  // placement still follow the video height. Windowed output fits the video.
  const outputWidth = videoFullscreen ? width : displayWidth;
  const outputAspect = outputWidth / displayHeight;
  viewport.style.left = (width - outputWidth) / 2 + 'px';
  viewport.style.top = (height - displayHeight) / 2 + 'px';
  viewport.style.width = outputWidth + 'px';
  viewport.style.height = displayHeight + 'px';
  // Keep a stable logical height. Changing only the window size then changes
  // the display scale, without rebuilding comments or their collision lanes.
  const sizeScale = Math.min(1, 8192 / (1080 * outputAspect));
  const canvasWidth = Math.max(1, Math.round(1080 * outputAspect * sizeScale));
  const canvasHeight = Math.max(1, Math.round(1080 * sizeScale));
  if (niconiComments) {
    niconiComments.resize(canvasWidth, canvasHeight);
    if (canvasNicoMode === 'css') {
      canvas.width = 1;
      canvas.height = 1;
    }
    return {width: canvasWidth, height: canvasHeight};
  }
  // CSS mode uses a tiny measurement surface in the engine. The hidden DOM
  // canvas stays 1x1; its logical viewport travels separately as viewportSize.
  if (canvasNicoMode === 'css') {
    canvas.width = 1;
    canvas.height = 1;
  } else {
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;
  }
  return {width: canvasWidth, height: canvasHeight};
}

function refreshCanvasViewport() {
  updateCanvasViewport();
  if (niconiComments && danmakuVisible) drawCanvasAtVpos((getVideoTimeSec() + danmakuTimeOffsetSec) * 100, true);
}

if (typeof window.addEventListener === 'function') {
  window.addEventListener('resize', function () {
    if (canvasViewportFrame !== null) return;
    canvasViewportFrame = requestAnimationFrame(function () {
      canvasViewportFrame = null;
      refreshCanvasViewport();
    });
  });
}

// Ordinary Bilibili/DDP rows use a small set of rendering commands. Keep
// owner scripts, CA, legacy formatting and Canvas on their established layout.
function shouldDeferCommentLayout(comments) {
  const minimumDeferred = Math.max(512, Math.ceil(comments.length / 2));
  if (canvasNicoMode !== 'css' || comments.length < minimumDeferred ||
      (formattedFileType !== 'bilibili-xml' && formattedFileType !== 'dandanplay')) return false;

  // The engine looks ahead about 22 s at 1x in the normal viewport. Require
  // a substantial tail beyond 30 s before trading seek work for a faster load.
  const currentVpos = (getVideoTimeSec() + danmakuTimeOffsetSec) * 100;
  const horizon = currentVpos + 3000 / scrollSpeed;
  let deferred = 0;
  const ordinaryCommand = /^(?:naka|ue|shita|small|medium|big|#[0-9a-f]{6})$/i;
  for (const comment of comments) {
    if (!comment || comment.owner || comment.date < 1499871600 ||
        /[\r\n]/.test(comment.content) || !Array.isArray(comment.mail) ||
        comment.mail.some(command => !ordinaryCommand.test(command))) return false;
    if (comment.vpos > horizon) deferred++;
  }
  return deferred >= minimumDeferred;
}

function initCanvasRenderer(data) {
  cancelLoadSuccess();
  if (canvasRebuildTimer !== null) clearTimeout(canvasRebuildTimer);
  canvasRebuildTimer = null;
  formattedComments = data;
  if (!danmakuVisible) { canvasRebuildPending = true; return; }
  canvasRebuildPending = false;
  const canvas = document.getElementById('niconicomments-canvas');
  if (!canvas || typeof NiconiComments === 'undefined') return;
  const useCssMode = canvasNicoMode === 'css';
  canvas.style.opacity = useCssMode ? 0 : canvasOpacity;
  canvas.style.display = '';
  disposeCanvasRenderer();
  const viewportSize = updateCanvasViewport();
  niconiComments = new NiconiComments(canvas, data, {
    format: 'formatted',
    mode: canvasNicoMode,
    lazy: shouldDeferCommentLayout(data),
    viewportSize: useCssMode && viewportSize ? viewportSize : undefined,
    keepCA: true,
    dedupeCA: false, // Projection owns merging; retain CA layers without deleting comments.
    scale: canvasFontScale,
    config: {
      contextStrokeColor: strokeColor,
      contextStrokeInversionColor: strokeInversionColor,
      contextStrokeOpacity: strokeOpacity,
      contextLineWidth: { html5: strokeWidth, flash: strokeWidth },
      cssTextShadowBlur: cssTextShadowBlur,
      commentLimit: commentLimit > 0 ? commentLimit : undefined,
      fonts: buildDanmakuFontConfig(),
      scrollSpeed: scrollSpeed,
      fixedCombo: fixedComboEnabled,
      nakaDedupeWindow: 0, // Projection already merges scrolling comments.
    },
  });
  if (useCssMode) {
    updateCanvasViewport();
    domEmojiRenderer = createDomEmojiRenderer(document.querySelector('[data-dm-css-container]'));
  }
  if (danmakuVisible && niconiComments && niconiComments.setPlaybackSpeed) {
    niconiComments.setPlaybackSpeed(playbackSpeed);
  }
  bindCanvasEvents(niconiComments);
  drawCanvasAtVpos((getVideoTimeSec() + danmakuTimeOffsetSec) * 100, true);
  if (isPaused && useCssMode) {
    niconiComments.pauseCSS();
  }
  if (useCssMode) {
    const cssContainer = document.querySelector('[data-dm-css-container]');
    if (cssContainer) cssContainer.style.opacity = canvasOpacity;
  }
  notifyLoadSuccess();
}

function shouldRunCanvasLoop() {
  return !!(niconiComments && danmakuVisible && (canvasIsPlaying || canvasForceDrawPending));
}

function drawCanvasAtVpos(vpos, forceRendering) {
  if (!danmakuVisible || !niconiComments) return;
  const continuousCss = canvasNicoMode === 'css' &&
    typeof niconiComments.needsContinuousCSSDraw === 'function' && niconiComments.needsContinuousCSSDraw();
  const renderVpos = canvasNicoMode === 'css' && !continuousCss ? Math.floor(vpos) : vpos;
  niconiComments.drawCanvas(renderVpos, !!forceRendering);
}

function canvasRenderLoop() {
  canvasRafId = null;
  if (!shouldRunCanvasLoop()) return;
  try {
    const forceRendering = canvasForceDrawPending;
    const clear = canvasClearPending;
    canvasForceDrawPending = false;
    canvasClearPending = false;
    if (clear) niconiComments.clear();
    drawCanvasAtVpos((getVideoTimeSec() + danmakuTimeOffsetSec) * 100, forceRendering);
    startCanvasLoop();
  } catch (error) { reportCanvasError(error); }
}

function startCanvasLoop() {
  if (canvasRafId || !shouldRunCanvasLoop()) return;
  const generation = canvasLoopGeneration;
  canvasRafId = requestAnimationFrame(() => {
    if (generation === canvasLoopGeneration) canvasRenderLoop();
  });
}

function stopCanvasLoop() {
  canvasLoopGeneration += 1;
  if (canvasRafId !== null) {
    cancelAnimationFrame(canvasRafId);
    canvasRafId = null;
  }
}

function cancelPendingCanvasDraw() {
  stopCanvasLoop();
  canvasForceDrawPending = false;
  canvasClearPending = false;
}

function requestCanvasDraw(clear) {
  canvasForceDrawPending = true;
  canvasClearPending = canvasClearPending || clear;
  startCanvasLoop();
}

function applyOpacityToDom() {
  const canvas = document.getElementById('niconicomments-canvas');
  if (canvas && canvasNicoMode !== 'css') canvas.style.opacity = canvasOpacity;
  const cssContainer = document.querySelector('[data-dm-css-container]');
  if (cssContainer) cssContainer.style.opacity = canvasOpacity;
}

function applyOverlaySettings(data) {
  if (data.fullscreen !== undefined) videoFullscreen = !!data.fullscreen;
  if (data.videoAspectRatio !== undefined) {
    const aspect = Number(data.videoAspectRatio);
    videoAspectRatio = isFinite(aspect) && aspect > 0 ? aspect : 0;
  }
  if (data.opacity !== undefined) { canvasOpacity = data.opacity; applyOpacityToDom(); }
  if (data.canvasFontScale !== undefined) canvasFontScale = data.canvasFontScale;
  if (data.canvasMode !== undefined) canvasNicoMode = data.canvasMode;
  if (data.strokeColor !== undefined) strokeColor = data.strokeColor;
  if (data.strokeInversionColor !== undefined) strokeInversionColor = data.strokeInversionColor;
  if (data.strokeOpacity !== undefined) strokeOpacity = data.strokeOpacity;
  if (data.strokeWidth !== undefined) strokeWidth = data.strokeWidth;
  if (data.cssTextShadowBlur !== undefined) cssTextShadowBlur = data.cssTextShadowBlur;
  if (data.commentLimit !== undefined) commentLimit = data.commentLimit;
  if (data.scrollSpeed !== undefined) scrollSpeed = data.scrollSpeed;
  if (data.danmakuTimeOffsetSec !== undefined) danmakuTimeOffsetSec = Number(data.danmakuTimeOffsetSec) || 0;
  if (data.danmakuFontFamily !== undefined) danmakuFontFamily = data.danmakuFontFamily || "";
  if (data.danmakuFontWeight !== undefined) danmakuFontWeight = data.danmakuFontWeight || "";
  if (data.fixedCombo !== undefined) fixedComboEnabled = !!data.fixedCombo;
}

onPluginMessage("time-update", (data) => {
  const hasIds = data && Number.isSafeInteger(data.timeId) && data.timeId > 0 &&
    Number.isSafeInteger(data.sourceId) && data.sourceId >= 0;
  try {
    if (!data || typeof data.time !== 'number' || !isFinite(data.time)) return;
    if (data.sourceId !== undefined &&
        (!Number.isSafeInteger(data.sourceId) || data.sourceId !== latestMessageId)) return;
    if (data.timeId !== undefined && (!hasIds || data.timeId <= latestTimeUpdateId)) return;
    if (hasIds) latestTimeUpdateId = data.timeId;
    const t = data.time * 100;
    const changed = lastTime === null || t !== lastTime;
    // Main knows mpv's seek state. An explicit false avoids mistaking native
    // IPC queue delay for a video jump. Untagged callers retain drift fallback.
    let isSeek = data.seek === true;
    if (typeof data.seek !== 'boolean') {
      const elapsedSec = Math.max(0, (performance.now() - lastTimeUpdateAt) / 1000);
      const expectedDelta = isPaused ? 0 : elapsedSec * playbackSpeed * 100;
      const actualDelta = lastTime === null ? 0 : t - lastTime;
      isSeek = lastTime !== null && (actualDelta < -10 ||
        Math.abs(actualDelta - expectedDelta) > Math.max(20, 10 * playbackSpeed));
    }
    if (isSeek || isPaused || !canvasIsPlaying || lastTime === null) {
      syncVideoAnchor(data.time);
    } else {
      // During playback the render clock is continuous. mpv can briefly lag
      // and then catch up around speed changes; applying either correction
      // would pull Canvas comments back or push them forward on screen.
      // Keep the received time for seek detection without moving that clock.
      lastTime = t;
      lastTimeUpdateAt = performance.now();
    }
    if (danmakuVisible && niconiComments && (isSeek || (isPaused && changed))) {
      // Keep only one draw for the latest anchor, including while paused.
      // The frame applies the offset once and clears old CSS nodes before drawing.
      requestCanvasDraw(true);
    } else {
      startCanvasLoop();
    }
  } finally {
    // Acknowledge receipt, not painting. This bounds main's native IPC queue;
    // the renderer's existing load-success notifier still waits for two rAFs.
    if (hasIds) iina.postMessage('time-update-ack', {timeId: data.timeId, sourceId: data.sourceId});
  }
});

onPluginMessage("load-danmaku", (data) => {
  if (data.loadId !== undefined) {
    if (!Number.isSafeInteger(data.loadId) || data.loadId <= latestMessageId) return;
    latestMessageId = data.loadId;
  }
  cancelLoadSuccess();
  currentLoadId = data.loadId;
  try {
    applyOverlaySettings(data);
    if (data.playback) syncPlaybackState(data.playback);
    if (!Array.isArray(data.comments)) throw new Error('Invalid formatted comment list');
    canvasIsPlaying = !isPaused;
    formattedFileType = data.fileType;
    initCanvasRenderer(data.comments);
    startCanvasLoop();
  } catch (error) { reportCanvasError(error); }
});

onPluginMessage("resize", refreshCanvasViewport);

onPluginMessage("set-video-aspect", (data) => {
  const aspect = Number(data && data.aspect);
  videoAspectRatio = isFinite(aspect) && aspect > 0 ? aspect : 0;
  if (data && data.fullscreen !== undefined) videoFullscreen = !!data.fullscreen;
  refreshCanvasViewport();
});

onPluginMessage("set-fullscreen", (data) => {
  videoFullscreen = !!(data && data.fullscreen);
  refreshCanvasViewport();
});

onPluginMessage("pause-state", (data) => {
  if (data.sourceId !== undefined && data.sourceId !== latestMessageId) return;
  // Cache transitions carry native video time, including recovery without a
  // user pause change. Ordinary pause events preserve the continuous clock.
  const resync = Number.isFinite(data.time);
  const anchoredTime = resync ? data.time : getVideoTimeSec();
  isPaused = !!data.paused;
  canvasIsPlaying = !isPaused;
  syncVideoAnchor(anchoredTime);
  if (niconiComments) {
    if (isPaused) {
      stopCanvasLoop();
      niconiComments.pauseCSS();
      startCanvasLoop();
    } else {
      niconiComments.resumeCSS();
      startCanvasLoop();
    }
  }
  if (resync && danmakuVisible && niconiComments) requestCanvasDraw(true);
});

onPluginMessage("playback-speed", (data) => {
  const anchoredTime = getVideoTimeSec();
  playbackSpeed = data && data.speed ? data.speed : 1.0;
  syncVideoAnchor(anchoredTime);
  // CSS hands active scrolling nodes to frame-driven motion on its next draw.
  if (danmakuVisible && niconiComments && niconiComments.setPlaybackSpeed) {
    niconiComments.setPlaybackSpeed(playbackSpeed);
  }
});

function syncPlaybackState(data) {
  cancelPendingCanvasDraw();
  const time = Number.isFinite(data.time) ? data.time : getVideoTimeSec();
  if (typeof data.paused === 'boolean') isPaused = data.paused;
  if (Number.isFinite(data.speed) && data.speed > 0) playbackSpeed = data.speed;
  canvasIsPlaying = !isPaused;
  syncVideoAnchor(time);
  if (data.enabled !== undefined) danmakuVisible = !!data.enabled;
  if (danmakuVisible && niconiComments) {
    niconiComments.setPlaybackSpeed(playbackSpeed);
    if (isPaused) niconiComments.pauseCSS(); else niconiComments.resumeCSS();
  }
}

onPluginMessage("toggle-danmaku", (data) => {
  cancelRevealAck();
  syncPlaybackState(data);
  danmakuVisible = !!data.enabled;
  const canvas = document.getElementById('niconicomments-canvas');
  if (canvas) canvas.style.display = data.enabled ? '' : 'none';
  const cssContainer = document.querySelector('[data-dm-css-container]');
  if (cssContainer) cssContainer.style.display = data.enabled ? '' : 'none';
  if (!data.enabled) {
    if (canvasRebuildTimer !== null) clearTimeout(canvasRebuildTimer);
    canvasRebuildTimer = null;
    cancelPendingCanvasDraw();
    if (niconiComments) niconiComments.clear();
  } else if (canvasRebuildPending && formattedComments) {
    try { initCanvasRenderer(formattedComments); startCanvasLoop(); }
    catch (error) { reportCanvasError(error); }
  } else {
    startCanvasLoop();
    // Disabling cleared the renderer. Redraw now because paused playback
    // has no running loop to restore the comments.
    drawCanvasAtVpos((getVideoTimeSec() + danmakuTimeOffsetSec) * 100, true);
  }
  if (data.enabled && Number.isSafeInteger(data.revealId)) acknowledgeReveal(data.revealId);
});

onPluginMessage("set-opacity", (data) => {
  canvasOpacity = data.opacity;
  applyOpacityToDom();
});

onPluginMessage("set-danmaku-style", (data) => {
  // Keep the current renderer entirely on its old style until the replacement
  // can use the complete new scale/font/stroke/speed tuple in its first frame.
  applyOverlaySettings(data);
  if (formattedComments) scheduleCanvasRebuild();
});

onPluginMessage("set-fontscale", (data) => {
  canvasFontScale = data.scale;
  if (formattedComments) scheduleCanvasRebuild();
});

onPluginMessage("set-canvas-mode", (data) => {
  canvasNicoMode = data.mode;
  if (formattedComments) scheduleCanvasRebuild();
});

onPluginMessage("set-stroke-opacity", (data) => {
  strokeOpacity = data.opacity;
  if (formattedComments) scheduleCanvasRebuild();
});

onPluginMessage("set-stroke-width", (data) => {
  strokeWidth = data.width;
  if (formattedComments) scheduleCanvasRebuild();
});

onPluginMessage("set-stroke-color", (data) => {
  strokeColor = data.color;
  if (formattedComments) scheduleCanvasRebuild();
});

onPluginMessage("set-css-text-shadow-blur", (data) => {
  if (!data || typeof data.blur !== 'number' || !isFinite(data.blur) || data.blur < 0 || data.blur > 10) return;
  if (cssTextShadowBlur === data.blur) return;
  cssTextShadowBlur = data.blur;
  // Canvas retains the setting for a later mode switch. A CSS rebuild also
  // regenerates repeated-emoji tiles with the new shadow, including while paused.
  if (canvasNicoMode === 'css' && formattedComments) scheduleCanvasRebuild();
});

onPluginMessage("set-stroke-inversion-color", (data) => {
  strokeInversionColor = data.color;
  if (formattedComments) scheduleCanvasRebuild();
});

onPluginMessage("set-comment-limit", (data) => {
  commentLimit = data.limit;
  if (formattedComments) scheduleCanvasRebuild();
});

onPluginMessage("set-scroll-speed", (data) => {
  scrollSpeed = data.speed;
  // An upcoming style rebuild already consumes this value. Do not remap the
  // old renderer's timeline while it is waiting to be replaced.
  if (canvasRebuildPending) return;
  if (niconiComments) {
    if (niconiComments.setScrollSpeed(scrollSpeed)) {
      // Playback consumes the pending layout on its next frame. Paused video
      // has no loop, so apply the one required draw immediately.
      if (danmakuVisible && isPaused) drawCanvasAtVpos((getVideoTimeSec() + danmakuTimeOffsetSec) * 100, false);
      else startCanvasLoop();
    }
  }
});

onPluginMessage("set-danmaku-offset", (data) => {
  if (data.offset !== undefined) {
    danmakuTimeOffsetSec = Number(data.offset) || 0;
  }
  if (danmakuVisible && formattedComments && niconiComments) {
    // An offset change is a seek: clear old CSS nodes before drawing the new time.
    niconiComments.clear();
    drawCanvasAtVpos((getVideoTimeSec() + danmakuTimeOffsetSec) * 100, true);
  }
});

onPluginMessage("set-danmaku-font", (data) => {
  if (data.fontFamily !== undefined) danmakuFontFamily = data.fontFamily || "";
  if (data.fontWeight !== undefined) danmakuFontWeight = data.fontWeight || "";
  if (formattedComments) scheduleCanvasRebuild();
});

onPluginMessage("clear-danmaku", (data) => {
  const clearId = data && data.clearId;
  if (clearId !== undefined) {
    if (!Number.isSafeInteger(clearId) || clearId <= latestMessageId) return;
    latestMessageId = clearId;
  }
  currentLoadId = 0;
  canvasRebuildPending = false;
  if (canvasRebuildTimer !== null) clearTimeout(canvasRebuildTimer);
  canvasRebuildTimer = null;
  stopCanvasLoop();
  if (canvasViewportFrame !== null) cancelAnimationFrame(canvasViewportFrame);
  canvasViewportFrame = null;
  lastTime = null;
  lastTimeUpdateAt = 0;
  canvasVideoAnchorTime = 0;
  canvasSystemAnchorTime = 0;
  canvasIsPlaying = false;
  formattedComments = null;
  formattedFileType = null;
  disposeCanvasRenderer();
});

function reportOverlayReady() {
  iina.postMessage("overlay-ready", {});
}
onPluginMessage("request-overlay-state", reportOverlayReady);
reportOverlayReady();
