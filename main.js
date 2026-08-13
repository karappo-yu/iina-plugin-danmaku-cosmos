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
var ddpHashScriptPath = null;
var ddpHashScriptReady = false;

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
  // preferredLocalizations only exists in newer IINA builds — detect before calling,
  // otherwise the TypeError lands in catch and forces a wrong fallback.
  try {
    if (iina.utils && typeof iina.utils.preferredLocalizations === 'function') {
      var locs = iina.utils.preferredLocalizations();
      if (locs && locs.length) {
        var l = String(locs[0]).toLowerCase();
        if (l.indexOf('ja') === 0) return 'ja';
        if (l.indexOf('zh') === 0) return 'zh';
        return 'en';
      }
    }
  } catch (e) {}
  // Fallback for older IINA (e.g. 1.4.4): WKWebView's navigator.language tracks system language
  try {
    var nav = (typeof navigator !== 'undefined' && navigator.language) || '';
    nav = String(nav).toLowerCase();
    if (nav.indexOf('ja') === 0) return 'ja';
    if (nav.indexOf('zh') === 0) return 'zh';
  } catch (e) {}
  return 'en';
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
  var encodedContent = danmakuCache[selectedPath];
  if (!encodedContent) return;

  var filteredEncoded = applyNicoJsonFilters(encodedContent);
  overlay.postMessage("load-danmaku", {
    xmlContent: filteredEncoded,
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

function ddpCalcFileHash(filePath) {
  if (!filePath) return Promise.resolve(null);
  try {
    if (!ddpHashScriptPath) ddpHashScriptPath = iina.utils.resolvePath('@data/ddp_hash.py');
    if (!ddpHashScriptPath) return Promise.resolve(null);
    if (!ddpHashScriptReady || !file.exists(ddpHashScriptPath)) {
      var script = 'import hashlib,sys,os\n'
        + 'try:\n'
        + '  p=sys.argv[1]\n'
        + '  with open(p,"rb") as f:\n'
        + '    h=hashlib.md5(f.read(16*1024*1024)).hexdigest()\n'
        + '  print(h+" "+str(os.path.getsize(p)))\n'
        + 'except Exception as e:\n'
        + '  print("ERROR "+str(e))';
      file.write(ddpHashScriptPath, script);
      ddpHashScriptReady = true;
    }

    return iina.utils.exec('/usr/bin/env', ['python3', ddpHashScriptPath, filePath]).then(function(result) {
      if (!result || result.status !== 0 || !result.stdout) return null;
      var parts = result.stdout.trim().split(' ');
      if (parts.length >= 2 && parts[0].length === 32 && parts[0] !== 'ERROR') {
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

    var payload = {
      xmlContent: danmakuCache[virtualPath],
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

  // === Step 3: Auto-load to overlay based on autoNetwork setting ===
  if (dandanplayAutoNetwork) {
    // network-first: auto-load DDP cache, trigger background auto-match
    if (hasDDPCache) {
      ddpAddToFileListAndLoad(ddpCached.episodeId, ddpCached.animeTitle, ddpCached.episodeTitle, ddpCached.comments, true);
      ddpAutoMatchAndLoad(url);
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
      ddpAddToFileListAndLoad(ddpCached.episodeId, ddpCached.animeTitle, ddpCached.episodeTitle, ddpCached.comments, true);
      ddpAutoMatchAndLoad(url);
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

  var payload = {
    xmlContent: encodedContent,
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

  if (fileType === 'nico-json') {
    payload.xmlContent = applyNicoJsonFilters(encodedContent);
  }

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

  var manualPayload = {
    xmlContent: encodedContent,
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

  if (manualFileType === 'nico-json') {
    manualPayload.xmlContent = applyNicoJsonFilters(encodedContent);
  }

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
  
  // 通知 overlay.js 实时变更设置并触发重新渲染清洗
  if (overlayReady) {
    overlay.postMessage("apply-settings", {
      danmakuForceSimplified: danmakuForceSimplified
    });
    
    // 如果当前已经加载了弹幕文件，重新驱动加载管道，让 OpenCC 重新清洗文本
    var selectedPath = danmakuFileList.selectedPaths.length > 0 ? danmakuFileList.selectedPaths[0] : null;
    if (selectedPath) {
      if (currentDanmakuStatus.fileType === 'nico-json') {
        applyDanmakuFilter(danmakuFilterOffset, danmakuFilterLimit);
      } else {
        overlay.postMessage("load-danmaku", {
          xmlContent: danmakuCache[selectedPath],
          path: selectedPath,
          danmakuType: currentDanmakuStatus.fileType === 'dandanplay' ? 'dandanplay' : 'bilibili-xml',
          opacity: canvasOpacity,
          canvasFontScale: canvasFontScale,
          strokeColor: strokeColor,
          strokeInversionColor: strokeInversionColor,
          strokeOpacity: strokeOpacity,
          strokeWidth: strokeWidth,
          commentLimit: commentLimit,
          scrollSpeed: scrollSpeed,
          preservePosition: true,
          danmakuForceSimplified: danmakuForceSimplified
        });
      }
    }
  }
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
  });

  sidebar.onMessage("set-danmaku-filter-density", function (data) {
    applyDanmakuFilterDensity(data.density || 0);
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

  sidebar.onMessage("select-danmaku-file", function (data) {
    var filePath = data.path;

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

    var selectPayload = {
      xmlContent: encodedContent,
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

    if (fileType === 'nico-json') {
      selectPayload.xmlContent = applyNicoJsonFilters(encodedContent);
    }

    overlay.postMessage("load-danmaku", selectPayload);
    core.osd(t('loaded') + (fileInfo ? fileInfo.filename : fileName));
    ensureDanmakuEnabled();
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
        core.osd(t('added_click_to_load', { name: fname }));
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
