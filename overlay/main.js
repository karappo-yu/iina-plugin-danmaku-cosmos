let allDanmaku = [];
let lastTime = 0;
let isPaused = false;

let danmakuFileMap = {};
let danmakuSeenKeys = {};

let canvasOpacity = 0.8;
let canvasFontScale = 1.0;
let canvasNicoMode = 'default';

let niconiComments = null;
let nicoRawData = null;
let nicoRawFormat = 'legacy';
let currentDanmakuType = 'none';
let canvasRafId = null;
let canvasVideoAnchorTime = 0;
let canvasSystemAnchorTime = 0;
let canvasIsPlaying = false;

function canvasSyncAnchor(videoTimeSec) {
  canvasVideoAnchorTime = videoTimeSec;
  canvasSystemAnchorTime = performance.now();
}

function canvasGetCurrentTime() {
  if (!canvasIsPlaying) return canvasVideoAnchorTime;
  return canvasVideoAnchorTime + (performance.now() - canvasSystemAnchorTime) / 1000;
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
  if (typeof niconiComments.destroy === 'function') niconiComments.destroy();
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
  });
  nicoRawData = data;
  bindCanvasEvents(niconiComments);
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

iina.onMessage("time-update", (data) => {
  let t = data.time * 100;
  const isSeek = Math.abs(t - lastTime) > 150;
  if (isSeek) stopCanvasLoop();
  canvasSyncAnchor(data.time);
  lastTime = t;
  if (isSeek && niconiComments) {
    niconiComments.drawCanvas(t);
    startCanvasLoop();
  }
});

iina.onMessage("load-danmaku", (data) => {
  if (data.canvasFontScale !== undefined) canvasFontScale = data.canvasFontScale;
  if (data.opacity) {
    canvasOpacity = data.opacity;
    const canvas = document.getElementById('niconicomments-canvas');
    if (canvas) canvas.style.opacity = data.opacity;
  }

  danmakuFileMap = {};
  danmakuSeenKeys = {};

  const encodedStr = data.xmlContent;
  const rawStr = decodeURIComponent(encodedStr);
  let list = parseDanmaku(encodedStr);

  var filePath = data.path || '__initial__';
  danmakuFileMap[filePath] = list;
  allDanmaku = list.sort((a, b) => a.t - b.t);

  var danmakuType = data.danmakuType || detectRawDanmakuType(rawStr);
  currentDanmakuType = danmakuType;
  prepareCanvasSource(rawStr, allDanmaku, danmakuType);

  iina.postMessage("danmaku-type", { type: danmakuType });

  if (nicoRawData) {
    canvasIsPlaying = !isPaused;
    canvasSyncAnchor(0);
    initCanvasRenderer(nicoRawData);
    startCanvasLoop();
  }
});

iina.onMessage("add-danmaku-file", (data) => {
  const filePath = data.path;
  const encodedStr = data.xmlContent;
  let list = parseDanmaku(encodedStr);
  danmakuFileMap[filePath] = list;

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
    prepareCanvasSource('', allDanmaku, currentDanmakuType);
    initCanvasRenderer(nicoRawData);
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

  prepareCanvasSource('', allDanmaku, currentDanmakuType);
  if (nicoRawData) initCanvasRenderer(nicoRawData);
});

iina.onMessage("resize", () => {
  if (niconiComments) niconiComments.clear();
});

iina.onMessage("pause-state", (data) => {
  isPaused = data.paused;
  document.body.classList.toggle('is-paused', isPaused);
  canvasIsPlaying = !isPaused;
  canvasSyncAnchor(canvasGetCurrentTime());
});

iina.onMessage("toggle-danmaku", (data) => {
  const canvas = document.getElementById('niconicomments-canvas');
  if (canvas) canvas.style.display = data.enabled ? '' : 'none';
  if (!data.enabled && niconiComments) niconiComments.clear();
});

iina.onMessage("set-opacity", (data) => {
  canvasOpacity = data.opacity;
  const canvas = document.getElementById('niconicomments-canvas');
  if (canvas) canvas.style.opacity = data.opacity;
});

iina.onMessage("set-fontscale", (data) => {
  canvasFontScale = data.scale;
  if (nicoRawData) initCanvasRenderer(nicoRawData);
});

iina.onMessage("set-canvas-mode", (data) => {
  canvasNicoMode = data.mode;
  if (nicoRawData) initCanvasRenderer(nicoRawData);
});

iina.onMessage("clear-danmaku", () => {
  destroyCanvasRenderer();
  allDanmaku = [];
  danmakuFileMap = {};
  danmakuSeenKeys = {};
  nicoRawData = null;
  nicoRawFormat = 'legacy';
  currentDanmakuType = 'none';
  iina.postMessage("danmaku-type", { type: 'none' });
});

iina.onMessage("apply-settings", (data) => {
  if (data.opacity !== undefined) {
    canvasOpacity = data.opacity;
    const canvas = document.getElementById('niconicomments-canvas');
    if (canvas) canvas.style.opacity = data.opacity;
  }
  if (data.canvasFontScale !== undefined) canvasFontScale = data.canvasFontScale;
  if (data.canvasMode !== undefined) canvasNicoMode = data.canvasMode;
});

iina.postMessage("overlay-ready", {});
