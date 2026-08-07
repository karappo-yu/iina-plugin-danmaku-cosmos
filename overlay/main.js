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
let scrollSpeed = 1.0; // 滚动速度倍率 (0.5 ~ 2.0), 通过 naka 弹幕 long 命令实现
let danmakuTimeOffsetSec = 0;
let danmakuFontFamily = "";
let danmakuFontWeight = "";

let niconiComments = null;
let nicoRawData = null;
let rawFormattedData = null; // 未注入滚动速度 long 命令的原始 formatted 数据
let rawNicoJsonData = null; // 未注入滚动速度 long 命令的原始 nico-json 数据
let nicoRawFormat = 'legacy';
let currentDanmakuType = 'none';
let canvasRafId = null;
let canvasVideoAnchorTime = 0;
let canvasSystemAnchorTime = 0;
let canvasIsPlaying = false;
let playbackSpeed = 1.0;
let danmakuVisible = true;
let danmakuForceSimplified = false;
// 初始化OpenCC转换器
let toSimplified = function(text) { return text; }; // 兜底函数
function updateSimplifiedConverter(enabled) {
  danmakuForceSimplified = !!enabled;
  if (danmakuForceSimplified) {
    try {
      const converter = OpenCC.Converter({ from: 'hk', to: 'cn' });
      toSimplified = function(text) {
        if (!text) return "";
        return converter(text);
      };
    } catch (e) {
      console.error("[Danmaku Cosmos] OpenCC 库加载失败，请检查文件路径:", e);
      toSimplified = function(text) { return text || ''; };
    }
  } else {
    toSimplified = function(text) { return text || ''; };
  }
}

updateSimplifiedConverter(danmakuForceSimplified);

function canvasSyncAnchor(videoTimeSec) {
  canvasVideoAnchorTime = videoTimeSec;
  canvasSystemAnchorTime = performance.now();
}

function canvasGetCurrentTime() {
  const baseTime = !canvasIsPlaying ? canvasVideoAnchorTime : canvasVideoAnchorTime + ((performance.now() - canvasSystemAnchorTime) / 1000) * playbackSpeed;
  return baseTime + danmakuTimeOffsetSec;
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
      no: d._no || 0,
      vpos: Math.round(d.t || 0),
      content: toSimplified(d.text || ''),
      date: d._dateSec || 0,
      date_usec: 0,
      owner: sourceType !== 'bilibili-xml' && !!d._isOwner,
      premium: true,
      mail: Array.isArray(d._commands) ? d._commands : [],
      user_id: toNumericUserId(d._userId, userMap),
      layer: d._layer === undefined ? -1 : d._layer,
      is_my_post: false
    });
  }
  return result;
}

function prepareCanvasSource(rawStr, parsedList, sourceType) {
  nicoRawData = null;
  rawFormattedData = null;
  rawNicoJsonData = null;
  nicoRawFormat = 'formatted';
  if (sourceType === 'nico-json') {
    try {
      rawNicoJsonData = JSON.parse(rawStr);
      nicoRawData = JSON.parse(rawStr); // 独立副本,避免重复注入叠加
      nicoRawFormat = detectNicoFormat(nicoRawData);
      applyScrollSpeedToNicoJson(nicoRawData);
      return;
    } catch (e) {
      console.warn('niconicocomments JSON parse failed, using formatted data:', e);
    }
  }
  rawFormattedData = buildFormattedCanvasData(parsedList, sourceType);
  applyScrollSpeed();
  nicoRawFormat = 'formatted';
}

// nico-json (v1/legacy 线程数组) 的滚动速度注入:
// v1: thread.comments[].commands 数组; legacy: thread.chat[].mail 字符串
function applyScrollSpeedToNicoJson(data) {
  if (!Array.isArray(data)) return;
  var k = scrollSpeed;
  if (!isFinite(k) || k <= 0) k = 1;
  if (k >= 1) return; // 100% = 原生速度,不做任何处理
  var longSecs = Math.max(0.5, 4 / k - 1);
  for (var i = 0; i < data.length; i++) {
    var thread = data[i];
    if (!thread) continue;
    var comments = Array.isArray(thread.comments) ? thread.comments : (Array.isArray(thread.chat) ? thread.chat : null);
    if (!comments) continue;
    for (var j = 0; j < comments.length; j++) {
      var c = comments[j];
      if (!c) continue;
      var cmds = Array.isArray(c.commands) ? c.commands : (typeof c.mail === 'string' ? c.mail.split(/\s+/).filter(Boolean) : null);
      if (!cmds) continue;
      if (cmds.indexOf('ue') !== -1 || cmds.indexOf('shita') !== -1) continue; // 固定弹幕不注入
      if (cmds.some(function (m) { return /^[@＠][0-9.]/.test(m); })) continue; // 自带时长命令不动
      cmds.push('@' + longSecs);
      if (typeof c.mail === 'string') c.mail = cmds.join(' '); // legacy 字符串同步回写
    }
  }
}

// 滚动弹幕速度倍率: 引擎 speed = (画布宽 + 弹幕宽×offset) / (long + 100)
// long 在分母 → 通过给 naka 弹幕注入 @秒数 命令(nicoscript 显示时长)实现真实速度倍率。
// 默认 long=300 (3s): 目标倍率 k → long = 400/k - 100 (vpos) = 4/k - 1 (秒)
function applyScrollSpeed() {
  if (!rawFormattedData) {
    nicoRawData = null;
    return;
  }
  var k = scrollSpeed;
  if (!isFinite(k) || k <= 0) k = 1;
  if (k >= 1) { // 100% = 原生速度,不做任何处理
    nicoRawData = rawFormattedData;
    return;
  }
  var longSecs = Math.max(0.5, 4 / k - 1);
  nicoRawData = rawFormattedData.map(function (c) {
    var mail = c.mail;
    if (!Array.isArray(mail)) return c;
    // 滚动弹幕判定: 显式 naka, 或没有 ue/shita 位置命令(本地 nico XML 的默认弹幕 mail 为空)
    var isScroll = mail.indexOf('naka') !== -1 || (mail.indexOf('ue') === -1 && mail.indexOf('shita') === -1);
    if (!isScroll) return c;
    if (mail.some(function (m) { return /^[@＠][0-9.]/.test(m); })) return c; // 自带时长命令的不动
    return Object.assign({}, c, { mail: mail.concat(['@' + longSecs]) });
  });
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

var DEFAULT_DANMAKU_FONT_STACKS = {
  gothic: { font: '"游ゴシック体", "游ゴシック", "Yu Gothic", YuGothic, yugothic, YuGo-Medium, "Hiragino Sans", HiraginoSans', offset: -0.04, weight: 400 },
  mincho: { font: '"游明朝体", "游明朝", "Yu Mincho", YuMincho, yumincho, YuMin-Medium, "Hiragino Mincho ProN", HiraMinProN, "Hiragino Mincho ProN W3", HiraMinProN-W3', offset: -0.01, weight: 400 },
  defont: { font: '"Hiragino Sans", "ヒラギノ角ゴシック", HiraginoSans', offset: -0.05, weight: 600 },
};

function buildDanmakuFontConfig() {
  var weight = danmakuFontWeight ? parseInt(danmakuFontWeight, 10) : 400;
  if (isNaN(weight) || weight < 100 || weight > 900) weight = 400;
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
      fonts: buildDanmakuFontConfig(),
    },
  });
  nicoRawData = data;
  // 初始化时同步当前播放速度(CSS 模式滚动动画时长按倍率缩放)
  if (niconiComments && niconiComments.setPlaybackSpeed) {
    niconiComments.setPlaybackSpeed(playbackSpeed);
  }
  bindCanvasEvents(niconiComments);
  drawCanvasAtVpos(canvasGetCurrentTime() * 100, true);
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
    niconiComments.clear();
    drawCanvasAtVpos(t, true);
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
  if (data.danmakuTimeOffsetSec !== undefined) danmakuTimeOffsetSec = Number(data.danmakuTimeOffsetSec) || 0;
  if (data.danmakuFontFamily !== undefined) danmakuFontFamily = data.danmakuFontFamily || "";
  if (data.danmakuFontWeight !== undefined) danmakuFontWeight = data.danmakuFontWeight || "";
  if (data.opacity !== undefined) {
    canvasOpacity = data.opacity;
    const canvas = document.getElementById('niconicomments-canvas');
    if (canvas && canvasNicoMode !== 'css') canvas.style.opacity = data.opacity;
    const cssContainer = document.querySelector('[data-dm-css-container]');
    if (cssContainer) cssContainer.style.opacity = data.opacity;
  }

  if (data.danmakuForceSimplified !== undefined) {
    updateSimplifiedConverter(data.danmakuForceSimplified);
  }

  const encodedStr = data.xmlContent;
  let rawStr;
  try { rawStr = decodeURIComponent(encodedStr); } catch (e) {
    console.log('[overlay] decodeURIComponent failed: ' + e);
    return;
  }

  var danmakuType = data.danmakuType || detectRawDanmakuType(rawStr);
  currentDanmakuType = danmakuType;

  if (danmakuType === 'dandanplay') {
    try {
      allDanmaku = JSON.parse(rawStr);
    } catch (e) {
      console.log('[overlay] parse dandanplay failed: ' + e);
      allDanmaku = [];
    }
  } else if (danmakuType === 'nico-json') {
    allDanmaku = [];
  } else {
    allDanmaku = parseDanmaku(rawStr, true);
  }

  prepareCanvasSource(rawStr, allDanmaku, danmakuType);
  allDanmaku = [];

  iina.postMessage("danmaku-type", { type: danmakuType });

  if (nicoRawData) {
    canvasIsPlaying = !isPaused;
    if (!data.preservePosition) {
      canvasSyncAnchor(0);
    }
    initCanvasRenderer(nicoRawData);
    startCanvasLoop();
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
  // 通知 CSS 渲染器:速度变化时重设滚动动画时长(1x 无操作)
  if (niconiComments && niconiComments.setPlaybackSpeed) {
    niconiComments.setPlaybackSpeed(playbackSpeed);
  }
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
  if (rawFormattedData) {
    applyScrollSpeed();
    initCanvasRenderer(nicoRawData);
  } else if (rawNicoJsonData) {
    nicoRawData = JSON.parse(JSON.stringify(rawNicoJsonData));
    applyScrollSpeedToNicoJson(nicoRawData);
    initCanvasRenderer(nicoRawData);
  }
});

iina.onMessage("set-danmaku-offset", (data) => {
  if (data.offset !== undefined) {
    danmakuTimeOffsetSec = Number(data.offset) || 0;
  }
  if (nicoRawData) {
    drawCanvasAtVpos(canvasGetCurrentTime() * 100, true);
  }
});

iina.onMessage("set-danmaku-font", (data) => {
  if (data.fontFamily !== undefined) danmakuFontFamily = data.fontFamily || "";
  if (data.fontWeight !== undefined) danmakuFontWeight = data.fontWeight || "";
  if (nicoRawData) initCanvasRenderer(nicoRawData);
});

iina.onMessage("clear-danmaku", () => {
  destroyCanvasRenderer();
  const cssContainer = document.querySelector('[data-dm-css-container]');
  if (cssContainer) cssContainer.remove();
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
  if (data.danmakuTimeOffsetSec !== undefined) danmakuTimeOffsetSec = Number(data.danmakuTimeOffsetSec) || 0;
  if (data.danmakuFontFamily !== undefined) danmakuFontFamily = data.danmakuFontFamily || "";
  if (data.danmakuFontWeight !== undefined) danmakuFontWeight = data.danmakuFontWeight || "";
  if (data.danmakuForceSimplified !== undefined) {
    updateSimplifiedConverter(data.danmakuForceSimplified);
  }
});

iina.postMessage("overlay-ready", {});
