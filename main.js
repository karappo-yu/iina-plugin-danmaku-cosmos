var pluginState = {};
let danmakuDocument = require('./danmaku-document.js');
// IINA resolves require against the executing script stack. Load the package
// module here; callbacks only construct/use its converter, never call require.
let openccLibrary = require('./overlay/lib/opencc.min.js') || globalThis.OpenCC;
let parseDanmakuSource = danmakuDocument.parseDanmakuSource;
let projectDanmaku = danmakuDocument.projectDanmaku;

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
rebuildBlockRegexes();
// 弹幕去重: 开关 + 区间(秒,1-5)。窗口内重复文本合并为 "原文xN",时间取组内最早。
pluginState.danmakuDedupeEnabled = !!preferences.get("danmakuDedupeEnabled");
pluginState.danmakuDedupeWindow = parseFloat(preferences.get("danmakuDedupeWindow"));
if (!isFinite(pluginState.danmakuDedupeWindow) || pluginState.danmakuDedupeWindow < 1 || pluginState.danmakuDedupeWindow > 5) pluginState.danmakuDedupeWindow = 2;
pluginState.canvasOpacity = preferences.get("danmakuCanvasOpacity") !== undefined ? preferences.get("danmakuCanvasOpacity") : 0.8;
pluginState.canvasFontScale = preferences.get("niconicommentsFontScale") || 1.0;
pluginState.currentCanvasMode = preferences.get("canvasMode") || 'css';
pluginState.strokeOpacity = preferences.get("strokeOpacity") !== undefined ? preferences.get("strokeOpacity") : 0.4;
pluginState.strokeWidth = preferences.get("strokeWidth") !== undefined ? preferences.get("strokeWidth") : 2.8;
pluginState.strokeColor = preferences.get("strokeColor") || '#000000';
pluginState.strokeInversionColor = preferences.get("strokeInversionColor") || '#ffffff';
pluginState.commentLimit = preferences.get("commentLimit") !== undefined ? preferences.get("commentLimit") : 0;
pluginState.scrollSpeed = preferences.get("scrollSpeed") !== undefined ? preferences.get("scrollSpeed") : 1.0;
pluginState.danmakuTimeOffsetSec = 0; // 弹幕偏移不做持久化: 偏移量因视频/弹幕文件而异,每个会话从 0 开始
pluginState.danmakuFontFamily = preferences.get("danmakuFontFamily") || "";
pluginState.danmakuFontWeight = preferences.get("danmakuFontWeight") || "400";
pluginState.stylePreset = preferences.get("stylePreset") || "nico";
var overlayReady = false;
let overlayLoadId = 0;
var preferencesSyncTimer = null;

var DDP_APP_ID = preferences.get("dandanplayAppId") || 't43832ky57';
var DDP_APP_SECRET = preferences.get("dandanplayAppSecret") || 'IDnPEdEKDIziKeYVxm6VcaJE4Bv2fnzT';
var DDP_API_BASE = 'https://api.dandanplay.net';
var DDP_LOAD_ORIGIN = { AUTO: 'auto', MANUAL: 'manual' };

pluginState.dandanplayAutoNetwork = preferences.get("dandanplayAutoNetwork") !== false;

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

// i18n for OSD / menu / file dialog strings (sidebar UI strings live in sidebar/index.js)
var PLUGIN_I18N = {
  en: {
    render_failed: "Cannot render this danmaku file",
    ddp_auth_error: "DanDanPlay: authentication failed (403)",
    ddp_no_results: "No results found",
    menu_toggle: "Toggle Danmaku",
    menu_load_file: "Load Danmaku File…",
    menu_show_overlay: "Show Danmaku Overlay",
    menu_hide_overlay: "Hide Danmaku Overlay",
    choose_file_title: "Select Danmaku File",
    danmaku_on: "Danmaku enabled",
    danmaku_off: "Danmaku disabled",
    loaded: "Danmaku loaded: ",
    network_loaded: "Network danmaku loaded: ",
    queued: "Danmaku queued…",
    read_failed: "Cannot read danmaku file",
    read_failed_name: "Cannot read danmaku file: ",
    content_unavailable: "Danmaku content unavailable",
    seek_disable: "Danmaku: seek disabled",
    seek_enable: "Danmaku: seek enabled",
    jump: "Danmaku jump: ",
    network_skip_local: "Network resource — skipping local danmaku",
    ddp_no_match: "DanDanPlay: no match found",
    ddp_network_error: "DanDanPlay: network error",
    ddp_api_error: "DanDanPlay: API response error",
    ddp_no_comments: "DanDanPlay: no danmaku for this video",
    ddp_load_failed: "DanDanPlay: failed to load danmaku",
    cache_stale: " (old)",
    duration_mismatch: "Duration mismatch with danmaku file: offset set to {offset}s",
    duration_mismatch_no_offset: "Duration mismatch with danmaku file"
  },
  ja: {
    render_failed: "\u3053\u306e\u30b3\u30e1\u30f3\u30c8\u30d5\u30a1\u30a4\u30eb\u3092\u63cf\u753b\u3067\u304d\u307e\u305b\u3093",
    ddp_auth_error: "\u5f3e\u5f3ePlay: \u8a8d\u8a3c\u306b\u5931\u6557\u3057\u307e\u3057\u305f (403)",
    ddp_no_results: "\u691c\u7d22\u7d50\u679c\u304c\u3042\u308a\u307e\u305b\u3093",
    menu_toggle: "\u30b3\u30e1\u30f3\u30c8\u8868\u793a\u3092\u5207\u308a\u66ff\u3048",
    menu_load_file: "\u30b3\u30e1\u30f3\u30c8\u30d5\u30a1\u30a4\u30eb\u3092\u8aad\u307f\u8fbc\u3080\u2026",
    menu_show_overlay: "\u30b3\u30e1\u30f3\u30c8\u30aa\u30fc\u30d0\u30fc\u30ec\u30a4\u3092\u8868\u793a",
    menu_hide_overlay: "\u30b3\u30e1\u30f3\u30c8\u30aa\u30fc\u30d0\u30fc\u30ec\u30a4\u3092\u96a0\u3059",
    choose_file_title: "\u30b3\u30e1\u30f3\u30c8\u30d5\u30a1\u30a4\u30eb\u3092\u9078\u629e",
    danmaku_on: "\u30b3\u30e1\u30f3\u30c8\u30aa\u30f3",
    danmaku_off: "\u30b3\u30e1\u30f3\u30c8\u30aa\u30d5",
    loaded: "\u30b3\u30e1\u30f3\u30c8\u8aad\u307f\u8fbc\u307f\u5b8c\u4e86: ",
    network_loaded: "\u30cd\u30c3\u30c8\u30ef\u30fc\u30af\u30b3\u30e1\u30f3\u30c8\u3092\u8aad\u307f\u8fbc\u307f\u307e\u3057\u305f: ",
    queued: "\u30b3\u30e1\u30f3\u30c8\u3092\u6e96\u5099\u4e2d\u2026",
    read_failed: "\u30b3\u30e1\u30f3\u30c8\u30d5\u30a1\u30a4\u30eb\u3092\u8aad\u307f\u8fbc\u3081\u307e\u305b\u3093",
    read_failed_name: "\u30b3\u30e1\u30f3\u30c8\u30d5\u30a1\u30a4\u30eb\u3092\u8aad\u307f\u8fbc\u3081\u307e\u305b\u3093: ",
    content_unavailable: "\u30b3\u30e1\u30f3\u30c8\u5185\u5bb9\u3092\u5229\u7528\u3067\u304d\u307e\u305b\u3093",
    seek_disable: "\u30b3\u30e1\u30f3\u30c8: \u30b7\u30fc\u30af\u7981\u6b62",
    seek_enable: "\u30b3\u30e1\u30f3\u30c8: \u30b7\u30fc\u30af\u8a31\u53ef",
    jump: "\u30b3\u30e1\u30f3\u30c8\u30b8\u30e3\u30f3\u30d7: ",
    network_skip_local: "\u30cd\u30c3\u30c8\u30ef\u30fc\u30af\u30ea\u30bd\u30fc\u30b9\u306e\u305f\u3081\u30ed\u30fc\u30ab\u30eb\u30b3\u30e1\u30f3\u30c8\u3092\u30b9\u30ad\u30c3\u30d7",
    ddp_no_match: "\u5f3e\u5f3ePlay: \u4e00\u81f4\u3059\u308b\u7d50\u679c\u304c\u3042\u308a\u307e\u305b\u3093",
    ddp_network_error: "\u5f3e\u5f3ePlay: \u30cd\u30c3\u30c8\u30ef\u30fc\u30af\u30a8\u30e9\u30fc",
    ddp_api_error: "\u5f3e\u5f3ePlay: API\u5fdc\u7b54\u30a8\u30e9\u30fc",
    ddp_no_comments: "\u5f3e\u5f3ePlay: \u3053\u306e\u52d5\u753b\u306b\u30b3\u30e1\u30f3\u30c8\u304c\u3042\u308a\u307e\u305b\u3093",
    ddp_load_failed: "\u5f3e\u5f3ePlay: \u30b3\u30e1\u30f3\u30c8\u306e\u8aad\u307f\u8fbc\u307f\u306b\u5931\u6557\u3057\u307e\u3057\u305f",
    cache_stale: " (\u65e7)",
    duration_mismatch: "\u52d5\u753b\u306e\u9577\u3055\u304c\u30b3\u30e1\u30f3\u30c8\u30d5\u30a1\u30a4\u30eb\u3068\u4e00\u81f4\u3057\u307e\u305b\u3093: \u30aa\u30d5\u30bb\u30c3\u30c8\u3092 {offset}s \u306b\u81ea\u52d5\u8abf\u6574",
    duration_mismatch_no_offset: "\u52d5\u753b\u306e\u9577\u3055\u304c\u30b3\u30e1\u30f3\u30c8\u30d5\u30a1\u30a4\u30eb\u3068\u4e00\u81f4\u3057\u307e\u305b\u3093"
  },
  zh: {
    render_failed: "\u65e0\u6cd5\u6e32\u67d3\u6b64\u5f39\u5e55\u6587\u4ef6",
    ddp_auth_error: "\u5f39\u5f39play: \u8eab\u4efd\u9a8c\u8bc1\u5931\u8d25 (403)",
    ddp_no_results: "\u672a\u627e\u5230\u641c\u7d22\u7ed3\u679c",
    menu_toggle: "\u5207\u6362\u5f39\u5e55\u663e\u793a",
    menu_load_file: "\u624b\u52a8\u52a0\u8f7d\u5f39\u5e55\u6587\u4ef6\u2026",
    menu_show_overlay: "\u663e\u793a\u5f39\u5e55\u8986\u76d6\u5c42",
    menu_hide_overlay: "\u9690\u85cf\u5f39\u5e55\u8986\u76d6\u5c42",
    choose_file_title: "\u9009\u62e9\u5f39\u5e55\u6587\u4ef6",
    danmaku_on: "\u5f39\u5e55\u5df2\u5f00\u542f",
    danmaku_off: "\u5f39\u5e55\u5df2\u5173\u95ed",
    loaded: "\u5df2\u52a0\u8f7d\u5f39\u5e55: ",
    network_loaded: "\u5df2\u52a0\u8f7d\u7f51\u7edc\u5f39\u5e55: ",
    queued: "\u5f39\u5e55\u6392\u961f\u4e2d\u2026",
    read_failed: "\u65e0\u6cd5\u8bfb\u53d6\u5f39\u5e55\u6587\u4ef6",
    read_failed_name: "\u65e0\u6cd5\u8bfb\u53d6\u5f39\u5e55\u6587\u4ef6: ",
    content_unavailable: "\u5f39\u5e55\u5185\u5bb9\u4e0d\u53ef\u7528",
    seek_disable: "\u5f39\u5e55\uff1a\u7981\u6b62\u8df3\u8f6c",
    seek_enable: "\u5f39\u5e55\uff1a\u5141\u8bb8\u8df3\u8f6c",
    jump: "\u5f39\u5e55\u8df3\u8f6c: ",
    network_skip_local: "\u7f51\u7edc\u8d44\u6e90\uff0c\u8df3\u8fc7\u672c\u5730\u5f39\u5e55\u52a0\u8f7d",
    ddp_no_match: "\u5f39\u5f39play: \u672a\u627e\u5230\u5339\u914d",
    ddp_network_error: "\u5f39\u5f39play: \u7f51\u7edc\u9519\u8bef",
    ddp_api_error: "\u5f39\u5f39play: API\u54cd\u5e94\u9519\u8bef",
    ddp_no_comments: "\u5f39\u5f39play: \u8be5\u89c6\u9891\u65e0\u5f39\u5e55",
    ddp_load_failed: "\u5f39\u5f39play: \u52a0\u8f7d\u5f39\u5e55\u5931\u8d25",
    cache_stale: " (\u65e7)",
    duration_mismatch: "\u89c6\u9891\u65f6\u957f\u4e0e\u5f39\u5e55\u6587\u4ef6\u4e0d\u4e00\u81f4: \u5df2\u81ea\u52a8\u8bbe\u7f6e\u504f\u79fb {offset} \u79d2",
    duration_mismatch_no_offset: "\u89c6\u9891\u65f6\u957f\u4e0e\u5f39\u5e55\u6587\u4ef6\u4e0d\u4e00\u81f4"
  }
};

function getPluginLang() {
  try {
    var locs = iina.utils.preferredLocalizations();
    if (locs && locs.length) {
      var l = String(locs[0]).toLowerCase();
      if (l.indexOf('ja') === 0) return 'ja';
      if (l.indexOf('zh') === 0) return 'zh';
      return 'en';
    }
  } catch (e) {}
  // Fallback for IINA versions without preferredLocalizations().
  return 'zh';
}

var pluginLang = getPluginLang();

function t(key, vars) {
  var s = (PLUGIN_I18N[pluginLang] && PLUGIN_I18N[pluginLang][key]) || PLUGIN_I18N.en[key] || key;
  if (vars) {
    for (var k in vars) {
      if (vars.hasOwnProperty(k)) s = s.replace('{' + k + '}', String(vars[k]));
    }
  }
  return s;
}

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
var openccSimplifier = null;     // 简繁转换器(hk→cn,懒加载;仅强制简体开启时构建)

// Preference names are an I/O mapping, not a second copy of state.
const statePreferenceKeys = {
  danmakuEnabled: 'danmakuEnabled', canvasOpacity: 'danmakuCanvasOpacity',
  canvasFontScale: 'niconicommentsFontScale', currentCanvasMode: 'canvasMode',
};
const persistentStateKeys = [
  'danmakuForceSimplified', 'danmakuAutoOffset', 'danmakuBlocklist', 'danmakuBlocklistEnabled',
  'danmakuBlockTopEnabled', 'danmakuBlockBottomEnabled', 'danmakuDedupeEnabled', 'danmakuDedupeWindow',
  'strokeOpacity', 'strokeWidth', 'strokeColor', 'strokeInversionColor', 'commentLimit', 'scrollSpeed',
  'danmakuFontFamily', 'danmakuFontWeight', 'stylePreset', 'dandanplayAutoNetwork',
  'danmakuFilterDensity', 'danmakuBrowserVisible'
];
persistentStateKeys.forEach(function (key) { statePreferenceKeys[key] = key; });

function stateSnapshot() {
  return Object.assign({}, pluginState, {
    enabled: pluginState.danmakuEnabled, canvasMode: pluginState.currentCanvasMode,
    danmakuFileType: pluginState.currentDanmakuStatus.fileType,
    danmakuLoaded: pluginState.currentDanmakuStatus.isLoaded,
    blocklist: {enabled: pluginState.danmakuBlocklistEnabled, words: pluginState.danmakuBlocklist.slice()},
    dedupe: {enabled: pluginState.danmakuDedupeEnabled, window: pluginState.danmakuDedupeWindow},
  });
}

// Presets are one state transaction, including their motion/layout settings.
const STYLE_PRESETS = {
  nico: {canvasFontScale: 1, danmakuFontWeight: '400', strokeWidth: 2.8, scrollSpeed: 1},
  balanced: {canvasFontScale: 0.5, danmakuFontWeight: '400', strokeWidth: 3, scrollSpeed: 0.5},
  bilibili: {canvasFontScale: 0.35, danmakuFontWeight: '200', strokeWidth: 2.5, scrollSpeed: 0.4},
};
const stylePresetFields = ['canvasFontScale', 'danmakuFontFamily', 'danmakuFontWeight', 'strokeWidth', 'scrollSpeed'];

const overlayStateBindings = {
  canvasOpacity: ['set-opacity', 'opacity'], canvasFontScale: ['set-fontscale', 'scale'],
  currentCanvasMode: ['set-canvas-mode', 'mode'], strokeOpacity: ['set-stroke-opacity', 'opacity'],
  strokeWidth: ['set-stroke-width', 'width'], strokeColor: ['set-stroke-color', 'color'],
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
  if ('danmakuBlocklist' in changed || 'danmakuBlocklistEnabled' in changed) changed.blocklist = {
    enabled: pluginState.danmakuBlocklistEnabled, words: pluginState.danmakuBlocklist.slice()
  };
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

function sidebarOnMessage(name, callback) {
  sidebarMessageHandlers[name] = callback;
  sidebar.onMessage(name, callback);
}

function overlayOnMessage(name, callback) {
  overlayMessageHandlers[name] = callback;
  overlay.onMessage(name, callback);
}

function escapeLoneSurrogates(text) {
  return text.replace(/[\uD800-\uDFFF]/g, function (unit, index) {
    let code = unit.charCodeAt(0);
    let paired = code <= 0xDBFF
      ? text.charCodeAt(index + 1) >= 0xDC00 && text.charCodeAt(index + 1) <= 0xDFFF
      : text.charCodeAt(index - 1) >= 0xD800 && text.charCodeAt(index - 1) <= 0xDBFF;
    return paired ? unit : '\\u' + code.toString(16);
  });
}

function needsIPCEnvelope(value) {
  if (typeof value === 'string') {
    return /[`\u2018-\u201D]|\$\{/.test(value) || escapeLoneSurrogates(value) !== value;
  }
  if (!value || typeof value !== 'object') return false;
  return Object.keys(value).some(function (key) {
    return needsIPCEnvelope(key) || needsIPCEnvelope(value[key]);
  });
}

function postSafeMessage(target, key, data) {
  let payload = data === undefined ? {} : data;
  if (needsIPCEnvelope(payload)) {
    // Older JavaScriptCore versions may stringify lone surrogates literally.
    // JSON Unicode escapes preserve the original code units and are URI-safe.
    let json = escapeLoneSurrogates(JSON.stringify(payload));
    payload = { __encoded: encodeURIComponent(json) };
  }
  target.postMessage(key, payload);
}

function sidebarPostMessage(key, data) {
  postSafeMessage(sidebar, key, data);
}

function overlayPostMessage(key, data) {
  postSafeMessage(overlay, key, data);
}

function applyDanmakuOffset(offsetSec) {
  var nextOffset = parseFloat(offsetSec);
  if (!isFinite(nextOffset)) return;
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

function filePathFromUrl(url) {
  if (!url) return null;
  if (url.startsWith("file://")) {
    try { return decodeURIComponent(url.substring(7)); } catch (e) { return url.substring(7); }
  }
  return null;
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
    applyDanmakuOffset(offset);
    core.osd(t('duration_mismatch', { offset: formatSecondsShort(offset) }));
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
      var offset = Math.round(-pluginState.nicoJsonDurationDiff * 10) / 10;
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
    commentLimit: pluginState.commentLimit,
    scrollSpeed: pluginState.scrollSpeed,
    danmakuTimeOffsetSec: pluginState.danmakuTimeOffsetSec,
    danmakuFontFamily: pluginState.danmakuFontFamily,
    danmakuFontWeight: pluginState.danmakuFontWeight,
    fixedCombo: false,
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
function ensureBrowserSimplifier() {
  if (openccSimplifier) return true;
  if (!pluginState.danmakuForceSimplified) return false;
  try {
    openccSimplifier = openccLibrary.Converter({ from: 'hk', to: 'cn' });
    return true;
  } catch (error) {
    console.log('[OpenCC] initialization failed: ' + error);
    return false;
  }
}

// ── 屏蔽词过滤(正则支持) ─────────────────────────────────────────────
// 每个词优先按正则编译;非法正则退化为转义后的普通文本匹配。

function rebuildBlockRegexes() {
  blockRegexes = [];
  for (var i = 0; i < pluginState.danmakuBlocklist.length; i++) {
    var w = pluginState.danmakuBlocklist[i];
    if (!w) continue;
    var re;
    try {
      re = new RegExp(w, 'i');
    } catch (e) {
      try {
        re = new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      } catch (e2) {
        continue;
      }
    }
    blockRegexes.push(re);
  }
}

function isBlockedText(text) {
  if (!text || blockRegexes.length === 0) return false;
  for (var i = 0; i < blockRegexes.length; i++) {
    if (blockRegexes[i].test(text)) return true;
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
  let settings = {
    startDay: pluginState.danmakuFilterStartDay, endDay: pluginState.danmakuFilterEndDay,
    density: pluginState.danmakuFilterDensity, forceSimplified: pluginState.danmakuForceSimplified,
    simplify: pluginState.danmakuForceSimplified && ensureBrowserSimplifier() ? openccSimplifier : null,
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
  if (!force && lastOverlayProjection && lastOverlayProjection.doc === doc &&
      sameFormattedComments(lastOverlayProjection.comments, comments)) return false;
  lastOverlayProjection = {doc: doc, comments: comments};
  updateDanmakuStatus({fileType: pluginState.currentDanmakuStatus.fileType, isLoaded: false});
  overlayPostMessage('load-danmaku', buildLoadDanmakuPayload(comments, pluginState.currentDanmakuStatus.fileType));
  loadedDanmakuVideoUrl = currentVideoUrl;
  return true;
}

function resendDanmakuToOverlay() {
  return sendCurrentDanmaku(false);
}

function extractNumberFromName(name) {
  var match;
  match = name.match(/\[(\d{1,3})\](?!.*\[)/);
  if (match) return parseInt(match[1], 10);
  match = name.match(/\[\d{1,3}\]/g);
  if (match) {
    match = match[match.length - 1].match(/\[(\d{1,3})\]/);
    if (match) return parseInt(match[1], 10);
  }
  match = name.match(/S\d{1,2}E(\d{1,3})/i);
  if (match) return parseInt(match[1], 10);
  match = name.match(/(?:EP|Vol\.?)\s*(\d{1,3})/i);
  if (match) return parseInt(match[1], 10);
  match = name.match(/(?:^|[_\-.\s])(\d{1,3})(?:_|\-|\.|\s|$)/);
  if (match) return parseInt(match[1], 10);
  match = name.match(/(?:^|[\[\]_\-.\s])(1?\d)(?:_|\.|\s|$)/i);
  if (match) return parseInt(match[1], 10);
  match = name.match(/(?:第|話|话|Episode|Ep\.?)\s*(\d{1,3})/i);
  if (match) return parseInt(match[1], 10);
  return null;
}

function extractEpisodeNumber(videoPath) {
  var filename = videoPath.replace(/.*[/\\]/, '').replace(/\.[^.]+$/, '');
  return extractNumberFromName(filename);
}

function extractDanmakuNumber(filename) {
  return extractNumberFromName(filename.replace(/\.[^.]+$/, ''));
}

function findDanmakuByEpisode(videoUrl) {
  var path = filePathFromUrl(videoUrl);
  if (!path) return { xmlFiles: [], jsonFiles: [] };

  var videoDir = path.replace(/[/\\][^/\\]+$/, '');
  var videoEpNum = extractEpisodeNumber(path);
  var videoBaseName = path.replace(/.*[/\\]/, '').replace(/\.[^.]+$/, '').normalize('NFC');

  var searchDirs = [videoDir];
  var altDirNames = ['弹幕', 'Comments', 'コメント'];
  for (var i = 0; i < altDirNames.length; i++) {
    var altDir = videoDir + '/' + altDirNames[i];
    if (file.exists(altDir)) searchDirs.push(altDir);
  }

  var exactXmlFiles = [];
  var exactJsonFiles = [];
  var prefixXmlFiles = [];
  var prefixJsonFiles = [];
  var epNumXmlFiles = [];
  var epNumJsonFiles = [];
  var seenPaths = {};

  for (var d = 0; d < searchDirs.length; d++) {
    var dir = searchDirs[d];
    var items;
    try { items = file.list(dir, { includeSubDir: false }); } catch (e) { continue; }
    if (!items) continue;

    for (var j = 0; j < items.length; j++) {
      var item = items[j];
      if (item.isDir) continue;
      var fname = item.filename;
      if (fname.charAt(0) === '.') continue;
      var ext = fname.lastIndexOf('.') >= 0 ? fname.substring(fname.lastIndexOf('.') + 1).toLowerCase() : '';
      if (ext !== 'json' && ext !== 'xml') continue;

      var filePath = dir + '/' + fname;
      if (seenPaths[filePath]) continue;
      seenPaths[filePath] = true;

      var relativePath = filePath;
      if (filePath.startsWith(videoDir + "/")) relativePath = filePath.substring(videoDir.length + 1);

      var fileEpNum = extractDanmakuNumber(fname);
      var fileBaseName = fname.replace(/\.[^.]+$/, '');
      var normalizedBaseName = fileBaseName.normalize('NFC');
      var isExactMatch = normalizedBaseName === videoBaseName;
      var isPrefixMatch = !isExactMatch && normalizedBaseName.startsWith(videoBaseName);
      if (/\d$/.test(videoBaseName) && /^\d/.test(normalizedBaseName.slice(videoBaseName.length))) isPrefixMatch = false;
      var fileInfo = {
        filename: fname,
        path: filePath,
        relativePath: relativePath,
        type: ext.toUpperCase(),
        _matchRank: (isExactMatch ? 0 : isPrefixMatch ? 4 : 8) + (d === 0 ? 0 : 2) + (ext === 'json' ? 0 : 1)
      };

      if (isExactMatch) {
        if (ext === 'xml') exactXmlFiles.push(fileInfo); else exactJsonFiles.push(fileInfo);
      } else if (isPrefixMatch) {
        if (ext === 'xml') prefixXmlFiles.push(fileInfo); else prefixJsonFiles.push(fileInfo);
      } else if (videoEpNum !== null && fileEpNum !== null && fileEpNum === videoEpNum) {
        if (ext === 'xml') epNumXmlFiles.push(fileInfo); else epNumJsonFiles.push(fileInfo);
      }
    }
  }

  var xmlFiles = exactXmlFiles.concat(prefixXmlFiles).concat(epNumXmlFiles);
  var jsonFiles = exactJsonFiles.concat(prefixJsonFiles).concat(epNumJsonFiles);
  return { xmlFiles: xmlFiles, jsonFiles: jsonFiles };
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

function ddpRequest(method, path, queryParams, body) {
  var url = DDP_API_BASE + path;
  var options = {
    headers: {
      'X-AppId': DDP_APP_ID,
      'X-AppSecret': DDP_APP_SECRET,
      'Accept': 'application/json',
      'User-Agent': 'DanmakuCosmos/IINA'
    }
  };
  if (queryParams && typeof queryParams === 'object') {
    var strParams = {};
    for (var key in queryParams) {
      if (queryParams.hasOwnProperty(key)) {
        strParams[key] = String(queryParams[key]);
      }
    }
    options.params = strParams;
  }
  if (body) {
    options.data = body;
    options.headers['Content-Type'] = 'application/json';
  }
  if (method === 'GET') return iina.http.get(url, options);
  return iina.http.post(url, options);
}

function ddpParseBody(res) {
  if (!res) return null;
  var text = res.text;
  if (typeof text === 'string' && text.length > 0) {
    try { return JSON.parse(text); } catch (e) {}
  }
  if (res.data !== undefined && res.data !== null && typeof res.data === 'object') {
    return res.data;
  }
  if (typeof res.data === 'string' && res.data.length > 0) {
    try { return JSON.parse(res.data); } catch (e) {}
  }
  return null;
}

// Compute MD5 of the first 16MB + file size for DDP hash matching.
// Runs as an async /bin/sh subprocess so it never blocks video opening (JS thread stays free).
// Uses only macOS base-system tools (dd, /sbin/md5, stat) — no python3/Xcode CLT dependency,
// so hash matching works on any Mac out of the box.
// Any failure (unreadable file, missing tools) yields null -> caller silently falls back
// to fileNameOnly matching. The file path is passed as a positional arg ($1) so filenames
// with quotes/spaces/brackets need no escaping.
function ddpCalcFileHash(filePath) {
  if (!filePath) return Promise.resolve(null);
  var script = 'set -e\n'
    + 'set -o pipefail\n'
    + 'f="$1"\n'
    + 'test -r "$f"\n'
    + 'h=$(dd if="$f" bs=1m count=16 2>/dev/null | /sbin/md5 -q)\n'
    + 'sz=$(stat -f %z "$f")\n'
    + 'printf "%s %s\\n" "$h" "$sz"';
  try {
    return iina.utils.exec('/bin/sh', ['-c', script, 'ddp-hash', filePath]).then(function(result) {
      if (!result || result.status !== 0 || !result.stdout) return null;
      var parts = result.stdout.trim().split(/\s+/);
      if (parts.length >= 2 && /^[0-9a-f]{32}$/.test(parts[0])) {
        return { hash: parts[0], fileSize: parseInt(parts[1], 10) || 0 };
      }
      return null;
    }).catch(function(err) {
      return null;
    });
  } catch(e) {
    return Promise.resolve(null);
  }
}

function ddpMatchVideo(fileName, filePath) {
  var nameWithoutExt = fileName.replace(/\.[^.]+$/, '');
  return ddpCalcFileHash(filePath).then(function(hashInfo) {
    if (hashInfo) {
      return ddpRequest('POST', '/api/v2/match', null, {
        fileName: nameWithoutExt,
        fileHash: hashInfo.hash,
        fileSize: hashInfo.fileSize,
        videoDuration: 0,
        matchMode: 'hashAndFileName'
      });
    }
    return ddpRequest('POST', '/api/v2/match', null, {
      fileName: nameWithoutExt,
      fileHash: '00000000000000000000000000000000',
      fileSize: 0,
      videoDuration: 0,
      matchMode: 'fileNameOnly'
    });
  });
}

function ddpSearchAnime(keyword) {
  return ddpRequest('GET', '/api/v2/search/anime', { keyword: keyword });
}

function ddpGetComments(episodeId) {
  return ddpRequest('GET', '/api/v2/comment/' + episodeId, {
    withRelated: 'true',
    chConvert: '0' // OpenCC is the sole conversion policy.
  });
}

function ddpGetBangumi(bangumiId) {
  return ddpRequest('GET', '/api/v2/bangumi/' + bangumiId);
}

function ddpErrStr(err) {
  if (!err) return 'Unknown error';
  if (typeof err === 'string') return err;
  if (err.message) return err.message;
  try { return JSON.stringify(err); } catch (e) { return String(err); }
}

function ddpConvertComments(comments) {
  return parseDanmakuSource(comments, '', 'dandanplay');
}

let ddpCacheDirPromise = null;
let cacheWriteQueue = Promise.resolve();
function ensureCacheDir() {
  if (ddpCacheDirPromise) return ddpCacheDirPromise;
  try {
    let cacheDir = iina.utils.resolvePath('@data/danmaku-cache/');
    if (!cacheDir) return Promise.resolve(null);
    if (file.exists(cacheDir)) return Promise.resolve(cacheDir);
    // IINA has no file.mkdir API. Await mkdir before the first cache write.
    ddpCacheDirPromise = iina.utils.exec('/bin/mkdir', ['-p', cacheDir]).then(function (result) {
      return result && result.status === 0 ? cacheDir : null;
    }).catch(function (error) {
      console.log('[ddp] cache directory error: ' + error);
      return null;
    }).then(function (dir) {
      ddpCacheDirPromise = null;
      return dir;
    });
    return ddpCacheDirPromise;
  } catch (e) {
    return Promise.resolve(null);
  }
}

function ddpPathHash(videoPath) {
  if (!videoPath) return '';
  var hash = 5381;
  for (var i = 0; i < videoPath.length; i++) {
    hash = ((hash << 5) + hash) + videoPath.charCodeAt(i);
    hash = hash & hash;
  }
  return (hash >>> 0).toString(36);
}

function ddpCacheFile(videoPath) {
  if (!videoPath) return null;
  return '@data/danmaku-cache/' + ddpPathHash(videoPath) + '.json';
}

function ddpSaveVideoCache(videoPath, episodeId, animeTitle, episodeTitle, comments) {
  if (!videoPath || !episodeId) return Promise.resolve(false);
  let content = JSON.stringify({
    videoPath: videoPath,
    episodeId: episodeId,
    animeTitle: animeTitle || '',
    episodeTitle: episodeTitle || '',
    cachedAt: Date.now(),
    schemaVersion: 2,
    comments: comments && comments.sourceType ? comments.comments : comments || []
  });
  cacheWriteQueue = cacheWriteQueue.then(ensureCacheDir).then(function (dir) {
    if (!dir) return false;
    if (file.write(ddpCacheFile(videoPath), content) === false) throw new Error('Cache write failed');
    return true;
  }).catch(function (e) {
    console.log('[ddp] saveVideoCache error: ' + e);
    return false;
  });
  return cacheWriteQueue;
}

function ddpReadVideoCache(videoPath) {
  if (!videoPath) return null;
  try {
    var f = ddpCacheFile(videoPath);
    if (!f || !file.exists(f)) return null;
    var content = file.read(f);
    if (!content) return null;
    var data = JSON.parse(content);
    if (!data || !data.episodeId || !Array.isArray(data.comments)) return null;
    if (data.videoPath && data.videoPath !== videoPath) return null;
    let cachedAt = Number(data.cachedAt);
    let age = Date.now() - cachedAt;
    if (!isFinite(cachedAt) || cachedAt <= 0 || age < 0 || age >= 24 * 60 * 60 * 1000) {
      data.stale = true;
    }
    data.document = parseDanmakuSource(data.comments, '', 'dandanplay');
    data.comments = data.document.comments;
    return data;
  } catch (e) {
    console.log('[ddp] readVideoCache error: ' + e);
    return null;
  }
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

function projectMatches(matches) {
  if (!matches) return null;
  var result = new Array(matches.length);
  for (var i = 0; i < matches.length; i++) {
    var match = matches[i] || {};
    result[i] = {
      animeId: match.animeId,
      animeTitle: match.animeTitle,
      episodeId: match.episodeId,
      episodeTitle: match.episodeTitle,
      type: match.type,
      typeDescription: match.typeDescription,
      shift: match.shift
    };
  }
  return result;
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
    if (res.statusCode === 403) {
      commitDdpState({status: 'error', error: t('ddp_auth_error')});
      ddpSyncState();
      ddpFallbackToLocal(true);
      return;
    }
    if (!data) {
      commitDdpState({status: 'error', error: t('ddp_api_error')});
      ddpSyncState();
      ddpFallbackToLocal(true);
      return;
    }
    if (data.success === false) {
      commitDdpState({status: 'error', error: data.errorMessage || t('ddp_api_error')});
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
    if (res.statusCode === 403) {
      commitDdpState({status: 'error', error: t('ddp_auth_error')});
      ddpSyncState();
      ddpFallbackToLocal(true);
      return;
    }
    var data = ddpParseBody(res);
    if (!data) {
      commitDdpState({status: 'error', error: t('ddp_api_error')});
      ddpSyncState();
      core.osd(t('ddp_api_error'));
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

function toggleDanmaku() {
  commitState({danmakuEnabled: !pluginState.danmakuEnabled});
  if (pluginState.danmakuEnabled) {
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
    core.osd(t('danmaku_on'));
  } else {
    if (overlayReady) overlayPostMessage('toggle-danmaku', playbackSnapshot());
    setObserver(false);
    core.osd(t('danmaku_off'));
  }
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

function registerSidebarHandlers() {
  sidebarOnMessage("toggle-danmaku", function () { toggleDanmaku(); });

  // [message, state property, payload field]. Persistence lives in commitState.
  [
    ['set-opacity', 'canvasOpacity', 'opacity'], ['set-fontscale', 'canvasFontScale', 'scale'],
    ['set-canvas-mode', 'currentCanvasMode', 'mode'], ['set-stroke-opacity', 'strokeOpacity', 'opacity'],
    ['set-stroke-width', 'strokeWidth', 'width'], ['set-stroke-color', 'strokeColor', 'color'],
    ['set-stroke-inversion-color', 'strokeInversionColor', 'color'], ['set-comment-limit', 'commentLimit', 'limit'],
    ['set-scroll-speed', 'scrollSpeed', 'speed']
  ].forEach(function (entry) {
    sidebarOnMessage(entry[0], function (data) {
      let patch = {};
      patch[entry[1]] = data[entry[2]];
      commitState(patch);
    });
  });

  sidebarOnMessage("set-danmaku-force-simplified", function (data) {
    commitState({danmakuForceSimplified: !!data.value});

    // 当前已加载弹幕时重新驱动加载管道（内容经 getEffectiveContent 单源转换）
    resendDanmakuToOverlay();
    // 过滤 tab 列表与 overlay 同源: 简体开关变化 → 重新构建并推送
    notifyBrowserDataChanged();
  });

  sidebarOnMessage("set-danmaku-auto-offset", function (data) {
    commitState({danmakuAutoOffset: !!data.value});

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
    applyDanmakuFont(data.fontFamily, data.fontWeight);
  });

  sidebarOnMessage("set-style-preset", function (data) {
    if (!data || !Object.prototype.hasOwnProperty.call(STYLE_PRESETS, data.preset)) return;
    commitState(Object.assign({}, STYLE_PRESETS[data.preset], {stylePreset: data.preset}));
  });

  sidebarOnMessage("set-danmaku-filter", function (data) {
    applyDanmakuFilter(data.startDay, data.endDay);
    notifyBrowserDataChanged(); // 范围切片变化 → 列表与 overlay 同步重建
  });

  sidebarOnMessage("set-danmaku-filter-density", function (data) {
    applyDanmakuFilterDensity(data.density || 0);
    notifyBrowserDataChanged(); // 密度过滤变化 → 列表与 overlay 同步重建
  });

  // ── 屏蔽词 ──

  sidebarOnMessage("danmaku-blocklist-set-enabled", function (data) {
    commitState({danmakuBlocklistEnabled: !!data.enabled});

    // 屏蔽词为零时开关不影响弹幕内容,跳过重建以省性能
    if (pluginState.danmakuBlocklist.length > 0) {
      notifyBrowserDataChanged();
      resendDanmakuToOverlay();
    }
  });

  sidebarOnMessage("danmaku-blocklist-add", function (data) {
    var w = String(data.word || '').trim();
    if (!w) return;
    if (pluginState.danmakuBlocklist.indexOf(w) !== -1) return;
    commitState({danmakuBlocklist: pluginState.danmakuBlocklist.concat(w)});

    rebuildBlockRegexes();
    notifyBrowserDataChanged();
    resendDanmakuToOverlay();
  });

  // 按词值删除(不按下标): 渲染与点击之间列表可能变化,下标会删错词
  sidebarOnMessage("danmaku-blocklist-remove", function (data) {
    var word = data && data.word !== undefined ? String(data.word) : null;
    var idx = word !== null ? pluginState.danmakuBlocklist.indexOf(word) : -1;
    if (idx < 0) return;
    commitState({danmakuBlocklist: pluginState.danmakuBlocklist.filter(function (_, i) { return i !== idx; })});

    rebuildBlockRegexes();
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
    if (data.enabled !== undefined) patch.danmakuDedupeEnabled = !!data.enabled;
    if (data.window !== undefined) {
      var w = parseFloat(data.window);
      if (isFinite(w) && w >= 1 && w <= 5) patch.danmakuDedupeWindow = w;
    }

    commitState(patch);
    notifyBrowserDataChanged();
    resendDanmakuToOverlay();
  });

  sidebarOnMessage("danmaku-browser-vis-set", function (data) {
    if (data && data.visible !== undefined) {
      commitState({danmakuBrowserVisible: !!data.visible});

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
    if (data && data.path) loadDanmakuFile(data.path, { enableDanmaku: true });
  });

  sidebarOnMessage("danmaku-file-add", chooseDanmakuFile);

  sidebarOnMessage("dandanplay-set-auto-network", function (data) {
    commitState({dandanplayAutoNetwork: !!data.autoNetwork});

    ddpSyncState();
  });

  sidebarOnMessage("dandanplay-search", function (data) {
    let generation = ++ddpSearchGeneration;
    ddpBangumiGeneration += 1;
    let searchId = data.searchId;
    var keyword = data.keyword;
    if (!keyword) return;
    ddpSearchAnime(keyword).then(function(res) {
      if (generation !== ddpSearchGeneration) return;
      var result = ddpParseBody(res);
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
    let generation = ++ddpBangumiGeneration;
    let searchGeneration = ddpSearchGeneration;
    var bangumiId = data.bangumiId;
    var animeTitle = data.animeTitle;
    ddpGetBangumi(bangumiId).then(function(res) {
      if (generation !== ddpBangumiGeneration || searchGeneration !== ddpSearchGeneration) return;
      var result = ddpParseBody(res);
      if (!result || !result.bangumi) {
        sidebarPostMessage("dandanplay-bangumi-result", { bangumiId: bangumiId, searchId: data.searchId, animeTitle: animeTitle, episodes: [], error: t('ddp_api_error') });
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
    danmakuBrowserWatch = !!data.watch;
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
    if (data.targetSec !== undefined && data.targetSec !== null) {
      mpv.set("time-pos", data.targetSec);
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
  menu.item(t('menu_show_overlay'), function () { overlay.show(); })
);

menu.addItem(
  menu.item(t('menu_hide_overlay'), function () { overlay.hide(); })
);

console.log("danmaku-cosmos plugin initialized");
