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
var DDP_LOAD_ORIGIN = ddpClientModule.DDP_LOAD_ORIGIN;
var ddpParseBody = ddpClientModule.ddpParseBody;
var ddpErrStr = ddpClientModule.ddpErrStr;
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
pluginState.danmakuForceSimplified = !!preferences.get("danmakuForceSimplified");
// Duration differences can come from opening or ending cuts, so auto-offset is opt-in.
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
var blockRegexes = [];
// Invalid or unsafe regex entries fall back to literal matching and are marked in the sidebar.
var blockInvalidEntries = [];
// Initialize this before rebuilding: declarations are hoisted, assignments are not.
var BLOCK_REGEX_MAX_LENGTH = 200;
rebuildBlockRegexes();
// Projection merges scrolling duplicates; the engine chains fixed comments as they appear.
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
pluginState.danmakuTimeOffsetSec = 0; // Video-specific offset; reset on load and never persisted.
pluginState.danmakuFontFamily = preferences.get("danmakuFontFamily") || "";
pluginState.danmakuFontWeight = preferences.get("danmakuFontWeight") || "500";
var savedStylePreset = preferences.get("stylePreset");
pluginState.stylePreset = savedStylePreset === undefined || savedStylePreset === null
  ? 'nico'
  : (['nico', 'balanced', 'bilibili', 'custom'].indexOf(savedStylePreset) !== -1 ? savedStylePreset : 'custom');
var overlayReady = false;
let overlayLoadId = 0;
let overlayTimeUpdateId = 0;
let overlayTimeInFlight = null;
let overlayTimePending = null;
var preferencesSyncTimer = null;

var DDP_APP_ID = preferences.get("dandanplayAppId") || 't43832ky57';
var DDP_APP_SECRET = preferences.get("dandanplayAppSecret") || 'IDnPEdEKDIziKeYVxm6VcaJE4Bv2fnzT';

pluginState.dandanplayAutoNetwork = preferences.get("dandanplayAutoNetwork") === true;

pluginState.dandanplayState = {
  status: 'idle',
  episodeId: null,
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
// Target video of the last renderer load; only a matching loadId reply confirms success.
var loadedDanmakuVideoUrl = null;
// A URL can be reloaded; generations reject asynchronous replies from the previous load.
var danmakuLoadGeneration = 0;
let awaitingFileLoaded = false;
let videoHasEnded = false;
let overlayAwaitingVideoRender = true;
let overlayHiddenByUser = false;
// Keep the native view transparent until a current frame is acknowledged,
// avoiding a flash of the WebView's previous frame when enabling playback.
let overlayAwaitingEnableFrame = false;
let overlayRevealId = 0;
let overlayRevealTimer = null;
const OVERLAY_REVEAL_TIMEOUT_MS = 500;
let videoDiscoveryTimer = null;
// Undefined until discovery. A missing entry is cached as null for this video.
let currentDdpCache;
let ddpRequestGeneration = 0;
let ddpSearchGeneration = 0;
let videoSeekInProgress = false;
// A new seek before the previous one restarted playback: a slider drag or a held key.
let videoSeekRepeated = false;
let ddpBangumiGeneration = 0;
var timePosListenerID = null;
var windowScaleListenerID = null;
var speedListenerID = null;
let cachePauseListenerID = null;
let overlayPausedForCache = false;

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
// Video duration minus source duration; null means no mismatch was found.
pluginState.nicoJsonDurationDiff = null;
pluginState.nicoJsonHasDuration = false;
pluginState.danmakuFilterStartDay = null;
pluginState.danmakuFilterEndDay = null;
pluginState.danmakuFilterDensity = preferences.get("danmakuFilterDensity") !== undefined ? preferences.get("danmakuFilterDensity") : 0;
var danmakuBrowserWatch = false;
var lastBrowserTimeSent = 0;
pluginState.danmakuBrowserVisible = preferences.get("danmakuBrowserVisible") !== undefined ? !!preferences.get("danmakuBrowserVisible") : true;
var openccSimplifier = null;

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

// Reject malformed IPC before missing payloads can become settings.
// Payloadless intents receive an empty object; handlers validate their own fields.
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

function isDdpId(value) {
  return (typeof value === 'string' && value.trim() !== '') || isFiniteNumber(value);
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
  if (browserNeedsTime()) pushBrowserTime(mpv.getNumber("time-pos"), true);
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

// Source duration has whole-second precision, so differences below one second are ignored.
// Return false only when video duration is unavailable, allowing a deferred retry.
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
  // mpv duration may be unavailable at file-loaded; retry only for the same source and video.
  var savedPath = pluginState.danmakuFileList.selectedPaths.length > 0 ? pluginState.danmakuFileList.selectedPaths[0] : null;
  let generation = danmakuLoadGeneration;
  setTimeout(function () {
    if (generation === danmakuLoadGeneration && savedPath && pluginState.danmakuFileList.selectedPaths[0] === savedPath) {
      runDurationCompare(danmakuDuration);
    }
  }, 800);
}

// Keep the duration warning visible instead of replacing it with the load notification.
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
    sourceTotalCount: projection ? projection.sourceTotalCount : 0,
    filterStartDay: pluginState.danmakuFilterStartDay, filterEndDay: pluginState.danmakuFilterEndDay,
    filterDensity: pluginState.danmakuFilterDensity, filteredCount: projection ? projection.filteredCount : 0,
    dateInfo: pluginState.nicoJsonDateInfo
  });
}

function buildLoadDanmakuPayload(comments) {
  resetOverlayTimeUpdates();
  return {
    loadId: ++overlayLoadId,
    playback: playbackSnapshot(),
    fileType: pluginState.currentDanmakuStatus.fileType,
    comments: comments,
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
  };
}

function resetNicoJsonFilterState(extra) {
  commitState(Object.assign({nicoJsonDateInfo: emptyNicoJsonDateInfo(), nicoJsonDurationDiff: null,
    nicoJsonHasDuration: false, danmakuFilterStartDay: null, danmakuFilterEndDay: null}, extra));
}

function applyDanmakuFilter(startDay, endDay) {
  if (startDay !== null || endDay !== null) {
    if (!Number.isInteger(startDay) || !Number.isInteger(endDay) || startDay > endDay || pluginState.nicoJsonDateInfo.firstDay === null) return false;
    let days = pluginState.nicoJsonDateInfo.dayCounts;
    let startIndex = 0;
    while (startIndex < days.length - 1 && days[startIndex][0] < startDay) startIndex += 1;
    let endIndex = startIndex;
    while (endIndex < days.length - 1 && days[endIndex + 1][0] <= endDay) endIndex += 1;
    startDay = days[startIndex][0];
    endDay = days[endIndex][0];
    let fullRange = startDay === pluginState.nicoJsonDateInfo.firstDay && endDay === pluginState.nicoJsonDateInfo.lastDay;
    if (fullRange) { startDay = null; endDay = null; }
  }
  if (startDay === pluginState.danmakuFilterStartDay && endDay === pluginState.danmakuFilterEndDay) return false;
  commitState({danmakuFilterStartDay: startDay, danmakuFilterEndDay: endDay});
  refreshDanmakuFilters();
  return true;
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

function readRegexUnicodeEscape(pattern, index, allowCodePoint) {
  let match = /^\\u(?:\{([0-9a-fA-F]+)\}|([0-9a-fA-F]{4}))/.exec(pattern.slice(index));
  if (!match || (match[1] && !allowCodePoint)) return null;
  let code = parseInt(match[1] || match[2], 16);
  if (!Number.isFinite(code) || code > 0x10FFFF) return null;
  return {length: match[0].length, code: code};
}

function normalizeRegexGroupName(name) {
  let normalized = '';
  for (let i = 0; i < name.length; i++) {
    if (name.charAt(i) !== '\\') { normalized += name.charAt(i); continue; }
    let escape = readRegexUnicodeEscape(name, i, true);
    if (!escape) return null;
    normalized += String.fromCodePoint(escape.code);
    i += escape.length - 1;
  }
  return normalized || null;
}

// Synchronous regex matching cannot be interrupted. Reject repeated ambiguous
// groups, multiple variable choices per alternative (including backreferences),
// and unanchored variable wildcards that can restart at every character.
// Bounds still multiply choices; exact {n} repetitions add no length choice.
// With both m and s, even anchored wildcards can repeatedly scan the remainder.
// This conservative check also rejects some safe patterns; they fall back to literals.
function isUnsafeBlockPattern(pattern, flags) {
  flags = flags || '';
  let unicode = flags.indexOf('u') !== -1;
  let multilineDotAll = flags.indexOf('m') !== -1 && flags.indexOf('s') !== -1;
  let newFrame = function (anchor) { return {ambiguous: false, variable: 0, maxVariable: 0,
    alternation: false, anchored: !!anchor, inheritedAnchor: !!anchor}; };
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
      let group, refEnd = null;
      if (pattern.slice(i, i + 3) === '\\k<') {
        refEnd = pattern.indexOf('>', i + 3);
        if (refEnd < 0) return true;
        let name = normalizeRegexGroupName(pattern.slice(i + 3, refEnd));
        if (name === null) return true;
        group = captureNames[name];
      } else {
        let ref = /^\\([1-9]\d*)/.exec(pattern.slice(i));
        if (ref) { group = Number(ref[1]); refEnd = i + ref[0].length - 1; }
      }
      if (refEnd !== null) {
        i = refEnd;
        if (group && variableCaptures[group]) {
          top().ambiguous = true;
          if (addVariable(top(), 1)) return true;
        }
        continue;
      }
      let escape = readRegexUnicodeEscape(pattern, i, unicode);
      if (escape) { i += escape.length - 1; continue; }
      let hex = /^\\x[0-9a-fA-F]{2}/.exec(pattern.slice(i));
      if (hex) { i += hex[0].length - 1; continue; }
      i++;
      continue;
    }
    if (ch === '^') { top().anchored = true; continue; }
    if (ch === '.') {
      let quantifier = readRegexQuantifier(pattern, i + 1);
      if (quantifier && quantifier.variable && (!top().anchored || multilineDotAll)) return true;
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
      frame.anchored = frame.inheritedAnchor;
      continue;
    }
    if (ch === '(') {
      let frame = newFrame(top().anchored);
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
            if (close < 0) return true;
            let name = normalizeRegexGroupName(pattern.slice(i + 3, close));
            if (name === null) return true;
            captureNames[name] = frame.capture;
            i = close;
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

// Only explicit /pattern/flags entries use regex; ordinary words match literally.
function compileBlockEntry(entry) {
  if (!entry) return null;
  var regexMatch = /^\/([\s\S]+)\/([imsu]*)$/.exec(entry);
  if (regexMatch) {
    var pattern = regexMatch[1];
    var rawFlags = regexMatch[2];
    if (pattern.length <= BLOCK_REGEX_MAX_LENGTH && !isUnsafeBlockPattern(pattern, rawFlags)) {
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

function pushBrowserTime(timeSec, force) {
  if (typeof timeSec !== 'number' || !isFinite(timeSec)) return;
  var now = Date.now();
  if (!force && now - lastBrowserTimeSent < 300) return;
  lastBrowserTimeSent = now;
  sidebarPostMessage("danmaku-visible-time", { time: timeSec, offset: pluginState.danmakuTimeOffsetSec });
}

var browserDataPending = false; // Defer list construction and delivery until the list is shown.

function notifyBrowserDataChanged() {
  if (!danmakuBrowserWatch) return;
  if (!pluginState.danmakuBrowserVisible) {
    browserDataPending = true;
    return;
  }
  sendDanmakuBrowserData(buildDanmakuBrowserList());
}

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
  // fixedCombo travels only with loads, so its changes require a reload even with identical comments.
  if (!force && lastOverlayProjection && lastOverlayProjection.doc === doc &&
      lastOverlayProjection.fixedCombo === pluginState.danmakuDedupeEnabled &&
      sameFormattedComments(lastOverlayProjection.comments, comments)) return false;
  lastOverlayProjection = {doc: doc, comments: comments, fixedCombo: pluginState.danmakuDedupeEnabled};
  updateDanmakuStatus({fileType: pluginState.currentDanmakuStatus.fileType, isLoaded: false});
  overlayPostMessage('load-danmaku', buildLoadDanmakuPayload(comments));
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
    if (loadDanmakuFile(files[i].path, {requireComments: true})) return true;
  }
  return false;
}

function ddpSyncState() {
  sidebarPostMessage("dandanplay-status", {
    status: pluginState.dandanplayState.status,
    episodeId: pluginState.dandanplayState.episodeId,
    error: pluginState.dandanplayState.error,
    matches: pluginState.dandanplayState.matches,
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
    episodeId: null,
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
  if (awaitingFileLoaded) return;
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
    episodeId: null,
    error: '',
    matches: null,
    matchType: ''
  }});
  ddpSyncState();

  let isCurrent = function () {
    return url === currentVideoUrl && loadGeneration === danmakuLoadGeneration && requestGeneration === ddpRequestGeneration;
  };
  ddpMatchVideo(fileName, path, isCurrent).then(function(res) {
    if (!isCurrent()) return;
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
    if (!isCurrent()) return;
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
    return entry === existing ? Object.assign({}, entry, {filename: displayName}) : entry;
  }) : files.concat({path: virtualPath, filename: displayName, relativePath: 'DanDanPlay #' + episodeId, type: 'DDP'});
  commitState({danmakuFileList: Object.assign({}, pluginState.danmakuFileList, {jsonFiles: next})}, false);
  return virtualPath;
}

function ddpAddToFileListAndLoad(episodeId, animeTitle, episodeTitle, converted, forceLoad, fresh) {
  var virtualPath = ddpUpsertFileListEntry(episodeId, animeTitle, episodeTitle, converted, fresh);
  if (forceLoad) {
    // Share source activation, readiness queuing and enable handling with local files.
    loadDanmakuFile(virtualPath, { enableDanmaku: true, loadedMessageKey: 'network_loaded' });
  } else {
    sidebarPostMessage("danmaku-file-list", pluginState.danmakuFileList);
  }
}

function ddpLoadComments(episodeId, animeTitle, episodeTitle, forceLoad, origin, loadGeneration) {
  if (awaitingFileLoaded) return;
  let requestGeneration = ++ddpRequestGeneration;
  if (origin === undefined) origin = DDP_LOAD_ORIGIN.AUTO;
  var isManual = isManualDdpLoad(origin);
  var videoUrl = currentVideoUrl;
  if (loadGeneration === undefined) loadGeneration = danmakuLoadGeneration;
  commitDdpState({status: 'loading', episodeId: episodeId});
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
      // Treat entirely malformed downloads as failures, preserving any stale cache.
      commitDdpState({status: 'error', error: t('ddp_no_comments')});
      ddpSyncState();
      core.osd(t('ddp_no_comments'));
      ddpFallbackToLocal(true);
      return;
    }

    let cachedAt = Date.now();
    currentDdpCache = {episodeId: episodeId, animeTitle: animeTitle, episodeTitle: episodeTitle,
      cachedAt: cachedAt, stale: false, document: converted};
    ddpSaveVideoCache(videoUrl, episodeId, animeTitle, episodeTitle, converted, cachedAt);

    commitDdpState({status: 'loaded'});
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
  if (videoDiscoveryTimer !== null) return;
  if (!pluginState.dandanplayAutoNetwork || !pluginState.danmakuEnabled) return;
  if (pluginState.currentDanmakuStatus.isLoaded) return;
  if (loadFirstLocalDanmaku()) return;
  let cached = getCurrentDdpCache();
  if (cached && (!cached.stale || allowStale)) {
    ddpAddToFileListAndLoad(cached.episodeId, cached.animeTitle, cached.episodeTitle, cached.document, true, !cached.stale);
  }
}

function getCurrentDdpCache() {
  if (currentDdpCache === undefined) {
    let stored = ddpReadVideoCache(currentVideoUrl);
    currentDdpCache = stored && stored.document.comments.length ? stored : null;
  }
  if (currentDdpCache) {
    let stale = ddpClientModule.isDdpCacheStale(currentDdpCache.cachedAt);
    if (stale !== currentDdpCache.stale) {
      currentDdpCache.stale = stale;
      ddpUpsertFileListEntry(currentDdpCache.episodeId, currentDdpCache.animeTitle, currentDdpCache.episodeTitle,
        currentDdpCache.document, !stale);
      sidebarPostMessage('danmaku-file-list', pluginState.danmakuFileList);
    }
  }
  return currentDdpCache;
}

function updateOverlayOpacity() {
  overlay.setOpacity(pluginState.danmakuEnabled && !overlayAwaitingVideoRender && !overlayAwaitingEnableFrame ? 1 : 0);
}

function cancelOverlayReveal() {
  overlayAwaitingEnableFrame = false;
  if (overlayRevealTimer !== null) clearTimeout(overlayRevealTimer);
  overlayRevealTimer = null;
}

// Begin a disabled → enabled transition. The bounded fallback keeps a WebView
// that never acknowledges (for example, one being reloaded) from staying hidden.
function beginOverlayReveal() {
  cancelOverlayReveal();
  overlayRevealId += 1;
  overlayAwaitingEnableFrame = true;
  let revealId = overlayRevealId;
  overlayRevealTimer = setTimeout(function () { finishOverlayReveal(revealId); }, OVERLAY_REVEAL_TIMEOUT_MS);
}

function finishOverlayReveal(revealId) {
  if (!overlayAwaitingEnableFrame || revealId !== overlayRevealId) return;
  cancelOverlayReveal();
  updateOverlayOpacity();
}

// Playback snapshot for toggle-danmaku. A pending reveal asks the overlay to
// acknowledge after it has drawn the enabled state.
function toggleSnapshot() {
  let snapshot = playbackSnapshot();
  if (overlayAwaitingEnableFrame && snapshot.enabled) snapshot.revealId = overlayRevealId;
  return snapshot;
}

function restoreOverlayAfterManualHide() {
  if (!overlayHiddenByUser) return;
  overlay.setOpacity(0);
  overlay.show();
  overlayHiddenByUser = false;
}

function hideOverlayForUser() {
  overlay.setOpacity(0);
  overlayHiddenByUser = true;
  overlay.hide();
}

function beginVideoReset(resetOffset, skipOverlayClear) {
  if (videoDiscoveryTimer !== null) clearTimeout(videoDiscoveryTimer);
  videoDiscoveryTimer = null;
  overlayLoadId += 1;
  danmakuLoadGeneration += 1;
  overlayAwaitingVideoRender = true;
  cancelOverlayReveal();
  overlay.setOpacity(0);
  videoSeekInProgress = false;
  videoSeekRepeated = false;
  danmakuCache = Object.create(null);
  currentDdpCache = undefined;
  projectionCache = null;
  lastOverlayProjection = null;
  currentVideoUrl = null;
  syncPlaybackObservers();
  pendingDanmaku = null;
  pendingLoadNotice = null;
  loadedDanmakuVideoUrl = null;
  ddpResetState();
  resetNicoJsonFilterState({currentDanmakuStatus: {fileType: null, isLoaded: false},
    danmakuFileList: {xmlFiles: [], jsonFiles: [], selectedPaths: []}});
  if (resetOffset !== false) applyDanmakuOffset(0);
  sidebarPostMessage('danmaku-file-list', pluginState.danmakuFileList);
  sendDanmakuFilterInfo();
  notifyBrowserDataChanged();
  if (overlayReady && !skipOverlayClear) overlayPostMessage('clear-danmaku', {clearId: overlayLoadId});
}

function loadDanmakuForVideo(url, resetOffset) {
  if (!url) return;
  let needsReset = !awaitingFileLoaded;
  awaitingFileLoaded = false;
  if (needsReset) beginVideoReset(resetOffset);
  videoHasEnded = false;
  currentVideoUrl = url;
  let loadGeneration = danmakuLoadGeneration;
  let requestGeneration = ddpRequestGeneration;
  // Yield to native hide/clear tasks before synchronous source discovery.
  // This is a scheduling boundary, not a WebView readiness timeout.
  videoDiscoveryTimer = setTimeout(function () {
    if (loadGeneration !== danmakuLoadGeneration || currentVideoUrl !== url) return;
    videoDiscoveryTimer = null;
    // Preserve an explicit operation while still discovering fallback sources.
    let activate = !pluginState.danmakuFileList.selectedPaths.length && requestGeneration === ddpRequestGeneration;
    discoverDanmakuForVideo(url, loadGeneration, activate);
    if (!activate && !pluginState.danmakuFileList.selectedPaths.length) {
      let status = pluginState.dandanplayState.status;
      if (status === 'error' || status === 'matched' || status === 'no-match') ddpFallbackToLocal(status === 'error');
    }
    if (overlayReady && loadedDanmakuVideoUrl !== currentVideoUrl) overlayPostMessage('toggle-danmaku', toggleSnapshot());
    syncPlaybackObservers();
  }, 0);
}

function discoverDanmakuForVideo(url, loadGeneration, activate) {
  postVideoAspect();

  let current = pluginState.danmakuFileList;
  if (core.status.isNetworkResource) {
    core.osd(t('network_skip_local'));
  } else {
    let discovered = findDanmakuByEpisode(url);
    let mergeFiles = function (found, existing) {
      let paths = new Set(found.map(function (item) { return item.path; }));
      return found.concat(existing.filter(function (item) { return !paths.has(item.path); }));
    };
    commitState({danmakuFileList: {
      xmlFiles: mergeFiles(discovered.xmlFiles, current.xmlFiles),
      jsonFiles: mergeFiles(discovered.jsonFiles, current.jsonFiles),
      selectedPaths: current.selectedPaths
    }});
  }

  let cached = getCurrentDdpCache();
  if (cached && current.selectedPaths[0] !== 'dandanplay://' + cached.episodeId) {
    ddpUpsertFileListEntry(cached.episodeId, cached.animeTitle, cached.episodeTitle, cached.document, !cached.stale);
  }

  sidebarPostMessage("danmaku-file-list", pluginState.danmakuFileList);
  sendDanmakuFilterInfo();
  notifyBrowserDataChanged();

  if (activate !== false) autoLoadDiscoveredDanmaku(url, loadGeneration);
}

function autoLoadDiscoveredDanmaku(url, loadGeneration) {
  if (!pluginState.danmakuEnabled) return;
  let cached = getCurrentDdpCache();
  if (!pluginState.dandanplayAutoNetwork && loadFirstLocalDanmaku()) return;
  if (cached && !cached.stale) {
    ddpAddToFileListAndLoad(cached.episodeId, cached.animeTitle, cached.episodeTitle, cached.document, true, true);
  } else if (pluginState.dandanplayAutoNetwork) {
    ddpAutoMatchAndLoad(url, DDP_LOAD_ORIGIN.AUTO, loadGeneration);
  } else {
    danmakuNotFound();
  }
}

// All source selections share this entry. Switch only after a successful read;
// local documents and DDP virtual entries reuse the current video's parsed cache.
function loadDanmakuFile(path, options) {
  if (!path || awaitingFileLoaded) return;
  options = options || {};
  let enableDanmaku = !!options.enableDanmaku;
  let loadedMessageKey = options.loadedMessageKey || 'loaded';
  let fileInfo = findDanmakuFileByPath(path);
  let fileName = fileInfo ? fileInfo.filename : path.split("/").pop();
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
  if (options.requireComments && doc.comments.length === 0) return false;

  // A successful user selection supersedes both matching and downloading,
  // including when the user reselects the currently active cached episode.
  if (options.userSelection) ddpResetState();

  // An active or in-flight source can be reused without resetting its date
  // slice, load acknowledgment or success notice. Explicit refreshes bypass it.
  if (!options.reload && !options.loadedMessageKey && lastOverlayProjection &&
      lastOverlayProjection.doc === doc && pluginState.danmakuFileList.selectedPaths[0] === path) {
    let wasEnabled = pluginState.danmakuEnabled;
    if (enableDanmaku) ensureDanmakuEnabled(true);
    if (overlayReady && pluginState.danmakuEnabled) {
      if (!sendCurrentDanmaku(false) && !wasEnabled) overlayPostMessage('toggle-danmaku', toggleSnapshot());
      syncPlaybackObservers();
    }
    return true;
  }

  if (enableDanmaku) ensureDanmakuEnabled(true);
  danmakuCache[path] = doc;
  let fileType = doc.sourceType.indexOf('nico-json') === 0 ? 'nico-json' : doc.sourceType;
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
  if (overlayReady) syncPlaybackObservers();
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
  overlayPausedForCache = mpv.getFlag('paused-for-cache');
  return {enabled: pluginState.danmakuEnabled, time: Number.isFinite(time) ? time : 0,
    paused: !!core.status.paused || overlayPausedForCache,
    speed: Number.isFinite(speed) && speed > 0 ? speed : 1};
}

function resetOverlayTimeUpdates() {
  overlayTimeInFlight = null;
  overlayTimePending = null;
}

function overlayNeedsTime() {
  return overlayReady && pluginState.danmakuEnabled && !awaitingFileLoaded && lastOverlayProjection !== null;
}

function browserNeedsTime() {
  return danmakuBrowserWatch && pluginState.danmakuBrowserVisible && !awaitingFileLoaded && currentVideoUrl !== null;
}

function flushOverlayTimeUpdate() {
  if (overlayTimeInFlight || !overlayTimePending) return;
  if (!overlayNeedsTime()) {
    resetOverlayTimeUpdates();
    return;
  }
  let pending = overlayTimePending;
  overlayTimePending = null;
  if (pending.sourceId !== overlayLoadId) return;
  let message = {
    time: pending.time, seek: pending.seek, sourceId: pending.sourceId,
    timeId: ++overlayTimeUpdateId
  };
  // The reply only acknowledges delivery of the anchor, not drawing or
  // compositor presentation. Keep one native evaluation in flight.
  overlayTimeInFlight = message;
  overlayPostMessage('time-update', message);
}

function queueOverlayTimeUpdate(time, seek) {
  if (!isFiniteNumber(time) || !overlayNeedsTime()) return;
  if (!overlayTimePending && overlayTimeInFlight &&
      overlayTimeInFlight.sourceId === overlayLoadId && overlayTimeInFlight.time === time && !seek) return;
  // A seek remains necessary even if ordinary progress replaces its target
  // before the busy WebView has acknowledged the previous message.
  let pendingSeek = overlayTimePending && overlayTimePending.sourceId === overlayLoadId && overlayTimePending.seek;
  overlayTimePending = {time: time, seek: !!seek || !!pendingSeek, sourceId: overlayLoadId};
  flushOverlayTimeUpdate();
}

function markOverlayReady() {
  if (overlayReady) return;
  overlayReady = true;
  updateOverlayOpacity();
  postVideoAspect();
  if (pendingDanmaku) {
    if (!sendCurrentDanmaku(true)) overlayPostMessage("toggle-danmaku", toggleSnapshot());
    pendingDanmaku = null;
  } else if (!awaitingFileLoaded && !videoHasEnded && pluginState.danmakuEnabled && !core.status.idle && !currentVideoUrl && core.status.url) {
    loadDanmakuForVideo(core.status.url);
  } else {
    overlayPostMessage("toggle-danmaku", toggleSnapshot());
  }
  syncPlaybackObservers();
}

function syncTimeObserver() {
  const needed = overlayNeedsTime() || browserNeedsTime();
  if (needed && timePosListenerID === null) {
    timePosListenerID = event.on("mpv.time-pos.changed", function (t) {
      // While paused, defer a lone seek until playback-restart provides the
      // landing frame time, avoiding a second visible correction. Repeated
      // seeks follow drag targets live and still anchor at the final restart.
      if (!(videoSeekInProgress && !videoSeekRepeated && core.status.paused)) {
        queueOverlayTimeUpdate(t, videoSeekInProgress);
      }
      if (browserNeedsTime()) pushBrowserTime(t);
    });
  } else if (!needed && timePosListenerID !== null) {
    event.off("mpv.time-pos.changed", timePosListenerID);
    timePosListenerID = null;
  }
}

function syncPlaybackObservers() {
  syncTimeObserver();
  if (!overlayNeedsTime()) {
    resetOverlayTimeUpdates();
    if (windowScaleListenerID !== null) { event.off("mpv.window-scale.changed", windowScaleListenerID); windowScaleListenerID = null; }
    if (speedListenerID !== null) { event.off("mpv.speed.changed", speedListenerID); speedListenerID = null; }
    if (cachePauseListenerID !== null) { event.off("mpv.cache-buffering-state.changed", cachePauseListenerID); cachePauseListenerID = null; }
  } else if (windowScaleListenerID === null) {
    windowScaleListenerID = event.on("mpv.window-scale.changed", function () {
      postVideoAspect();
    });
    speedListenerID = event.on("mpv.speed.changed", function (speed) {
      overlayPostMessage("playback-speed", { speed: speed });
    });
    // IINA observes plugin-added properties as doubles. Cache percentage is
    // numeric (0–99 while stopped, 100 after recovery); paused-for-cache is a
    // flag. Start from the last sent snapshot so recovery between loading and
    // observer installation still sends a resume rather than dropping it.
    cachePauseListenerID = event.on("mpv.cache-buffering-state.changed", function (percent) {
      if (awaitingFileLoaded || videoHasEnded || !currentVideoUrl ||
          !Number.isFinite(percent) || percent < 0 || percent > 100) return;
      const next = percent < 100;
      if (next === overlayPausedForCache) return;
      overlayPausedForCache = next;
      overlayPostMessage("pause-state", {paused: !!core.status.paused || next,
        time: mpv.getNumber('time-pos'), sourceId: overlayLoadId});
    });
  }
}

function setDanmakuEnabled(enabled, options) {
  let next = !!enabled;
  options = options || {};
  if (next === pluginState.danmakuEnabled) {
    if (next) { restoreOverlayAfterManualHide(); updateOverlayOpacity(); }
    else if (options.hideOverlay) hideOverlayForUser();
    return;
  }
  commitState({danmakuEnabled: next});
  if (next) {
    beginOverlayReveal();
    restoreOverlayAfterManualHide();
    updateOverlayOpacity();
    if (awaitingFileLoaded || videoDiscoveryTimer !== null) {
      if (options.osd !== false) core.osd(t('danmaku_on'));
      return;
    }
    let selectedPath = pluginState.danmakuFileList.selectedPaths[0];
    if (selectedPath && danmakuCache[selectedPath]) {
      if (!sendCurrentDanmaku(false) && overlayReady) overlayPostMessage('toggle-danmaku', toggleSnapshot());
    } else if (currentVideoUrl && loadedDanmakuVideoUrl !== currentVideoUrl) {
      autoLoadDiscoveredDanmaku(currentVideoUrl, danmakuLoadGeneration);
      if (overlayReady && loadedDanmakuVideoUrl !== currentVideoUrl) overlayPostMessage('toggle-danmaku', toggleSnapshot());
    } else {
      if (overlayReady) overlayPostMessage('toggle-danmaku', toggleSnapshot());
    }
    syncPlaybackObservers();
    if (options.osd !== false) core.osd(t('danmaku_on'));
  } else {
    cancelOverlayReveal();
    updateOverlayOpacity();
    if (overlayReady) overlayPostMessage('toggle-danmaku', playbackSnapshot());
    syncPlaybackObservers();
    if (options.hideOverlay) hideOverlayForUser();
    if (options.osd !== false) core.osd(t('danmaku_off'));
  }
}

function toggleDanmaku() {
  setDanmakuEnabled(!pluginState.danmakuEnabled);
}

// Source loads defer playback IPC because their load payload carries the full snapshot.
function ensureDanmakuEnabled(deferPlayback) {
  let wasEnabled = pluginState.danmakuEnabled;
  commitState({danmakuEnabled: true});
  if (!wasEnabled) beginOverlayReveal();
  restoreOverlayAfterManualHide();
  updateOverlayOpacity();
  if (!deferPlayback) {
    if (overlayReady) overlayPostMessage('toggle-danmaku', toggleSnapshot());
    syncPlaybackObservers();
  }
}

function chooseDanmakuFile() {
  let generation = danmakuLoadGeneration;
  iina.utils.chooseFile(t('choose_file_title'), { allowedFileTypes: ["json", "xml"] }).then(function (path) {
    if (generation !== danmakuLoadGeneration) return;
    loadDanmakuFile(path, { enableDanmaku: true, reload: true, userSelection: true });
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
  let isOpacity = function (value) { return isFiniteNumber(value) && value >= 0 && value <= 1; };
  [
    ['set-opacity', 'canvasOpacity', 'opacity', isOpacity], ['set-fontscale', 'canvasFontScale', 'scale', isPositive],
    ['set-canvas-mode', 'currentCanvasMode', 'mode', isCanvasMode], ['set-stroke-opacity', 'strokeOpacity', 'opacity', isOpacity],
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
    if (isValidCssTextShadowBlur(data.blur)) commitState({cssTextShadowBlur: data.blur});
  });

  sidebarOnMessage("set-danmaku-force-simplified", function (data) {
    if (typeof data.value !== 'boolean') return;
    commitState({danmakuForceSimplified: data.value});

    resendDanmakuToOverlay();
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
    if (!isFiniteNumber(data.offset)) return;
    applyDanmakuOffset(data.offset);
  });

  sidebarOnMessage("set-danmaku-font", function (data) {
    let family = typeof data.fontFamily === 'string' ? data.fontFamily : undefined;
    let weight = typeof data.fontWeight === 'string' || isFiniteNumber(data.fontWeight) ? String(data.fontWeight) : undefined;
    if (family === undefined && weight === undefined) return;
    applyDanmakuFont(family, weight);
  });

  sidebarOnMessage("set-style-preset", function (data) {
    if (!Object.prototype.hasOwnProperty.call(STYLE_PRESETS, data.preset)) return;
    commitState(Object.assign({}, STYLE_PRESETS[data.preset], {stylePreset: data.preset}));
  });

  sidebarOnMessage("set-danmaku-filter", function (data) {
    if (data.startDay === undefined || data.endDay === undefined) return;
    if (applyDanmakuFilter(data.startDay, data.endDay)) notifyBrowserDataChanged();
  });

  sidebarOnMessage("set-danmaku-filter-density", function (data) {
    // 0 is the explicit "unlimited" value; a missing field is not.
    if (!isFiniteNumber(data.density) || data.density < 0) return;
    applyDanmakuFilterDensity(data.density);
    notifyBrowserDataChanged();
  });

  sidebarOnMessage("danmaku-blocklist-set-enabled", function (data) {
    if (typeof data.enabled !== 'boolean') return;
    commitState({danmakuBlocklistEnabled: data.enabled});

    // An empty blocklist cannot change the projection, so skip the rebuild.
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

  // Remove by value because the list may change between rendering and clicking.
  sidebarOnMessage("danmaku-blocklist-remove", function (data) {
    var word = data.word !== undefined ? String(data.word) : null;
    var idx = word !== null ? pluginState.danmakuBlocklist.indexOf(word) : -1;
    if (idx < 0) return;
    commitState({danmakuBlocklist: pluginState.danmakuBlocklist.filter(function (_, i) { return i !== idx; })});

    notifyBrowserDataChanged();
    resendDanmakuToOverlay();
  });

  sidebarOnMessage("danmaku-position-filter-set", function (data) {
    let top = typeof data.danmakuBlockTopEnabled === 'boolean' ? data.danmakuBlockTopEnabled : pluginState.danmakuBlockTopEnabled;
    let bottom = typeof data.danmakuBlockBottomEnabled === 'boolean' ? data.danmakuBlockBottomEnabled : pluginState.danmakuBlockBottomEnabled;
    if (top !== pluginState.danmakuBlockTopEnabled || bottom !== pluginState.danmakuBlockBottomEnabled) {
      commitState({danmakuBlockTopEnabled: top, danmakuBlockBottomEnabled: bottom});

      notifyBrowserDataChanged();
      resendDanmakuToOverlay();
    }
  });

  sidebarOnMessage("danmaku-seek", function (data) {
    if (typeof data.vpos !== 'number' || !isFinite(data.vpos)) return;
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
      let wasVisible = pluginState.danmakuBrowserVisible;
      commitState({danmakuBrowserVisible: data.visible});
      syncTimeObserver();

      if (pluginState.danmakuBrowserVisible && browserDataPending) {
        browserDataPending = false;
        sendDanmakuBrowserData(buildDanmakuBrowserList());
      } else if (!wasVisible && browserNeedsTime()) {
        pushBrowserTime(mpv.getNumber('time-pos'), true);
      }
    }
  });

  sidebarOnMessage("request-state", function () {
    // Lazy sidebar initialization reads the existing session without rediscovering sources.
    sidebarPostMessage('danmaku-state', stateSnapshot());
    sidebarPostMessage("danmaku-file-list", pluginState.danmakuFileList);
    sendDanmakuFilterInfo();
    ddpSyncState();
  });

  sidebarOnMessage("select-danmaku-file", function (data) {
    if (typeof data.path === 'string' && data.path) loadDanmakuFile(data.path, { enableDanmaku: true, userSelection: true });
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
    if (!isDdpId(data.bangumiId)) return;
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
    if (awaitingFileLoaded) return;
    var match = data.match;
    if (match && isDdpId(match.episodeId)) {
      commitDdpState({matchType: 'filename'});
      ddpLoadComments(match.episodeId, match.animeTitle, match.episodeTitle, true, DDP_LOAD_ORIGIN.MANUAL);
    }
  });

  sidebarOnMessage("dandanplay-select-episode", function (data) {
    if (awaitingFileLoaded) return;
    if (!isDdpId(data.episodeId)) return;
    commitDdpState({matchType: 'filename'});
    ddpLoadComments(data.episodeId, data.animeTitle, data.episodeTitle, true, DDP_LOAD_ORIGIN.MANUAL);
  });

  sidebarOnMessage("dandanplay-trigger-match", function () {
    if (currentVideoUrl) {
      ddpAutoMatchAndLoad(currentVideoUrl, DDP_LOAD_ORIGIN.MANUAL);
    }
  });

  sidebarOnMessage("danmaku-browser-request", function () {
    if (pluginState.danmakuBrowserVisible) {
      sendDanmakuBrowserData(buildDanmakuBrowserList());
    } else {
      browserDataPending = true;
    }
  });

  sidebarOnMessage("danmaku-browser-watch", function (data) {
    if (typeof data.watch !== 'boolean') return;
    danmakuBrowserWatch = data.watch;
    syncTimeObserver();
    if (browserNeedsTime()) {
      var t = mpv.getNumber("time-pos");
      // Bypass throttling to seed the anchor; paused video may send no further time updates.
      if (t !== undefined && t !== null) pushBrowserTime(t, true);
    }
  });
}

event.on("iina.window-loaded", function () {
  overlayReady = false;
  danmakuBrowserWatch = false;
  overlayLoadId += 1;
  overlayAwaitingVideoRender = true;
  cancelOverlayReveal();
  overlay.setOpacity(0);
  updateDanmakuStatus({fileType: pluginState.currentDanmakuStatus.fileType, isLoaded: false});
  lastOverlayProjection = null;
  syncPlaybackObservers();
  if (pluginState.danmakuFileList.selectedPaths.length) pendingDanmaku = {};
  overlay.loadFile("overlay/index.html");
  sidebar.loadFile("sidebar/index.html");
  registerSidebarHandlers();
});

event.on("iina.plugin-overlay-loaded", function () {
  resetOverlayTimeUpdates();
  // Keep the WebView active while transparent so its render-success frames
  // can run. Explicit user hiding is restored before the next enabled load.
  overlay.setOpacity(0);
  overlay.show();
  overlayHiddenByUser = false;
  registerOverlayHandlers();
  overlayPostMessage("request-overlay-state", {});
});

event.on('mpv.end-file', function () {
  // Hide and invalidate the ended video before mpv starts opening the next.
  // Do not await file-loaded here: playback may simply have stopped.
  videoHasEnded = true;
  beginVideoReset(true);
});

event.on('iina.file-started', function () {
  // Reuse the end-file clear only while no source has been sent since it.
  // Still reset generations to invalidate operations begun in the gap.
  let alreadyCleared = videoHasEnded && currentVideoUrl === null &&
    overlayAwaitingVideoRender && lastOverlayProjection === null;
  awaitingFileLoaded = true;
  beginVideoReset(true, alreadyCleared);
});

event.on("iina.file-loaded", function (url) {
  loadDanmakuForVideo(url);
});

event.on('mpv.idle-active.changed', function (idle) {
  if (idle && awaitingFileLoaded && core.status.idle) awaitingFileLoaded = false;
});

// IINA observes properties as doubles, so the seeking flag cannot report true.
// Native seek/playback-restart events bracket target and landing times reliably.
event.on("mpv.seek", function () {
  if (videoSeekInProgress) videoSeekRepeated = true;
  videoSeekInProgress = true;
});

event.on("mpv.playback-restart", function () {
  if (!videoSeekInProgress) return;
  videoSeekInProgress = false;
  videoSeekRepeated = false;
  queueOverlayTimeUpdate(mpv.getNumber('time-pos'), true);
});

event.on("mpv.pause.changed", function () {
  if (!overlayNeedsTime()) return;
  const pausedForCache = mpv.getFlag('paused-for-cache');
  const data = {paused: !!core.status.paused || pausedForCache, sourceId: overlayLoadId};
  if (pausedForCache !== overlayPausedForCache) {
    overlayPausedForCache = pausedForCache;
    data.time = mpv.getNumber('time-pos');
  }
  overlayPostMessage("pause-state", data);
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
  overlayOnMessage("overlay-ready", function () {
    markOverlayReady();
  });

  overlayOnMessage('time-update-ack', function (data) {
    if (!Number.isSafeInteger(data.timeId) || !Number.isSafeInteger(data.sourceId) ||
        !overlayTimeInFlight || data.sourceId !== overlayLoadId ||
        data.timeId !== overlayTimeInFlight.timeId || data.sourceId !== overlayTimeInFlight.sourceId) return;
    overlayTimeInFlight = null;
    flushOverlayTimeUpdate();
  });

  overlayOnMessage("danmaku-load-result", function (data) {
    if (data.loadId !== overlayLoadId) return;
    if (!data.success) {
      let path = pluginState.danmakuFileList.selectedPaths[0];
      // A failed candidate remains in the list for an explicit retry, but is
      // no longer an active selection. Invalidate later replies from this load.
      overlayLoadId += 1;
      overlayAwaitingVideoRender = true;
      cancelOverlayReveal();
      overlay.setOpacity(0);
      lastOverlayProjection = null;
      syncPlaybackObservers();
      projectionCache = null;
      loadedDanmakuVideoUrl = null;
      pendingLoadNotice = null;
      pendingDanmaku = null;
      resetNicoJsonFilterState({
        currentDanmakuStatus: {fileType: null, isLoaded: false},
        danmakuFileList: Object.assign({}, pluginState.danmakuFileList, {selectedPaths: []})
      });
      overlayPostMessage('clear-danmaku', {clearId: overlayLoadId});
      sidebarPostMessage('danmaku-file-list', pluginState.danmakuFileList);
      sidebarPostMessage("danmaku-file-error", { path: path, message: t('render_failed') });
      sendDanmakuFilterInfo();
      notifyBrowserDataChanged();
      core.osd(t('render_failed'));
    } else {
      updateDanmakuStatus({ fileType: pluginState.currentDanmakuStatus.fileType, isLoaded: true });
      overlayAwaitingVideoRender = false;
      // The load acknowledgment already waited for frames drawn at this time.
      cancelOverlayReveal();
      updateOverlayOpacity();
      if (pendingLoadNotice && pendingLoadNotice.path === pluginState.danmakuFileList.selectedPaths[0]) {
        osdAfterDanmakuLoad(pendingLoadNotice.fileName, pendingLoadNotice.loadedMessageKey);
        pendingLoadNotice = null;
      }
    }
  });

  overlayOnMessage("danmaku-reveal-ready", function (data) {
    if (Number.isSafeInteger(data.revealId)) finishOverlayReveal(data.revealId);
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
