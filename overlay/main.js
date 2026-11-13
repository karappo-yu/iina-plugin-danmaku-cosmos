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
let danmakuTimeOffsetSec = 0;
let danmakuFontFamily = "";
let danmakuFontWeight = "";

let niconiComments = null;
let domEmojiRenderer = null;
let formattedComments = null;
let canvasRafId = null;
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
    const key = JSON.stringify([glyph, style.fontFamily, style.fontWeight, rasterFontSize,
      lineHeight, style.color, strokeWidth * ratio, style.webkitTextStrokeColor,
      shadow ? shadow.slice(1).map(function (n) { return Number(n) * ratio; }) : null]);
    if (tiles.has(key)) return tiles.get(key);

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const font = style.fontWeight + ' ' + rasterFontSize + 'px ' + style.fontFamily;
    ctx.font = font;
    const width = Math.ceil(ctx.measureText(glyph).width * density);
    const height = Math.ceil(lineHeight * rasterFontSize * density);
    if (width <= 0 || height <= 0 || width > 1024 || height > 1024) return null;
    canvas.width = width;
    canvas.height = height;
    ctx.scale(density, density);
    ctx.font = font;
    const metrics = ctx.measureText('Ag');
    const ascent = metrics.fontBoundingBoxAscent === undefined ? rasterFontSize * 0.9 : metrics.fontBoundingBoxAscent;
    const descent = metrics.fontBoundingBoxDescent === undefined ? rasterFontSize * 0.1 : metrics.fontBoundingBoxDescent;
    const baseline = (lineHeight * rasterFontSize - ascent - descent) / 2 + ascent;
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
    const tile = { image: 'url("' + canvas.toDataURL() + '")', lineHeight: lineHeight };
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
        } else if (node.nodeType === 1 && !node.closest('[data-dm-emoji-repeat]')) {
          const walker = document.createTreeWalker(node, 4);
          let text;
          while ((text = walker.nextNode())) pending.add(text);
        }
      }
    }
    for (const node of pending) {
      const parent = node.parentElement;
      if (!parent || !container.contains(parent) || parent.closest('[data-dm-emoji-repeat]') ||
          !parent.closest('[data-dm-comment]')) continue;
      const repeated = getRepeatedEmoji(node.textContent);
      if (!repeated) continue;
      const tile = getTile(repeated.glyph, getComputedStyle(parent));
      if (!tile) continue;
      const span = document.createElement('span');
      span.setAttribute('data-dm-emoji-repeat', '');
      span.textContent = node.textContent;
      span.style.backgroundImage = tile.image;
      // Match the original run's actual advance, including WebKit rounding.
      span.style.backgroundSize = (100 / repeated.count) + '% ' + tile.lineHeight + 'em';
      parent.replaceChild(span, node);
    }
  });
  observer.observe(container, { childList: true, subtree: true });
  return { destroy: function () { observer.disconnect(); tiles.clear(); } };
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
      iina.postMessage("jump", { targetSec: e.targetVpos / 100, message: e.message, to: e.to });
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
  if (domEmojiRenderer) {
    domEmojiRenderer.destroy();
    domEmojiRenderer = null;
  }
  if (!niconiComments) return;
  unbindCanvasEvents(niconiComments);
  niconiComments.clear();
  niconiComments.destroy();
  niconiComments = null;
}

var DEFAULT_DANMAKU_FONT_STACKS = {
  gothic: { font: '"游ゴシック体", "游ゴシック", "Yu Gothic", YuGothic, yugothic, YuGo-Medium, "Hiragino Sans", HiraginoSans', offset: -0.04, weight: 400 },
  mincho: { font: '"游明朝体", "游明朝", "Yu Mincho", YuMincho, yumincho, YuMin-Medium, "Hiragino Mincho ProN", HiraMinProN, "Hiragino Mincho ProN W3", HiraMinProN-W3', offset: -0.01, weight: 400 },
  defont: { font: '"Hiragino Sans", "ヒラギノ角ゴシック", HiraginoSans', offset: -0.05, weight: 600 },
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

function scheduleCanvasRebuild() {
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
  if (niconiComments) return niconiComments.resize(canvasWidth, canvasHeight);
  canvas.width = canvasWidth;
  canvas.height = canvasHeight;
  return true;
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

function initCanvasRenderer(data) {
  if (canvasRebuildTimer !== null) clearTimeout(canvasRebuildTimer);
  canvasRebuildTimer = null;
  formattedComments = data;
  if (!danmakuVisible) { canvasRebuildPending = true; return; }
  canvasRebuildPending = false;
  const canvas = document.getElementById('niconicomments-canvas');
  if (!canvas || typeof NiconiComments === 'undefined') return;
  const useCssMode = canvasNicoMode === 'css';
  canvas.style.opacity = useCssMode ? 0 : canvasOpacity;
  canvas.style.display = danmakuVisible ? '' : 'none';
  disposeCanvasRenderer();
  updateCanvasViewport();
  niconiComments = new NiconiComments(canvas, data, {
    format: 'formatted',
    mode: canvasNicoMode,
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
      fixedCombo: false,
      nakaDedupeWindow: 0,
    },
  });
  formattedComments = data;
  if (useCssMode) {
    domEmojiRenderer = createDomEmojiRenderer(document.querySelector('[data-dm-css-container]'));
  }
  // 初始化时同步当前播放速度(CSS 模式滚动动画时长按倍率缩放)
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
  iina.postMessage("danmaku-load-result", { loadId: currentLoadId, success: true });
}

function shouldRunCanvasLoop() {
  return !!(niconiComments && danmakuVisible && canvasIsPlaying);
}

function drawCanvasAtVpos(vpos, forceRendering) {
  if (!danmakuVisible || !niconiComments) return;
  const renderVpos = canvasNicoMode === 'css' ? Math.floor(vpos) : vpos;
  niconiComments.drawCanvas(renderVpos, !!forceRendering);
}

function canvasRenderLoop() {
  canvasRafId = null;
  if (!shouldRunCanvasLoop()) return;
  drawCanvasAtVpos((getVideoTimeSec() + danmakuTimeOffsetSec) * 100, false);
  startCanvasLoop();
}

function startCanvasLoop() {
  if (canvasRafId || !shouldRunCanvasLoop()) return;
  canvasRafId = requestAnimationFrame(canvasRenderLoop);
}

function stopCanvasLoop() {
  if (canvasRafId !== null) {
    cancelAnimationFrame(canvasRafId);
    canvasRafId = null;
  }
}

function applyOpacityToDom() {
  const canvas = document.getElementById('niconicomments-canvas');
  if (canvas && canvasNicoMode !== 'css') canvas.style.opacity = canvasOpacity;
  const cssContainer = document.querySelector('[data-dm-css-container]');
  if (cssContainer) cssContainer.style.opacity = canvasOpacity;
}

// load-danmaku 共用的逐字段幂等设置应用(重复携带无副作用)
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
}

onPluginMessage("time-update", (data) => {
  if (!data || typeof data.time !== 'number' || !isFinite(data.time)) return;
  let t = data.time * 100;
  const elapsedSec = Math.max(0, (performance.now() - lastTimeUpdateAt) / 1000);
  const expectedDelta = isPaused ? 0 : elapsedSec * playbackSpeed * 100;
  const actualDelta = lastTime === null ? 0 : t - lastTime;
  const drift = actualDelta - expectedDelta;
  const isSeek = data.seek === true || (lastTime !== null &&
    (actualDelta < -10 || Math.abs(drift) > Math.max(20, 10 * playbackSpeed)));
  if (isSeek) stopCanvasLoop();
  syncVideoAnchor(data.time);
  lastTime = t;
  if (danmakuVisible && (isSeek || isPaused) && niconiComments) {
    niconiComments.clear();
    // 必须用偏移后时间: 裸视频时间会在负偏移时把本该延后的弹幕提前生成,
    // CSS 模式弹幕是 DOM 动画,生成后会完整飘完一遍再出现第二次(重复)
    drawCanvasAtVpos((getVideoTimeSec() + danmakuTimeOffsetSec) * 100, true);
  }
  startCanvasLoop();
});

onPluginMessage("load-danmaku", (data) => {
  currentLoadId = data.loadId;
  try {
    applyOverlaySettings(data);
    if (data.playback) syncPlaybackState(data.playback);
    if (!Array.isArray(data.comments)) throw new Error('Invalid formatted comment list');
    formattedComments = data.comments;
    if (formattedComments) {
      canvasIsPlaying = !isPaused;
      initCanvasRenderer(formattedComments);
      startCanvasLoop();
    }
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
  const anchoredTime = getVideoTimeSec();
  isPaused = !!data.paused;
  canvasIsPlaying = !isPaused;
  syncVideoAnchor(anchoredTime);
  if (niconiComments) {
    if (isPaused) {
      stopCanvasLoop();
      niconiComments.pauseCSS();
    } else {
      niconiComments.resumeCSS();
      startCanvasLoop();
    }
  }
});

onPluginMessage("playback-speed", (data) => {
  const anchoredTime = getVideoTimeSec();
  playbackSpeed = data && data.speed ? data.speed : 1.0;
  syncVideoAnchor(anchoredTime);
  // 通知 CSS 渲染器:速度变化时重设滚动动画时长(1x 无操作)
  if (danmakuVisible && niconiComments && niconiComments.setPlaybackSpeed) {
    niconiComments.setPlaybackSpeed(playbackSpeed);
  }
});

function syncPlaybackState(data) {
  stopCanvasLoop();
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
  syncPlaybackState(data);
  danmakuVisible = !!data.enabled;
  const canvas = document.getElementById('niconicomments-canvas');
  if (canvas) canvas.style.display = data.enabled ? '' : 'none';
  const cssContainer = document.querySelector('[data-dm-css-container]');
  if (cssContainer) cssContainer.style.display = data.enabled ? '' : 'none';
  if (!data.enabled) {
    if (canvasRebuildTimer !== null) clearTimeout(canvasRebuildTimer);
    canvasRebuildTimer = null;
    stopCanvasLoop();
    if (niconiComments) niconiComments.clear();
  } else if (canvasRebuildPending && formattedComments) {
    try { initCanvasRenderer(formattedComments); startCanvasLoop(); }
    catch (error) { reportCanvasError(error); }
  } else {
    startCanvasLoop();
    // 暂停中重开: rAF loop 不会启动(shouldRunCanvasLoop 要求正在播放),
    // 且关闭分支已 clear() 清空内容——必须强制重绘一次,否则画面空白直到恢复播放
    drawCanvasAtVpos((getVideoTimeSec() + danmakuTimeOffsetSec) * 100, true);
  }
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
    // 偏移变化等同于时间轴跳转。CSSRenderer 使用增量 DOM，
    // 必须先清空，否则旧时间点的弹幕会与新时间点的弹幕叠加。
    niconiComments.clear();
    drawCanvasAtVpos((getVideoTimeSec() + danmakuTimeOffsetSec) * 100, true);
  }
});

onPluginMessage("set-danmaku-font", (data) => {
  if (data.fontFamily !== undefined) danmakuFontFamily = data.fontFamily || "";
  if (data.fontWeight !== undefined) danmakuFontWeight = data.fontWeight || "";
  if (formattedComments) scheduleCanvasRebuild();
});

onPluginMessage("clear-danmaku", () => {
  currentLoadId = 0;
  canvasRebuildPending = false;
  if (canvasRebuildTimer !== null) clearTimeout(canvasRebuildTimer);
  canvasRebuildTimer = null;
  stopCanvasLoop();
  disposeCanvasRenderer();
  lastTime = null;
  lastTimeUpdateAt = 0;
  canvasVideoAnchorTime = 0;
  canvasSystemAnchorTime = 0;
  canvasIsPlaying = false;
  const cssContainer = document.querySelector('[data-dm-css-container]');
  if (cssContainer) cssContainer.remove();
  formattedComments = null;

});

function reportOverlayReady() {
  iina.postMessage("overlay-ready", {});
}
onPluginMessage("request-overlay-state", reportOverlayReady);
reportOverlayReady();
