let allDanmaku = [];
let lastTime = 0;
let isPaused = false;

let canvasOpacity = 0.8;
let canvasFontScale = 1.0;
let canvasNicoMode = 'default';
let strokeColor = '#000000';
let strokeInversionColor = '#ffffff';
let strokeOpacity = 0.4;
let strokeWidth = 2.8;
let commentLimit = 0;
let scrollSpeed = 0.95;

let niconiComments = null;
let nicoRawData = null;
let nicoRawFormat = 'legacy';
let currentDanmakuType = 'none';
let canvasRafId = null;
let canvasVideoAnchorTime = 0;
let canvasSystemAnchorTime = 0;
let canvasIsPlaying = false;
let playbackSpeed = 1.0;
let danmakuVisible = true;

function canvasSyncAnchor(videoTimeSec) {
  canvasVideoAnchorTime = videoTimeSec;
  canvasSystemAnchorTime = performance.now();
}

function canvasGetCurrentTime() {
  if (!canvasIsPlaying) return canvasVideoAnchorTime;
  return canvasVideoAnchorTime + ((performance.now() - canvasSystemAnchorTime) / 1000) * playbackSpeed;
}

function detectNicoFormat(data) {
  if (Array.isArray(data) && data.length > 0) {
    if (data[0].comments !== undefined && Array.isArray(data[0].comments)) return 'v1';
    if (data[0].chat !== undefined) return 'legacy';
  }
  return 'legacy';
}

function detectRawDanmakuType(rawStr) {
  const s = rawStr ? rawStr.trim() : '';
  if (!s) return 'bilibili-xml';
  if (s.charAt(0) === '[') return 'nico-json';
  if (s.indexOf('<packet') !== -1) return 'nico-xml';
  return 'bilibili-xml';
}

function toNumericUserId(userId, userMap) {
  const numeric = Number(userId);
  if (!isNaN(numeric) && isFinite(numeric)) return numeric;
  const key = String(userId || '');
  if (userMap[key] === undefined) {
    userMap._nextId = (userMap._nextId || 0) + 1;
    userMap[key] = userMap._nextId;
  }
  return userMap[key];
}

function buildFormattedCanvasData(list, sourceType) {
  const userMap = {};
  const result = [];
  for (let i = 0; i < list.length; i++) {
    const d = list[i];
    result.push({
      id: i,
      vpos: Math.round(d.t || 0),
      content: d.text || '',
      date: d._dateSec || 0,
      date_usec: 0,
      owner: sourceType !== 'bilibili-xml' && !!d._isOwner,
      premium: true,
      mail: Array.isArray(d._commands) ? d._commands : [],
      user_id: toNumericUserId(d._userId, userMap),
      layer: d._layer === undefined ? -1 : d._layer,
      is_my_post: false,
      reverse: !!d._reverse
    });
  }
  return result;
}

function prepareCanvasSource(rawStr, parsedList, sourceType) {
  nicoRawData = null;
  nicoRawFormat = 'formatted';
  if (sourceType === 'nico-json') {
    try {
      nicoRawData = JSON.parse(rawStr);
      nicoRawFormat = detectNicoFormat(nicoRawData);
      return;
    } catch (e) {
      console.warn('niconicocomments JSON parse failed, using formatted data:', e);
    }
  }
  nicoRawData = buildFormattedCanvasData(parsedList, sourceType);
  nicoRawFormat = 'formatted';
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
  if (!niconiComments) return;
  unbindCanvasEvents(niconiComments);
  niconiComments.clear();
  niconiComments.destroy();
  niconiComments = null;
}

function initCanvasRenderer(data) {
  const canvas = document.getElementById('niconicomments-canvas');
  if (!canvas || typeof NiconiComments === 'undefined') return;
  canvas.width = 1920;
  canvas.height = 1080;
  const useCssMode = canvasNicoMode === 'css';
  canvas.style.opacity = useCssMode ? 0 : canvasOpacity;
  disposeCanvasRenderer();
  niconiComments = new NiconiComments(canvas, data, {
    format: nicoRawFormat,
    mode: canvasNicoMode,
    keepCA: true,
    scale: canvasFontScale,
    config: {
      contextStrokeColor: strokeColor,
      contextStrokeInversionColor: strokeInversionColor,
      contextStrokeOpacity: strokeOpacity,
      contextLineWidth: { html5: strokeWidth, flash: strokeWidth },
      commentLimit: commentLimit > 0 ? commentLimit : undefined,
      nakaCommentSpeedOffset: scrollSpeed,
    },
  });
  nicoRawData = data;
  bindCanvasEvents(niconiComments);
  if (isPaused && useCssMode) {
    niconiComments.pauseCSS();
  }
  if (useCssMode) {
    const cssContainer = document.querySelector('[data-dm-css-container]');
    if (cssContainer) cssContainer.style.opacity = canvasOpacity;
  }
}

function destroyCanvasRenderer() {
  stopCanvasLoop();
  disposeCanvasRenderer();
}

function shouldRunCanvasLoop() {
  return !!(niconiComments && danmakuVisible && canvasIsPlaying);
}

function drawCanvasAtVpos(vpos, forceRendering) {
  if (!niconiComments) return;
  const renderVpos = canvasNicoMode === 'css' ? Math.floor(vpos) : vpos;
  niconiComments.drawCanvas(renderVpos, !!forceRendering);
}

function canvasRenderLoop() {
  canvasRafId = null;
  if (!shouldRunCanvasLoop()) return;
  drawCanvasAtVpos(canvasGetCurrentTime() * 100, false);
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

iina.onMessage("time-update", (data) => {
  let t = data.time * 100;
  const isSeek = Math.abs(t - lastTime) > 150;
  if (isSeek) stopCanvasLoop();
  canvasSyncAnchor(data.time);
  lastTime = t;
  if (isSeek && niconiComments) {
    drawCanvasAtVpos(t, false);
  }
  startCanvasLoop();
});

iina.onMessage("load-danmaku", (data) => {
  if (data.canvasFontScale !== undefined) canvasFontScale = data.canvasFontScale;
  if (data.strokeOpacity !== undefined) strokeOpacity = data.strokeOpacity;
  if (data.strokeWidth !== undefined) strokeWidth = data.strokeWidth;
  if (data.strokeColor !== undefined) strokeColor = data.strokeColor;
  if (data.strokeInversionColor !== undefined) strokeInversionColor = data.strokeInversionColor;
  if (data.commentLimit !== undefined) commentLimit = data.commentLimit;
  if (data.scrollSpeed !== undefined) scrollSpeed = data.scrollSpeed;
  if (data.opacity !== undefined) {
    canvasOpacity = data.opacity;
    const canvas = document.getElementById('niconicomments-canvas');
    if (canvas && canvasNicoMode !== 'css') canvas.style.opacity = data.opacity;
    const cssContainer = document.querySelector('[data-dm-css-container]');
    if (cssContainer) cssContainer.style.opacity = data.opacity;
  }

  const encodedStr = data.xmlContent;
  const rawStr = decodeURIComponent(encodedStr);

  var danmakuType = data.danmakuType || detectRawDanmakuType(rawStr);
  console.log('[overlay] load-danmaku: type=' + danmakuType + ' rawStr.length=' + rawStr.length + ' path=' + (data.path || ''));
  currentDanmakuType = danmakuType;

  if (danmakuType === 'dandanplay') {
    try {
      allDanmaku = JSON.parse(rawStr);
      console.log('[overlay] parsed dandanplay: count=' + allDanmaku.length);
    } catch (e) {
      console.log('[overlay] parse dandanplay failed: ' + e);
      allDanmaku = [];
    }
  } else if (danmakuType === 'nico-json') {
    allDanmaku = [];
  } else {
    allDanmaku = parseDanmaku(rawStr, true);
    console.log('[overlay] parsed xml: type=' + danmakuType + ' count=' + allDanmaku.length);
  }

  prepareCanvasSource(rawStr, allDanmaku, danmakuType);
  allDanmaku = [];
  console.log('[overlay] nicoRawData=' + (nicoRawData ? 'present' : 'null') + ' format=' + nicoRawFormat);

  iina.postMessage("danmaku-type", { type: danmakuType });

  if (nicoRawData) {
    canvasIsPlaying = !isPaused;
    canvasSyncAnchor(0);
    initCanvasRenderer(nicoRawData);
    startCanvasLoop();
    console.log('[overlay] renderer initialized and loop started');
  } else {
    console.log('[overlay] no nicoRawData, skipping renderer init');
  }
});

iina.onMessage("resize", () => {
  if (niconiComments) {
    niconiComments.clear();
    drawCanvasAtVpos(canvasGetCurrentTime() * 100, true);
  }
});

iina.onMessage("pause-state", (data) => {
  const anchoredTime = canvasGetCurrentTime();
  isPaused = !!data.paused;
  canvasIsPlaying = !isPaused;
  canvasSyncAnchor(anchoredTime);
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

iina.onMessage("playback-speed", (data) => {
  const anchoredTime = canvasGetCurrentTime();
  playbackSpeed = data && data.speed ? data.speed : 1.0;
  canvasSyncAnchor(anchoredTime);
});

iina.onMessage("toggle-danmaku", (data) => {
  danmakuVisible = !!data.enabled;
  const canvas = document.getElementById('niconicomments-canvas');
  if (canvas) canvas.style.display = data.enabled ? '' : 'none';
  const cssContainer = document.querySelector('[data-dm-css-container]');
  if (cssContainer) cssContainer.style.display = data.enabled ? '' : 'none';
  if (!data.enabled) {
    stopCanvasLoop();
    if (niconiComments) niconiComments.clear();
  } else {
    startCanvasLoop();
  }
});

iina.onMessage("set-opacity", (data) => {
  canvasOpacity = data.opacity;
  const canvas = document.getElementById('niconicomments-canvas');
  if (canvas && canvasNicoMode !== 'css') canvas.style.opacity = data.opacity;
  const cssContainer = document.querySelector('[data-dm-css-container]');
  if (cssContainer) cssContainer.style.opacity = data.opacity;
});

iina.onMessage("set-fontscale", (data) => {
  canvasFontScale = data.scale;
  if (nicoRawData) initCanvasRenderer(nicoRawData);
});

iina.onMessage("set-canvas-mode", (data) => {
  const oldMode = canvasNicoMode;
  canvasNicoMode = data.mode;
  if (nicoRawData) {
    initCanvasRenderer(nicoRawData);
    startCanvasLoop();
    if (oldMode === 'css' && canvasNicoMode !== 'css') {
      const cssContainer = document.querySelector('[data-dm-css-container]');
      if (cssContainer) cssContainer.remove();
    }
  }
});

iina.onMessage("set-stroke-opacity", (data) => {
  strokeOpacity = data.opacity;
  if (nicoRawData) initCanvasRenderer(nicoRawData);
});

iina.onMessage("set-stroke-width", (data) => {
  strokeWidth = data.width;
  if (nicoRawData) initCanvasRenderer(nicoRawData);
});

iina.onMessage("set-stroke-color", (data) => {
  strokeColor = data.color;
  if (nicoRawData) initCanvasRenderer(nicoRawData);
});

iina.onMessage("set-stroke-inversion-color", (data) => {
  strokeInversionColor = data.color;
  if (nicoRawData) initCanvasRenderer(nicoRawData);
});

iina.onMessage("set-comment-limit", (data) => {
  commentLimit = data.limit;
  if (nicoRawData) initCanvasRenderer(nicoRawData);
});

iina.onMessage("set-scroll-speed", (data) => {
  scrollSpeed = data.speed;
  if (nicoRawData) initCanvasRenderer(nicoRawData);
});

iina.onMessage("clear-danmaku", () => {
  destroyCanvasRenderer();
  allDanmaku = [];
  nicoRawData = null;
  nicoRawFormat = 'legacy';
  currentDanmakuType = 'none';
  iina.postMessage("danmaku-type", { type: 'none' });
});

iina.onMessage("apply-settings", (data) => {
  if (data.opacity !== undefined) {
    canvasOpacity = data.opacity;
    const canvas = document.getElementById('niconicomments-canvas');
    if (canvas && canvasNicoMode !== 'css') canvas.style.opacity = data.opacity;
    const cssContainer = document.querySelector('[data-dm-css-container]');
    if (cssContainer) cssContainer.style.opacity = data.opacity;
  }
  if (data.canvasFontScale !== undefined) canvasFontScale = data.canvasFontScale;
  if (data.canvasMode !== undefined) canvasNicoMode = data.canvasMode;
  if (data.strokeColor !== undefined) strokeColor = data.strokeColor;
  if (data.strokeInversionColor !== undefined) strokeInversionColor = data.strokeInversionColor;
  if (data.strokeOpacity !== undefined) strokeOpacity = data.strokeOpacity;
  if (data.strokeWidth !== undefined) strokeWidth = data.strokeWidth;
  if (data.commentLimit !== undefined) commentLimit = data.commentLimit;
  if (data.scrollSpeed !== undefined) scrollSpeed = data.scrollSpeed;
});

iina.postMessage("overlay-ready", {});
