var pluginState = {};
let danmakuDocument = require('./danmaku-document.js');
let ipcTransport = require('./ipc-transport.js');
let pluginI18n = require('./plugin-i18n.js');
let episodeMatcher = require('./episode-matcher.js');
let ddpClientModule = require('./ddp-client.js');
// IINA resolves require against the executing script stack. Load the package
// module here; callbacks only construct/use its converter, never call require.
let openccLibrary = require('./lib/opencc.min.js') || globalThis.OpenCC;
let parseDanmakuSource = danmakuDocument.parseDanmakuSource;
let projectDanmaku = danmakuDocument.projectDanmaku;
let postSafeMessage = ipcTransport.postSafeMessage;
var filePathFromUrl = episodeMatcher.filePathFromUrl;
var extractNumberFromName = episodeMatcher.extractNumberFromName;
var DDP_LOAD_ORIGIN = ddpClientModule.DDP_LOAD_ORIGIN;
var ddpParseBody = ddpClientModule.ddpParseBody;
var ddpErrStr = ddpClientModule.ddpErrStr;
var ddpCacheFile = ddpClientModule.ddpCacheFile;
var projectMatches = ddpClientModule.projectMatches;

var overlay = iina.overlay;
var sidebar = iina.sidebar;
var event = iina.event;
var console = iina.console;
var menu = iina.menu;
var core = iina.core;
var file = iina.file;
var preferences = iina.preferences;
var mpv = iina.mpv;

// Keep WebView callbacks rooted in JS even if IINA's JSManagedValue loses its
// native owner. Replace by message name so navigation does not retain old handlers.
let sidebarMessageHandlers = Object.create(null);
let overlayMessageHandlers = Object.create(null);

pluginState.danmakuEnabled = preferences.get("danmakuEnabled") !== false;
pluginState.danmakuForceSimplified = !!preferences.get("danmakuForceSimplified"); // 默认 false,与 Info.json preferenceDefaults 一致
// 弹幕时长自动偏移检测(nico-json): 加载时对比弹幕源时长与视频时长
// 默认关闭: 时长差无法区分片头/片尾差异, 只提醒, 由用户在高级设置中手动开启自动设置
pluginState.danmakuAutoOffset = preferences.get("danmakuAutoOffset") !== undefined ? preferences.get("danmakuAutoOffset") : false;
pluginState.danmakuBlocklist = [];
try { pluginState.danmakuBlocklist = JSON.parse(preferences.get("danmakuBlocklist") || '[]') || []; } catch (e) { pluginState.danmakuBlocklist = []; }
if (!Array.isArray(pluginState.danmakuBlocklist)) pluginState.danmakuBlocklist = [];
// Preserve literal text; transport escaping belongs exclusively to postSafeMessage.
pluginState.danmakuBlocklist = pluginState.danmakuBlocklist
  .map(function (w) { return String(w).trim(); })
  .filter(function (w, i, arr) { return w && arr.indexOf(w) === i; });
pluginState.danmakuBlocklistEnabled = !!preferences.get("danmakuBlocklistEnabled");
pluginState.danmakuBlockTopEnabled = !!preferences.get("danmakuBlockTopEnabled");
pluginState.danmakuBlockBottomEnabled = !!preferences.get("danmakuBlockBottomEnabled");
var blockRegexes = []; // 编译缓存(列表变化时重建)
// /.../ 词条中编译失败、超长或可能灾难性回溯的条目(按普通文字匹配,侧栏标记提示)
var blockInvalidEntries = [];
// 正则长度上限必须在启动重建之前赋值: 函数声明会提升, var 赋值不会,
// 否则启动时已保存的 /.../ 词条会因 undefined 比较退化为字面量匹配。
var BLOCK_REGEX_MAX_LENGTH = 200;
rebuildBlockRegexes();
// 弹幕去重: 开关 + 区间(秒,1-5)。滚动弹幕在投影内静态合并为 "原文xN"(时间取组内最早);
// 固定弹幕(顶部/底部)不在投影合并,由引擎 fixedCombo 在屏上渐进接续(计数 x2→x3,宿主生命周期延长)。
pluginState.danmakuDedupeEnabled = !!preferences.get("danmakuDedupeEnabled");
pluginState.danmakuDedupeWindow = parseFloat(preferences.get("danmakuDedupeWindow"));
if (!isFinite(pluginState.danmakuDedupeWindow) || pluginState.danmakuDedupeWindow < 1 || pluginState.danmakuDedupeWindow > 5) pluginState.danmakuDedupeWindow = 2;
pluginState.canvasOpacity = preferences.get("danmakuCanvasOpacity") !== undefined ? preferences.get("danmakuCanvasOpacity") : 0.8;
pluginState.canvasFontScale = preferences.get("niconicommentsFontScale") || 1.0;
pluginState.currentCanvasMode = preferences.get("canvasMode") || 'css';
pluginState.strokeOpacity = preferences.get("strokeOpacity") !== undefined ? preferences.get("strokeOpacity") : 1;
pluginState.strokeWidth = preferences.get("strokeWidth") !== undefined ? preferences.get("strokeWidth") : 0;
pluginState.cssTextShadowBlur = isValidCssTextShadowBlur(preferences.get("cssTextShadowBlur")) ? preferences.get("cssTextShadowBlur") : 2;
pluginState.strokeColor = preferences.get("strokeColor") || '#000000';
pluginState.strokeInversionColor = preferences.get("strokeInversionColor") || '#ffffff';
pluginState.commentLimit = preferences.get("commentLimit") !== undefined ? preferences.get("commentLimit") : 0;
pluginState.scrollSpeed = preferences.get("scrollSpeed") !== undefined ? preferences.get("scrollSpeed") : 1.0;
pluginState.danmakuTimeOffsetSec = 0; // 弹幕偏移不做持久化: 偏移量因视频/弹幕文件而异,每个会话从 0 开始
pluginState.danmakuFontFamily = preferences.get("danmakuFontFamily") || "";
pluginState.danmakuFontWeight = preferences.get("danmakuFontWeight") || "500";
var savedStylePreset = preferences.get("stylePreset");
pluginState.stylePreset = savedStylePreset === undefined || savedStylePreset === null
  ? 'nico'
  : (['nico', 'balanced', 'bilibili', 'custom'].indexOf(savedStylePreset) !== -1 ? savedStylePreset : 'custom');
var overlayReady = false;
let overlayLoadId = 0;
var preferencesSyncTimer = null;

var DDP_APP_ID = preferences.get("dandanplayAppId") || 't43832ky57';
var DDP_APP_SECRET = preferences.get("dandanplayAppSecret") || 'IDnPEdEKDIziKeYVxm6VcaJE4Bv2fnzT';

// Off by default: automatic matching hashes every opened video and calls the
// DanDanPlay API. Only an explicit opt-in (true) enables it.
pluginState.dandanplayAutoNetwork = preferences.get("dandanplayAutoNetwork") === true;

pluginState.dandanplayState = {
  status: 'idle',
  animeTitle: '',
  episodeTitle: '',
  episodeId: null,
  commentCount: 0,
  error: '',
  matches: null,
  matchType: ''
};

var pluginLang = pluginI18n.getPluginLang(iina.utils);
var t = pluginI18n.createTranslator(pluginLang);

let ddpClient = ddpClientModule.createDdpClient({
  appId: DDP_APP_ID,
  appSecret: DDP_APP_SECRET,
  http: iina.http,
  utils: iina.utils,
  file: file,
  console: console,
  parseDanmakuSource: parseDanmakuSource,
  t: t
});
var ddpConvertComments = ddpClient.convertComments;
var ddpSaveVideoCache = ddpClient.saveVideoCache;
var ddpReadVideoCache = ddpClient.readVideoCache;
let ddpMatchVideo = ddpClient.matchVideo;
let ddpSearchAnime = ddpClient.searchAnime;
let ddpGetComments = ddpClient.getComments;
let ddpGetBangumi = ddpClient.getBangumi;
let ddpHttpError = ddpClient.httpError;

function syncPreferencesSoon() {
  if (preferencesSyncTimer) clearTimeout(preferencesSyncTimer);
  preferencesSyncTimer = setTimeout(function () {
    preferences.sync();
    preferencesSyncTimer = null;
  }, 250);
}

var pendingDanmaku = null;
let pendingLoadNotice = null;
var currentVideoUrl = null;
// 最后下发的 renderer 目标视频。渲染是否成功由 loadId 回执确认,
// 不从弹幕文件读取成功或开关状态推断。
var loadedDanmakuVideoUrl = null;
// 同一 URL 也可能被重新加载;世代号用于丢弃旧异步 DDP 请求的回调。
var danmakuLoadGeneration = 0;
let ddpRequestGeneration = 0;
let ddpSearchGeneration = 0;
let videoSeekInProgress = false;
let ddpBangumiGeneration = 0;
var timePosListenerID = null;
var windowScaleListenerID = null;
var speedListenerID = null;

pluginState.currentDanmakuStatus = {
  fileType: null,
  isLoaded: false
};

pluginState.danmakuFileList = {
  xmlFiles: [],
  jsonFiles: [],
  selectedPaths: []
};

var danmakuCache = Object.create(null);

pluginState.nicoJsonDateInfo = emptyNicoJsonDateInfo();
// 时长检测: nico-json main 线程的 duration(下载弹幕时原视频长度,秒)与当前视频时长的差值
// null = 无检测结果(非 nico-json / 无 duration 字段 / 时长一致)
pluginState.nicoJsonDurationDiff = null;
pluginState.nicoJsonHasDuration = false;
pluginState.danmakuFilterStartDay = null;
pluginState.danmakuFilterEndDay = null;
pluginState.danmakuFilterDensity = preferences.get("danmakuFilterDensity") !== undefined ? preferences.get("danmakuFilterDensity") : 0;
var danmakuBrowserWatch = false; // sidebar 过滤 tab 是否在监听(控制播放时间推送)
var lastBrowserTimeSent = 0;
pluginState.danmakuBrowserVisible = preferences.get("danmakuBrowserVisible") !== undefined ? !!preferences.get("danmakuBrowserVisible") : true;
var openccSimplifier = null;     // 简繁转换器(tw→cn,懒加载;仅强制简体开启时构建)

// Preference names are an I/O mapping, not a second copy of state.
const statePreferenceKeys = {
  danmakuEnabled: 'danmakuEnabled', canvasOpacity: 'danmakuCanvasOpacity',
  canvasFontScale: 'niconicommentsFontScale', currentCanvasMode: 'canvasMode',
};
const persistentStateKeys = [
  'danmakuForceSimplified', 'danmakuAutoOffset', 'danmakuBlocklist', 'danmakuBlocklistEnabled',
  'danmakuBlockTopEnabled', 'danmakuBlockBottomEnabled', 'danmakuDedupeEnabled', 'danmakuDedupeWindow',
  'strokeOpacity', 'strokeWidth', 'cssTextShadowBlur', 'strokeColor', 'strokeInversionColor', 'commentLimit', 'scrollSpeed',
  'danmakuFontFamily', 'danmakuFontWeight', 'stylePreset', 'dandanplayAutoNetwork',
  'danmakuFilterDensity', 'danmakuBrowserVisible'
];
persistentStateKeys.forEach(function (key) { statePreferenceKeys[key] = key; });

function stateSnapshot() {
  return Object.assign({}, pluginState, {
    enabled: pluginState.danmakuEnabled, canvasMode: pluginState.currentCanvasMode,
    danmakuFileType: pluginState.currentDanmakuStatus.fileType,
    danmakuLoaded: pluginState.currentDanmakuStatus.isLoaded,
    blocklist: blocklistPayload(),
    dedupe: {enabled: pluginState.danmakuDedupeEnabled, window: pluginState.danmakuDedupeWindow},
    uiLang: pluginLang,
  });
}

function blocklistPayload() {
  let payload = {enabled: pluginState.danmakuBlocklistEnabled, words: pluginState.danmakuBlocklist.slice()};
  if (blockInvalidEntries.length) payload.invalid = blockInvalidEntries.slice();
  return payload;
}

// Presets are one state transaction, including their motion/layout settings.
// Soft Nico appearance: native Hiragino default, weight 500, centered glyph
// shadow without a hard outline. 2 engine units is ~4.3 px at 58 px text.
const NICO_STYLE = {
  canvasFontScale: 1, danmakuFontFamily: '', danmakuFontWeight: '500',
  strokeWidth: 0, strokeOpacity: 1, strokeColor: '#000000', strokeInversionColor: '#ffffff',
  cssTextShadowBlur: 2, scrollSpeed: 1,
};
const STYLE_PRESETS = {
  nico: NICO_STYLE,
  balanced: Object.assign({}, NICO_STYLE, {canvasFontScale: 0.5, scrollSpeed: 0.5}),
  bilibili: {canvasFontScale: 0.35, danmakuFontFamily: '', danmakuFontWeight: '200',
    strokeWidth: 2.5, strokeOpacity: 0.4, strokeColor: '#000000', strokeInversionColor: '#ffffff',
    cssTextShadowBlur: 0, scrollSpeed: 0.4},
};
const stylePresetFields = ['canvasFontScale', 'danmakuFontFamily', 'danmakuFontWeight', 'strokeWidth', 'scrollSpeed',
  'strokeOpacity', 'strokeColor', 'strokeInversionColor', 'cssTextShadowBlur'];

const overlayStateBindings = {
  canvasOpacity: ['set-opacity', 'opacity'], canvasFontScale: ['set-fontscale', 'scale'],
  currentCanvasMode: ['set-canvas-mode', 'mode'], strokeOpacity: ['set-stroke-opacity', 'opacity'],
  strokeWidth: ['set-stroke-width', 'width'], strokeColor: ['set-stroke-color', 'color'],
  cssTextShadowBlur: ['set-css-text-shadow-blur', 'blur'],
  strokeInversionColor: ['set-stroke-inversion-color', 'color'], commentLimit: ['set-comment-limit', 'limit'],
  scrollSpeed: ['set-scroll-speed', 'speed'], danmakuTimeOffsetSec: ['set-danmaku-offset', 'offset'],
};

function commitState(patch, notify) {
  let persist = false;
  let changed = {};
  Object.keys(patch).forEach(function (key) {
    if (pluginState[key] === patch[key]) return;
    pluginState[key] = patch[key];
    changed[key] = patch[key];
    if (statePreferenceKeys[key]) {
      preferences.set(statePreferenceKeys[key], key === 'danmakuBlocklist' ? JSON.stringify(patch[key]) : patch[key]);
      persist = true;
    }
  });
  if (!Object.prototype.hasOwnProperty.call(patch, 'stylePreset') &&
      stylePresetFields.some(function (key) { return Object.prototype.hasOwnProperty.call(changed, key); }) &&
      pluginState.stylePreset !== 'custom') {
    pluginState.stylePreset = 'custom';
    changed.stylePreset = 'custom';
    if (statePreferenceKeys.stylePreset) {
      preferences.set(statePreferenceKeys.stylePreset, 'custom');
      persist = true;
    }
  }
  if ('danmakuBlocklist' in changed) rebuildBlockRegexes();
  if (persist) syncPreferencesSoon();
  if (overlayReady) {
    let atomicStyle = Object.prototype.hasOwnProperty.call(patch, 'stylePreset') &&
      stylePresetFields.some(function (key) { return Object.prototype.hasOwnProperty.call(changed, key); });
    if (atomicStyle) {
      let style = {};
      stylePresetFields.forEach(function (key) { style[key] = pluginState[key]; });
      overlayPostMessage('set-danmaku-style', style);
    }
    Object.keys(changed).forEach(function (key) {
      if (atomicStyle && stylePresetFields.indexOf(key) !== -1) return;
      let binding = overlayStateBindings[key];
      if (!binding) return;
      let payload = {};
      payload[binding[1]] = pluginState[key];
      overlayPostMessage(binding[0], payload);
    });
    if (!atomicStyle && ('danmakuFontFamily' in changed || 'danmakuFontWeight' in changed)) overlayPostMessage('set-danmaku-font', {
      fontFamily: pluginState.danmakuFontFamily, fontWeight: pluginState.danmakuFontWeight
    });
  }
  if (notify === false || Object.keys(changed).length === 0) return;
  // Incremental settings updates stay small. The complete snapshot is pulled
  // once when the lazy sidebar opens; source metadata has its own notifications.
  if ('danmakuEnabled' in changed) changed.enabled = pluginState.danmakuEnabled;
  if ('currentCanvasMode' in changed) changed.canvasMode = pluginState.currentCanvasMode;
  if ('currentDanmakuStatus' in changed) {
    changed.danmakuFileType = pluginState.currentDanmakuStatus.fileType;
    changed.danmakuLoaded = pluginState.currentDanmakuStatus.isLoaded;
  }
  if ('danmakuBlocklist' in changed || 'danmakuBlocklistEnabled' in changed) changed.blocklist = blocklistPayload();
  if ('danmakuDedupeEnabled' in changed || 'danmakuDedupeWindow' in changed) changed.dedupe = {
    enabled: pluginState.danmakuDedupeEnabled, window: pluginState.danmakuDedupeWindow
  };
  delete changed.nicoJsonDateInfo;
  delete changed.danmakuFileList;
  delete changed.dandanplayState;
  if (Object.keys(changed).length) sidebarPostMessage('danmaku-state', changed);
}

function commitDdpState(patch) {
  commitState({dandanplayState: Object.assign({}, pluginState.dandanplayState, patch)}, false);
}

// Intents that carry no payload by design. Every other message is dropped
// unless its payload is an object; each handler then validates its own fields,
// so a missing field never becomes a setting (undefined/false/0).
const PAYLOADLESS_MESSAGES = Object.freeze({
  'toggle-danmaku': true, 'request-state': true, 'danmaku-file-add': true, 'dandanplay-trigger-match': true,
  'overlay-ready': true, 'seek-disable': true, 'seek-enable': true,
});

function withPayload(name, callback) {
  return function (data) {
    let isObject = !!data && typeof data === 'object' && !Array.isArray(data);
    if (!isObject && !PAYLOADLESS_MESSAGES[name]) return;
    return callback(isObject ? data : {});
  };
}

function isFiniteNumber(value) {
  return typeof value === 'number' && isFinite(value);
}

function isHexColor(value) {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
}

function sidebarOnMessage(name, callback) {
  let handler = withPayload(name, callback);
  sidebarMessageHandlers[name] = handler;
  sidebar.onMessage(name, handler);
}

function overlayOnMessage(name, callback) {
  let handler = withPayload(name, callback);
  overlayMessageHandlers[name] = handler;
  overlay.onMessage(name, handler);
}

function sidebarPostMessage(key, data) {
  postSafeMessage(sidebar, key, data);
}

function overlayPostMessage(key, data) {
  postSafeMessage(overlay, key, data);
}

var DANMAKU_OFFSET_MIN = -30;
var DANMAKU_OFFSET_MAX = 30;
function clampDanmakuOffset(value) {
  var rounded = Math.round(value * 1000) / 1000;
  return Math.max(DANMAKU_OFFSET_MIN, Math.min(DANMAKU_OFFSET_MAX, rounded));
}

function applyDanmakuOffset(offsetSec) {
  var nextOffset = parseFloat(offsetSec);
  if (!isFinite(nextOffset)) return;
  nextOffset = clampDanmakuOffset(nextOffset);
  commitState({danmakuTimeOffsetSec: nextOffset});
  if (danmakuBrowserWatch) pushBrowserTime(mpv.getNumber("time-pos"), true);
}

function applyDanmakuFont(fontFamily, fontWeight) {
  let patch = {};
  if (fontFamily !== undefined) patch.danmakuFontFamily = fontFamily || '';
  if (fontWeight !== undefined) patch.danmakuFontWeight = fontWeight || '';
  commitState(patch);
}

function findDanmakuFileByPath(path) {
  var groups = [pluginState.danmakuFileList.xmlFiles, pluginState.danmakuFileList.jsonFiles];
  for (var g = 0; g < groups.length; g++) {
    var files = groups[g] || [];
    for (var i = 0; i < files.length; i++) {
      if (files[i].path === path) return files[i];
    }
  }
  return null;
}

function updateDanmakuStatus(status) {
  if (status.fileType === pluginState.currentDanmakuStatus.fileType &&
      status.isLoaded === pluginState.currentDanmakuStatus.isLoaded) return;
  commitState({currentDanmakuStatus: status});
}

function danmakuNotFound() {
  updateDanmakuStatus({ fileType: null, isLoaded: false });
}

function emptyNicoJsonDateInfo() {
  return danmakuDocument.emptyDateInfo();
}

function formatSecondsShort(sec) {
  var n = Math.round(sec * 10) / 10;
  return (n % 1 === 0) ? String(Math.round(n)) : String(n);
}

function setNicoJsonDurationDiff(diff) {
  if (pluginState.nicoJsonDurationDiff === diff) return;
  commitState({nicoJsonDurationDiff: diff});
}

function setNicoJsonDurationAvailability(hasDuration) {
  if (pluginState.nicoJsonHasDuration === hasDuration) return;
  commitState({nicoJsonHasDuration: hasDuration});
}

// nico-json 加载时自动检测时长差: diff = 视频时长 - 弹幕源时长
// |diff| < 1 视为一致(弹幕源时长只能精确到秒,1s 以内的差值忽略);否则提醒,并(开关开启时)自动设置偏移
// 返回 true 表示本次比较有效(拿到了视频时长)
function runDurationCompare(danmakuDuration) {
  var videoDuration;
  try { videoDuration = mpv.getNumber("duration"); } catch (e) { videoDuration = NaN; }
  if (!videoDuration || !isFinite(videoDuration) || videoDuration <= 0) return false;
  var diff = videoDuration - danmakuDuration;
  if (Math.abs(diff) < 1) return true;
  setNicoJsonDurationDiff(diff);
  var offset = Math.round(-diff * 10) / 10;
  if (pluginState.danmakuAutoOffset) {
    var applied = clampDanmakuOffset(offset);
    applyDanmakuOffset(applied);
    core.osd(t('duration_mismatch', { offset: formatSecondsShort(applied) }));
  } else {
    core.osd(t('duration_mismatch_no_offset'));
  }
  return true;
}

function checkNicoJsonDuration(doc) {
  setNicoJsonDurationDiff(null);
  var danmakuDuration = doc.durationSec;
  setNicoJsonDurationAvailability(danmakuDuration !== null);
  if (danmakuDuration === null) return;
  if (runDurationCompare(danmakuDuration)) return;
  // file-loaded 瞬间 mpv duration 可能还没就绪,延迟重试一次(仅当仍选中同一弹幕文件)
  var savedPath = pluginState.danmakuFileList.selectedPaths.length > 0 ? pluginState.danmakuFileList.selectedPaths[0] : null;
  let generation = danmakuLoadGeneration;
  setTimeout(function () {
    if (generation === danmakuLoadGeneration && savedPath && pluginState.danmakuFileList.selectedPaths[0] === savedPath) {
      runDurationCompare(danmakuDuration);
    }
  }, 800);
}

// 加载弹幕后的 OSD: 若时长检测发现不一致,优先提醒(避免被"已加载"覆盖)
function osdAfterDanmakuLoad(loadedName, loadedMessageKey) {
  if (pluginState.nicoJsonDurationDiff !== null) {
    if (pluginState.danmakuAutoOffset) {
      var offset = pluginState.danmakuTimeOffsetSec;
      core.osd(t('duration_mismatch', { offset: formatSecondsShort(offset) }));
    } else {
      core.osd(t('duration_mismatch_no_offset'));
    }
  } else {
    core.osd(t(loadedMessageKey || 'loaded') + loadedName);
  }
}

function sendDanmakuFilterInfo() {
  let projection = getCurrentProjection();
  sidebarPostMessage("danmaku-filter-info", {
    fileType: pluginState.currentDanmakuStatus.fileType,
    totalCount: pluginState.nicoJsonDateInfo.totalCount,
    sourceTotalCount: projection ? projection.sourceTotalCount : 0,
    filterStartDay: pluginState.danmakuFilterStartDay, filterEndDay: pluginState.danmakuFilterEndDay,
    filterDensity: pluginState.danmakuFilterDensity, filteredCount: projection ? projection.filteredCount : 0,
    dateInfo: pluginState.nicoJsonDateInfo
  });
}

// load-danmaku 载荷统一构造。设置字段全量携带: overlay 端逐字段幂等应用,重复携带无副作用。
function buildLoadDanmakuPayload(comments, danmakuType) {
  return {
    loadId: ++overlayLoadId,
    playback: playbackSnapshot(),
    comments: comments,
    danmakuType: danmakuType,
    canvasMode: pluginState.currentCanvasMode,
    videoAspectRatio: getVideoAspectRatio(),
    fullscreen: !!(core.window && core.window.fullscreen),
    opacity: pluginState.canvasOpacity,
    canvasFontScale: pluginState.canvasFontScale,
    strokeColor: pluginState.strokeColor,
    strokeInversionColor: pluginState.strokeInversionColor,
    strokeOpacity: pluginState.strokeOpacity,
    strokeWidth: pluginState.strokeWidth,
    cssTextShadowBlur: pluginState.cssTextShadowBlur,
    commentLimit: pluginState.commentLimit,
    scrollSpeed: pluginState.scrollSpeed,
    danmakuTimeOffsetSec: pluginState.danmakuTimeOffsetSec,
    danmakuFontFamily: pluginState.danmakuFontFamily,
    danmakuFontWeight: pluginState.danmakuFontWeight,
    fixedCombo: pluginState.danmakuDedupeEnabled,
    nakaDedupeWindow: 0,
  };
}

function resetNicoJsonFilterState(extra) {
  commitState(Object.assign({nicoJsonDateInfo: emptyNicoJsonDateInfo(), nicoJsonDurationDiff: null,
    nicoJsonHasDuration: false, danmakuFilterStartDay: null, danmakuFilterEndDay: null}, extra));
}

function applyDanmakuFilter(startDay, endDay) {
  if (startDay === null && endDay === null) {
    commitState({danmakuFilterStartDay: null, danmakuFilterEndDay: null});
  } else {
    if (!Number.isInteger(startDay) || !Number.isInteger(endDay) || startDay > endDay || pluginState.nicoJsonDateInfo.firstDay === null) return;
    let days = pluginState.nicoJsonDateInfo.dayCounts;
    let startIndex = 0;
    while (startIndex < days.length - 1 && days[startIndex][0] < startDay) startIndex += 1;
    let endIndex = startIndex;
    while (endIndex < days.length - 1 && days[endIndex + 1][0] <= endDay) endIndex += 1;
    startDay = days[startIndex][0];
    endDay = days[endIndex][0];
    let fullRange = startDay === pluginState.nicoJsonDateInfo.firstDay && endDay === pluginState.nicoJsonDateInfo.lastDay;
    commitState({danmakuFilterStartDay: fullRange ? null : startDay, danmakuFilterEndDay: fullRange ? null : endDay});
  }
  refreshDanmakuFilters();
}

function refreshDanmakuFilters() {
  var ft = pluginState.currentDanmakuStatus.fileType;
  if (!ft) return;

  var selectedPath = pluginState.danmakuFileList.selectedPaths.length > 0 ? pluginState.danmakuFileList.selectedPaths[0] : null;
  if (!selectedPath) return;
  if (!danmakuCache[selectedPath]) return;

  resendDanmakuToOverlay();
  sendDanmakuFilterInfo();
}

function applyDanmakuFilterDensity(density) {
  commitState({danmakuFilterDensity: density});

  refreshDanmakuFilters();
}

// IINA's package-local CommonJS loader owns initialization; no WebView path
// messages, persisted absolute paths, or eval are involved.
function ensureSimplifier() {
  if (openccSimplifier) return true;
  if (!pluginState.danmakuForceSimplified) return false;
  try {
    openccSimplifier = openccLibrary.Converter({ from: 'tw', to: 'cn' });
    return true;
  } catch (error) {
    console.log('[OpenCC] initialization failed: ' + error);
    return false;
  }
}

// ── 屏蔽词过滤(默认字面量匹配;/.../ 包裹时编译为正则) ──────────────────────
// 普通词按大小写不敏感纯文本匹配,避免 ".", "+", "()" 等触发误匹配或 ReDoS;
// 仅当词条以 /.../ (可选 i/m/s/u 修饰符) 包裹时才作为正则编译并限制最大长度(BLOCK_REGEX_MAX_LENGTH 在文件头部初始化)。

// Reads a quantifier at pattern[index]. `repeats` is true when the item can
// occur more than once (*, +, {n,}, {n,m}/{n} with a maximum above 1).
// `variable` means its length can change; an exact {n} adds no length choice.
function readRegexQuantifier(pattern, index) {
  let ch = pattern.charAt(index);
  let length = 0, min = 0, max = 0;
  if (ch === '*' || ch === '+') { length = 1; min = ch === '+' ? 1 : 0; max = Infinity; }
  else if (ch === '?') { length = 1; max = 1; }
  else if (ch === '{') {
    let m = /^\{(\d+)(,(\d*))?\}/.exec(pattern.slice(index));
    if (!m) return null;
    length = m[0].length;
    min = Number(m[1]);
    max = m[2] === undefined ? Number(m[1]) : m[3] === '' ? Infinity : Number(m[3]);
  } else return null;
  if (pattern.charAt(index + length) === '?') length++; // lazy form
  return {length: length, repeats: max > 1, variable: min !== max};
}

// A synchronous RegExp cannot be interrupted, and a saved catastrophic entry
// would freeze every load after a restart. Two shapes are rejected:
// 1. a group that can repeat (any maximum above 1, bounded or not) while its
//    body is ambiguous, i.e. contains a quantifier or an alternation:
//    (a+)+, (a+){9}, (a{1,5})+, (a|aa)+ (exponential);
// 2. two or more variable choices along one alternative, including optional
//    and bounded repetitions and alternatives inside groups. A short bound
//    does not stop choices multiplying: a?a?...b, a{0,16}a{0,16}...b.
//    Fixed {n} has no length choice. Top-level alternatives count separately.
//    A backreference to a variable-length capture re-matches every length the
//    group tried, so it counts as one more choice: (.*)\1x is cubic.
// This is conservative: safe forms such as (ab|cd)+, (a+)? and two bounded
// numeric fields are also rejected; they fall back to marked literal entries.
function isUnsafeBlockPattern(pattern) {
  let newFrame = function () { return {ambiguous: false, variable: 0, maxVariable: 0, alternation: false}; };
  let stack = [newFrame()];
  let top = function () { return stack[stack.length - 1]; };
  let addVariable = function (frame, n) {
    frame.variable += n;
    return frame.variable >= 2;
  };
  // Capture groups are numbered in opening order; a group is variable when
  // its body has any length choice. Only closed groups are known: a
  // reference to an open or later group matches the empty string.
  let captureCount = 0, captureNames = Object.create(null), variableCaptures = Object.create(null);
  for (let i = 0; i < pattern.length; i++) {
    let ch = pattern.charAt(i);
    if (ch === '\\') {
      let ref = /^\\(?:([1-9]\d*)|k<([^>]+)>)/.exec(pattern.slice(i, i + 64));
      if (ref) {
        let group = ref[1] ? Number(ref[1]) : captureNames[ref[2]];
        i += ref[0].length - 1;
        if (group && variableCaptures[group]) {
          top().ambiguous = true;
          if (addVariable(top(), 1)) return true;
        }
        continue;
      }
      i++;
      continue;
    }
    if (ch === '[') {
      // JavaScript (no v flag): the first unescaped ] always closes the
      // class, so [] is an empty class and [^] matches any character.
      i++;
      if (pattern.charAt(i) === '^') i++;
      while (i < pattern.length && pattern.charAt(i) !== ']') {
        if (pattern.charAt(i) === '\\') i++;
        i++;
      }
      let quantifier = readRegexQuantifier(pattern, i + 1);
      if (quantifier) {
        top().ambiguous = true;
        if (quantifier.variable && addVariable(top(), 1)) return true;
        i += quantifier.length;
      }
      continue;
    }
    if (ch === '|') {
      let frame = top();
      frame.ambiguous = true;
      frame.alternation = true;
      frame.maxVariable = Math.max(frame.maxVariable, frame.variable);
      frame.variable = 0;
      continue;
    }
    if (ch === '(') {
      let frame = newFrame();
      stack.push(frame);
      if (pattern.charAt(i + 1) === '?') {
        let next = pattern.charAt(i + 2);
        if (next === ':' || next === '=' || next === '!') i += 2;
        else if (next === '<') {
          let after = pattern.charAt(i + 3);
          if (after === '=' || after === '!') i += 3;
          else {
            // Named groups (?<name>...) are numbered like plain captures.
            let close = pattern.indexOf('>', i);
            frame.capture = ++captureCount;
            if (close > 0) captureNames[pattern.slice(i + 3, close)] = frame.capture;
            i = close < 0 ? pattern.length : close;
          }
        }
      } else {
        frame.capture = ++captureCount;
      }
      continue;
    }
    if (ch === ')') {
      let frame = stack.length > 1 ? stack.pop() : newFrame();
      let quantifier = readRegexQuantifier(pattern, i + 1);
      if (quantifier && quantifier.repeats && frame.ambiguous) return true;
      if (frame.ambiguous || quantifier) top().ambiguous = true;
      // Include choices inside the group, its alternatives and its quantifier.
      let bodyVariable = Math.max(frame.maxVariable, frame.variable) + (frame.alternation ? 1 : 0);
      // The captured text has one length per iteration, so the group's own
      // quantifier does not make a backreference to it variable.
      if (frame.capture && bodyVariable > 0) variableCaptures[frame.capture] = true;
      let groupVariable = bodyVariable + (quantifier && quantifier.variable ? 1 : 0);
      if (groupVariable && addVariable(top(), groupVariable)) return true;
      if (quantifier) i += quantifier.length;
      continue;
    }
    let quantifier = readRegexQuantifier(pattern, i);
    if (quantifier) {
      top().ambiguous = true;
      if (quantifier.variable && addVariable(top(), 1)) return true;
      i += quantifier.length - 1;
    }
  }
  return false;
}

// Returns {regex} for valid /.../ entries, otherwise a pre-lowered literal.
function compileBlockEntry(entry) {
  if (!entry) return null;
  var regexMatch = /^\/([\s\S]+)\/([imsu]*)$/.exec(entry);
  if (regexMatch) {
    var pattern = regexMatch[1];
    var rawFlags = regexMatch[2];
    if (pattern.length <= BLOCK_REGEX_MAX_LENGTH && !isUnsafeBlockPattern(pattern)) {
      var flags = rawFlags.indexOf('i') === -1 ? rawFlags + 'i' : rawFlags;
      try {
        return {regex: new RegExp(pattern, flags)};
      } catch (e) {}
    }
    return {literal: entry.toLowerCase(), invalid: true};
  }
  return {literal: entry.toLowerCase()};
}

function rebuildBlockRegexes() {
  blockRegexes = [];
  blockInvalidEntries = [];
  for (var i = 0; i < pluginState.danmakuBlocklist.length; i++) {
    var matcher = compileBlockEntry(pluginState.danmakuBlocklist[i]);
    if (!matcher) continue;
    if (matcher.invalid) blockInvalidEntries.push(pluginState.danmakuBlocklist[i]);
    blockRegexes.push(matcher);
  }
}

function isBlockedText(text) {
  if (!text || blockRegexes.length === 0) return false;
  var lower = null; // lower-case the comment once for all literal entries
  for (var i = 0; i < blockRegexes.length; i++) {
    var matcher = blockRegexes[i];
    if (matcher.regex) {
      if (matcher.regex.test(text)) return true;
    } else {
      if (lower === null) lower = String(text).toLowerCase();
      if (lower.indexOf(matcher.literal) !== -1) return true;
    }
  }
  return false;
}

// 渲染过滤与列表 blocked 标记共用判定,各屏蔽条件独立叠加。
function isBlockedComment(text, position) {
  return (pluginState.danmakuBlockTopEnabled && position === 'ue') ||
    (pluginState.danmakuBlockBottomEnabled && position === 'shita') ||
    (pluginState.danmakuBlocklistEnabled && isBlockedText(text));
}

// Cache one projection per document/settings revision. Overlay, statistics and
// lazy sidebar reads share the exact same arrays and selected membership.
let projectionCache = null;
let lastOverlayProjection = null;
function getCurrentProjection() {
  let path = pluginState.danmakuFileList.selectedPaths[0];
  let doc = path && danmakuCache[path];
  if (!doc) return null;
  let forceSimplified = pluginState.danmakuForceSimplified && danmakuDocument.canSimplifySource(doc.sourceType);
  let settings = {
    startDay: pluginState.danmakuFilterStartDay, endDay: pluginState.danmakuFilterEndDay,
    density: pluginState.danmakuFilterDensity, forceSimplified: forceSimplified,
    simplify: forceSimplified && ensureSimplifier() ? openccSimplifier : null,
    dedupeWindow: pluginState.danmakuDedupeEnabled ? pluginState.danmakuDedupeWindow * 100 : 0,
    blockTop: pluginState.danmakuBlockTopEnabled, blockBottom: pluginState.danmakuBlockBottomEnabled,
    blockEnabled: pluginState.danmakuBlocklistEnabled, regexes: blockRegexes,
    isBlocked: isBlockedComment,
  };
  if (projectionCache && projectionCache.doc === doc && Object.keys(settings).every(function (key) {
    return projectionCache.settings[key] === settings[key];
  })) return projectionCache.result;
  let result = projectDanmaku(doc, settings);
  projectionCache = {doc: doc, settings: settings, result: result};
  return result;
}

function getEffectiveContent(path) {
  if (pluginState.danmakuFileList.selectedPaths[0] !== path) return [];
  let projection = getCurrentProjection();
  return projection ? projection.formatted : [];
}

function buildDanmakuBrowserList() {
  let projection = getCurrentProjection();
  return projection ? projection.items : [];
}

function sendDanmakuBrowserData(items) {
  const CHUNK = 2000;
  const total = items.length;
  for (let index = 0; index < Math.max(1, Math.ceil(total / CHUNK)); index++) {
    sidebarPostMessage("danmaku-browser-data", {
      items: items.slice(index * CHUNK, (index + 1) * CHUNK), total: total,
      chunkIndex: index, done: (index + 1) * CHUNK >= total
    });
  }
  pushBrowserTime(mpv.getNumber('time-pos'), true);
}

// 播放时间推送(300ms 节流),sidebar 据此计算在屏弹幕窗口
function pushBrowserTime(timeSec, force) {
  if (typeof timeSec !== 'number' || !isFinite(timeSec)) return;
  var now = Date.now();
  if (!force && now - lastBrowserTimeSent < 300) return;
  lastBrowserTimeSent = now;
  sidebarPostMessage("danmaku-visible-time", { time: timeSec, offset: pluginState.danmakuTimeOffsetSec });
}

var browserDataPending = false; // 列表开关关闭期间数据变化: 不构建不发送,打开时补发一次

// 弹幕加载/切换/清空后,若 sidebar 正在监听则推送刷新列表
function notifyBrowserDataChanged() {
  if (!danmakuBrowserWatch) return;
  if (!pluginState.danmakuBrowserVisible) {
    browserDataPending = true;
    return;
  }
  sendDanmakuBrowserData(buildDanmakuBrowserList());
}

// 向 overlay 重发当前弹幕(内容经 getEffectiveContent 单源处理)。
// 屏蔽词/简体等设置变化后调用,让渲染内容与 sidebar 列表同步更新。
function sameFormattedComments(a, b) {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  return a.every(function (comment, index) {
    let other = b[index];
    let keys = Object.keys(comment);
    return keys.length === Object.keys(other).length && keys.every(function (key) {
      let value = comment[key], next = other[key];
      return Array.isArray(value) ? Array.isArray(next) && value.length === next.length &&
        value.every(function (command, i) { return command === next[i]; }) : value === next;
    });
  });
}

function sendCurrentDanmaku(force) {
  let path = pluginState.danmakuFileList.selectedPaths[0];
  let doc = path && danmakuCache[path];
  if (!overlayReady || !pluginState.danmakuEnabled || !doc) return false;
  let comments = getEffectiveContent(path);
  // fixedCombo 只随 load-danmaku 载荷下发,投影不变但开关变化时也必须重发。
  if (!force && lastOverlayProjection && lastOverlayProjection.doc === doc &&
      lastOverlayProjection.fixedCombo === pluginState.danmakuDedupeEnabled &&
      sameFormattedComments(lastOverlayProjection.comments, comments)) return false;
  lastOverlayProjection = {doc: doc, comments: comments, fixedCombo: pluginState.danmakuDedupeEnabled};
  updateDanmakuStatus({fileType: pluginState.currentDanmakuStatus.fileType, isLoaded: false});
  overlayPostMessage('load-danmaku', buildLoadDanmakuPayload(comments, pluginState.currentDanmakuStatus.fileType));
  loadedDanmakuVideoUrl = currentVideoUrl;
  return true;
}

function resendDanmakuToOverlay() {
  return sendCurrentDanmaku(false);
}

function findDanmakuByEpisode(videoUrl) {
  return episodeMatcher.findDanmakuByEpisode(videoUrl, file);
}

function localDanmakuCandidates() {
  return pluginState.danmakuFileList.xmlFiles.concat(pluginState.danmakuFileList.jsonFiles).filter(function (item) {
    return item.type !== 'DDP';
  }).sort(function (a, b) {
    let rankA = a._matchRank === undefined ? 100 : a._matchRank;
    let rankB = b._matchRank === undefined ? 100 : b._matchRank;
    return rankA - rankB || a.path.localeCompare(b.path);
  });
}

function loadFirstLocalDanmaku() {
  let files = localDanmakuCandidates();
  for (let i = 0; i < files.length; i++) {
    if (loadDanmakuFile(files[i].path)) return true;
  }
  return false;
}

function ddpSyncState() {
  sidebarPostMessage("dandanplay-status", {
    status: pluginState.dandanplayState.status,
    animeTitle: pluginState.dandanplayState.animeTitle,
    episodeTitle: pluginState.dandanplayState.episodeTitle,
    episodeId: pluginState.dandanplayState.episodeId,
    commentCount: pluginState.dandanplayState.commentCount,
    error: pluginState.dandanplayState.error,
    matches: projectMatches(pluginState.dandanplayState.matches),
    autoNetwork: pluginState.dandanplayAutoNetwork,
    matchType: pluginState.dandanplayState.matchType
  });
}

function ddpResetState() {
  ddpRequestGeneration += 1;
  ddpSearchGeneration += 1;
  ddpBangumiGeneration += 1;
  commitState({dandanplayState: {
    status: 'idle',
    animeTitle: '',
    episodeTitle: '',
    episodeId: null,
    commentCount: 0,
    error: '',
    matches: null,
    matchType: ''
  }});
  ddpSyncState();
}

function isManualDdpLoad(origin) {
  return origin === DDP_LOAD_ORIGIN.MANUAL;
}

function ddpAutoMatchAndLoad(url, origin, loadGeneration) {
  let requestGeneration = ++ddpRequestGeneration;
  if (origin === undefined) origin = DDP_LOAD_ORIGIN.AUTO;
  var isManual = isManualDdpLoad(origin);
  var loadEnabled = pluginState.danmakuEnabled;
  if (loadGeneration === undefined) loadGeneration = danmakuLoadGeneration;
  var path = filePathFromUrl(url);
  var fileName;
  if (path) {
    fileName = path.replace(/.*[/\\]/, '');
  } else {
    try { fileName = decodeURIComponent(url.replace(/.*[/\\]/, '').replace(/[?#].*/, '')); } catch (e) { fileName = url; }
  }
  if (!fileName) return;

  commitState({dandanplayState: {
    status: 'matching',
    animeTitle: '',
    episodeTitle: '',
    episodeId: null,
    commentCount: 0,
    error: '',
    matches: null,
    matchType: ''
  }});
  ddpSyncState();

  ddpMatchVideo(fileName, path).then(function(res) {
    if (url !== currentVideoUrl || loadGeneration !== danmakuLoadGeneration || requestGeneration !== ddpRequestGeneration) return;
    if (!isManual && !pluginState.danmakuEnabled) { ddpResetState(); return; }
    var data = ddpParseBody(res);
    var isHttpError = res && typeof res.statusCode === 'number' && (res.statusCode < 200 || res.statusCode >= 300);
    if (res && res.statusCode === 403) {
      commitDdpState({status: 'error', error: t('ddp_auth_error')});
      ddpSyncState();
      ddpFallbackToLocal(true);
      return;
    }
    if (!data || isHttpError) {
      var matchErr = ddpHttpError(res, data);
      commitDdpState({status: 'error', error: matchErr});
      ddpSyncState();
      ddpFallbackToLocal(true);
      return;
    }
    if (data.success === false) {
      commitDdpState({status: 'error', error: ddpHttpError(res, data)});
      ddpSyncState();
      ddpFallbackToLocal(true);
      return;
    }
    if (!data.matches || data.matches.length === 0) {
      commitDdpState({status: 'no-match', error: t('ddp_no_match')});
      ddpSyncState();
      core.osd(t('ddp_no_match'));
      ddpFallbackToLocal();
      return;
    }

    commitDdpState({matches: projectMatches(data.matches)});

    if (data.isMatched) {
      if (!isManual && loadEnabled && !pluginState.danmakuEnabled) return;
      var match = data.matches[0];
      var forceLoad = isManual || (loadEnabled && pluginState.dandanplayAutoNetwork);
      commitDdpState({matchType: 'hash'});
      ddpLoadComments(match.episodeId, match.animeTitle, match.episodeTitle, forceLoad, origin, loadGeneration);
    } else {
      commitDdpState({status: 'matched'});
      ddpSyncState();
      ddpFallbackToLocal();
    }
  }).catch(function(err) {
    if (url !== currentVideoUrl || loadGeneration !== danmakuLoadGeneration || requestGeneration !== ddpRequestGeneration) return;
    commitDdpState({status: 'error', error: ddpErrStr(err)});
    ddpSyncState();
    core.osd(t('ddp_network_error'));
    ddpFallbackToLocal(true);
  });
}

function ddpUpsertFileListEntry(episodeId, animeTitle, episodeTitle, converted, fresh) {
  var virtualPath = 'dandanplay://' + episodeId;
  var displayName = (animeTitle || 'DanDanPlay') + ' - ' + (episodeTitle || '') + (fresh ? '' : t('cache_stale')) + ' 🌐';
  let doc = converted && converted.sourceType ? converted : parseDanmakuSource(converted, virtualPath, 'dandanplay');
  danmakuCache[virtualPath] = Object.freeze(Object.assign({}, doc, {path: virtualPath}));

  let files = pluginState.danmakuFileList.jsonFiles;
  let existing = files.find(function (entry) { return entry.path === virtualPath; });
  let next = existing ? files.map(function (entry) {
    return entry === existing && fresh ? Object.assign({}, entry, {filename: displayName}) : entry;
  }) : files.concat({path: virtualPath, filename: displayName, relativePath: 'DanDanPlay #' + episodeId, type: 'DDP'});
  commitState({danmakuFileList: Object.assign({}, pluginState.danmakuFileList, {jsonFiles: next})}, false);
  return virtualPath;
}

function ddpAddToFileListAndLoad(episodeId, animeTitle, episodeTitle, converted, forceLoad, fresh) {
  var virtualPath = ddpUpsertFileListEntry(episodeId, animeTitle, episodeTitle, converted, fresh);
  if (forceLoad) {
    // 网络弹幕的激活统一复用 loadDanmakuFile,避免复制 overlay/pending/开关逻辑。
    loadDanmakuFile(virtualPath, { enableDanmaku: true, loadedMessageKey: 'network_loaded' });
  } else {
    sidebarPostMessage("danmaku-file-list", pluginState.danmakuFileList);
  }
}

function ddpLoadComments(episodeId, animeTitle, episodeTitle, forceLoad, origin, loadGeneration) {
  let requestGeneration = ++ddpRequestGeneration;
  if (origin === undefined) origin = DDP_LOAD_ORIGIN.AUTO;
  var isManual = isManualDdpLoad(origin);
  var videoUrl = currentVideoUrl;
  if (loadGeneration === undefined) loadGeneration = danmakuLoadGeneration;
  commitDdpState({status: 'loading', episodeId: episodeId, animeTitle: animeTitle || '', episodeTitle: episodeTitle || ''});
  ddpSyncState();

  ddpGetComments(episodeId).then(function(res) {
    if (videoUrl !== currentVideoUrl || loadGeneration !== danmakuLoadGeneration || requestGeneration !== ddpRequestGeneration) return;
    if (!pluginState.danmakuEnabled && !isManual) { ddpResetState(); return; }
    if (!isManual && !pluginState.dandanplayAutoNetwork) forceLoad = false;
    if (res && res.statusCode === 403) {
      commitDdpState({status: 'error', error: t('ddp_auth_error')});
      ddpSyncState();
      ddpFallbackToLocal(true);
      return;
    }
    var data = ddpParseBody(res);
    var isHttpError = res && typeof res.statusCode === 'number' && (res.statusCode < 200 || res.statusCode >= 300);
    if (!data || isHttpError) {
      var commentErr = ddpHttpError(res, data);
      commitDdpState({status: 'error', error: commentErr});
      ddpSyncState();
      core.osd(commentErr);
      ddpFallbackToLocal(true);
      return;
    }
    if (!data.comments || data.comments.length === 0) {
      commitDdpState({status: 'error', error: t('ddp_no_comments')});
      ddpSyncState();
      core.osd(t('ddp_no_comments'));
      ddpFallbackToLocal(true);
      return;
    }

    var converted = ddpConvertComments(data.comments);

    if (converted.comments.length === 0) {
      // 全部条目 malformed:视为下载失败,不覆盖磁盘上的 stale 缓存
      commitDdpState({status: 'error', error: t('ddp_no_comments')});
      ddpSyncState();
      core.osd(t('ddp_no_comments'));
      ddpFallbackToLocal(true);
      return;
    }

    ddpSaveVideoCache(videoUrl, episodeId, animeTitle, episodeTitle, converted);

    commitDdpState({status: 'loaded', commentCount: converted.comments.length});
    ddpSyncState();
    ddpAddToFileListAndLoad(episodeId, animeTitle, episodeTitle, converted, forceLoad, true);
  }).catch(function(err) {
    if (videoUrl !== currentVideoUrl || loadGeneration !== danmakuLoadGeneration || requestGeneration !== ddpRequestGeneration) return;
    commitDdpState({status: 'error', error: ddpErrStr(err)});
    ddpSyncState();
    core.osd(t('ddp_load_failed'));
    ddpFallbackToLocal(true);
  });
}

function ddpFallbackToLocal(allowStale) {
  if (!pluginState.dandanplayAutoNetwork || !pluginState.danmakuEnabled) return;
  if (pluginState.currentDanmakuStatus.isLoaded) return;
  if (loadFirstLocalDanmaku()) return;
  // 仅下载失败路径启用:无本地文件时回退到过期缓存(成功下载会覆盖写同一文件)
  if (!allowStale) return;
  var cached = ddpReadVideoCache(currentVideoUrl);
  if (cached && cached.stale && cached.comments && cached.comments.length > 0) {
    ddpAddToFileListAndLoad(cached.episodeId, cached.animeTitle, cached.episodeTitle, cached.document, true, false);
  }
}

function addDDPToFileList(episodeId, animeTitle, episodeTitle, comments, stale) {
  ddpUpsertFileListEntry(episodeId, animeTitle, episodeTitle, comments, !stale);
}

function loadDanmakuForVideo(url) {
  setObserver(false);
  overlayLoadId += 1;
  danmakuLoadGeneration += 1;
  videoSeekInProgress = false;
  var loadGeneration = danmakuLoadGeneration;
  danmakuCache = Object.create(null);
  projectionCache = null;
  lastOverlayProjection = null;
  currentVideoUrl = url;
  pendingDanmaku = null;
  pendingLoadNotice = null;
  loadedDanmakuVideoUrl = null;
  ddpResetState();
  danmakuNotFound();
  resetNicoJsonFilterState();

  // 视频切换时无条件清掉旧 renderer,即使弹幕当前处于关闭状态。
  if (overlayReady) overlayPostMessage("clear-danmaku", {});

  if (core.status.isNetworkResource) {
    core.osd(t('network_skip_local'));
    danmakuNotFound();
    commitState({danmakuFileList: { xmlFiles: [], jsonFiles: [], selectedPaths: [] }});
    sidebarPostMessage("danmaku-file-list", pluginState.danmakuFileList);
    sendDanmakuFilterInfo();
    notifyBrowserDataChanged();
    if (pluginState.danmakuEnabled && pluginState.dandanplayAutoNetwork) ddpAutoMatchAndLoad(url, DDP_LOAD_ORIGIN.AUTO, loadGeneration);
    return;
  }

  // === Step 1: Build complete file list (local + cached DDP) ===
  var discovered = findDanmakuByEpisode(url);

  commitState({danmakuFileList: {
    xmlFiles: discovered.xmlFiles,
    jsonFiles: discovered.jsonFiles,
    selectedPaths: []
  }});

  var ddpCached = ddpReadVideoCache(url);
  var hasDDPCache = ddpCached && ddpCached.comments && ddpCached.comments.length > 0;
  var hasFreshDDPCache = hasDDPCache && !ddpCached.stale;
  if (hasDDPCache) {
    addDDPToFileList(ddpCached.episodeId, ddpCached.animeTitle, ddpCached.episodeTitle, ddpCached.document, ddpCached.stale);
  }

  // === Step 2: Send file list (all available sources, regardless of priority) ===
  sidebarPostMessage("danmaku-file-list", pluginState.danmakuFileList);
  sendDanmakuFilterInfo();
  notifyBrowserDataChanged();

  // 关闭状态只更新当前视频及其可用文件,不启动本地/网络弹幕加载。
  // toggleDanmaku() 在重新开启时会根据 loadedDanmakuVideoUrl 补做加载。
  if (!pluginState.danmakuEnabled) return;

  // === Step 3: Auto-load to overlay based on autoNetwork setting ===
  if (pluginState.dandanplayAutoNetwork) {
    // network-first: 缓存新鲜(24h TTL 内)时只用缓存,完全跳过后台自动匹配
    // (不重算 hash、不发 API)。缓存刷新发生在 TTL 过期后,
    // 或用户在「网络弹幕」面板手动触发匹配时(dandanplay-trigger-match);
    // 过期缓存带「(旧)」标记进列表,不自动加载,等刷新结果
    if (hasFreshDDPCache) {
      ddpAddToFileListAndLoad(ddpCached.episodeId, ddpCached.animeTitle, ddpCached.episodeTitle, ddpCached.document, true, true);
    } else {
      ddpAutoMatchAndLoad(url, DDP_LOAD_ORIGIN.AUTO, loadGeneration);
    }
  } else {
    // local-first: prefer local files, fallback to DDP cache as last resort
    if (loadFirstLocalDanmaku()) return;
    if (hasFreshDDPCache) {
      ddpAddToFileListAndLoad(ddpCached.episodeId, ddpCached.animeTitle, ddpCached.episodeTitle, ddpCached.document, true, true);
    } else {
      danmakuNotFound();
    }
  }
}

// 自动加载、菜单和侧栏选择共用同一入口。读取成功后才切换选中源;
// 本地文件在首次 I/O 时解析,同一视频会话内重选复用 IR。
// DDP 虚拟条目在加入列表时已写入会话缓存,无需另从磁盘重建。
function loadDanmakuFile(path, options) {
  if (!path) return;
  options = options || {};
  let enableDanmaku = !!options.enableDanmaku;
  let loadedMessageKey = options.loadedMessageKey || 'loaded';
  let fileInfo = findDanmakuFileByPath(path);
  let fileName = fileInfo ? fileInfo.filename : path.split("/").pop();
  let fileType = 'dandanplay';
  let doc = options.reload && path.indexOf('dandanplay://') !== 0 ? null : danmakuCache[path];

  if (!doc && path.indexOf('dandanplay://') !== 0) {
    let content = null;
    try {
      content = file.read(path);
    } catch (e) {}
    if (!content) {
      core.osd(t('read_failed_name') + fileName);
      sidebarPostMessage("danmaku-file-error", { path: path, message: t('read_failed') });
      return;
    }
    try { doc = parseDanmakuSource(content, path); } catch (error) {
      core.osd(t('read_failed_name') + fileName);
      sidebarPostMessage('danmaku-file-error', {path: path, message: t('read_failed')});
      return;
    }

    if (!fileInfo) {
      let videoPath = filePathFromUrl(currentVideoUrl);
      let videoDir = videoPath ? videoPath.replace(/[/\\][^/\\]+$/, '') : '';
      let isXml = /\.xml$/i.test(path);
      fileInfo = {
        filename: fileName,
        path: path,
        relativePath: videoDir && path.startsWith(videoDir + '/') ? path.substring(videoDir.length + 1) : path,
        type: isXml ? 'XML' : 'JSON'
      };
      let group = isXml ? 'xmlFiles' : 'jsonFiles';
      let next = Object.assign({}, pluginState.danmakuFileList);
      next[group] = next[group].concat(fileInfo);
      commitState({danmakuFileList: next}, false);
    }
  }
  if (!doc) {
    core.osd(t('content_unavailable'));
    return;
  }

  // 用户选定本地来源后,此前的后台匹配/下载不得覆盖该选择。
  if (enableDanmaku && path.indexOf('dandanplay://') !== 0) ddpResetState();

  // An active or in-flight source can be reused without resetting its date
  // slice, load acknowledgment or success notice. Explicit refreshes bypass it.
  if (!options.reload && !options.loadedMessageKey && lastOverlayProjection &&
      lastOverlayProjection.doc === doc && pluginState.danmakuFileList.selectedPaths[0] === path) {
    let wasEnabled = pluginState.danmakuEnabled;
    if (enableDanmaku) ensureDanmakuEnabled(true);
    if (overlayReady && pluginState.danmakuEnabled) {
      if (!sendCurrentDanmaku(false) && !wasEnabled) overlayPostMessage('toggle-danmaku', playbackSnapshot());
      if (!timePosListenerID) setObserver(true);
    }
    return true;
  }

  if (enableDanmaku) ensureDanmakuEnabled(true);
  danmakuCache[path] = doc;
  fileType = doc.sourceType.indexOf('nico-json') === 0 ? 'nico-json' : doc.sourceType;
  commitState({danmakuFileList: Object.assign({}, pluginState.danmakuFileList, {selectedPaths: [path]})}, false);
  resetNicoJsonFilterState();
  commitState({nicoJsonDateInfo: doc.dateInfo});
  if (fileType === 'nico-json') checkNicoJsonDuration(doc);
  updateDanmakuStatus({ fileType: fileType, isLoaded: false });
  pendingLoadNotice = {path: path, fileName: fileName, loadedMessageKey: loadedMessageKey};
  sidebarPostMessage("danmaku-file-list", pluginState.danmakuFileList);
  sendDanmakuFilterInfo();
  notifyBrowserDataChanged();

  if (overlayReady) {
    sendCurrentDanmaku(true);
  } else {
    pendingDanmaku = {};
    core.osd(t('queued'));
  }
  if (overlayReady) setObserver(true);
  return true;
}

function getVideoAspectRatio() {
  let aspect = mpv.getNumber("video-out-params/aspect");
  let rotation = mpv.getNumber("video-out-params/rotate");
  if (!(typeof aspect === "number" && isFinite(aspect) && aspect > 0)) {
    aspect = mpv.getNumber("video-params/aspect");
    rotation = mpv.getNumber("video-params/rotate");
  }
  if (!(typeof aspect === "number" && isFinite(aspect) && aspect > 0)) {
    let width = core.status.videoWidth;
    let height = core.status.videoHeight;
    aspect = width > 0 && height > 0 ? width / height : 0;
  }
  if (!(typeof aspect === "number" && isFinite(aspect) && aspect > 0)) return 0;
  if (typeof rotation === "number" && Math.abs(rotation % 180) === 90) aspect = 1 / aspect;
  return aspect;
}

function postVideoAspect() {
  if (overlayReady) overlayPostMessage("set-video-aspect", {
    aspect: getVideoAspectRatio(),
    fullscreen: !!(core.window && core.window.fullscreen),
  });
}

function playbackSnapshot() {
  let time = mpv.getNumber('time-pos');
  let speed = mpv.getNumber('speed');
  return {enabled: pluginState.danmakuEnabled, time: Number.isFinite(time) ? time : 0,
    paused: !!core.status.paused, speed: Number.isFinite(speed) && speed > 0 ? speed : 1};
}

function markOverlayReady() {
  if (overlayReady) return;
  overlayReady = true;
  overlay.show();
  postVideoAspect();
  if (pendingDanmaku) {
    if (!sendCurrentDanmaku(true)) overlayPostMessage("toggle-danmaku", playbackSnapshot());
    pendingDanmaku = null;
    setObserver(true);
  } else if (pluginState.danmakuEnabled && !core.status.idle && !currentVideoUrl && core.status.url) {
    loadDanmakuForVideo(core.status.url);
    if (loadedDanmakuVideoUrl !== currentVideoUrl) overlayPostMessage('toggle-danmaku', playbackSnapshot());
    setObserver(true);
  } else {
    overlayPostMessage("toggle-danmaku", playbackSnapshot());
    setObserver(true);
  }
}

function setObserver(start) {
  if (timePosListenerID) { event.off("mpv.time-pos.changed", timePosListenerID); timePosListenerID = null; }
  if (windowScaleListenerID) { event.off("mpv.window-scale.changed", windowScaleListenerID); windowScaleListenerID = null; }
  if (speedListenerID) { event.off("mpv.speed.changed", speedListenerID); speedListenerID = null; }

  if (start && overlayReady && pluginState.danmakuEnabled) {
    timePosListenerID = event.on("mpv.time-pos.changed", function (t) {
      overlayPostMessage("time-update", { time: t });
      if (danmakuBrowserWatch) pushBrowserTime(t);
    });
    windowScaleListenerID = event.on("mpv.window-scale.changed", function () {
      postVideoAspect();
    });
    speedListenerID = event.on("mpv.speed.changed", function (speed) {
      overlayPostMessage("playback-speed", { speed: speed });
    });
  }
}

function setDanmakuEnabled(enabled, options) {
  let next = !!enabled;
  options = options || {};
  if (next === pluginState.danmakuEnabled) {
    if (next) overlay.show();
    else if (options.hideOverlay) overlay.hide();
    return;
  }
  commitState({danmakuEnabled: next});
  if (next) {
    overlay.show();
    let selectedPath = pluginState.danmakuFileList.selectedPaths[0];
    if (selectedPath && danmakuCache[selectedPath]) {
      if (!sendCurrentDanmaku(false) && overlayReady) overlayPostMessage('toggle-danmaku', playbackSnapshot());
      setObserver(true);
    } else if (currentVideoUrl && loadedDanmakuVideoUrl !== currentVideoUrl) {
      loadDanmakuForVideo(currentVideoUrl);
      if (overlayReady && loadedDanmakuVideoUrl !== currentVideoUrl) overlayPostMessage('toggle-danmaku', playbackSnapshot());
      setObserver(true);
    } else {
      if (overlayReady) overlayPostMessage('toggle-danmaku', playbackSnapshot());
      setObserver(true);
    }
    if (options.osd !== false) core.osd(t('danmaku_on'));
  } else {
    if (overlayReady) overlayPostMessage('toggle-danmaku', playbackSnapshot());
    setObserver(false);
    if (options.hideOverlay) overlay.hide();
    if (options.osd !== false) core.osd(t('danmaku_off'));
  }
}

function toggleDanmaku() {
  setDanmakuEnabled(!pluginState.danmakuEnabled);
}

// Source loads defer playback IPC because their load payload carries the full snapshot.
function ensureDanmakuEnabled(deferPlayback) {
  commitState({danmakuEnabled: true});
  overlay.show();
  if (!deferPlayback) {
    if (overlayReady) overlayPostMessage('toggle-danmaku', playbackSnapshot());
    setObserver(true);
  }
}

function chooseDanmakuFile() {
  iina.utils.chooseFile(t('choose_file_title'), { allowedFileTypes: ["json", "xml"] }).then(function (path) {
    loadDanmakuFile(path, { enableDanmaku: true, reload: true });
  });
}

function isValidCssTextShadowBlur(value) {
  return typeof value === 'number' && isFinite(value) && value >= 0 && value <= 10;
}

function registerSidebarHandlers() {
  sidebarOnMessage("toggle-danmaku", function () { toggleDanmaku(); });

  // [message, state property, payload field, validator]. Persistence lives in commitState.
  let isCanvasMode = function (value) { return value === 'css' || value === 'default'; };
  let isNonNegative = function (value) { return isFiniteNumber(value) && value >= 0; };
  let isPositive = function (value) { return isFiniteNumber(value) && value > 0; };
  [
    ['set-opacity', 'canvasOpacity', 'opacity', isNonNegative], ['set-fontscale', 'canvasFontScale', 'scale', isPositive],
    ['set-canvas-mode', 'currentCanvasMode', 'mode', isCanvasMode], ['set-stroke-opacity', 'strokeOpacity', 'opacity', isNonNegative],
    ['set-stroke-width', 'strokeWidth', 'width', isNonNegative], ['set-stroke-color', 'strokeColor', 'color', isHexColor],
    ['set-stroke-inversion-color', 'strokeInversionColor', 'color', isHexColor], ['set-comment-limit', 'commentLimit', 'limit', isNonNegative],
    ['set-scroll-speed', 'scrollSpeed', 'speed', isPositive]
  ].forEach(function (entry) {
    sidebarOnMessage(entry[0], function (data) {
      if (!entry[3](data[entry[2]])) return;
      let patch = {};
      patch[entry[1]] = data[entry[2]];
      commitState(patch);
    });
  });

  sidebarOnMessage("set-css-text-shadow-blur", function (data) {
    if (data && isValidCssTextShadowBlur(data.blur)) commitState({cssTextShadowBlur: data.blur});
  });

  sidebarOnMessage("set-danmaku-force-simplified", function (data) {
    if (typeof data.value !== 'boolean') return;
    commitState({danmakuForceSimplified: data.value});

    // 当前已加载弹幕时重新驱动加载管道（内容经 getEffectiveContent 单源转换）
    resendDanmakuToOverlay();
    // 过滤 tab 列表与 overlay 同源: 简体开关变化 → 重新构建并推送
    notifyBrowserDataChanged();
  });

  sidebarOnMessage("set-danmaku-auto-offset", function (data) {
    if (typeof data.value !== 'boolean') return;
    commitState({danmakuAutoOffset: data.value});

    if (pluginState.danmakuAutoOffset && pluginState.currentDanmakuStatus.fileType === 'nico-json') {
      var selectedPath = pluginState.danmakuFileList.selectedPaths.length > 0 ? pluginState.danmakuFileList.selectedPaths[0] : null;
      if (selectedPath && danmakuCache[selectedPath]) {
        checkNicoJsonDuration(danmakuCache[selectedPath]);
      }
    }
  });

  sidebarOnMessage("set-danmaku-offset", function (data) {
    applyDanmakuOffset(data.offset);
  });

  sidebarOnMessage("set-danmaku-font", function (data) {
    let family = typeof data.fontFamily === 'string' ? data.fontFamily : undefined;
    let weight = typeof data.fontWeight === 'string' || isFiniteNumber(data.fontWeight) ? String(data.fontWeight) : undefined;
    if (family === undefined && weight === undefined) return;
    applyDanmakuFont(family, weight);
  });

  sidebarOnMessage("set-style-preset", function (data) {
    if (!data || !Object.prototype.hasOwnProperty.call(STYLE_PRESETS, data.preset)) return;
    commitState(Object.assign({}, STYLE_PRESETS[data.preset], {stylePreset: data.preset}));
  });

  sidebarOnMessage("set-danmaku-filter", function (data) {
    if (data.startDay === undefined || data.endDay === undefined) return;
    applyDanmakuFilter(data.startDay, data.endDay);
    notifyBrowserDataChanged(); // 范围切片变化 → 列表与 overlay 同步重建
  });

  sidebarOnMessage("set-danmaku-filter-density", function (data) {
    // 0 is the explicit "unlimited" value; a missing field is not.
    if (!isFiniteNumber(data.density) || data.density < 0) return;
    applyDanmakuFilterDensity(data.density);
    notifyBrowserDataChanged(); // 密度过滤变化 → 列表与 overlay 同步重建
  });

  // ── 屏蔽词 ──

  sidebarOnMessage("danmaku-blocklist-set-enabled", function (data) {
    if (typeof data.enabled !== 'boolean') return;
    commitState({danmakuBlocklistEnabled: data.enabled});

    // 屏蔽词为零时开关不影响弹幕内容,跳过重建以省性能
    if (pluginState.danmakuBlocklist.length > 0) {
      notifyBrowserDataChanged();
      resendDanmakuToOverlay();
    }
  });

  sidebarOnMessage("danmaku-blocklist-add", function (data) {
    if (typeof data.word !== 'string') return;
    var w = data.word.trim();
    if (!w) return;
    if (pluginState.danmakuBlocklist.indexOf(w) !== -1) return;
    commitState({danmakuBlocklist: pluginState.danmakuBlocklist.concat(w)});

    notifyBrowserDataChanged();
    resendDanmakuToOverlay();
  });

  // 按词值删除(不按下标): 渲染与点击之间列表可能变化,下标会删错词
  sidebarOnMessage("danmaku-blocklist-remove", function (data) {
    var word = data && data.word !== undefined ? String(data.word) : null;
    var idx = word !== null ? pluginState.danmakuBlocklist.indexOf(word) : -1;
    if (idx < 0) return;
    commitState({danmakuBlocklist: pluginState.danmakuBlocklist.filter(function (_, i) { return i !== idx; })});

    notifyBrowserDataChanged();
    resendDanmakuToOverlay();
  });

  // ── 顶部 / 底部弹幕屏蔽 ──
  sidebarOnMessage("danmaku-position-filter-set", function (data) {
    if (!data) return;
    let top = typeof data.danmakuBlockTopEnabled === 'boolean' ? data.danmakuBlockTopEnabled : pluginState.danmakuBlockTopEnabled;
    let bottom = typeof data.danmakuBlockBottomEnabled === 'boolean' ? data.danmakuBlockBottomEnabled : pluginState.danmakuBlockBottomEnabled;
    if (top !== pluginState.danmakuBlockTopEnabled || bottom !== pluginState.danmakuBlockBottomEnabled) {
      commitState({danmakuBlockTopEnabled: top, danmakuBlockBottomEnabled: bottom});

      notifyBrowserDataChanged();
      resendDanmakuToOverlay();
    }
  });

  // ── 弹幕去重 ──

  // 点击列表时间戳 → 跳转到该弹幕时间(弹幕 vpos 换算为视频秒,考虑弹幕偏移)
  sidebarOnMessage("danmaku-seek", function (data) {
    if (!data || typeof data.vpos !== 'number' || !isFinite(data.vpos)) return;
    var sec = data.vpos / 100 - (pluginState.danmakuTimeOffsetSec || 0);
    if (sec < 0) sec = 0;
    try {
      core.seekTo(sec);
    } catch (e) {
      console.log('[danmaku-seek] seekTo failed: ' + e);
    }
  });

  sidebarOnMessage("danmaku-dedupe-set", function (data) {
    let patch = {};
    if (typeof data.enabled === 'boolean') patch.danmakuDedupeEnabled = data.enabled;
    if (data.window !== undefined) {
      var w = parseFloat(data.window);
      if (isFinite(w) && w >= 1 && w <= 5) patch.danmakuDedupeWindow = w;
    }

    if (!Object.keys(patch).length) return;
    commitState(patch);
    notifyBrowserDataChanged();
    resendDanmakuToOverlay();
  });

  sidebarOnMessage("danmaku-browser-vis-set", function (data) {
    if (typeof data.visible === 'boolean') {
      commitState({danmakuBrowserVisible: data.visible});

      if (pluginState.danmakuBrowserVisible && browserDataPending) {
        browserDataPending = false;
        sendDanmakuBrowserData(buildDanmakuBrowserList());
      }
    }
  });

  sidebarOnMessage("request-state", function () {
    // 主进程在视频/弹幕切换时维护状态;侧栏懒加载只拉取快照,不能重建并覆盖会话文件列表。
    sidebarPostMessage('danmaku-state', stateSnapshot());
    sidebarPostMessage("danmaku-file-list", pluginState.danmakuFileList);
    sendDanmakuFilterInfo();
    ddpSyncState();
  });

  sidebarOnMessage("sidebar-log", function (data) {
    console.log('[sidebar] ' + data.msg);
  });

  sidebarOnMessage("select-danmaku-file", function (data) {
    if (typeof data.path === 'string' && data.path) loadDanmakuFile(data.path, { enableDanmaku: true });
  });

  sidebarOnMessage("danmaku-file-add", chooseDanmakuFile);

  sidebarOnMessage("dandanplay-set-auto-network", function (data) {
    if (typeof data.autoNetwork !== 'boolean') return;
    commitState({dandanplayAutoNetwork: data.autoNetwork});

    ddpSyncState();
  });

  sidebarOnMessage("dandanplay-search", function (data) {
    // Validate before advancing generations: an empty request must not cancel a real one.
    if (typeof data.keyword !== 'string' || !data.keyword.trim()) return;
    let generation = ++ddpSearchGeneration;
    ddpBangumiGeneration += 1;
    let searchId = data.searchId;
    var keyword = data.keyword;
    ddpSearchAnime(keyword).then(function(res) {
      if (generation !== ddpSearchGeneration) return;
      if (res && res.statusCode === 403) {
        sidebarPostMessage("dandanplay-search-result", { searchId: searchId, animes: [], error: t('ddp_auth_error') });
        return;
      }
      var result = ddpParseBody(res);
      if (res && typeof res.statusCode === 'number' && (res.statusCode < 200 || res.statusCode >= 300)) {
        sidebarPostMessage("dandanplay-search-result", { searchId: searchId, animes: [], error: ddpHttpError(res, result) });
        return;
      }
      if (!result || !result.animes || result.animes.length === 0) {
        sidebarPostMessage("dandanplay-search-result", { searchId: searchId, animes: [], error: t('ddp_no_results') });
        return;
      }
      sidebarPostMessage("dandanplay-search-result", { searchId: searchId, animes: result.animes, error: null });
    }).catch(function(err) {
      if (generation !== ddpSearchGeneration) return;
      console.log('[search] API error: ' + ddpErrStr(err));
      sidebarPostMessage("dandanplay-search-result", { searchId: searchId, animes: [], error: ddpErrStr(err) });
    });
  });

  sidebarOnMessage("dandanplay-get-bangumi", function (data) {
    if ((typeof data.bangumiId !== 'string' && !isFiniteNumber(data.bangumiId)) || data.bangumiId === '') return;
    let generation = ++ddpBangumiGeneration;
    let searchGeneration = ddpSearchGeneration;
    var bangumiId = data.bangumiId;
    var animeTitle = data.animeTitle;
    ddpGetBangumi(bangumiId).then(function(res) {
      if (generation !== ddpBangumiGeneration || searchGeneration !== ddpSearchGeneration) return;
      if (res && res.statusCode === 403) {
        sidebarPostMessage("dandanplay-bangumi-result", { bangumiId: bangumiId, searchId: data.searchId, animeTitle: animeTitle, episodes: [], error: t('ddp_auth_error') });
        return;
      }
      var result = ddpParseBody(res);
      var isHttpError = res && typeof res.statusCode === 'number' && (res.statusCode < 200 || res.statusCode >= 300);
      if (!result || !result.bangumi || isHttpError) {
        sidebarPostMessage("dandanplay-bangumi-result", { bangumiId: bangumiId, searchId: data.searchId, animeTitle: animeTitle, episodes: [], error: ddpHttpError(res, result) });
        return;
      }
      var episodes = result.bangumi.episodes || [];
      sidebarPostMessage("dandanplay-bangumi-result", { bangumiId: bangumiId, searchId: data.searchId, animeTitle: animeTitle, episodes: episodes });
    }).catch(function(err) {
      if (generation !== ddpBangumiGeneration || searchGeneration !== ddpSearchGeneration) return;
      console.log('[bangumi] API error: ' + ddpErrStr(err));
      sidebarPostMessage("dandanplay-bangumi-result", { bangumiId: bangumiId, searchId: data.searchId, animeTitle: animeTitle, episodes: [], error: ddpErrStr(err) });
    });
  });

  sidebarOnMessage("dandanplay-select-match", function (data) {
    var match = data.match;
    if (match && match.episodeId) {
      commitDdpState({matchType: 'filename'});
      ddpLoadComments(match.episodeId, match.animeTitle, match.episodeTitle, true, DDP_LOAD_ORIGIN.MANUAL);
    }
  });

  sidebarOnMessage("dandanplay-select-episode", function (data) {
    if ((typeof data.episodeId !== 'string' && !isFiniteNumber(data.episodeId)) || data.episodeId === '') return;
    commitDdpState({matchType: 'filename'});
    ddpLoadComments(data.episodeId, data.animeTitle, data.episodeTitle, true, DDP_LOAD_ORIGIN.MANUAL);
  });

  sidebarOnMessage("dandanplay-trigger-match", function () {
    if (currentVideoUrl) {
      ddpAutoMatchAndLoad(currentVideoUrl, DDP_LOAD_ORIGIN.MANUAL);
    }
  });

  // 过滤 tab: sidebar 懒加载,只能由 sidebar 主动拉取弹幕列表;watch 控制播放时间推送
  sidebarOnMessage("danmaku-browser-request", function (data) {
    if (pluginState.danmakuBrowserVisible) {
      sendDanmakuBrowserData(buildDanmakuBrowserList());
    } else {
      browserDataPending = true;
    }
  });

  sidebarOnMessage("danmaku-browser-watch", function (data) {
    if (typeof data.watch !== 'boolean') return;
    danmakuBrowserWatch = data.watch;
    if (danmakuBrowserWatch) {
      var t = mpv.getNumber("time-pos");
      // force: 播种锚点必须送达——若被 300ms 节流吞掉,暂停播放时不再有
      // time-pos 事件,sidebar 的 browserVpos 保持 -1,列表永不锚定
      if (t !== undefined && t !== null) pushBrowserTime(t, true);
    }
  });
}

event.on("iina.window-loaded", function () {
  overlayReady = false;
  overlayLoadId += 1;
  updateDanmakuStatus({fileType: pluginState.currentDanmakuStatus.fileType, isLoaded: false});
  lastOverlayProjection = null;
  if (pluginState.danmakuFileList.selectedPaths.length) pendingDanmaku = {};
  overlay.loadFile("overlay/index.html");
  sidebar.loadFile("sidebar/index.html");
  registerSidebarHandlers();
});

event.on("iina.plugin-overlay-loaded", function () {
  registerOverlayHandlers();
  overlayPostMessage("request-overlay-state", {});
  overlay.show();
});

event.on("iina.file-loaded", function (url) {
  postVideoAspect();
  // 偏移量因视频/弹幕文件而异(且不持久化),切换视频时归零并同步 overlay/sidebar
  applyDanmakuOffset(0);
  // 无论弹幕开关状态都重置视频相关状态,避免旧 renderer/弹幕残留到新视频。
  loadDanmakuForVideo(url);
});

event.on("mpv.seeking.changed", function (seeking) {
  if (seeking) { videoSeekInProgress = true; return; }
  if (!videoSeekInProgress) return;
  videoSeekInProgress = false;
  if (overlayReady && pluginState.danmakuEnabled) overlayPostMessage('time-update', {
    time: mpv.getNumber('time-pos'), seek: true
  });
});

event.on("mpv.pause.changed", function () {
  if (!overlayReady) return;
  overlayPostMessage("pause-state", { paused: core.status.paused });
});

// mpv's display aspect includes pixel-aspect and aspect overrides; output
// parameters also include video filters. Property updates handle rotation/crop.
event.on("mpv.video-out-params.changed", postVideoAspect);
event.on("mpv.video-params.changed", postVideoAspect);

event.on("iina.window-fs.changed", function (fullscreen) {
  if (overlayReady) overlayPostMessage("set-fullscreen", { fullscreen: !!fullscreen });
});

function registerOverlayHandlers() {
  // IINA replaces listeners by name; re-register after every overlay navigation.
  overlayOnMessage("overlay-ready", function (data) {
    markOverlayReady();
  });

  overlayOnMessage("danmaku-load-result", function (data) {
    if (!data || data.loadId !== overlayLoadId) return;
    if (!data.success) {
      let path = pluginState.danmakuFileList.selectedPaths[0];
      // A failed candidate remains in the list for an explicit retry, but is
      // no longer an active selection. Invalidate later replies from this load.
      overlayLoadId += 1;
      lastOverlayProjection = null;
      projectionCache = null;
      loadedDanmakuVideoUrl = null;
      pendingLoadNotice = null;
      pendingDanmaku = null;
      resetNicoJsonFilterState({
        currentDanmakuStatus: {fileType: null, isLoaded: false},
        danmakuFileList: Object.assign({}, pluginState.danmakuFileList, {selectedPaths: []})
      });
      overlayPostMessage('clear-danmaku', {});
      sidebarPostMessage('danmaku-file-list', pluginState.danmakuFileList);
      sidebarPostMessage("danmaku-file-error", { path: path, message: t('render_failed') });
      sendDanmakuFilterInfo();
      notifyBrowserDataChanged();
      core.osd(t('render_failed'));
    } else {
      updateDanmakuStatus({ fileType: pluginState.currentDanmakuStatus.fileType, isLoaded: true });
      if (pendingLoadNotice && pendingLoadNotice.path === pluginState.danmakuFileList.selectedPaths[0]) {
        osdAfterDanmakuLoad(pendingLoadNotice.fileName, pendingLoadNotice.loadedMessageKey);
        pendingLoadNotice = null;
      }
    }
  });

  overlayOnMessage("seek-disable", function () { core.osd(t('seek_disable')); });
  overlayOnMessage("seek-enable", function () { core.osd(t('seek_enable')); });

  overlayOnMessage("jump", function (data) {
    let targetSec = typeof data.targetSec === 'number' ? data.targetSec : NaN;
    if (isFinite(targetSec) && targetSec >= 0) {
      mpv.set("time-pos", targetSec);
      if (data.message) core.osd(t('jump') + data.message);
    }
  });

  overlayOnMessage("jump-video", function (data) {
    if (data.videoId) core.osd(t('jump') + data.videoId + (data.message ? " " + data.message : ""));
  });
}

menu.addItem(
  menu.item(t('menu_toggle'), function () { toggleDanmaku(); }, { keyBinding: "D" })
);

menu.addItem(
  menu.item(t('menu_load_file'), chooseDanmakuFile)
);

menu.addItem(menu.separator());

menu.addItem(
  menu.item(t('menu_show_overlay'), function () { setDanmakuEnabled(true); })
);

menu.addItem(
  menu.item(t('menu_hide_overlay'), function () { setDanmakuEnabled(false, { hideOverlay: true }); })
);

console.log("danmaku-cosmos plugin initialized");
