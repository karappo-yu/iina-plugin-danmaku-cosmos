var overlay = iina.overlay;
var sidebar = iina.sidebar;
var event = iina.event;
var console = iina.console;
var menu = iina.menu;
var core = iina.core;
var file = iina.file;
var preferences = iina.preferences;
var mpv = iina.mpv;

var danmakuEnabled = preferences.get("danmakuEnabled");
var danmakuForceSimplified = preferences.get("danmakuForceSimplified") !== undefined ? preferences.get("danmakuForceSimplified") : true;
// 屏蔽词过滤(正则支持)——列表与开关都持久化;过滤在 getEffectiveContent 单源出口执行
var danmakuBlocklist = [];
try { danmakuBlocklist = JSON.parse(preferences.get("danmakuBlocklist") || '[]') || []; } catch (e) { danmakuBlocklist = []; }
if (!Array.isArray(danmakuBlocklist)) danmakuBlocklist = [];
var danmakuBlocklistEnabled = !!preferences.get("danmakuBlocklistEnabled");
var blockRegexes = []; // 编译缓存(列表变化时重建)
rebuildBlockRegexes();
// 弹幕去重: 开关 + 区间(秒,1-5)。窗口内重复文本合并为 "原文✖️N",时间取组内最早。
var danmakuDedupeEnabled = !!preferences.get("danmakuDedupeEnabled");
var danmakuDedupeWindow = parseFloat(preferences.get("danmakuDedupeWindow"));
if (!isFinite(danmakuDedupeWindow) || danmakuDedupeWindow < 1 || danmakuDedupeWindow > 5) danmakuDedupeWindow = 2;
var canvasOpacity = preferences.get("danmakuCanvasOpacity") || 0.8;
var canvasFontScale = preferences.get("niconicommentsFontScale") || 1.0;
var currentCanvasMode = preferences.get("canvasMode") || 'css';
var strokeOpacity = preferences.get("strokeOpacity") !== undefined ? preferences.get("strokeOpacity") : 0.4;
var strokeWidth = preferences.get("strokeWidth") !== undefined ? preferences.get("strokeWidth") : 2.8;
var strokeColor = preferences.get("strokeColor") || '#000000';
var strokeInversionColor = preferences.get("strokeInversionColor") || '#ffffff';
var commentLimit = preferences.get("commentLimit") !== undefined ? preferences.get("commentLimit") : 0;
var scrollSpeed = preferences.get("scrollSpeed") !== undefined ? preferences.get("scrollSpeed") : 1.0;
var danmakuTimeOffsetSec = preferences.get("danmakuTimeOffset") !== undefined ? preferences.get("danmakuTimeOffset") : 0;
var danmakuFontFamily = preferences.get("danmakuFontFamily") || "";
var danmakuFontWeight = preferences.get("danmakuFontWeight") || "400";
var stylePreset = preferences.get("stylePreset") || "nico";
var currentPlaybackSpeed = 1.0;
var overlayReady = false;
var preferencesSyncTimer = null;
var ddpCacheDirPath = null;
var ddpCacheDirChecked = false;

var DDP_APP_ID = preferences.get("dandanplayAppId") || 't43832ky57';
var DDP_APP_SECRET = preferences.get("dandanplayAppSecret") || 'IDnPEdEKDIziKeYVxm6VcaJE4Bv2fnzT';
var DDP_API_BASE = 'https://api.dandanplay.net';

var dandanplayAutoNetwork = preferences.get("dandanplayAutoNetwork") !== false;
var dandanplayChConvert = preferences.get("dandanplayChConvert") !== undefined ? preferences.get("dandanplayChConvert") : 0;
var dandanplayWithRelated = preferences.get("dandanplayWithRelated") !== undefined ? preferences.get("dandanplayWithRelated") : true;

var dandanplayState = {
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
    no_file_selected: "No file selected",
    read_failed: "Cannot read danmaku file",
    read_failed_name: "Cannot read danmaku file: ",
    content_unavailable: "Danmaku content unavailable",
    file_already_in_list: "File already in list",
    added_click_to_load: "Danmaku added: {name} — click to load",
    seek_disable: "Danmaku: seek disabled",
    seek_enable: "Danmaku: seek enabled",
    jump: "Danmaku jump: ",
    network_skip_local: "Network resource — skipping local danmaku",
    ddp_no_match: "DanDanPlay: no match found",
    ddp_network_error: "DanDanPlay: network error",
    ddp_api_error: "DanDanPlay: API response error",
    ddp_no_comments: "DanDanPlay: no danmaku for this video",
    ddp_load_failed: "DanDanPlay: failed to load danmaku"
  },
  ja: {
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
    no_file_selected: "\u30d5\u30a1\u30a4\u30eb\u304c\u9078\u629e\u3055\u308c\u3066\u3044\u307e\u305b\u3093",
    read_failed: "\u30b3\u30e1\u30f3\u30c8\u30d5\u30a1\u30a4\u30eb\u3092\u8aad\u307f\u8fbc\u3081\u307e\u305b\u3093",
    read_failed_name: "\u30b3\u30e1\u30f3\u30c8\u30d5\u30a1\u30a4\u30eb\u3092\u8aad\u307f\u8fbc\u3081\u307e\u305b\u3093: ",
    content_unavailable: "\u30b3\u30e1\u30f3\u30c8\u5185\u5bb9\u3092\u5229\u7528\u3067\u304d\u307e\u305b\u3093",
    file_already_in_list: "\u30d5\u30a1\u30a4\u30eb\u306f\u3059\u3067\u306b\u30ea\u30b9\u30c8\u306b\u3042\u308a\u307e\u3059",
    added_click_to_load: "\u30b3\u30e1\u30f3\u30c8\u3092\u8ffd\u52a0: {name}\u3001\u30af\u30ea\u30c3\u30af\u3067\u8aad\u307f\u8fbc\u307f",
    seek_disable: "\u30b3\u30e1\u30f3\u30c8: \u30b7\u30fc\u30af\u7981\u6b62",
    seek_enable: "\u30b3\u30e1\u30f3\u30c8: \u30b7\u30fc\u30af\u8a31\u53ef",
    jump: "\u30b3\u30e1\u30f3\u30c8\u30b8\u30e3\u30f3\u30d7: ",
    network_skip_local: "\u30cd\u30c3\u30c8\u30ef\u30fc\u30af\u30ea\u30bd\u30fc\u30b9\u306e\u305f\u3081\u30ed\u30fc\u30ab\u30eb\u30b3\u30e1\u30f3\u30c8\u3092\u30b9\u30ad\u30c3\u30d7",
    ddp_no_match: "\u5f3e\u5f3ePlay: \u4e00\u81f4\u3059\u308b\u7d50\u679c\u304c\u3042\u308a\u307e\u305b\u3093",
    ddp_network_error: "\u5f3e\u5f3ePlay: \u30cd\u30c3\u30c8\u30ef\u30fc\u30af\u30a8\u30e9\u30fc",
    ddp_api_error: "\u5f3e\u5f3ePlay: API\u5fdc\u7b54\u30a8\u30e9\u30fc",
    ddp_no_comments: "\u5f3e\u5f3ePlay: \u3053\u306e\u52d5\u753b\u306b\u30b3\u30e1\u30f3\u30c8\u304c\u3042\u308a\u307e\u305b\u3093",
    ddp_load_failed: "\u5f3e\u5f3ePlay: \u30b3\u30e1\u30f3\u30c8\u306e\u8aad\u307f\u8fbc\u307f\u306b\u5931\u6557\u3057\u307e\u3057\u305f"
  },
  zh: {
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
    no_file_selected: "\u672a\u9009\u62e9\u6587\u4ef6",
    read_failed: "\u65e0\u6cd5\u8bfb\u53d6\u5f39\u5e55\u6587\u4ef6",
    read_failed_name: "\u65e0\u6cd5\u8bfb\u53d6\u5f39\u5e55\u6587\u4ef6: ",
    content_unavailable: "\u5f39\u5e55\u5185\u5bb9\u4e0d\u53ef\u7528",
    file_already_in_list: "\u6587\u4ef6\u5df2\u5728\u5217\u8868\u4e2d",
    added_click_to_load: "\u5df2\u6dfb\u52a0\u5f39\u5e55: {name}\uff0c\u70b9\u51fb\u52a0\u8f7d",
    seek_disable: "\u5f39\u5e55\uff1a\u7981\u6b62\u8df3\u8f6c",
    seek_enable: "\u5f39\u5e55\uff1a\u5141\u8bb8\u8df3\u8f6c",
    jump: "\u5f39\u5e55\u8df3\u8f6c: ",
    network_skip_local: "\u7f51\u7edc\u8d44\u6e90\uff0c\u8df3\u8fc7\u672c\u5730\u5f39\u5e55\u52a0\u8f7d",
    ddp_no_match: "\u5f39\u5f39play: \u672a\u627e\u5230\u5339\u914d",
    ddp_network_error: "\u5f39\u5f39play: \u7f51\u7edc\u9519\u8bef",
    ddp_api_error: "\u5f39\u5f39play: API\u54cd\u5e94\u9519\u8bef",
    ddp_no_comments: "\u5f39\u5f39play: \u8be5\u89c6\u9891\u65e0\u5f39\u5e55",
    ddp_load_failed: "\u5f39\u5f39play: \u52a0\u8f7d\u5f39\u5e55\u5931\u8d25"
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
  // API unavailable (older IINA): preserve pre-i18n behavior (strings were hardcoded Chinese)
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
var currentVideoUrl = null;
var timePosListenerID = null;
var windowScaleListenerID = null;
var speedListenerID = null;

var currentDanmakuStatus = {
  fileType: null,
  fileName: null,
  relativePath: null,
  isLoaded: false
};

var danmakuFileList = {
  xmlFiles: [],
  jsonFiles: [],
  unknownFiles: [],
  selectedPaths: []
};

var danmakuCache = {};

var nicoJsonTotalCount = 0;
var danmakuFilterOffset = 0;
var danmakuFilterLimit = 0;
var danmakuFilterDensity = 0;
var danmakuBrowserWatch = false; // sidebar 过滤 tab 是否在监听(控制播放时间推送)
var lastBrowserTimeSent = 0;     // 时间推送节流标记
var pluginRootPath = '';         // sidebar 上报的插件根目录(用于读 overlay/lib/opencc.min.js)
var openccSimplifier = null;     // 简繁转换器(hk→cn,懒加载;仅强制简体开启且列表被监听时构建)

function sanitizeIPCString(value) {
  return String(value || '').replace(/[`\u2018\u2019]/g, "'");
}

function applyDanmakuOffset(offsetSec) {
  var nextOffset = parseFloat(offsetSec);
  if (isNaN(nextOffset)) nextOffset = 0;
  danmakuTimeOffsetSec = nextOffset;
  preferences.set("danmakuTimeOffset", danmakuTimeOffsetSec);
  syncPreferencesSoon();
  if (overlayReady) {
    overlay.postMessage("set-danmaku-offset", { offset: danmakuTimeOffsetSec });
  }
  sidebar.postMessage("danmaku-state", { danmakuTimeOffsetSec: danmakuTimeOffsetSec });
}

function applyDanmakuFont(fontFamily, fontWeight) {
  danmakuFontFamily = fontFamily || "";
  danmakuFontWeight = fontWeight || "";
  preferences.set("danmakuFontFamily", danmakuFontFamily);
  preferences.set("danmakuFontWeight", danmakuFontWeight);
  syncPreferencesSoon();
  if (overlayReady) {
    overlay.postMessage("set-danmaku-font", { fontFamily: danmakuFontFamily, fontWeight: danmakuFontWeight });
  }
  sidebar.postMessage("danmaku-state", { danmakuFontFamily: danmakuFontFamily, danmakuFontWeight: danmakuFontWeight });
}

function findDanmakuFileByPath(path) {
  var groups = [danmakuFileList.xmlFiles, danmakuFileList.jsonFiles, danmakuFileList.unknownFiles];
  for (var g = 0; g < groups.length; g++) {
    var files = groups[g] || [];
    for (var i = 0; i < files.length; i++) {
      if (files[i].path === path) return files[i];
    }
  }
  return null;
}

function updateDanmakuStatus(status) {
  if (status.fileName && typeof status.fileName === 'string') {
    status.fileName = sanitizeIPCString(status.fileName);
  }
  currentDanmakuStatus = status;
  sidebar.postMessage("danmaku-type", currentDanmakuStatus);
}

function danmakuNotFound() {
  updateDanmakuStatus({ fileType: null, fileName: null, relativePath: null, isLoaded: false });
}

function filePathFromUrl(url) {
  if (!url) return null;
  if (url.startsWith("file://")) {
    try { return decodeURIComponent(url.substring(7)); } catch (e) { return url.substring(7); }
  }
  return null;
}

function detectDanmakuType(content) {
  if (!content) return 'bilibili-xml';
  var s = content.trim();
  if (s.charAt(0) === '[') return 'nico-json';
  if (s.charAt(0) === '{') {
    try {
      var obj = JSON.parse(s);
      if (obj.source === 'dandanplay' && obj.comments) return 'dandanplay';
    } catch (e) {}
  }
  if (s.indexOf('<packet') !== -1) return 'nico-xml';
  return 'bilibili-xml';
}

function computeNicoJsonCount(encodedContent) {
  if (!encodedContent) return 0;
  try {
    var raw = decodeURIComponent(encodedContent);
    var data = JSON.parse(raw);
    if (!Array.isArray(data)) return 0;
    var count = 0;
    for (var i = 0; i < data.length; i++) {
      if (data[i] && data[i].fork !== 'owner' && data[i].fork !== 'easy' && Array.isArray(data[i].comments)) {
        count += data[i].comments.length;
      }
    }
    return count;
  } catch (e) {}
  return 0;
}

function sendDanmakuFilterInfo() {
  var rangeStartDate = null;
  var rangeEndDate = null;
  var filteredCount = 0;

  var selectedPath = danmakuFileList.selectedPaths.length > 0 ? danmakuFileList.selectedPaths[0] : null;
  var ft = currentDanmakuStatus.fileType;

  if (selectedPath && ft === 'nico-json') {
    var encodedContent = danmakuCache[selectedPath];
    if (encodedContent) {
      try {
        var rawStr = decodeURIComponent(encodedContent);
        var data = JSON.parse(rawStr);
        if (Array.isArray(data)) {
          // Compute filtered count
          var filteredData = filterNicoJsonData(data);
          for (var fi = 0; fi < filteredData.length; fi++) {
            var fthread = filteredData[fi];
            if (fthread && fthread.fork !== 'owner' && fthread.fork !== 'easy' && Array.isArray(fthread.comments)) {
              filteredCount += fthread.comments.length;
            }
          }
          // Find the main thread for range dates
          for (var i = 0; i < data.length; i++) {
            var thread = data[i];
            if (thread && thread.fork !== 'owner' && thread.fork !== 'easy' && Array.isArray(thread.comments) && thread.comments.length > 0) {
              var comments = thread.comments.slice().sort(function(a, b) { return (a.no || 0) - (b.no || 0); });
              var offset = danmakuFilterOffset || 0;
              var limit = danmakuFilterLimit > 0 ? danmakuFilterLimit : comments.length;
              if (offset + limit > comments.length) {
                offset = Math.max(0, comments.length - limit);
              }
              var startIdx = offset;
              var endIdx = Math.min(offset + limit - 1, comments.length - 1);
              for (var k = startIdx; k <= endIdx; k++) {
                var pa = comments[k].postedAt;
                if (!pa) continue;
                if (rangeStartDate === null || pa < rangeStartDate) rangeStartDate = pa;
                if (rangeEndDate === null || pa > rangeEndDate) rangeEndDate = pa;
              }
              break;
            }
          }
        }
      } catch (e) {}
    }
  }

  sidebar.postMessage("danmaku-filter-info", {
    fileType: ft,
    totalCount: nicoJsonTotalCount,
    filterOffset: danmakuFilterOffset,
    filterLimit: danmakuFilterLimit,
    filterDensity: danmakuFilterDensity,
    filteredCount: filteredCount,
    rangeStartDate: rangeStartDate,
    rangeEndDate: rangeEndDate
  });
}

// Nico JSON density filter: 60s windows, top N by no desc, nicoru>=3 protected (no quota)
function densityFilterNicoJsonComments(comments, density) {
  if (!density || density <= 0 || !Array.isArray(comments) || comments.length === 0) return comments;

  var nicoruKept = [];
  var candidates = [];
  for (var i = 0; i < comments.length; i++) {
    var c = comments[i];
    if (c && c.nicoruCount >= 3) {
      nicoruKept.push(c);
    } else {
      candidates.push(c);
    }
  }

  var windows = {};
  for (var i = 0; i < candidates.length; i++) {
    var c = candidates[i];
    var win = Math.floor((c.vposMs || 0) / 60000);
    if (!windows[win]) windows[win] = [];
    windows[win].push(c);
  }

  var densityKept = [];
  for (var win in windows) {
    if (!windows.hasOwnProperty(win)) continue;
    var arr = windows[win];
    arr.sort(function(a, b) { return (b.no || 0) - (a.no || 0); });
    var take = Math.min(density, arr.length);
    for (var i = 0; i < take; i++) {
      densityKept.push(arr[i]);
    }
  }

  var result = nicoruKept.concat(densityKept);
  result.sort(function(a, b) { return (a.no || 0) - (b.no || 0); });
  return result;
}

// Apply offset/limit + density filters to nico-json thread data
function filterNicoJsonData(data) {
  if (!Array.isArray(data)) return data;
  var filteredData = [];
  var hasFilter = false;
  for (var i = 0; i < data.length; i++) {
    var thread = data[i];
    if (!thread || !Array.isArray(thread.comments)) {
      filteredData.push(thread);
      continue;
    }
    if (thread.fork === 'owner' || thread.fork === 'easy') {
      filteredData.push(thread);
    } else {
      var comments = thread.comments;
      var sliced = comments;
      if (danmakuFilterLimit > 0 && danmakuFilterLimit < comments.length) {
        var sorted = comments.slice().sort(function(a, b) { return (a.no || 0) - (b.no || 0); });
        var start = Math.min(danmakuFilterOffset, sorted.length - danmakuFilterLimit);
        if (start < 0) start = 0;
        sliced = sorted.slice(start, start + danmakuFilterLimit);
        hasFilter = true;
      }
      if (danmakuFilterDensity > 0) {
        sliced = densityFilterNicoJsonComments(sliced, danmakuFilterDensity);
        hasFilter = true;
      }
      if (sliced !== comments) {
        var newObj = {};
        for (var k in thread) {
          if (thread.hasOwnProperty(k)) newObj[k] = thread[k];
        }
        newObj.comments = sliced;
        newObj.commentCount = sliced.length;
        filteredData.push(newObj);
      } else {
        filteredData.push(thread);
      }
    }
  }
  return hasFilter ? filteredData : data;
}

function applyNicoJsonFilters(encodedContent) {
  if (danmakuFilterDensity <= 0 && danmakuFilterLimit <= 0) return encodedContent;
  var rawStr;
  try { rawStr = decodeURIComponent(encodedContent); } catch (e) { return encodedContent; }
  var data;
  try { data = JSON.parse(rawStr); } catch (e) { return encodedContent; }
  if (!Array.isArray(data)) return encodedContent;
  var filteredData = filterNicoJsonData(data);
  if (filteredData === data) return encodedContent;
  return encodeContent(JSON.stringify(filteredData));
}

function applyDanmakuFilter(offset, limit) {
  danmakuFilterOffset = offset;
  danmakuFilterLimit = limit;
  if (!overlayReady) return;

  var ft = currentDanmakuStatus.fileType;
  if (ft !== 'nico-json') return;

  var selectedPath = danmakuFileList.selectedPaths.length > 0 ? danmakuFileList.selectedPaths[0] : null;
  if (!selectedPath) return;
  if (!danmakuCache[selectedPath]) return;

  overlay.postMessage("load-danmaku", {
    xmlContent: getEffectiveContent(selectedPath),
    path: selectedPath,
    danmakuType: 'nico-json',
    opacity: canvasOpacity,
    canvasFontScale: canvasFontScale,
    strokeColor: strokeColor,
    strokeInversionColor: strokeInversionColor,
    strokeOpacity: strokeOpacity,
    strokeWidth: strokeWidth,
    commentLimit: commentLimit,
    scrollSpeed: scrollSpeed,
    danmakuTimeOffsetSec: danmakuTimeOffsetSec,
    danmakuFontFamily: danmakuFontFamily,
    danmakuFontWeight: danmakuFontWeight,
    preservePosition: true,
  });
  sendDanmakuFilterInfo();
}

function applyDanmakuFilterDensity(density) {
  danmakuFilterDensity = density;
  var ft = currentDanmakuStatus.fileType;
  if (ft === 'nico-json') {
    applyDanmakuFilter(danmakuFilterOffset, danmakuFilterLimit);
  }
}

// ── 过滤 tab: 弹幕时间线列表 ──────────────────────────────────────────
// 数据源为 danmakuCache(main.js 本就持有已加载的弹幕内容,发给 overlay 渲染的同一份),
// 不经 overlay。sidebar 懒加载,只能由 sidebar 主动拉取(danmaku-browser-request);
// 播放时间以 danmaku-visible-time 节流推送,sidebar 按时间线锚定跟随。
// 列表与 overlay 渲染内容保持一致: nico-json 应用与 overlay 相同的 offset/limit/密度
// 切片(applyNicoJsonFilters);其他格式文本过强制简体转换(OpenCC,与 overlay 同一库同参数)。

// 纯 JS base64(UTF-8)——main.js 运行在 IINA 的 JavaScriptCore 环境,不保证有 btoa/unescape
var B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function b64Encode(str) {
  var bytes = [];
  for (var i = 0; i < str.length; i++) {
    var c = str.charCodeAt(i);
    if (c < 0x80) {
      bytes.push(c);
    } else if (c < 0x800) {
      bytes.push(0xC0 | (c >> 6), 0x80 | (c & 63));
    } else if (c >= 0xD800 && c <= 0xDBFF && i + 1 < str.length) {
      var c2 = str.charCodeAt(i + 1);
      if (c2 >= 0xDC00 && c2 <= 0xDFFF) {
        var cp = 0x10000 + ((c - 0xD800) << 10) + (c2 - 0xDC00);
        bytes.push(0xF0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
        i++;
      } else {
        bytes.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      }
    } else {
      bytes.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
  }
  var out = '';
  for (var j = 0; j < bytes.length; j += 3) {
    var b0 = bytes[j], b1 = bytes[j + 1], b2 = bytes[j + 2];
    out += B64_CHARS[b0 >> 2];
    out += B64_CHARS[((b0 & 3) << 4) | (b1 === undefined ? 0 : b1 >> 4)];
    out += b1 === undefined ? '=' : B64_CHARS[((b1 & 15) << 2) | (b2 === undefined ? 0 : b2 >> 6)];
    out += b2 === undefined ? '=' : B64_CHARS[b2 & 63];
  }
  return out;
}

function decodeXmlText(text) {
  if (text.indexOf('&') === -1) return text;
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

// 简繁转换器(OpenCC hk→cn,与 overlay/lib/opencc.min.js 同一库同参数)。
// opencc.min.js 是 UMD bundle,无 DOM 依赖,file.read + eval 即可在 JavaScriptCore 运行;
// 失败则返回 false(列表退化为原文,不影响渲染主链路)。首次构建 ~几百 ms,缓存复用。
function ensureBrowserSimplifier() {
  if (openccSimplifier) return true;
  if (!danmakuForceSimplified) return false;
  if (!pluginRootPath) return false;
  try {
    var code = file.read(pluginRootPath + '/overlay/lib/opencc.min.js');
    if (!code) return false;
    eval(code); // UMD 挂到全局(globalThis.OpenCC)
    if (!globalThis.OpenCC) return false;
    openccSimplifier = globalThis.OpenCC.Converter({ from: 'hk', to: 'cn' });
    return true;
  } catch (e) {
    return false;
  }
}

// ── 屏蔽词过滤(正则支持) ─────────────────────────────────────────────
// 过滤发生在 getEffectiveContent 单源出口: overlay 渲染与 sidebar 列表拿同一份
// 过滤后内容,结构性一致。每个词优先按正则编译;非法正则退化为转义后的普通文本匹配。

function rebuildBlockRegexes() {
  blockRegexes = [];
  for (var i = 0; i < danmakuBlocklist.length; i++) {
    var w = danmakuBlocklist[i];
    if (!w) continue;
    var re;
    try {
      re = new RegExp(w, 'i'); // 优先按正则
    } catch (e) {
      try {
        re = new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'); // 非法正则 → 转义当普通词
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

// ── 弹幕去重(时间窗内重复文本合并) ───────────────────────────────────
// 输入为已含 .t(1/100s) 与 .text 的对象数组(时间无需有序,内部按 t 排序);
// 窗口 windowMs 内文本相同的弹幕合并为一条——保留组内最早对象(时间=t),
// 其 .text 原地改为 "原文✖️N";被合并对象从输出消失。调用方通过对象引用
// 判断保留/删除。与屏蔽词/简繁共用同一变换序列,保证 overlay 与列表一致。
function mergeDuplicateItems(items, windowMs) {
  if (!items || items.length === 0) return items;
  if (!(windowMs > 0)) return items;
  var buckets = new Map();
  var out = []; // 空文本条目(未解析/无效评论占位)不进桶,原样透传——否则被去重丢弃
  for (var i = 0; i < items.length; i++) {
    var it = items[i];
    if (!it || typeof it.t !== 'number' || !isFinite(it.t)) continue;
    if (!it.text) { out.push(it); continue; }
    var bucket = buckets.get(it.text);
    if (!bucket) { bucket = []; buckets.set(it.text, bucket); }
    bucket.push(it);
  }
  buckets.forEach(function (bucket) {
    bucket.sort(function (a, b) { return a.t - b.t; });
    var i = 0;
    while (i < bucket.length) {
      var first = bucket[i];
      var count = 1;
      var j = i + 1;
      while (j < bucket.length && bucket[j].t - first.t <= windowMs) {
        count++;
        j++;
      }
      if (count > 1) {
        // 合并标记(调用方据此给新弹幕加颜色指令);分隔符用 x(✖ 太粗,且不带
        // 变体选择符时才按文本渲染)
        first._mergeCount = count;
        first.text = first.text + 'x' + count;
      }
      out.push(first);
      i = j;
    }
  });
  out.sort(function (a, b) { return a.t - b.t; });
  return out;
}

// XML 文本转义(合并文本重建行时用;与 decodeXmlText 互逆)
function encodeXmlText(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// 合并弹幕颜色池(鲜艳色,视觉可区分;nico 经典色系)
var MERGE_COLORS = [
  { name: 'red',    hex: '#ff0000', dec: 16711680 },
  { name: 'pink',   hex: '#ff8080', dec: 16744320 },
  { name: 'orange', hex: '#ffcc00', dec: 16766720 },
  { name: 'yellow', hex: '#ffff00', dec: 16776960 },
  { name: 'green',  hex: '#00ff00', dec: 65280 },
  { name: 'cyan',   hex: '#00ffff', dec: 65535 },
  { name: 'blue',   hex: '#0000ff', dec: 255 },
  { name: 'purple', hex: '#800080', dec: 8388736 }
];
function pickMergeColor(text) {
  if (text) {
    // 按文本 hash 稳定选色: 同一合并文本每次重建颜色不变(重发/改设置不闪色),
    // 不同文本按 hash 分散到色池
    var h = 0;
    for (var i = 0; i < text.length; i++) {
      h = (h * 31 + text.charCodeAt(i)) | 0;
    }
    return MERGE_COLORS[Math.abs(h) % MERGE_COLORS.length];
  }
  return MERGE_COLORS[Math.floor(Math.random() * MERGE_COLORS.length)];
}

// nico-json 去重: 每个 thread 的 comments 内合并(保留组内最早 comment 的全部字段)
function dedupeNicoJson(encodedContent) {
  if (!(danmakuDedupeWindow > 0)) return encodedContent;
  var rawStr;
  try { rawStr = decodeURIComponent(encodedContent); } catch (e) { return encodedContent; }
  var data;
  try { data = JSON.parse(rawStr); } catch (e) { return encodedContent; }
  if (!Array.isArray(data)) return encodedContent;
  var windowMs = danmakuDedupeWindow * 100;
  var changed = false;
  var filteredData = [];
  for (var i = 0; i < data.length; i++) {
    var thread = data[i];
    if (!thread || !Array.isArray(thread.comments)) { filteredData.push(thread); continue; }
    var entries = [];
    for (var j = 0; j < thread.comments.length; j++) {
      var c = thread.comments[j];
      if (!c) { entries.push({ t: 0, text: '', _c: c, _skip: true }); continue; }
      var t = c.vposMs !== undefined ? Math.round(c.vposMs / 10) : (typeof c.vpos === 'number' ? Math.round(c.vpos) : NaN);
      var text = c.body !== undefined ? c.body : c.content;
      if (!isFinite(t) || !text) { entries.push({ t: 0, text: '', _c: c, _skip: true }); continue; }
      entries.push({ t: t, text: text, _c: c });
    }
    var merged = mergeDuplicateItems(entries, windowMs);
    var newComments = [];
    for (var k = 0; k < merged.length; k++) {
      var e = merged[k];
      if (e._skip) { newComments.push(e._c); continue; }
      if (e._mergeCount > 1) {
        // 合并出的新弹幕: commands 数组追加随机颜色命令(v1 格式无 mail 字段,
        // commands 直接作为引擎 mail 解析,颜色名经 config.colors 生效)
        var mc = pickMergeColor(e.text);
        if (!Array.isArray(e._c.commands)) e._c.commands = [];
        e._c.commands.push(mc.name);
      }
      if (e._c.body !== undefined) e._c.body = e.text;
      else e._c.content = e.text;
      newComments.push(e._c);
    }
    if (newComments.length !== thread.comments.length) {
      changed = true;
      var newObj = {};
      for (var p in thread) { if (thread.hasOwnProperty(p)) newObj[p] = thread[p]; }
      newObj.comments = newComments;
      newObj.commentCount = newComments.length;
      filteredData.push(newObj);
    } else {
      filteredData.push(thread);
    }
  }
  if (!changed) return encodedContent;
  return encodeContent(JSON.stringify(filteredData));
}

// 非 nico-json 去重: dandanplay 解析合并;XML(bilibili <d> / nico <chat>)行级合并
function dedupeContent(encodedContent, ft) {
  if (!(danmakuDedupeWindow > 0)) return encodedContent;
  var rawStr;
  try { rawStr = decodeURIComponent(encodedContent); } catch (e) { return encodedContent; }
  var windowMs = danmakuDedupeWindow * 100;
  if (ft === 'dandanplay') {
    var list;
    try { list = JSON.parse(rawStr); } catch (e) { return encodedContent; }
    if (!Array.isArray(list)) return encodedContent;
    var entries = [];
    for (var i = 0; i < list.length; i++) {
      var d = list[i];
      if (!d || typeof d.t !== 'number' || !isFinite(d.t) || !d.text) { entries.push({ t: 0, text: '', _d: d, _skip: true }); continue; }
      entries.push({ t: Math.round(d.t), text: d.text, _d: d });
    }
    var merged = mergeDuplicateItems(entries, windowMs);
    var out = [];
    for (var k = 0; k < merged.length; k++) {
      var e = merged[k];
      if (e._skip) { out.push(e._d); continue; }
      if (e._mergeCount > 1 && Array.isArray(e._d._commands)) {
        // 合并出的新弹幕: 颜色命令替换为随机颜色(无颜色命令则追加)
        var mc = pickMergeColor(e.text);
        var hasColor = false;
        for (var ci = 0; ci < e._d._commands.length; ci++) {
          if (e._d._commands[ci].charAt(0) === '#') {
            e._d._commands[ci] = mc.hex;
            hasColor = true;
            break;
          }
        }
        if (!hasColor) e._d._commands.push(mc.hex);
      }
      e._d.text = e.text;
      out.push(e._d);
    }
    if (out.length === list.length) return encodedContent;
    return encodeContent(JSON.stringify(out));
  }
  // 用 ft 判断格式(内容嗅探 '<chat' 会误判含 <chatserver> 头部的 bilibili XML)
  var re = ft === 'nico-xml'
    ? /(<chat\b[^>]*>)([\s\S]*?)(<\/chat>)/g
    : /(<d\s+p="[^"]*"[^>]*>)([\s\S]*?)(<\/d>)/g;
  var lines = []; // {t, text, head, tail, full, start}
  var m;
  while ((m = re.exec(rawStr)) !== null) {
    var t = m[1].indexOf('vpos="') !== -1
      ? parseInt((m[1].match(/vpos="(\d+)"/) || [0, 0])[1], 10) || 0
      : Math.round((parseFloat((m[1].match(/p="([^"]*)"/) || [0, '0'])[1].split(',')[0]) || 0) * 100);
    // start = 本行在原始串中的位置: 重建时按序推进,无需重扫/线性查找(O(n))
    lines.push({ t: t, text: decodeXmlText(m[2]), head: m[1], tail: m[3], full: m[0], start: m.index });
  }
  if (lines.length === 0) return encodedContent;
  var merged = mergeDuplicateItems(lines, windowMs);
  var kept = new Set();
  for (var i2 = 0; i2 < merged.length; i2++) kept.add(merged[i2]);
  if (kept.size === lines.length) return encodedContent;
  // 重建: 按原始顺序推进——每行输出它前面那段原始内容(头部等非弹幕内容),
  // 保留的行重建(合并标色/文本),被合并掉的行自然跳过。O(n)。
  var parts = [];
  var last = 0;
  for (var li = 0; li < lines.length; li++) {
    var line = lines[li];
    parts.push(rawStr.slice(last, line.start));
    if (kept.has(line)) {
      var head = line.head;
      if (line._mergeCount > 1) {
        // 合并出的新弹幕: p 属性第 4 段(颜色)替换为随机颜色
        var pm = head.match(/p="([^"]*)"/);
        if (pm) {
          var pParts = pm[1].split(',');
          if (pParts.length >= 4) {
            pParts[3] = String(pickMergeColor(line.text).dec);
            head = head.replace(pm[1], pParts.join(','));
          }
        }
      }
      parts.push(head + encodeXmlText(line.text) + line.tail);
    }
    last = line.start + line.full.length;
  }
  parts.push(rawStr.slice(last));
  return encodeContent(parts.join(''));
}

// nico-json: 过滤所有 thread 的 comments(含 owner/easy——屏蔽词对渲染的全部弹幕生效)
function filterBlockedNicoJson(encodedContent) {
  if (blockRegexes.length === 0) return encodedContent;
  var rawStr;
  try { rawStr = decodeURIComponent(encodedContent); } catch (e) { return encodedContent; }
  var data;
  try { data = JSON.parse(rawStr); } catch (e) { return encodedContent; }
  if (!Array.isArray(data)) return encodedContent;
  var changed = false;
  var filteredData = [];
  for (var i = 0; i < data.length; i++) {
    var thread = data[i];
    if (!thread || !Array.isArray(thread.comments)) { filteredData.push(thread); continue; }
    var kept = [];
    for (var j = 0; j < thread.comments.length; j++) {
      var c = thread.comments[j];
      if (!c) { kept.push(c); continue; }
      var text = c.body !== undefined ? c.body : c.content;
      if (isBlockedText(text)) changed = true;
      else kept.push(c);
    }
    if (kept.length !== thread.comments.length) {
      var newObj = {};
      for (var k in thread) { if (thread.hasOwnProperty(k)) newObj[k] = thread[k]; }
      newObj.comments = kept;
      newObj.commentCount = kept.length;
      filteredData.push(newObj);
    } else {
      filteredData.push(thread);
    }
  }
  if (!changed) return encodedContent;
  return encodeContent(JSON.stringify(filteredData));
}

// 非 nico-json: 内容字符串层面的弹幕行过滤。dandanplay(JSON)解析后过滤;
// XML(bilibili <d> / nico <chat>)行级正则,只删除匹配弹幕行,保留整体结构。
function filterBlockedContent(encodedContent, ft) {
  if (blockRegexes.length === 0) return encodedContent;
  var rawStr;
  try { rawStr = decodeURIComponent(encodedContent); } catch (e) { return encodedContent; }
  if (ft === 'dandanplay') {
    var list;
    try { list = JSON.parse(rawStr); } catch (e) { return encodedContent; }
    if (!Array.isArray(list)) return encodedContent;
    var kept = [];
    var changed = false;
    for (var i = 0; i < list.length; i++) {
      var d = list[i];
      if (!d || !isBlockedText(d.text)) kept.push(d);
      else changed = true;
    }
    if (!changed) return encodedContent;
    return encodeContent(JSON.stringify(kept));
  }
  // 用 ft 判断格式(内容嗅探 '<chat' 会误判含 <chatserver> 头部的 bilibili XML)
  var re = ft === 'nico-xml'
    ? /<chat\b[^>]*>([\s\S]*?)<\/chat>/g
    : /<d\s+p="[^"]*"[^>]*>([\s\S]*?)<\/d>/g;
  var out = [];
  var last = 0;
  var m;
  var changed = false;
  while ((m = re.exec(rawStr)) !== null) {
    out.push(rawStr.slice(last, m.index));
    if (isBlockedText(decodeXmlText(m[1]))) {
      changed = true; // 删除该弹幕行
    } else {
      out.push(m[0]);
    }
    last = m.index + m[0].length;
  }
  out.push(rawStr.slice(last));
  if (!changed) return encodedContent;
  return encodeContent(out.join(''));
}

// 单源内容出口: 按当前设置返回"最终内容"(URI 编码形式)。
// overlay 的 load-danmaku 与 sidebar 过滤列表都从这里取数,保证两边拿到
// 完全同一份数据——nico-json 应用 offset/limit/密度切片;其他格式应用强制简体转换;
// 屏蔽词开启时两者都再经过屏蔽词过滤;去重开启时最后合并重复弹幕。
function getEffectiveContent(path) {
  var encodedContent = danmakuCache[path];
  if (!encodedContent) return null;
  var ft = currentDanmakuStatus.fileType;
  var out;
  if (ft === 'nico-json') {
    out = applyNicoJsonFilters(encodedContent); // 切片/密度(无过滤时原样返回)
    if (danmakuBlocklistEnabled) out = filterBlockedNicoJson(out);
    if (danmakuDedupeEnabled) out = dedupeNicoJson(out);
    return out;
  }
  if (danmakuForceSimplified && ensureBrowserSimplifier()) {
    try {
      out = encodeContent(openccSimplifier(decodeURIComponent(encodedContent)));
    } catch (e) {
      out = encodedContent;
    }
  } else {
    out = encodedContent;
  }
  if (danmakuBlocklistEnabled) out = filterBlockedContent(out, ft);
  if (danmakuDedupeEnabled) out = dedupeContent(out, ft);
  return out;
}

// 逐条文本简繁转换(与 getEffectiveContent 的整串转换结果一致,OpenCC 逐字符幂等)
function simplifyText(text) {
  if (!text || !openccSimplifier || !danmakuForceSimplified) return text;
  return openccSimplifier(text);
}

// 从原始内容构建 [{t, text, blocked}] 时间线(vpos 升序)。
// 与 getEffectiveContent 完全相同的变换序列: nico-json 先切片/密度(排除的不入列表,
// 它们不在当前范围而非"被屏蔽");文本按强制简体转换;屏蔽词命中标记 blocked——
// 被屏蔽弹幕仍显示在列表(划线),其 blocked 状态与 overlay 实际过滤掉的弹幕一一对应。
// 格式字段与 overlay 解析一致: nico-json v1(vposMs/body)与 legacy(vpos/content);
// dandanplay 缓存已是 {t,text}; nico/bilibili XML 轻量正则提取。
function buildDanmakuBrowserList() {
  var selectedPath = danmakuFileList.selectedPaths.length > 0 ? danmakuFileList.selectedPaths[0] : null;
  if (!selectedPath) return [];
  var encodedContent = danmakuCache[selectedPath];
  if (!encodedContent) return [];
  var ft = currentDanmakuStatus.fileType;
  var rawStr;
  try {
    rawStr = decodeURIComponent(ft === 'nico-json' ? applyNicoJsonFilters(encodedContent) : encodedContent);
  } catch (e) { return []; }
  ensureBrowserSimplifier(); // 需要时构建转换器(非 nico-json + 强制简体)
  var items = [];
  try {
    if (ft === 'nico-json') {
      var data = JSON.parse(rawStr);
      if (Array.isArray(data)) {
        for (var i = 0; i < data.length; i++) {
          var thread = data[i];
          if (!thread) continue;
          if (thread.fork === 'owner' || thread.fork === 'easy') continue;
          var comments = Array.isArray(thread.comments) ? thread.comments : (Array.isArray(thread.chat) ? thread.chat : null);
          if (!comments) continue;
          for (var j = 0; j < comments.length; j++) {
            var c = comments[j];
            if (!c) continue;
            var t = c.vposMs !== undefined ? Math.round(c.vposMs / 10) : (typeof c.vpos === 'number' ? Math.round(c.vpos) : NaN);
            var text = c.body !== undefined ? c.body : c.content;
            if (!isFinite(t) || !text) continue;
            items.push({ t: t, text: text, blocked: isBlockedText(text) });
          }
        }
      }
    } else if (ft === 'dandanplay') {
      var list = JSON.parse(rawStr);
      if (Array.isArray(list)) {
        for (var k = 0; k < list.length; k++) {
          var d = list[k];
          if (!d || typeof d.t !== 'number' || !isFinite(d.t) || !d.text) continue;
          var st = simplifyText(d.text);
          items.push({ t: Math.round(d.t), text: st, blocked: isBlockedText(st) });
        }
      }
    } else {
      if (ft === 'nico-xml' || rawStr.indexOf('<packet') !== -1) {
        var reChat = /<chat\b[^>]*\bvpos="(\d+)"[^>]*>([\s\S]*?)<\/chat>/g;
        var m;
        while ((m = reChat.exec(rawStr)) !== null) {
          if (!m[2]) continue;
          var ct = simplifyText(decodeXmlText(m[2]));
          items.push({ t: parseInt(m[1], 10) || 0, text: ct, blocked: isBlockedText(ct) });
        }
      } else {
        var reD = /<d\s+p="([^"]*)"[^>]*>([\s\S]*?)<\/d>/g;
        var m2;
        while ((m2 = reD.exec(rawStr)) !== null) {
          var parts = m2[1].split(',');
          var sec = parseFloat(parts[0]);
          if (!isFinite(sec) || !m2[2]) continue;
          var bt = simplifyText(decodeXmlText(m2[2]));
          items.push({ t: Math.round(sec * 100), text: bt, blocked: isBlockedText(bt) });
        }
      }
    }
  } catch (e) {
    return [];
  }
  // 去重: 可见弹幕合并(与 overlay 相同规则——屏蔽先于去重,overlay 不渲染
  // 被屏蔽弹幕所以不参与画面合并);被屏蔽弹幕按同一规则做展示层合并
  // (已屏蔽/全部视图里 2s 内重复的屏蔽弹幕显示为 草x5,而非逐条列出)。
  // 合并弹幕标记 merged(供 sidebar 切换"已合并"视图识别;blocked 合并项
  // 不标 merged——"已合并"视图只展示画面里的合并弹幕)。
  if (danmakuDedupeEnabled && danmakuDedupeWindow > 0) {
    var visible = [];
    var blockedItems = [];
    for (var di = 0; di < items.length; di++) {
      if (items[di].blocked) blockedItems.push(items[di]);
      else visible.push(items[di]);
    }
    var mergedOut = mergeDuplicateItems(visible, danmakuDedupeWindow * 100);
    for (var mi = 0; mi < mergedOut.length; mi++) {
      if (mergedOut[mi]._mergeCount > 1) {
        mergedOut[mi].merged = true;
      }
    }
    // 被屏蔽弹幕展示层合并(保持 blocked 标记;时间窗相同)
    var blockedMerged = mergeDuplicateItems(blockedItems, danmakuDedupeWindow * 100);
    items = blockedMerged.concat(mergedOut);
  }
  items.sort(function (a, b) { return a.t - b.t; });
  return items;
}

// 分块 + base64 投递。IINA 的 sidebar 桥把数据拼进 JS 模板字符串(String.raw`...`),
// 文本里出现 ${ 或反引号会让整条消息被 JS 异常静默丢弃;base64 字母表与之不相交。
function sendDanmakuBrowserData(items) {
  var CHUNK = 2000;
  var total = items.length;
  if (total === 0) {
    sidebar.postMessage("danmaku-browser-data", { payload: b64Encode('[]'), total: 0, chunkIndex: 0, done: true });
    return;
  }
  var n = Math.ceil(total / CHUNK);
  for (var c = 0; c < n; c++) {
    sidebar.postMessage("danmaku-browser-data", {
      payload: b64Encode(JSON.stringify(items.slice(c * CHUNK, (c + 1) * CHUNK))),
      total: total,
      chunkIndex: c,
      done: c === n - 1
    });
  }
}

// 播放时间推送(300ms 节流),sidebar 据此计算在屏弹幕窗口
function pushBrowserTime(timeSec) {
  var now = Date.now();
  if (now - lastBrowserTimeSent < 300) return;
  lastBrowserTimeSent = now;
  sidebar.postMessage("danmaku-visible-time", { time: timeSec, offset: danmakuTimeOffsetSec });
}

// 弹幕加载/切换/清空后,若 sidebar 正在监听则推送刷新列表
function notifyBrowserDataChanged() {
  if (!danmakuBrowserWatch) return;
  sendDanmakuBrowserData(buildDanmakuBrowserList());
}

// 向 overlay 重发当前弹幕(内容经 getEffectiveContent 单源处理)。
// 屏蔽词/简体等设置变化后调用,让渲染内容与 sidebar 列表同步更新。
function resendDanmakuToOverlay() {
  if (!overlayReady) return;
  var selectedPath = danmakuFileList.selectedPaths.length > 0 ? danmakuFileList.selectedPaths[0] : null;
  if (!selectedPath || !danmakuCache[selectedPath]) return;
  overlay.postMessage("load-danmaku", {
    xmlContent: getEffectiveContent(selectedPath),
    path: selectedPath,
    danmakuType: currentDanmakuStatus.fileType,
    opacity: canvasOpacity,
    canvasFontScale: canvasFontScale,
    strokeColor: strokeColor,
    strokeInversionColor: strokeInversionColor,
    strokeOpacity: strokeOpacity,
    strokeWidth: strokeWidth,
    commentLimit: commentLimit,
    scrollSpeed: scrollSpeed,
    danmakuTimeOffsetSec: danmakuTimeOffsetSec,
    danmakuFontFamily: danmakuFontFamily,
    danmakuFontWeight: danmakuFontWeight,
    preservePosition: true
  });
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
  if (!path) return { xmlFiles: [], jsonFiles: [], unknownFiles: [] };

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
      var fileInfo = {
        filename: fname,
        path: filePath,
        relativePath: relativePath,
        type: ext.toUpperCase()
      };

      if (isExactMatch) {
        if (ext === 'xml') exactXmlFiles.push(fileInfo); else exactJsonFiles.push(fileInfo);
      } else if (isPrefixMatch) {
        if (ext === 'xml') prefixXmlFiles.push(fileInfo); else prefixJsonFiles.push(fileInfo);
      } else if (videoEpNum !== null && fileEpNum !== null && fileEpNum === videoEpNum) {
        if (ext === 'xml') epNumXmlFiles.push(fileInfo); else epNumJsonFiles.push(fileInfo);
      }
      // Files that don't match the video (no episode number) are skipped entirely
    }
  }

  var xmlFiles = exactXmlFiles.concat(prefixXmlFiles).concat(epNumXmlFiles);
  var jsonFiles = exactJsonFiles.concat(prefixJsonFiles).concat(epNumJsonFiles);
  return { xmlFiles: xmlFiles, jsonFiles: jsonFiles, unknownFiles: [] };
}

function encodeContent(str) {
  return encodeURIComponent(str);
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
    withRelated: dandanplayWithRelated ? 'true' : 'false',
    chConvert: String(dandanplayChConvert)
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

function ddpConvertComments(ddpComments) {
  var list = new Array(ddpComments.length);
  var write = 0;
  for (var i = 0; i < ddpComments.length; i++) {
    var c = ddpComments[i];
    if (!c.p || !c.m) continue;
    var parts = c.p.split(',');
    if (parts.length < 3) continue;
    var timeSec = parseFloat(parts[0]);
    var mode = parseInt(parts[1]);
    var colorDec = parseInt(parts[2]);
    if (isNaN(timeSec) || isNaN(mode) || isNaN(colorDec)) continue;
    if (mode < 1 || mode > 6) continue;
    if (colorDec < 0) colorDec = (colorDec >>> 0) & 0xFFFFFF;
    var colorHex = '#' + colorDec.toString(16).padStart(6, '0');
    var commands = [];
    if (mode === 4) commands.push('shita');
    else if (mode === 5) commands.push('ue');
    else commands.push('naka');
    commands.push(colorHex);
    list[write++] = {
      t: Math.round(timeSec * 100),
      text: c.m,
      _isOwner: false,
      _commands: commands,
      _userId: parseInt(parts[3]) || 0,
      _dateSec: 1767196800
    };
  }
  list.length = write;
  return list;
}

function ensureCacheDir() {
  try {
    if (ddpCacheDirChecked && ddpCacheDirPath) return ddpCacheDirPath;
    var cacheDir = iina.utils.resolvePath('@data/danmaku-cache/');
    if (!cacheDir) return null;
    if (!file.exists(cacheDir)) {
      try {
        if (typeof file.mkdir === 'function') {
          file.mkdir(cacheDir);
        } else {
          var escaped = cacheDir.replace(/'/g, "'\\''");
          iina.utils.exec('/bin/sh', ['-c', 'mkdir -p ' + "'" + escaped + "'"]);
        }
      } catch (e2) {
        var escaped2 = cacheDir.replace(/'/g, "'\\''");
        iina.utils.exec('/bin/sh', ['-c', 'mkdir -p ' + "'" + escaped2 + "'"]);
      }
    }
    if (!file.exists(cacheDir)) return null;
    // Clean up old video-map.json from previous implementation
    var oldMap = cacheDir + '/video-map.json';
    if (file.exists(oldMap)) {
      try { file.delete(oldMap); } catch(e) {}
    }
    ddpCacheDirPath = cacheDir;
    ddpCacheDirChecked = true;
    return cacheDir;
  } catch (e) {
    return null;
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
  if (!videoPath || !episodeId) return;
  try {
    ensureCacheDir();
    var f = ddpCacheFile(videoPath);
    if (!f) return;
    file.write(f, JSON.stringify({
      episodeId: episodeId,
      animeTitle: animeTitle || '',
      episodeTitle: episodeTitle || '',
      cachedAt: Date.now(),
      comments: comments || []
    }));
  } catch (e) {
    console.log('[ddp] saveVideoCache error: ' + e);
  }
}

function ddpReadVideoCache(videoPath) {
  if (!videoPath) return null;
  try {
    ensureCacheDir();
    var f = ddpCacheFile(videoPath);
    if (!f || !file.exists(f)) return null;
    var content = file.read(f);
    if (!content) return null;
    var data = JSON.parse(content);
    var age = Date.now() - (data.cachedAt || 0);
    if (age >= 24 * 60 * 60 * 1000) return null;
    return data;
  } catch (e) {
    console.log('[ddp] readVideoCache error: ' + e);
    return null;
  }
}

function ddpSyncState() {
  sidebar.postMessage("dandanplay-status", {
    status: dandanplayState.status,
    animeTitle: sanitizeIPCString(dandanplayState.animeTitle),
    episodeTitle: sanitizeIPCString(dandanplayState.episodeTitle),
    episodeId: dandanplayState.episodeId,
    commentCount: dandanplayState.commentCount,
    error: sanitizeIPCString(dandanplayState.error),
    matches: sanitizeMatches(dandanplayState.matches),
    autoNetwork: dandanplayAutoNetwork,
    matchType: dandanplayState.matchType
  });
}

function sanitizeMatches(matches) {
  if (!matches) return null;
  var result = new Array(matches.length);
  for (var i = 0; i < matches.length; i++) {
    var match = matches[i] || {};
    result[i] = {
      animeId: match.animeId,
      animeTitle: sanitizeIPCString(match.animeTitle),
      episodeId: match.episodeId,
      episodeTitle: sanitizeIPCString(match.episodeTitle),
      type: match.type,
      typeDescription: match.typeDescription,
      shift: match.shift
    };
  }
  return result;
}

function ddpResetState() {
  dandanplayState = {
    status: 'idle',
    animeTitle: '',
    episodeTitle: '',
    episodeId: null,
    commentCount: 0,
    error: '',
    matches: null,
    matchType: ''
  };
  ddpSyncState();
}

function ddpAutoMatchAndLoad(url) {
  var path = filePathFromUrl(url);
  var fileName;
  if (path) {
    fileName = path.replace(/.*[/\\]/, '');
  } else {
    try { fileName = decodeURIComponent(url.replace(/.*[/\\]/, '').replace(/[?#].*/, '')); } catch (e) { fileName = url; }
  }
  if (!fileName) return;

  dandanplayState = {
    status: 'matching',
    animeTitle: '',
    episodeTitle: '',
    episodeId: null,
    commentCount: 0,
    error: '',
    matches: null,
    matchType: ''
  };
  ddpSyncState();

  ddpMatchVideo(fileName, path).then(function(res) {
    if (url !== currentVideoUrl) return;
    var data = ddpParseBody(res);
    if (res.statusCode === 403) {
      dandanplayState.status = 'error';
      dandanplayState.error = 'Auth error (403): ' + (res.reason || 'check AppId/AppSecret');
      ddpSyncState();
      return;
    }
    if (!data) {
      dandanplayState.status = 'error';
      dandanplayState.error = 'API response error (status=' + res.statusCode + ', text=' + (res.text ? res.text.substring(0, 100) : 'empty') + ')';
      ddpSyncState();
      return;
    }
    if (data.success === false) {
      dandanplayState.status = 'error';
      dandanplayState.error = data.errorMessage || 'API error';
      ddpSyncState();
      return;
    }
    if (!data.matches || data.matches.length === 0) {
      dandanplayState.status = 'no-match';
      dandanplayState.error = 'No match found';
      ddpSyncState();
      core.osd(t('ddp_no_match'));
      return;
    }

    dandanplayState.matches = JSON.parse(JSON.stringify(data.matches));

    if (data.isMatched) {
      var match = data.matches[0];
      var forceLoad = dandanplayAutoNetwork;
      dandanplayState.matchType = 'hash';
      ddpLoadComments(match.episodeId, match.animeTitle, match.episodeTitle, forceLoad);
    } else {
      ddpSyncState();
      ddpFallbackToLocal();
    }
  }).catch(function(err) {
    dandanplayState.status = 'error';
    dandanplayState.error = ddpErrStr(err);
    ddpSyncState();
    core.osd(t('ddp_network_error'));
    ddpFallbackToLocal();
  });
}

function ddpAddToFileListAndLoad(episodeId, animeTitle, episodeTitle, converted, forceLoad) {
  var virtualPath = 'dandanplay://' + episodeId;
  var displayName = sanitizeIPCString((animeTitle || 'DanDanPlay') + ' - ' + (episodeTitle || '') + ' 🌐');
  danmakuCache[virtualPath] = encodeContent(JSON.stringify(converted));

  var alreadyExists = !!findDanmakuFileByPath(virtualPath);
  if (!alreadyExists) {
    danmakuFileList.jsonFiles.push({
      path: virtualPath,
      filename: displayName,
      relativePath: 'DanDanPlay #' + episodeId,
      type: 'DDP'
    });
  }

  var shouldAutoLoad = forceLoad;

  if (shouldAutoLoad) {
    danmakuFileList.selectedPaths = [virtualPath];
    updateDanmakuStatus({ fileType: 'dandanplay', fileName: displayName, relativePath: 'DanDanPlay #' + episodeId, isLoaded: true });
    nicoJsonTotalCount = 0;
    danmakuFilterOffset = 0;
    danmakuFilterLimit = 0;
    danmakuFilterDensity = 0;
    sidebar.postMessage("danmaku-file-list", danmakuFileList);
    sendDanmakuFilterInfo();
    notifyBrowserDataChanged();

    var payload = {
      xmlContent: getEffectiveContent(virtualPath),
      path: virtualPath,
      danmakuType: 'dandanplay',
      opacity: canvasOpacity,
      canvasFontScale: canvasFontScale,
      strokeColor: strokeColor,
      strokeInversionColor: strokeInversionColor,
      strokeOpacity: strokeOpacity,
      strokeWidth: strokeWidth,
      commentLimit: commentLimit,
      scrollSpeed: scrollSpeed,
      preservePosition: true,
    };
    if (overlayReady) {
      overlay.postMessage("load-danmaku", payload);
      core.osd(t('network_loaded') + displayName);
      ensureDanmakuEnabled();
    } else {
      pendingDanmaku = payload;
    }
  } else {
    sidebar.postMessage("danmaku-file-list", danmakuFileList);
  }
}

function ddpLoadComments(episodeId, animeTitle, episodeTitle, forceLoad) {
  var videoUrl = currentVideoUrl;
  dandanplayState.status = 'loading';
  dandanplayState.episodeId = episodeId;
  dandanplayState.animeTitle = animeTitle || '';
  dandanplayState.episodeTitle = episodeTitle || '';
  ddpSyncState();

  ddpGetComments(episodeId).then(function(res) {
    if (videoUrl !== currentVideoUrl) return;
    if (res.statusCode === 403) {
      dandanplayState.status = 'error';
      dandanplayState.error = 'Auth error (403): ' + (res.reason || 'check AppId/AppSecret');
      ddpSyncState();
      return;
    }
    var data = ddpParseBody(res);
    if (!data) {
      dandanplayState.status = 'error';
      dandanplayState.error = 'API response error';
      ddpSyncState();
      core.osd(t('ddp_api_error'));
      ddpFallbackToLocal();
      return;
    }
    if (!data.comments || data.comments.length === 0) {
      dandanplayState.status = 'error';
      dandanplayState.error = 'No comments available';
      ddpSyncState();
      core.osd(t('ddp_no_comments'));
      ddpFallbackToLocal();
      return;
    }

    var converted = ddpConvertComments(data.comments);

    ddpSaveVideoCache(videoUrl, episodeId, animeTitle, episodeTitle, converted);

    dandanplayState.status = 'loaded';
    dandanplayState.commentCount = converted.length;
    ddpSyncState();
    ddpAddToFileListAndLoad(episodeId, animeTitle, episodeTitle, converted, forceLoad);
  }).catch(function(err) {
    dandanplayState.status = 'error';
    dandanplayState.error = ddpErrStr(err);
    ddpSyncState();
    core.osd(t('ddp_load_failed'));
    ddpFallbackToLocal();
  });
}

function ddpFallbackToLocal() {
  if (!dandanplayAutoNetwork) return;
  if (currentDanmakuStatus.isLoaded) return;
  var groups = [danmakuFileList.xmlFiles, danmakuFileList.jsonFiles];
  for (var g = 0; g < groups.length; g++) {
    var files = groups[g] || [];
    for (var i = 0; i < files.length; i++) {
      if (files[i].type !== 'DDP') {
        loadLocalDanmaku(files[i]);
        return;
      }
    }
  }
}

function addDDPToFileList(episodeId, animeTitle, episodeTitle, comments) {
  var virtualPath = 'dandanplay://' + episodeId;
  var displayName = sanitizeIPCString((animeTitle || 'DanDanPlay') + ' - ' + (episodeTitle || '') + ' 🌐');
  if (findDanmakuFileByPath(virtualPath)) return;
  danmakuCache[virtualPath] = encodeContent(JSON.stringify(comments));
  danmakuFileList.jsonFiles.push({
    path: virtualPath,
    filename: displayName,
    relativePath: 'DanDanPlay #' + episodeId,
    type: 'DDP'
  });
}

function loadDanmakuForVideo(url) {
  danmakuCache = {};
  currentVideoUrl = url;
  ddpResetState();
  currentDanmakuStatus = { fileType: null, fileName: null, relativePath: null, isLoaded: false };
  nicoJsonTotalCount = 0;
  danmakuFilterOffset = 0;
  danmakuFilterLimit = 0;
  danmakuFilterDensity = 0;

  if (core.status.isNetworkResource) {
    core.osd(t('network_skip_local'));
    danmakuNotFound();
    danmakuFileList = { xmlFiles: [], jsonFiles: [], unknownFiles: [], selectedPaths: [] };
    sidebar.postMessage("danmaku-file-list", danmakuFileList);
    sendDanmakuFilterInfo();
    notifyBrowserDataChanged();
    if (overlayReady) overlay.postMessage("clear-danmaku", {});
    if (dandanplayAutoNetwork) ddpAutoMatchAndLoad(url);
    return;
  }

  // === Step 1: Build complete file list (local + cached DDP) ===
  var discovered = findDanmakuByEpisode(url);
  var allLocalFiles = discovered.xmlFiles.concat(discovered.jsonFiles);
  var hasLocal = allLocalFiles.length > 0;

  danmakuFileList = {
    xmlFiles: discovered.xmlFiles,
    jsonFiles: discovered.jsonFiles,
    unknownFiles: discovered.unknownFiles,
    selectedPaths: []
  };

  var ddpCached = ddpReadVideoCache(url);
  var hasDDPCache = ddpCached && ddpCached.comments && ddpCached.comments.length > 0;
  if (hasDDPCache) {
    addDDPToFileList(ddpCached.episodeId, ddpCached.animeTitle, ddpCached.episodeTitle, ddpCached.comments);
  }

  // === Step 2: Send file list (all available sources, regardless of priority) ===
  sidebar.postMessage("danmaku-file-list", danmakuFileList);
  sendDanmakuFilterInfo();
  notifyBrowserDataChanged();

  // === Step 3: Auto-load to overlay based on autoNetwork setting ===
  if (dandanplayAutoNetwork) {
    // network-first: 缓存新鲜(24h TTL 内)时只用缓存,完全跳过后台自动匹配
    // (不重算 hash、不发 API)。缓存刷新发生在 TTL 过期后,
    // 或用户在「网络弹幕」面板手动触发匹配时(dandanplay-trigger-match)
    if (hasDDPCache) {
      ddpAddToFileListAndLoad(ddpCached.episodeId, ddpCached.animeTitle, ddpCached.episodeTitle, ddpCached.comments, true);
    } else {
      // Don't pre-load local file — wait for DDP auto-match result
      if (overlayReady) overlay.postMessage("clear-danmaku", {});
      ddpAutoMatchAndLoad(url);
    }
  } else {
    // local-first: prefer local files, fallback to DDP cache as last resort
    if (hasLocal) {
      loadLocalDanmaku(allLocalFiles[0]);
    } else if (hasDDPCache) {
      // 同上:缓存新鲜时跳过后台匹配
      ddpAddToFileListAndLoad(ddpCached.episodeId, ddpCached.animeTitle, ddpCached.episodeTitle, ddpCached.comments, true);
    } else {
      if (overlayReady) overlay.postMessage("clear-danmaku", {});
      danmakuNotFound();
    }
  }

  // Re-send file list after a tick to catch up sidebar WebView that might
  // have been suspended during video switch (IINA drops messages otherwise)
  setTimeout(function() {
    sidebar.postMessage("danmaku-file-list", danmakuFileList);
  }, 0);
}

function loadLocalDanmaku(fileInfo) {
  danmakuFileList.selectedPaths = [fileInfo.path];

  var xmlContent = file.read(fileInfo.path);
  if (!xmlContent) {
    core.osd(t('read_failed_name') + fileInfo.filename);
    console.log('[loadLocalDanmaku] FAILED to read file: ' + fileInfo.path);
    danmakuNotFound();
    return;
  }

  var fileType = detectDanmakuType(xmlContent);
  var contentToSend = xmlContent;
  if (fileType === 'dandanplay') {
    try {
      var obj = JSON.parse(xmlContent);
      if (obj.comments) {
        contentToSend = JSON.stringify(obj.comments);
      }
    } catch (e) {}
  }

  var encodedContent = encodeContent(contentToSend);
  danmakuCache[fileInfo.path] = encodedContent;

  if (fileType === 'nico-json') {
    nicoJsonTotalCount = computeNicoJsonCount(encodedContent);
  } else {
    nicoJsonTotalCount = 0;
  }
  danmakuFilterOffset = 0;
  danmakuFilterLimit = 0;
  danmakuFilterDensity = 0;

  updateDanmakuStatus({ fileType: fileType, fileName: fileInfo.filename, relativePath: fileInfo.relativePath, isLoaded: true });

  sidebar.postMessage("danmaku-file-list", danmakuFileList);
  sendDanmakuFilterInfo();
  notifyBrowserDataChanged();

  var payload = {
    xmlContent: getEffectiveContent(fileInfo.path),
    path: fileInfo.path,
    danmakuType: fileType,
    opacity: canvasOpacity,
    canvasFontScale: canvasFontScale,
    strokeColor: strokeColor,
    strokeInversionColor: strokeInversionColor,
    strokeOpacity: strokeOpacity,
    strokeWidth: strokeWidth,
    commentLimit: commentLimit,
    scrollSpeed: scrollSpeed,
    preservePosition: true,
  };

  if (overlayReady) {
    overlay.postMessage("load-danmaku", payload);
    core.osd(t('loaded') + fileInfo.filename);
    setObserver(true);
  } else {
    pendingDanmaku = payload;
    core.osd(t('queued'));
  }
}

function markOverlayReady() {
  if (overlayReady) return;
  overlayReady = true;
  overlay.show();
  overlay.postMessage("ack", {});

  overlay.postMessage("apply-settings", {
    opacity: canvasOpacity,
    canvasFontScale: canvasFontScale,
    canvasMode: currentCanvasMode,
    strokeColor: strokeColor,
    strokeInversionColor: strokeInversionColor,
    strokeOpacity: strokeOpacity,
    strokeWidth: strokeWidth,
    commentLimit: commentLimit,
    scrollSpeed: scrollSpeed,
    danmakuTimeOffsetSec: danmakuTimeOffsetSec,
    danmakuFontFamily: danmakuFontFamily,
    danmakuFontWeight: danmakuFontWeight,
    danmakuForceSimplified: danmakuForceSimplified
  });

  if (pendingDanmaku) {
    overlay.postMessage("load-danmaku", pendingDanmaku);
    var pendingPath = danmakuFileList.selectedPaths.length > 0 ? danmakuFileList.selectedPaths[0] : "";
    var pendingInfo = pendingPath ? findDanmakuFileByPath(pendingPath) : null;
    var loadedName = pendingInfo ? pendingInfo.filename : (pendingPath ? pendingPath.split("/").pop() : "");
    core.osd(t('loaded') + loadedName);
    pendingDanmaku = null;
    setObserver(true);
  } else if (danmakuEnabled && !core.status.idle && currentVideoUrl) {
    loadDanmakuForVideo(currentVideoUrl);
  } else if (danmakuEnabled && !core.status.idle && core.status.url) {
    loadDanmakuForVideo(core.status.url);
  }
}

function setObserver(start) {
  if (timePosListenerID) { event.off("mpv.time-pos.changed", timePosListenerID); timePosListenerID = null; }
  if (windowScaleListenerID) { event.off("mpv.window-scale.changed", windowScaleListenerID); windowScaleListenerID = null; }
  if (speedListenerID) { event.off("mpv.speed.changed", speedListenerID); speedListenerID = null; }

  if (start && overlayReady && danmakuEnabled) {
    timePosListenerID = event.on("mpv.time-pos.changed", function (t) {
      overlay.postMessage("time-update", { time: t });
      if (danmakuBrowserWatch) pushBrowserTime(t);
    });
    windowScaleListenerID = event.on("mpv.window-scale.changed", function () {
      overlay.postMessage("resize", {});
    });
    speedListenerID = event.on("mpv.speed.changed", function (speed) {
      currentPlaybackSpeed = speed;
      overlay.postMessage("playback-speed", { speed: speed });
    });
    var t = mpv.getNumber("time-pos");
    if (t !== undefined && t !== null) overlay.postMessage("time-update", { time: t });
    var speed = mpv.getNumber("speed");
    if (speed !== undefined && speed !== null) {
      currentPlaybackSpeed = speed;
      overlay.postMessage("playback-speed", { speed: speed });
    }
    overlay.postMessage("resize", {});
  }
}

function toggleDanmaku() {
  danmakuEnabled = !danmakuEnabled;
  preferences.set("danmakuEnabled", danmakuEnabled);
  syncPreferencesSoon();
  overlay.postMessage("toggle-danmaku", { enabled: danmakuEnabled });
  if (danmakuEnabled) { overlay.show(); setObserver(true); core.osd(t('danmaku_on')); }
  else { setObserver(false); core.osd(t('danmaku_off')); }
  sidebar.postMessage("danmaku-state", { enabled: danmakuEnabled, canvasMode: currentCanvasMode });
}

function ensureDanmakuEnabled() {
  if (danmakuEnabled) return;
  danmakuEnabled = true;
  preferences.set("danmakuEnabled", true);
  syncPreferencesSoon();
  overlay.postMessage("toggle-danmaku", { enabled: true });
  overlay.show();
  setObserver(true);
  sidebar.postMessage("danmaku-state", { enabled: true, canvasMode: currentCanvasMode });
}

function loadManualDanmakuFile(path) {
  if (!path) { core.osd(t('no_file_selected')); return; }
  var xmlContent = file.read(path);
  if (!xmlContent) { core.osd(t('read_failed')); return; }
  var encodedContent = encodeContent(xmlContent);
  danmakuCache[path] = encodedContent; // 必须存缓存: getEffectiveContent 从这里取内容
  var manualFileName = path.split("/").pop();
  var manualFileType = detectDanmakuType(xmlContent);
  updateDanmakuStatus({ fileType: manualFileType, fileName: manualFileName, relativePath: manualFileName, isLoaded: true });

  if (manualFileType === 'nico-json') {
    nicoJsonTotalCount = computeNicoJsonCount(encodedContent);
  } else {
    nicoJsonTotalCount = 0;
  }
  danmakuFilterOffset = 0;
  danmakuFilterLimit = 0;
  danmakuFilterDensity = 0;
  sendDanmakuFilterInfo();
  notifyBrowserDataChanged();

  var manualPayload = {
    xmlContent: getEffectiveContent(path),
    path: path,
    danmakuType: manualFileType,
    opacity: canvasOpacity,
    canvasFontScale: canvasFontScale,
    strokeColor: strokeColor,
    strokeInversionColor: strokeInversionColor,
    strokeOpacity: strokeOpacity,
    strokeWidth: strokeWidth,
    commentLimit: commentLimit,
    scrollSpeed: scrollSpeed,
    preservePosition: true,
  };

  if (overlayReady) {
    overlay.postMessage("load-danmaku", manualPayload);
    core.osd(t('loaded') + manualFileName);
    ensureDanmakuEnabled();
  } else {
    pendingDanmaku = manualPayload;
    core.osd(t('queued'));
  }
}

function registerSidebarHandlers() {
  sidebar.onMessage("toggle-danmaku", function () { toggleDanmaku(); });

  sidebar.onMessage("set-opacity", function (data) {
    canvasOpacity = data.opacity;
    preferences.set("danmakuCanvasOpacity", canvasOpacity);
    syncPreferencesSoon();
    overlay.postMessage("set-opacity", { opacity: data.opacity });
  });

  sidebar.onMessage("set-fontscale", function (data) {
    canvasFontScale = data.scale;
    preferences.set("niconicommentsFontScale", canvasFontScale);
    syncPreferencesSoon();
    overlay.postMessage("set-fontscale", { scale: data.scale });
  });

  sidebar.onMessage("set-canvas-mode", function (data) {
    currentCanvasMode = data.mode;
    preferences.set("canvasMode", currentCanvasMode);
    syncPreferencesSoon();
    overlay.postMessage("set-canvas-mode", { mode: data.mode });
  });

  sidebar.onMessage("set-danmaku-force-simplified", function (data) {
    // 更新 main.js 内部的全局变量
    danmakuForceSimplified = !!data.value;

    // 将此偏好持久化同步到 IINA 系统配置中
    preferences.set("danmakuForceSimplified", danmakuForceSimplified);
    syncPreferencesSoon();

    // 当前已加载弹幕时重新驱动加载管道（内容经 getEffectiveContent 单源转换）
    // nico-json 只可能是日语弹幕，繁简转换对其无意义（getEffectiveContent 也不转换该格式），跳过重建
    if (currentDanmakuStatus.fileType !== 'nico-json') {
      resendDanmakuToOverlay();
    }
    // 过滤 tab 列表与 overlay 同源: 简体开关变化 → 重新构建并推送
    notifyBrowserDataChanged();
  });

  sidebar.onMessage("set-stroke-opacity", function (data) {
    strokeOpacity = data.opacity;
    preferences.set("strokeOpacity", strokeOpacity);
    syncPreferencesSoon();
    overlay.postMessage("set-stroke-opacity", { opacity: data.opacity });
  });

  sidebar.onMessage("set-stroke-width", function (data) {
    strokeWidth = data.width;
    preferences.set("strokeWidth", strokeWidth);
    syncPreferencesSoon();
    overlay.postMessage("set-stroke-width", { width: data.width });
  });

  sidebar.onMessage("set-stroke-color", function (data) {
    strokeColor = data.color;
    preferences.set("strokeColor", strokeColor);
    syncPreferencesSoon();
    overlay.postMessage("set-stroke-color", { color: data.color });
  });

  sidebar.onMessage("set-stroke-inversion-color", function (data) {
    strokeInversionColor = data.color;
    preferences.set("strokeInversionColor", strokeInversionColor);
    syncPreferencesSoon();
    overlay.postMessage("set-stroke-inversion-color", { color: data.color });
  });

  sidebar.onMessage("set-comment-limit", function (data) {
    commentLimit = data.limit;
    preferences.set("commentLimit", commentLimit);
    syncPreferencesSoon();
    overlay.postMessage("set-comment-limit", { limit: data.limit });
  });

  sidebar.onMessage("set-scroll-speed", function (data) {
    scrollSpeed = data.speed;
    preferences.set("scrollSpeed", scrollSpeed);
    syncPreferencesSoon();
    overlay.postMessage("set-scroll-speed", { speed: data.speed });
  });

  sidebar.onMessage("set-danmaku-offset", function (data) {
    applyDanmakuOffset(data.offset);
  });

  sidebar.onMessage("set-danmaku-font", function (data) {
    applyDanmakuFont(data.fontFamily, data.fontWeight);
  });

  sidebar.onMessage("set-style-preset", function (data) {
    stylePreset = data.preset || "nico";
    preferences.set("stylePreset", stylePreset);
    syncPreferencesSoon();
  });

  sidebar.onMessage("adjust-danmaku-offset", function (data) {
    var delta = parseFloat(data.delta);
    if (isNaN(delta)) delta = 0;
    applyDanmakuOffset((danmakuTimeOffsetSec || 0) + delta);
  });

  sidebar.onMessage("set-danmaku-filter", function (data) {
    applyDanmakuFilter(data.offset || 0, data.limit);
    notifyBrowserDataChanged(); // 范围切片变化 → 列表与 overlay 同步重建
  });

  sidebar.onMessage("set-danmaku-filter-density", function (data) {
    applyDanmakuFilterDensity(data.density || 0);
    notifyBrowserDataChanged(); // 密度过滤变化 → 列表与 overlay 同步重建
  });

  // ── 屏蔽词 ──
  sidebar.onMessage("danmaku-blocklist-request", function () {
    sidebar.postMessage("danmaku-blocklist-state", { enabled: danmakuBlocklistEnabled, words: danmakuBlocklist.slice() });
  });

  sidebar.onMessage("danmaku-blocklist-set-enabled", function (data) {
    danmakuBlocklistEnabled = !!data.enabled;
    preferences.set("danmakuBlocklistEnabled", danmakuBlocklistEnabled);
    syncPreferencesSoon();
    notifyBrowserDataChanged();
    resendDanmakuToOverlay();
    sidebar.postMessage("danmaku-blocklist-state", { enabled: danmakuBlocklistEnabled, words: danmakuBlocklist.slice() });
  });

  sidebar.onMessage("danmaku-blocklist-add", function (data) {
    var w = String(data.word || '').trim();
    if (!w) return;
    if (danmakuBlocklist.indexOf(w) === -1) danmakuBlocklist.push(w);
    preferences.set("danmakuBlocklist", JSON.stringify(danmakuBlocklist));
    syncPreferencesSoon();
    rebuildBlockRegexes();
    notifyBrowserDataChanged();
    resendDanmakuToOverlay();
    sidebar.postMessage("danmaku-blocklist-state", { enabled: danmakuBlocklistEnabled, words: danmakuBlocklist.slice() });
  });

  sidebar.onMessage("danmaku-blocklist-remove", function (data) {
    var idx = parseInt(data.index, 10);
    if (isNaN(idx) || idx < 0 || idx >= danmakuBlocklist.length) return;
    danmakuBlocklist.splice(idx, 1);
    preferences.set("danmakuBlocklist", JSON.stringify(danmakuBlocklist));
    syncPreferencesSoon();
    rebuildBlockRegexes();
    notifyBrowserDataChanged();
    resendDanmakuToOverlay();
    sidebar.postMessage("danmaku-blocklist-state", { enabled: danmakuBlocklistEnabled, words: danmakuBlocklist.slice() });
  });

  // ── 弹幕去重 ──
  sidebar.onMessage("danmaku-dedupe-request", function () {
    sidebar.postMessage("danmaku-dedupe-state", { enabled: danmakuDedupeEnabled, window: danmakuDedupeWindow });
  });

  // 点击列表时间戳 → 跳转到该弹幕时间(弹幕 vpos 换算为视频秒,考虑弹幕偏移)
  sidebar.onMessage("danmaku-seek", function (data) {
    if (!data || typeof data.vpos !== 'number' || !isFinite(data.vpos)) return;
    var sec = data.vpos / 100 - (danmakuTimeOffsetSec || 0);
    if (sec < 0) sec = 0;
    try {
      core.seekTo(sec); // seekTo 是 core 对象的方法(core.player 不存在)
    } catch (e) {
      debugLog('danmaku-seek failed: ' + e);
    }
  });

  sidebar.onMessage("danmaku-dedupe-set", function (data) {
    if (data.enabled !== undefined) danmakuDedupeEnabled = !!data.enabled;
    if (data.window !== undefined) {
      var w = parseFloat(data.window);
      if (isFinite(w) && w >= 1 && w <= 5) danmakuDedupeWindow = w;
    }
    preferences.set("danmakuDedupeEnabled", danmakuDedupeEnabled);
    preferences.set("danmakuDedupeWindow", danmakuDedupeWindow);
    syncPreferencesSoon();
    notifyBrowserDataChanged();
    resendDanmakuToOverlay();
    sidebar.postMessage("danmaku-dedupe-state", { enabled: danmakuDedupeEnabled, window: danmakuDedupeWindow });
  });

  sidebar.onMessage("request-state", function () {
    // Rebuild file list from scratch — sidebar WebView might have been
    // suspended/resumed while video changed, leaving danmakuFileList stale
    if (currentVideoUrl && !core.status.isNetworkResource) {
      var discovered = findDanmakuByEpisode(currentVideoUrl);
      danmakuFileList = {
        xmlFiles: discovered.xmlFiles,
        jsonFiles: discovered.jsonFiles,
        unknownFiles: discovered.unknownFiles,
        selectedPaths: danmakuFileList.selectedPaths || []
      };
      var cached = ddpReadVideoCache(currentVideoUrl);
      if (cached && cached.comments && cached.comments.length > 0) {
        addDDPToFileList(cached.episodeId, cached.animeTitle, cached.episodeTitle, cached.comments);
      }
    }
    sidebar.postMessage("danmaku-state", {
      enabled: danmakuEnabled,
      canvasMode: currentCanvasMode,
      canvasOpacity: canvasOpacity,
      canvasFontScale: canvasFontScale,
      strokeOpacity: strokeOpacity,
      strokeWidth: strokeWidth,
      strokeColor: strokeColor,
      strokeInversionColor: strokeInversionColor,
      commentLimit: commentLimit,
      scrollSpeed: scrollSpeed,
      danmakuTimeOffsetSec: danmakuTimeOffsetSec,
      danmakuFontFamily: danmakuFontFamily,
      danmakuFontWeight: danmakuFontWeight,
      stylePreset: stylePreset,
      danmakuForceSimplified: danmakuForceSimplified,
      danmakuFileType: currentDanmakuStatus.fileType,
      danmakuFileName: currentDanmakuStatus.fileName,
      danmakuRelativePath: currentDanmakuStatus.relativePath,
      danmakuLoaded: currentDanmakuStatus.isLoaded,
      danmakuFilterDensity: danmakuFilterDensity,
    });
    sidebar.postMessage("danmaku-file-list", danmakuFileList);
    sendDanmakuFilterInfo();
    ddpSyncState();
  });

  sidebar.onMessage("sidebar-log", function (data) {
    console.log('[sidebar] ' + data.msg);
  });

  sidebar.onMessage("manual-load-danmaku", function () {
    iina.utils.chooseFile(t('choose_file_title'), { allowedFileTypes: ["json", "xml"] }).then(function(path) {
      loadManualDanmakuFile(path);
    });
  });

  // 加载选中弹幕文件(danmaku-file-add 添加后也会自动调用——添加即显示)
  function selectDanmakuFile(filePath) {
    if (!filePath) return;

    var encodedContent = danmakuCache[filePath];
    if (!encodedContent && filePath.indexOf('dandanplay://') === 0) {
      // Reconstruct from disk cache for DDP virtual paths
      var cached = ddpReadVideoCache(currentVideoUrl);
      if (cached && cached.comments && cached.comments.length > 0) {
        encodedContent = encodeContent(JSON.stringify(cached.comments));
        danmakuCache[filePath] = encodedContent;
      }
    }
    if (!encodedContent && filePath.indexOf('dandanplay://') !== 0) {
      var rawContent = file.read(filePath);
      if (!rawContent) {
        core.osd(t('read_failed_name') + filePath.split("/").pop());
        return;
      }
      encodedContent = encodeContent(rawContent);
      danmakuCache[filePath] = encodedContent;
    }

    if (!encodedContent) {
      core.osd(t('content_unavailable'));
      return;
    }

    danmakuFileList.selectedPaths = [filePath];

    var fileName = filePath.indexOf('dandanplay://') === 0 ? filePath : filePath.split("/").pop();
    var fileInfo = findDanmakuFileByPath(filePath);
    var relPath = fileInfo ? fileInfo.relativePath : fileName;
    var fileType;
    if (filePath.indexOf('dandanplay://') === 0) {
      fileType = 'dandanplay';
    } else {
      var decodedForType;
      try { decodedForType = decodeURIComponent(encodedContent); } catch (e) { decodedForType = ''; }
      fileType = detectDanmakuType(decodedForType);
    }
    updateDanmakuStatus({ fileType: fileType, fileName: fileInfo ? fileInfo.filename : fileName, relativePath: relPath, isLoaded: true });

    if (fileType === 'nico-json') {
      nicoJsonTotalCount = computeNicoJsonCount(encodedContent);
    } else {
      nicoJsonTotalCount = 0;
    }
    danmakuFilterOffset = 0;
    danmakuFilterLimit = 0;
    danmakuFilterDensity = 0;

    sidebar.postMessage("danmaku-file-list", danmakuFileList);
    sendDanmakuFilterInfo();
    notifyBrowserDataChanged();

    var selectPayload = {
      xmlContent: getEffectiveContent(filePath),
      path: filePath,
      danmakuType: fileType,
      opacity: canvasOpacity,
      canvasFontScale: canvasFontScale,
      strokeColor: strokeColor,
      strokeInversionColor: strokeInversionColor,
      strokeOpacity: strokeOpacity,
      strokeWidth: strokeWidth,
      commentLimit: commentLimit,
      scrollSpeed: scrollSpeed,
      preservePosition: true,
    };

    overlay.postMessage("load-danmaku", selectPayload);
    core.osd(t('loaded') + (fileInfo ? fileInfo.filename : fileName));
    ensureDanmakuEnabled();
  }

  sidebar.onMessage("select-danmaku-file", function (data) {
    if (data && data.path) selectDanmakuFile(data.path);
  });

  sidebar.onMessage("danmaku-file-add", function () {
    iina.utils.chooseFile(t('choose_file_title'), { allowedFileTypes: ["json", "xml"] }).then(function(path) {
      if (!path) return;

      if (findDanmakuFileByPath(path)) { core.osd(t('file_already_in_list')); return; }

      var fname = path.split("/").pop();
      var ext = fname.lastIndexOf('.') >= 0 ? fname.substring(fname.lastIndexOf('.') + 1).toLowerCase() : '';
      var videoFilePath = currentVideoUrl ? filePathFromUrl(currentVideoUrl) : null;
      var videoDir = videoFilePath ? videoFilePath.replace(/[/\\][^/\\]+$/, '') : '';
      var relativePath = path;
      if (videoDir && path.startsWith(videoDir + "/")) relativePath = path.substring(videoDir.length + 1);

      var fileInfo = { filename: fname, path: path, relativePath: relativePath, type: ext.toUpperCase() };

      if (ext === 'xml') danmakuFileList.xmlFiles.push(fileInfo);
      else if (ext === 'json') danmakuFileList.jsonFiles.push(fileInfo);

      danmakuFileList.selectedPaths = [];

      var content = file.read(path);
      if (content) {
        danmakuCache[path] = encodeContent(content);
        selectDanmakuFile(path); // 添加即加载: 不用再在列表里手动点选
        core.osd(t('loaded') + fname);
      } else {
        core.osd(t('read_failed_name') + fname);
        sidebar.postMessage("danmaku-file-error", { path: path, message: t('read_failed') });
      }

      sidebar.postMessage("danmaku-file-list", danmakuFileList);
    });
  });

  sidebar.onMessage("dandanplay-set-auto-network", function (data) {
    dandanplayAutoNetwork = !!data.autoNetwork;
    preferences.set("dandanplayAutoNetwork", dandanplayAutoNetwork);
    syncPreferencesSoon();
    ddpSyncState();
  });

  sidebar.onMessage("dandanplay-search", function (data) {
    var keyword = data.keyword;
    if (!keyword) return;
    ddpSearchAnime(keyword).then(function(res) {
      var result = ddpParseBody(res);
      if (!result || !result.animes || result.animes.length === 0) {
        sidebar.postMessage("dandanplay-search-result", { animes: [], error: 'No results found' });
        return;
      }
      for (var i = 0; i < result.animes.length; i++) {
        if (result.animes[i].animeTitle) result.animes[i].animeTitle = sanitizeIPCString(result.animes[i].animeTitle);
      }
      sidebar.postMessage("dandanplay-search-result", { animes: result.animes, error: null });
    }).catch(function(err) {
      console.log('[search] API error: ' + ddpErrStr(err));
      sidebar.postMessage("dandanplay-search-result", { animes: [], error: ddpErrStr(err) });
    });
  });

  sidebar.onMessage("dandanplay-get-bangumi", function (data) {
    var bangumiId = data.bangumiId;
    var animeTitle = data.animeTitle;
    ddpGetBangumi(bangumiId).then(function(res) {
      var result = ddpParseBody(res);
      if (!result || !result.bangumi) {
        sidebar.postMessage("dandanplay-bangumi-result", { animeTitle: animeTitle, episodes: [], error: 'Parse error' });
        return;
      }
      var episodes = result.bangumi.episodes || [];
      for (var i = 0; i < episodes.length; i++) {
        if (episodes[i].episodeTitle) episodes[i].episodeTitle = sanitizeIPCString(episodes[i].episodeTitle);
      }
      sidebar.postMessage("dandanplay-bangumi-result", { animeTitle: animeTitle, episodes: episodes });
    }).catch(function(err) {
      console.log('[bangumi] API error: ' + ddpErrStr(err));
      sidebar.postMessage("dandanplay-bangumi-result", { animeTitle: animeTitle, episodes: [], error: ddpErrStr(err) });
    });
  });

  sidebar.onMessage("dandanplay-select-match", function (data) {
    var match = data.match;
    if (match && match.episodeId) {
      dandanplayState.matchType = 'filename';
      ddpLoadComments(match.episodeId, match.animeTitle, match.episodeTitle, true);
    }
  });

  sidebar.onMessage("dandanplay-select-episode", function (data) {
    dandanplayState.matchType = 'filename';
    ddpLoadComments(data.episodeId, data.animeTitle, data.episodeTitle, true);
  });

  sidebar.onMessage("dandanplay-trigger-match", function () {
    if (currentVideoUrl) {
      ddpAutoMatchAndLoad(currentVideoUrl);
    }
  });

  // 过滤 tab: sidebar 懒加载,只能由 sidebar 主动拉取弹幕列表;watch 控制播放时间推送
  sidebar.onMessage("danmaku-browser-request", function (data) {
    // sidebar 上报插件根目录(file:// 定位),供 main 读 overlay/lib/opencc.min.js
    if (data && data.pluginRoot) pluginRootPath = data.pluginRoot;
    sendDanmakuBrowserData(buildDanmakuBrowserList());
  });

  sidebar.onMessage("danmaku-browser-watch", function (data) {
    danmakuBrowserWatch = !!data.watch;
    if (danmakuBrowserWatch) {
      var t = mpv.getNumber("time-pos");
      if (t !== undefined && t !== null) pushBrowserTime(t);
    }
  });
}

event.on("iina.window-loaded", function () {
  overlay.loadFile("overlay/index.html");
  sidebar.loadFile("sidebar/index.html");
  registerSidebarHandlers();
});

overlay.onMessage("overlay-ready", function () { markOverlayReady(); });

event.on("iina.plugin-overlay-loaded", function () {
  overlay.show();
  setTimeout(function () { if (!overlayReady) markOverlayReady(); }, 2000);
});

event.on("iina.file-loaded", function (url) {
  currentVideoUrl = url;
  if (danmakuEnabled) loadDanmakuForVideo(url);
});

event.on("mpv.pause.changed", function () {
  if (!overlayReady) return;
  overlay.postMessage("pause-state", { paused: core.status.paused });
});

overlay.onMessage("danmaku-type", function (data) {
  currentDanmakuStatus.fileType = data.type;
  sidebar.postMessage("danmaku-type", currentDanmakuStatus);
});

overlay.onMessage("seek-disable", function () { core.osd(t('seek_disable')); });
overlay.onMessage("seek-enable", function () { core.osd(t('seek_enable')); });

overlay.onMessage("jump", function (data) {
  if (data.targetSec !== undefined && data.targetSec !== null) {
    mpv.set("time-pos", data.targetSec);
    if (data.message) core.osd(t('jump') + data.message);
  }
});

overlay.onMessage("jump-video", function (data) {
  if (data.videoId) core.osd(t('jump') + data.videoId + (data.message ? " " + data.message : ""));
});

menu.addItem(
  menu.item(t('menu_toggle'), function () { toggleDanmaku(); }, { keyBinding: "D" })
);

menu.addItem(
  menu.item(t('menu_load_file'), function () {
    iina.utils.chooseFile(t('choose_file_title'), { allowedFileTypes: ["json", "xml"] }).then(function(path) {
      loadManualDanmakuFile(path);
    });
  })
);

menu.addItem(menu.separator());

menu.addItem(
  menu.item(t('menu_show_overlay'), function () { overlay.show(); })
);

menu.addItem(
  menu.item(t('menu_hide_overlay'), function () { overlay.hide(); })
);

console.log("niconicocomments-only plugin initialized");
