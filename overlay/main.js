/**
 * main.js — 弹幕引擎主入口
 *
 * 负责引擎状态管理、IINA 消息处理、事件循环调度。
 * 支持两种渲染模式：CSS模式（默认）和Canvas模式（niconicomments）。
 */

// --- 引擎状态（视频层面，两种模式共用）---
let allDanmaku = [];
let currentIndex = 0;
let lastTime = 0;
let isPaused = false;
let lastReverseState = false;
let lastSeekDisabled = false;

// --- CSS模式专用参数 ---
let cssOpacity = 0.8;
let cssFontScale = 1.0;

// --- Canvas模式专用参数 ---
let canvasOpacity = 0.8;
let canvasFontScale = 1.0;
let canvasNicoMode = 'default'; // 'default' | 'html5' | 'flash'
let canvasIsPlaying = false;
let canvasPlaybackRate = 1.0;
let canvasVideoAnchorTime = 0;
let canvasSystemAnchorTime = 0;

// --- 渲染模式 ---
let renderMode = 'css'; // 'css' | 'canvas'
let niconiComments = null;
let nicoRawData = null;
let canvasRafId = null;

function isCanvasMode() {
  return renderMode === 'canvas';
}

function canvasSyncAnchor(videoTimeSec) {
  canvasVideoAnchorTime = videoTimeSec;
  canvasSystemAnchorTime = performance.now();
}

function canvasGetCurrentTime() {
  if (!canvasIsPlaying) {
    return canvasVideoAnchorTime;
  }
  const elapsedSec = (performance.now() - canvasSystemAnchorTime) / 1000;
  return canvasVideoAnchorTime + elapsedSec * canvasPlaybackRate;
}

function detectNicoFormat(data) {
  if (data instanceof XMLDocument) return 'niconicome';
  if (Array.isArray(data) && data.length > 0) {
    if (data[0].fork !== undefined && data[0].comments !== undefined) return 'v1';
  }
  return 'legacy';
}

function buildCanvasPlugins() {
  const plugins = [];
  if (typeof PluginNiwango === 'function' && typeof Niwango !== 'undefined') {
    plugins.push(PluginNiwango(Niwango));
  }
  return plugins;
}

function initCanvasRenderer(data) {
  const canvas = document.getElementById('niconicomments-canvas');
  if (!canvas || typeof NiconiComments === 'undefined') return;

  canvas.width = 1920;
  canvas.height = 1080;
  canvas.style.opacity = canvasOpacity;

  if (niconiComments) {
    niconiComments.clear();
  }

  const renderer = NiconiComments.internal.renderer.createRenderer(canvas);

  niconiComments = new NiconiComments(renderer, data, {
    format: detectNicoFormat(data),
    mode: canvasNicoMode,
    keepCA: true,
    scale: canvasFontScale,
    config: {
      plugins: buildCanvasPlugins(),
    },
  });
  nicoRawData = data;

  niconiComments.addEventListener("seekDisable", () => {
    iina.postMessage("seek-disable", {});
  });
  niconiComments.addEventListener("seekEnable", () => {
    iina.postMessage("seek-enable", {});
  });
  niconiComments.addEventListener("jump", (e) => {
    if (e.targetVpos !== null && e.targetVpos !== undefined) {
      iina.postMessage("jump", { targetSec: e.targetVpos / 100, message: e.message, to: e.to });
    } else if (e.to) {
      iina.postMessage("jump-video", { videoId: e.to, message: e.message });
    }
  });
}

function destroyCanvasRenderer() {
  if (canvasRafId) {
    cancelAnimationFrame(canvasRafId);
    canvasRafId = null;
  }
  canvasIsPlaying = false;
  if (niconiComments) {
    niconiComments.clear();
    niconiComments = null;
  }
}

function canvasRenderLoop() {
  if (!niconiComments) return;
  const videoTime = canvasGetCurrentTime();
  const vpos = videoTime * 100;
  niconiComments.drawCanvas(vpos);
  canvasRafId = requestAnimationFrame(canvasRenderLoop);
}

function startCanvasLoop() {
  if (canvasRafId) return;
  canvasRafId = requestAnimationFrame(canvasRenderLoop);
}

function switchRenderMode(mode) {
  if (mode === renderMode) return;
  renderMode = mode;

  document.body.classList.toggle('canvas-mode', mode === 'canvas');

  if (mode === 'canvas') {
    clearAllDanmaku();
    canvasIsPlaying = !isPaused;
    canvasSyncAnchor(lastTime / 100);
    if (nicoRawData) {
      initCanvasRenderer(nicoRawData);
      startCanvasLoop();
    } else {
      iina.postMessage("canvas-unsupported", {});
    }
  } else {
    destroyCanvasRenderer();
    handleSeek(lastTime);
  }
}

/**
 * Seek 处理：重置画面并从指定时间点重新渲染
 */
function handleSeek(timeVpos) {
  // CSS模式专用
  const { scrollDuration, fixedDuration } = getRendererConfig();
  clearAllDanmaku();
  resetLaneData();
  updateLanes();

  const durVpos = Math.max(scrollDuration, fixedDuration) / 10;
  currentIndex = allDanmaku.findIndex(d => d.t >= timeVpos - durVpos);
  if (currentIndex === -1) currentIndex = allDanmaku.length;

  let tempIndex = currentIndex;
  while (tempIndex < allDanmaku.length && allDanmaku[tempIndex].t <= timeVpos) {
    const d = allDanmaku[tempIndex];
    const typeDur = (d.m >= 1 && d.m <= 6) ? scrollDuration : fixedDuration;
    if (timeVpos - d.t < typeDur / 10) {
      createDanmaku(d, timeVpos);
    }
    tempIndex++;
  }
  currentIndex = tempIndex;

  lastReverseState = isReverseActive(timeVpos, false);
}

// ===================== IINA 消息处理 =====================

iina.onMessage("time-update", (data) => {
  let t = data.time * 100;

  if (isCanvasMode()) {
    canvasSyncAnchor(data.time);
    lastTime = t;
    return;
  }

  // --- 以下为CSS模式专用逻辑 ---
  if (Math.abs(t - lastTime) > 150) {
    handleSeek(t);
  } else if (!isPaused) {
    while (currentIndex < allDanmaku.length && allDanmaku[currentIndex].t <= t) {
      createDanmaku(allDanmaku[currentIndex], t);
      currentIndex++;
    }
  }

  // 逆播放状态切换
  const currentReverseState = isReverseActive(t, false);
  if (currentReverseState !== lastReverseState && !isCanvasMode() && getActiveDanmaku().size > 0) {
    reverseAllActiveDanmaku(currentReverseState, lastTime);
    lastReverseState = currentReverseState;
  }

  // 拖动禁止状态切换
  const currentSeekDisabled = isSeekDisabled(t);
  if (currentSeekDisabled !== lastSeekDisabled) {
    iina.postMessage(currentSeekDisabled ? "seek-disable" : "seek-enable", {});
    lastSeekDisabled = currentSeekDisabled;
  }

  // 跳转脚本触发
  for (const jump of nicoScripts.jump) {
    if (jump.start <= t && t - jump.start < 20) {
      if (jump._fired) continue;
      jump._fired = true;
      if (jump.targetVpos !== null) {
        iina.postMessage("jump", { targetSec: jump.targetVpos / 100, message: jump.message, to: jump.to });
      } else {
        iina.postMessage("jump-video", { videoId: jump.to, message: jump.message });
      }
    }
  }

  lastTime = t;
});

iina.onMessage("load-danmaku", (data) => {
  if (data.fontScale) {
    cssFontScale = data.fontScale;
    setRendererConfig({ fontScale: data.fontScale });
    setLaneConfig({ fontScale: data.fontScale });
  }
  if (data.scrollDuration) setRendererConfig({ scrollDuration: data.scrollDuration });
  if (data.opacity) {
    cssOpacity = data.opacity;
    document.documentElement.style.setProperty('--global-opacity', data.opacity);
  }
  updateLanes();

  // 重置 Nicoscript 状态
  resetNicoScripts();
  lastReverseState = false;

  // 解析弹幕数据
  const encodedStr = data.xmlContent.replace(/(..)/g, '%$1');
  let list = parseDanmaku(encodedStr);

  // 排序
  allDanmaku = list.sort((a, b) => a.t - b.t);

  // CA 层分离：识别弹幕画并分配独立 layer
  if (typeof assignCALayers === 'function') {
    assignCALayers(allDanmaku);
  }

  // Canvas模式：保存原始数据供niconicomments使用（不支持Bilibili XML）
  var danmakuType = 'unknown';
  try {
    const rawStr = decodeURIComponent(encodedStr);
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(rawStr, "text/xml");
    const chats = xmlDoc.getElementsByTagName('chat');
    if (chats.length > 0) {
      nicoRawData = xmlDoc;
      danmakuType = 'nico-xml';
    } else if (xmlDoc.getElementsByTagName('d').length > 0) {
      nicoRawData = null;
      danmakuType = 'bilibili-xml';
    } else {
      nicoRawData = JSON.parse(rawStr);
      danmakuType = 'nico-json';
    }
  } catch (e) {
    nicoRawData = null;
    danmakuType = 'unknown';
  }

  iina.postMessage("danmaku-type", { type: danmakuType });

  if (isCanvasMode() && nicoRawData) {
    canvasIsPlaying = !isPaused;
    canvasSyncAnchor(0);
    initCanvasRenderer(nicoRawData);
    startCanvasLoop();
  } else {
    lastTime = 0;
    if (isCanvasMode()) {
      switchRenderMode('css');
    }
    handleSeek(0);
  }
});

iina.onMessage("resize", () => {
  updateLanes();

  if (isCanvasMode()) {
    if (nicoRawData) {
      initCanvasRenderer(nicoRawData);
    }
    return;
  }

  clearDanmakuCaches(allDanmaku);

  const active = getActiveDanmaku();
  active.forEach(item => {
    if (item.type === 'fixed') {
      const winW = window.innerWidth;
      const textW = item.el.offsetWidth;
      const maxW = item.d.full ? winW : winW * 0.95;
      if (textW > maxW) {
        item.el.style.transform = `translateX(-50%) scaleX(${maxW / textW})`;
      } else {
        item.el.style.transform = `translateX(-50%)`;
      }
    }
  });
});

iina.onMessage("pause-state", (data) => {
  isPaused = data.paused;
  document.body.classList.toggle('is-paused', isPaused);
  if (isCanvasMode()) {
    canvasIsPlaying = !isPaused;
    canvasSyncAnchor(lastTime / 100);
  }
});

iina.onMessage("playback-speed", (data) => {
  if (isCanvasMode()) {
    canvasPlaybackRate = data.speed;
    canvasSyncAnchor(canvasGetCurrentTime());
  }
});

iina.onMessage("toggle-danmaku", (data) => {
  setRendererConfig({ danmakuVisible: data.enabled });
  if (isCanvasMode()) {
    const canvas = document.getElementById('niconicomments-canvas');
    if (canvas) canvas.style.display = data.enabled ? '' : 'none';
    if (!data.enabled && niconiComments) {
      niconiComments.clear();
    }
  } else {
    const container = getContainer();
    container.style.display = data.enabled ? '' : 'none';
    if (!data.enabled) {
      clearAllDanmaku();
    }
  }
});

iina.onMessage("set-opacity", (data) => {
  if (isCanvasMode()) {
    canvasOpacity = data.opacity;
    const canvas = document.getElementById('niconicomments-canvas');
    if (canvas) canvas.style.opacity = data.opacity;
  } else {
    cssOpacity = data.opacity;
    document.documentElement.style.setProperty('--global-opacity', data.opacity);
  }
});

iina.onMessage("set-fontscale", (data) => {
  if (isCanvasMode()) {
    canvasFontScale = data.scale;
    if (nicoRawData) initCanvasRenderer(nicoRawData);
  } else {
    cssFontScale = data.scale;
    setRendererConfig({ fontScale: data.scale });
    setLaneConfig({ fontScale: data.scale });
    updateLanes();
    clearDanmakuCaches(allDanmaku);
    handleSeek(lastTime);
  }
});

iina.onMessage("set-scroll-duration", (data) => {
  setRendererConfig({ scrollDuration: data.duration });
});

iina.onMessage("clear-danmaku", () => {
  if (isCanvasMode()) {
    destroyCanvasRenderer();
  } else {
    clearAllDanmaku();
  }
  allDanmaku = [];
  currentIndex = 0;
  iina.postMessage("danmaku-type", { type: 'none' });
});

iina.onMessage("apply-settings", (data) => {
  if (data.opacity !== undefined) {
    if (isCanvasMode()) {
      canvasOpacity = data.opacity;
      const canvas = document.getElementById('niconicomments-canvas');
      if (canvas) canvas.style.opacity = data.opacity;
    } else {
      cssOpacity = data.opacity;
      document.documentElement.style.setProperty('--global-opacity', data.opacity);
    }
  }
  if (data.fontScale !== undefined) {
    if (isCanvasMode()) {
      canvasFontScale = data.fontScale;
    } else {
      cssFontScale = data.fontScale;
      setRendererConfig({ fontScale: data.fontScale });
      setLaneConfig({ fontScale: data.fontScale });
    }
  }
  if (data.scrollDuration !== undefined) setRendererConfig({ scrollDuration: data.scrollDuration });
  if (data.blockForceLane !== undefined) setRendererConfig({ blockForceLane: data.blockForceLane });
  if (data.maxLaneRatio !== undefined) setLaneConfig({ maxLaneRatio: data.maxLaneRatio });
  if (!isCanvasMode()) updateLanes();
});

iina.onMessage("block-type", (data) => {
  window._blockScroll = data.blockScroll;
  window._blockTop = data.blockTop;
  window._blockBottom = data.blockBottom;
});

iina.onMessage("block-force-lane", (data) => {
  setRendererConfig({ blockForceLane: data.blockForceLane });
});

iina.onMessage("set-lane-limit", (data) => {
  if (data.maxLaneRatio !== undefined) {
    setLaneConfig({ maxLaneRatio: data.maxLaneRatio });
    updateLanes();
  }
});

iina.onMessage("set-render-mode", (data) => {
  switchRenderMode(data.mode);
});

iina.onMessage("set-canvas-mode", (data) => {
  canvasNicoMode = data.mode;
  if (isCanvasMode() && nicoRawData) {
    initCanvasRenderer(nicoRawData);
  }
});

// ===================== 初始化 =====================

updateLanes();

window.addEventListener("resize", () => {
  updateLanes();
  iina.postMessage("resize", {});
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && lastTime > 0) {
    handleSeek(lastTime);
  }
});

setTimeout(() => iina.postMessage("overlay-ready", {}), 300);
