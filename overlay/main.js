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

let danmakuFileMap = {};
let danmakuSeenKeys = {};

// --- CSS模式专用参数 ---
let cssOpacity = 0.8;
let cssFontScale = 1.0;
let cssFontFamily = 'default';
let cssFontWeight = 800;
let cssStrokeWidth = 0.1;

// --- Canvas模式专用参数 ---
let canvasOpacity = 0.8;
let canvasFontScale = 1.0;
let canvasNicoMode = 'default'; // 'default' | 'html5' | 'flash'

// --- 渲染模式 ---
let renderMode = 'css'; // 'css' | 'canvas'
let niconiComments = null;
let nicoRawData = null;
let nicoRawFormat = 'legacy';
let currentDanmakuType = 'none';
let canvasRafId = null;
let canvasVideoAnchorTime = 0;
let canvasSystemAnchorTime = 0;
let canvasIsPlaying = false;

function isCanvasMode() {
  return renderMode === 'canvas';
}

const FONT_FAMILY_MAP = {
  'default': "'Hiragino Sans', 'Hiragino Kaku Gothic ProN', 'Noto Sans JP', 'Meiryo', sans-serif",
  'hiragino-sans': "'Hiragino Sans', sans-serif",
  'hiragino-kaku': "'Hiragino Kaku Gothic ProN', sans-serif",
  'hiragino-mincho': "'Hiragino Mincho ProN', serif",
  'yu-gothic': "'Yu Gothic', '游ゴシック体', YuGothic, sans-serif",
  'yu-mincho': "'Yu Mincho', '游明朝体', YuMincho, serif",
  'noto-sans-jp': "'Noto Sans JP', sans-serif",
  'noto-serif-jp': "'Noto Serif JP', serif",
  'meiryo': "'Meiryo', 'メイリオ', sans-serif",
  'ms-pgothic': "'MS PGothic', 'ＭＳ Ｐゴシック', sans-serif",
  'pingfang-sc': "'PingFang SC', sans-serif",
  'pingfang-tc': "'PingFang TC', sans-serif",
  'heiti-sc': "'STHeiti', sans-serif",
  'songti-sc': "'Songti SC', serif",
  'stfangsong': "'STFangsong', serif",
  'simsun': "'SimSun', '宋体', serif",
  'microsoft-yahei': "'Microsoft YaHei', '微软雅黑', sans-serif",
  'wenquanyi-micro-hei': "'WenQuanYi Micro Hei', '文泉驿微米黑', sans-serif",
};

function applyCssFontPreferences() {
  const fontFamily = FONT_FAMILY_MAP[cssFontFamily] || FONT_FAMILY_MAP['default'];
  const scaledStroke = cssStrokeWidth * cssFontScale;
  window.__strokeBaseVh = scaledStroke;
  const strokeValue = scaledStroke > 0 ? scaledStroke + 'vh rgba(0,0,0,0.5)' : 'none';
  document.documentElement.style.setProperty('--dm-font-family', fontFamily);
  document.documentElement.style.setProperty('--dm-font-weight', String(cssFontWeight));
  document.documentElement.style.setProperty('--dm-stroke', strokeValue);
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
  return canvasVideoAnchorTime + elapsedSec;
}

function detectNicoFormat(data) {
  if (Array.isArray(data) && data.length > 0) {
    if (data[0].comments !== undefined && Array.isArray(data[0].comments)) return 'v1';
    if (data[0].chat !== undefined) return 'legacy';
  }
  return 'legacy';
}

function ensureV1Fields(data) {
  if (!Array.isArray(data)) return data;
  return data.map(function(thread, i) {
    if (thread.comments === undefined || !Array.isArray(thread.comments)) return thread;
    var t = Object.assign({}, thread);
    if (t.id === undefined) t.id = i;
    if (t.fork === undefined) t.fork = String(i);
    if (t.commentCount === undefined) t.commentCount = t.comments.length;
    t.comments = t.comments.map(function(c) {
      var comment = Object.assign({}, c);
      if (comment.score === undefined) comment.score = 0;
      if (comment.postedAt === undefined) comment.postedAt = '1970-01-01T00:00:00+09:00';
      if (comment.nicoruCount === undefined) comment.nicoruCount = 0;
      if (comment.nicoruId === undefined) comment.nicoruId = null;
      if (comment.source === undefined) comment.source = 'trunk';
      if (comment.isMyPost === undefined) comment.isMyPost = false;
      return comment;
    });
    return t;
  });
}

function detectRawDanmakuType(rawStr) {
  const s = rawStr ? rawStr.trim() : '';
  if (!s) return 'bilibili-xml';
  if (s.charAt(0) === '[') return 'nico-json';
  if (s.indexOf('<packet') !== -1) return 'nico-xml';
  return 'bilibili-xml';
}

function hasCommand(commands, values) {
  for (let i = 0; i < commands.length; i++) {
    const c = String(commands[i]).toLowerCase();
    if (values.indexOf(c) !== -1) return true;
  }
  return false;
}

function canvasMailFromDanmaku(d) {
  const mail = Array.isArray(d._commands) ? d._commands.slice() : [];
  if (!hasCommand(mail, ['naka', 'ue', 'shita'])) {
    if (d.m === 4) mail.push('shita');
    else if (d.m === 5) mail.push('ue');
    else mail.push('naka');
  }

  if (!hasCommand(mail, ['small', 'big', 'medium'])) {
    if (d.size >= 36) mail.push('big');
    else if (d.size <= 15) mail.push('small');
  }

  const color = d.c || '#FFFFFF';
  if (/^#[0-9a-f]{6}$/i.test(color) && color.toUpperCase() !== '#FFFFFF') {
    let hasColor = false;
    for (let i = 0; i < mail.length; i++) {
      if (resolveColor(mail[i])) {
        hasColor = true;
        break;
      }
    }
    if (!hasColor) mail.push(color);
  }

  return mail;
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
      mail: canvasMailFromDanmaku(d),
      user_id: toNumericUserId(d._userId, userMap),
      layer: d._layer === undefined ? -1 : d._layer,
      is_my_post: false
    });
  }
  return result;
}

function prepareCanvasSource(rawStr, parsedList, sourceType) {
  nicoRawData = null;
  nicoRawFormat = 'formatted';

  if (sourceType === 'nico-json') {
    try {
      const parsed = JSON.parse(rawStr);
      nicoRawData = ensureV1Fields(parsed);
      nicoRawFormat = detectNicoFormat(nicoRawData);
      return;
    } catch (e) {
      console.warn('niconicocomments JSON source parse failed, using formatted data:', e);
    }
  }

  nicoRawData = buildFormattedCanvasData(parsedList, sourceType);
  nicoRawFormat = 'formatted';
}

function buildCanvasPlugins() {
  const plugins = [];
  if (typeof PluginNiwango === 'function' && typeof Niwango !== 'undefined') {
    plugins.push(PluginNiwango(Niwango));
  }
  return plugins;
}

const canvasEventHandlers = {
  seekDisable: () => {
    iina.postMessage("seek-disable", {});
  },
  seekEnable: () => {
    iina.postMessage("seek-enable", {});
  },
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
  if (typeof niconiComments.destroy === 'function') {
    niconiComments.destroy();
  }
  niconiComments = null;
}

function initCanvasRenderer(data) {
  const canvas = document.getElementById('niconicomments-canvas');
  if (!canvas || typeof NiconiComments === 'undefined') return;

  canvas.width = 1920;
  canvas.height = 1080;
  canvas.style.opacity = canvasOpacity;

  disposeCanvasRenderer();

  const renderer = NiconiComments.internal.renderer.createRenderer(canvas);

  niconiComments = new NiconiComments(renderer, data, {
    format: nicoRawFormat,
    mode: canvasNicoMode,
    keepCA: true,
    scale: canvasFontScale,
    config: {
      plugins: buildCanvasPlugins(),
    },
  });
  nicoRawData = data;

  bindCanvasEvents(niconiComments);

  const _lastVpos = allDanmaku.length > 0 ? allDanmaku[allDanmaku.length - 1].t : 0;
  if (_lastVpos > 0) {
    const _c = document.getElementById('niconicomments-canvas');
    const _o = _c.style.opacity;
    _c.style.opacity = '0';
    niconiComments.drawCanvas(_lastVpos, true);
    niconiComments.drawCanvas(0, true);
    _c.style.opacity = _o;
  }
}

function destroyCanvasRenderer() {
  stopCanvasLoop();
  disposeCanvasRenderer();
}

function canvasRenderLoop() {
  if (!niconiComments) return;
  niconiComments.drawCanvas(canvasGetCurrentTime() * 100);
  canvasRafId = requestAnimationFrame(canvasRenderLoop);
}

function startCanvasLoop() {
  if (canvasRafId) return;
  canvasRafId = requestAnimationFrame(canvasRenderLoop);
}

function stopCanvasLoop() {
  if (canvasRafId !== null) {
    cancelAnimationFrame(canvasRafId);
    canvasRafId = null;
  }
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
    } else if (currentDanmakuType !== 'none' || allDanmaku.length > 0) {
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
function findDanmakuStartIndex(vpos) {
  let low = 0;
  let high = allDanmaku.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (allDanmaku[mid].t < vpos) low = mid + 1;
    else high = mid;
  }
  return low;
}

function handleSeek(timeVpos) {
  // CSS模式专用
  const { scrollDuration, fixedDuration } = getRendererConfig();
  clearAllDanmaku();
  resetLaneData();
  updateLanes();

  const durVpos = Math.max(scrollDuration, fixedDuration) / 10;
  currentIndex = findDanmakuStartIndex(timeVpos - durVpos);

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
    const isSeek = Math.abs(t - lastTime) > 150;
    if (isSeek) stopCanvasLoop();
    canvasSyncAnchor(data.time);
    lastTime = t;
    if (isSeek && niconiComments) {
      niconiComments.drawCanvas(t);
      startCanvasLoop();
    }
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
  const incomingCssFontScale = data.cssFontScale !== undefined ? data.cssFontScale : data.fontScale;
  if (incomingCssFontScale !== undefined) {
    cssFontScale = incomingCssFontScale;
    setRendererConfig({ fontScale: incomingCssFontScale });
    setLaneConfig({ fontScale: incomingCssFontScale });
  }
  if (data.canvasFontScale !== undefined) {
    canvasFontScale = data.canvasFontScale;
  }
  if (data.scrollDuration) setRendererConfig({ scrollDuration: data.scrollDuration });
  if (data.opacity) {
    cssOpacity = data.opacity;
    document.documentElement.style.setProperty('--global-opacity', data.opacity);
  }
  if (data.cssFontFamily !== undefined) cssFontFamily = data.cssFontFamily;
  if (data.cssFontWeight !== undefined) cssFontWeight = data.cssFontWeight;
  if (data.cssStrokeWidth !== undefined) cssStrokeWidth = data.cssStrokeWidth;
  applyCssFontPreferences();
  updateLanes();

  resetNicoScripts();
  lastReverseState = false;

  danmakuFileMap = {};
  danmakuSeenKeys = {};

  const encodedStr = data.xmlContent;
  const rawStr = decodeURIComponent(encodedStr);
  let list = parseDanmaku(encodedStr);

  var filePath = data.path || '__initial__';
  danmakuFileMap[filePath] = list;

  allDanmaku = list.sort((a, b) => a.t - b.t);

  if (typeof assignCALayers === 'function') {
    assignCALayers(allDanmaku);
  }

  var danmakuType = data.danmakuType || detectRawDanmakuType(rawStr);
  currentDanmakuType = danmakuType;
  prepareCanvasSource(rawStr, allDanmaku, danmakuType);

  iina.postMessage("danmaku-type", { type: danmakuType });

  let switchedRenderMode = false;
  if (data.renderMode !== undefined && data.renderMode !== renderMode) {
    switchRenderMode(data.renderMode);
    switchedRenderMode = true;
  }

  if (isCanvasMode() && nicoRawData) {
    canvasIsPlaying = !isPaused;
    canvasSyncAnchor(0);
    if (!switchedRenderMode) initCanvasRenderer(nicoRawData);
    startCanvasLoop();
  } else {
    lastTime = 0;
    if (isCanvasMode()) {
      switchRenderMode('css');
    }
    handleSeek(0);
  }
});

iina.onMessage("add-danmaku-file", (data) => {
  const filePath = data.path;
  const encodedStr = data.xmlContent;
  let list = parseDanmaku(encodedStr);

  danmakuFileMap[filePath] = list;

  // Populate danmakuSeenKeys from the first file's data if this is the first
  // additional file being added (single-file scenario skips this entirely)
  if (allDanmaku.length > 0) {
    let empty = true;
    for (let k in danmakuSeenKeys) { empty = false; break; }
    if (empty) {
      for (let i = 0; i < allDanmaku.length; i++) {
        const d = allDanmaku[i];
        danmakuSeenKeys[d.t + '|' + d.text] = true;
      }
    }
  }

  let newItems = [];
  for (let i = 0; i < list.length; i++) {
    const d = list[i];
    const key = d.t + '|' + d.text;
    if (!danmakuSeenKeys[key]) {
      danmakuSeenKeys[key] = true;
      newItems.push(d);
    }
  }

  if (newItems.length > 0) {
    allDanmaku = allDanmaku.concat(newItems).sort((a, b) => a.t - b.t);

    if (typeof assignCALayers === 'function') {
      assignCALayers(allDanmaku);
    }

    if (isCanvasMode()) {
      prepareCanvasSource('', allDanmaku, currentDanmakuType);
      initCanvasRenderer(nicoRawData);
    } else {
      handleSeek(lastTime);
    }
  }
});

iina.onMessage("remove-danmaku-file", (data) => {
  const filePath = data.path;
  const removedList = danmakuFileMap[filePath];
  if (!removedList) return;

  for (let i = 0; i < removedList.length; i++) {
    const d = removedList[i];
    const key = d.t + '|' + d.text;
    delete danmakuSeenKeys[key];
  }

  delete danmakuFileMap[filePath];

  const removedSet = new Set(removedList);
  allDanmaku = allDanmaku.filter(d => !removedSet.has(d));

  for (const path in danmakuFileMap) {
    const fileList = danmakuFileMap[path];
    for (let i = 0; i < fileList.length; i++) {
      const d = fileList[i];
      const key = d.t + '|' + d.text;
      danmakuSeenKeys[key] = true;
    }
  }

  if (typeof assignCALayers === 'function') {
    assignCALayers(allDanmaku);
  }

  if (isCanvasMode()) {
    prepareCanvasSource('', allDanmaku, currentDanmakuType);
    if (nicoRawData) initCanvasRenderer(nicoRawData);
  } else {
    clearAllDanmaku();
    handleSeek(lastTime);
  }
});

iina.onMessage("resize", () => {
  updateLanes();

  if (isCanvasMode()) {
    if (niconiComments) niconiComments.clear();
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
  if (data.mode === 'canvas' || (data.mode === undefined && isCanvasMode())) {
    canvasFontScale = data.scale;
    if (isCanvasMode() && nicoRawData) {
      initCanvasRenderer(nicoRawData);
    }
    return;
  }

  cssFontScale = data.scale;
  applyCssFontPreferences();
  setRendererConfig({ fontScale: data.scale });
  setLaneConfig({ fontScale: data.scale });
  updateLanes();
  clearDanmakuCaches(allDanmaku);
  handleSeek(lastTime);
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
  danmakuFileMap = {};
  danmakuSeenKeys = {};
  nicoRawData = null;
  nicoRawFormat = 'legacy';
  currentDanmakuType = 'none';
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
  const incomingCssFontScale = data.cssFontScale !== undefined ? data.cssFontScale : data.fontScale;
  if (incomingCssFontScale !== undefined) {
    cssFontScale = incomingCssFontScale;
    setRendererConfig({ fontScale: incomingCssFontScale });
    setLaneConfig({ fontScale: incomingCssFontScale });
  }
  if (data.canvasFontScale !== undefined) {
    canvasFontScale = data.canvasFontScale;
  }
  if (data.scrollDuration !== undefined) setRendererConfig({ scrollDuration: data.scrollDuration });
  if (data.blockForceLane !== undefined) setRendererConfig({ blockForceLane: data.blockForceLane });
  if (data.maxLaneRatio !== undefined) setLaneConfig({ maxLaneRatio: data.maxLaneRatio });
  if (data.cssFontFamily !== undefined) cssFontFamily = data.cssFontFamily;
  if (data.cssFontWeight !== undefined) cssFontWeight = data.cssFontWeight;
  if (data.cssStrokeWidth !== undefined) cssStrokeWidth = data.cssStrokeWidth;
  applyCssFontPreferences();
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

iina.postMessage("overlay-ready", {});
