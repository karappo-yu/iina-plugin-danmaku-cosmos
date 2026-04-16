/**
 * main.js — 弹幕引擎主入口
 *
 * 负责引擎状态管理、IINA 消息处理、事件循环调度。
 * 支持两种渲染模式：CSS模式（默认）和Canvas模式（niconicomments）。
 */

// --- 引擎状态 ---
let allDanmaku = [];
let currentIndex = 0;
let lastTime = 0;
let isPaused = false;
let lastReverseState = false;
let lastSeekDisabled = false;

// --- 动态参数 ---
let currentOpacity = 0.8;
let currentFontScale = 1.0;

// --- 渲染模式 ---
let renderMode = 'css'; // 'css' | 'canvas'
let niconiComments = null;
let nicoRawData = null;
let canvasIntervalId = null;
let canvasTimeRef = null;

function isCanvasMode() {
  return renderMode === 'canvas';
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
  canvas.style.opacity = currentOpacity;

  if (niconiComments) {
    niconiComments.clear();
  }

  const renderer = NiconiComments.internal.renderer.createRenderer(canvas);

  niconiComments = new NiconiComments(renderer, data, {
    format: detectNicoFormat(data),
    keepCA: true,
    scale: currentFontScale,
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
  if (canvasIntervalId) {
    clearInterval(canvasIntervalId);
    canvasIntervalId = null;
  }
  canvasTimeRef = null;
  if (niconiComments) {
    niconiComments.clear();
    niconiComments = null;
  }
}

function canvasUpdateCanvas() {
  if (!niconiComments) return;
  let vpos;
  if (!canvasTimeRef) {
    vpos = lastTime;
  } else {
    vpos = (performance.now() - canvasTimeRef.microsec) / 10 + canvasTimeRef.currentTime * 100;
  }
  niconiComments.drawCanvas(vpos);
}

function startCanvasLoop() {
  if (canvasIntervalId) return;
  canvasIntervalId = setInterval(canvasUpdateCanvas, 1);
}

function switchRenderMode(mode) {
  if (mode === renderMode) return;
  renderMode = mode;

  document.body.classList.toggle('canvas-mode', mode === 'canvas');

  if (mode === 'canvas') {
    clearAllDanmaku();
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
    if (!isPaused) {
      canvasTimeRef = {
        currentTime: data.time,
        microsec: performance.now(),
      };
    }
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
  // 设置参数
  if (data.fontScale) {
    currentFontScale = data.fontScale;
    setRendererConfig({ fontScale: data.fontScale });
    setLaneConfig({ fontScale: data.fontScale });
  }
  if (data.scrollDuration) setRendererConfig({ scrollDuration: data.scrollDuration });
  if (data.opacity) {
    currentOpacity = data.opacity;
    document.documentElement.style.setProperty('--global-opacity', currentOpacity);
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
  try {
    const rawStr = decodeURIComponent(encodedStr);
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(rawStr, "text/xml");
    const chats = xmlDoc.getElementsByTagName('chat');
    if (chats.length > 0) {
      nicoRawData = xmlDoc;
    } else if (xmlDoc.getElementsByTagName('d').length > 0) {
      nicoRawData = null;
    } else {
      nicoRawData = JSON.parse(rawStr);
    }
  } catch (e) {
    nicoRawData = null;
  }

  if (isCanvasMode() && nicoRawData) {
    initCanvasRenderer(nicoRawData);
    startCanvasLoop();
  } else {
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
    canvasTimeRef = isPaused ? null : {
      currentTime: lastTime / 100,
      microsec: performance.now(),
    };
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
  currentOpacity = data.opacity;
  document.documentElement.style.setProperty('--global-opacity', currentOpacity);
  if (isCanvasMode()) {
    const canvas = document.getElementById('niconicomments-canvas');
    if (canvas) canvas.style.opacity = currentOpacity;
  }
});

iina.onMessage("set-fontscale", (data) => {
  currentFontScale = data.scale;
  setRendererConfig({ fontScale: data.scale });
  setLaneConfig({ fontScale: data.scale });
  updateLanes();
  if (isCanvasMode()) {
    if (nicoRawData) initCanvasRenderer(nicoRawData);
  } else {
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
});

iina.onMessage("apply-settings", (data) => {
  if (data.opacity !== undefined) {
    currentOpacity = data.opacity;
    document.documentElement.style.setProperty('--global-opacity', currentOpacity);
    if (isCanvasMode()) {
      const canvas = document.getElementById('niconicomments-canvas');
      if (canvas) canvas.style.opacity = currentOpacity;
    }
  }
  if (data.fontScale !== undefined) {
    currentFontScale = data.fontScale;
    setRendererConfig({ fontScale: data.fontScale });
    setLaneConfig({ fontScale: data.fontScale });
  }
  if (data.scrollDuration !== undefined) setRendererConfig({ scrollDuration: data.scrollDuration });
  if (data.blockForceLane !== undefined) setRendererConfig({ blockForceLane: data.blockForceLane });
  if (data.maxLaneRatio !== undefined) setLaneConfig({ maxLaneRatio: data.maxLaneRatio });
  updateLanes();
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
