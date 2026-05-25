var toggleDanmaku = document.getElementById("toggle-danmaku");
var canvasRendererToggle = document.getElementById("canvas-renderer-toggle");
var opacitySlider = document.getElementById("opacity-slider");
var opacityValue = document.getElementById("opacity-value");
var fontsizeSlider = document.getElementById("fontsize-slider");
var fontsizeValue = document.getElementById("fontsize-value");
var strokeOpacitySlider = document.getElementById("stroke-opacity-slider");
var strokeOpacityValue = document.getElementById("stroke-opacity-value");
var strokeWidthSlider = document.getElementById("stroke-width-slider");
var strokeWidthValue = document.getElementById("stroke-width-value");
var strokeColorInput = document.getElementById("stroke-color");
var strokeInversionInput = document.getElementById("stroke-inversion-color");
var commentLimitSlider = document.getElementById("comment-limit-slider");
var commentLimitValue = document.getElementById("comment-limit-value");
var speedSlider = document.getElementById("speed-slider");
var speedValue = document.getElementById("speed-value");
var advancedToggle = document.getElementById("advanced-toggle");
var advancedContent = document.getElementById("advanced-content");
var advancedArrow = document.getElementById("advanced-arrow");
var fileAddBtn = document.getElementById("danmaku-file-add-btn");
var commentLimitRow = document.getElementById("comment-limit-row");

var advancedOpen = false;

var ddpError = document.getElementById("dandanplay-error");
var ddpMatches = document.getElementById("dandanplay-matches");
var ddpMatchesList = document.getElementById("dandanplay-matches-list");
var ddpSearchBtn = document.getElementById("dandanplay-search-btn");
var ddpSearchPanel = document.getElementById("dandanplay-search-panel");
var ddpSearchInput = document.getElementById("dandanplay-search-input");
var ddpSearchGoBtn = document.getElementById("dandanplay-search-go-btn");
var ddpSearchResults = document.getElementById("dandanplay-search-results-list");
var ddpSearchResultsToggle = document.getElementById("dandanplay-search-results-toggle");
var ddpSearchResultsHeader = document.getElementById("dandanplay-search-results-header");
var ddpSearchResultsArrow = document.getElementById("dandanplay-search-results-arrow");
var ddpSearchResultsWrapper = document.getElementById("dandanplay-search-results");
var ddpAutoNetwork = document.getElementById("ddp-auto-network");

var ddpState = {
  status: 'idle',
  animeTitle: '',
  episodeTitle: '',
  episodeId: null,
  commentCount: 0,
  error: null,
  matches: null,
  matchType: '',
  autoNetwork: true
};

var settingsSections = [opacitySlider.closest('.section'), fontsizeSlider.closest('.section'), strokeOpacitySlider.closest('.section')];

var state = {
  enabled: true,
  useCanvasRenderer: true,
  danmakuType: 'none',
  danmakuFileName: null,
  danmakuRelativePath: null,
  danmakuLoaded: false,
  canvasOpacity: 0.8,
  canvasFontScale: 1.0,
  strokeOpacity: 0.4,
  strokeWidth: 2.8,
  strokeColor: '#000000',
  strokeInversionColor: '#ffffff',
  commentLimit: 0,
  scrollSpeed: 0.95,
};

var fileListState = {
  xmlFiles: [],
  jsonFiles: [],
  unknownFiles: [],
  selectedPaths: [],
  unknownExpanded: false,
  errorPaths: {}
};

var DEBUG_LOG = false;

function debugLog(message) {
  if (DEBUG_LOG) iina.postMessage("sidebar-log", { msg: message });
}

function createFileItem(fileInfo, isChecked, isDisabled) {
  var item = document.createElement('div');
  item.className = 'danmaku-file-item' + (isChecked ? ' selected' : '') + (isDisabled ? ' disabled' : '');
  item.dataset.path = fileInfo.path;
  item.style.cursor = 'pointer';

  item.addEventListener('click', function () {
    if (isDisabled) return;
    // Radio-style: clicking this file selects it exclusively
    iina.postMessage("select-danmaku-file", { path: fileInfo.path });
  });

  var info = document.createElement('div');
  info.className = 'danmaku-file-item-info';

  var name = document.createElement('span');
  name.className = 'danmaku-file-item-name';
  name.textContent = fileInfo.filename;
  name.title = fileInfo.filename;

  var type = document.createElement('span');
  type.className = 'danmaku-file-item-type';
  type.textContent = fileInfo.type;

  info.appendChild(name);
  info.appendChild(type);

  var pathEl = document.createElement('span');
  pathEl.className = 'danmaku-file-item-path';
  pathEl.textContent = fileInfo.relativePath;
  pathEl.title = fileInfo.relativePath;

  var deleteBtn = document.createElement('button');
  deleteBtn.className = 'danmaku-file-item-delete';
  deleteBtn.textContent = '\u00d7';
  deleteBtn.title = 'Delete';
  deleteBtn.setAttribute('data-clickable', '');
  deleteBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    iina.postMessage("danmaku-file-delete", { path: fileInfo.path });
  });

  item.appendChild(info);
  item.appendChild(pathEl);
  item.appendChild(deleteBtn);

  if (fileListState.errorPaths[fileInfo.path]) {
    var errorEl = document.createElement('div');
    errorEl.className = 'danmaku-file-item-error';
    errorEl.textContent = fileListState.errorPaths[fileInfo.path];
    item.appendChild(errorEl);
  }

  return item;
}

function createFileGroup(title, files, selectedPaths) {
  if (files.length === 0) return null;
  var group = document.createElement('div');
  group.className = 'danmaku-file-group';
  var titleEl = document.createElement('div');
  titleEl.className = 'danmaku-file-group-title';
  titleEl.textContent = title;
  group.appendChild(titleEl);
  for (var i = 0; i < files.length; i++) {
    var isChecked = selectedPaths.indexOf(files[i].path) !== -1;
    group.appendChild(createFileItem(files[i], isChecked, false));
  }
  return group;
}

function renderFileList() {
  var container = document.getElementById('danmaku-file-list-container');
  if (!container) return;
  container.innerHTML = '';

  var hasFiles = fileListState.xmlFiles.length > 0 || fileListState.jsonFiles.length > 0 || fileListState.unknownFiles.length > 0;

  var lang = getBrowserLang();
  var xmlTitle = lang === 'zh' ? 'XML 弹幕' : lang === 'ja' ? 'XML\u30b3\u30e1\u30f3\u30c8' : 'XML Danmaku';
  var jsonTitle = lang === 'zh' ? 'JSON 弹幕' : lang === 'ja' ? 'JSON\u30b3\u30e1\u30f3\u30c8' : 'JSON Danmaku';
  var unknownTitle = lang === 'zh' ? '\u5176\u4ed6\u5f39\u5e55' : lang === 'ja' ? '\u305d\u306e\u4ed6\u30b3\u30e1\u30f3\u30c8' : 'Other Danmaku';

  if (fileListState.xmlFiles.length > 0) {
    var xmlGroup = createFileGroup(xmlTitle, fileListState.xmlFiles, fileListState.selectedPaths);
    if (xmlGroup) container.appendChild(xmlGroup);
  }
  if (fileListState.jsonFiles.length > 0) {
    var jsonGroup = createFileGroup(jsonTitle, fileListState.jsonFiles, fileListState.selectedPaths);
    if (jsonGroup) container.appendChild(jsonGroup);
  }
  if (fileListState.unknownFiles.length > 0) {
    var toggleEl = document.createElement('div');
    toggleEl.className = 'danmaku-file-unknown-toggle';
    var arrow = document.createElement('span');
    arrow.className = 'toggle-arrow' + (fileListState.unknownExpanded ? ' expanded' : '');
    arrow.textContent = '\u25b6';
    var label = document.createElement('span');
    label.textContent = unknownTitle + ' (' + fileListState.unknownFiles.length + ')';
    toggleEl.appendChild(arrow);
    toggleEl.appendChild(label);
    toggleEl.addEventListener('click', function () {
      fileListState.unknownExpanded = !fileListState.unknownExpanded;
      renderFileList();
    });
    container.appendChild(toggleEl);

    var unknownContent = document.createElement('div');
    unknownContent.className = 'danmaku-file-unknown-content' + (fileListState.unknownExpanded ? ' expanded' : '');
    var unknownGroup = createFileGroup('', fileListState.unknownFiles, fileListState.selectedPaths);
    if (unknownGroup) unknownContent.appendChild(unknownGroup);
    container.appendChild(unknownContent);
  }

  updateFileCount();
}

function updateFileCount() {
  var countEl = document.getElementById('danmaku-file-count');
  if (!countEl) return;
  var lang = getBrowserLang();
  var selected = fileListState.selectedPaths.length;
  var total = fileListState.xmlFiles.length + fileListState.jsonFiles.length + fileListState.unknownFiles.length;
  if (lang === 'zh') countEl.textContent = '\u5df2\u9009 ' + selected + ' / ' + total + ' \u4e2a\u6587\u4ef6';
  else if (lang === 'ja') countEl.textContent = selected + ' / ' + total + ' \u30d5\u30a1\u30a4\u30eb\u9078\u629e';
  else countEl.textContent = selected + ' / ' + total + ' selected';
}

function debouncedFileCheck(path, checked) {
  if (checkDebounceTimer) clearTimeout(checkDebounceTimer);
  checkDebounceTimer = setTimeout(function () {
    iina.postMessage("danmaku-file-check", { path: path, checked: checked });
    checkDebounceTimer = null;
  }, 300);
}

function updateDanmakuInfoUI() {
  var fileListSection = document.getElementById('danmaku-file-list-section');
  var hasFiles = fileListState.xmlFiles.length > 0 || fileListState.jsonFiles.length > 0 || fileListState.unknownFiles.length > 0;
  var hasDanmaku = state.danmakuLoaded || hasFiles;
  if (fileListSection) fileListSection.style.display = '';
  toggleDanmaku.disabled = !hasDanmaku;
  if (!hasDanmaku) toggleDanmaku.checked = false;
}

function updateEnabledUI() {
  var hasFiles = fileListState.xmlFiles.length > 0 || fileListState.jsonFiles.length > 0 || fileListState.unknownFiles.length > 0;
  var show = state.enabled && (state.danmakuLoaded || hasFiles);
  settingsSections.forEach(function(sec) {
    if (sec) sec.style.display = show ? '' : 'none';
  });
  updateDanmakuInfoUI();
}

var i18n = {
  en: {
    danmaku_visible: "Danmaku On",
    opacity: "Danmaku Opacity",
    font_scale: "Font Scale",

    advanced: "Advanced",
    comment_limit: "Comment Limit",
    stroke_color: "Stroke Color",
    stroke_inversion: "Invert Color",
    stroke_opacity: "Opacity",
    stroke_width: "Width",
    scroll_speed: "Center Speed",
    danmaku_not_found: "No danmaku file found",
    file_add: "Add",
    dandanplay_label: "DanDanPlay",
    dandanplay_anime: "Anime",
    dandanplay_episode: "Episode",
    dandanplay_count: "Comments",
    dandanplay_refresh: "Refresh",
    dandanplay_search: "Search",
    dandanplay_search_go: "Go",
    dandanplay_priority: "Priority",
    dandanplay_priority_local: "Local First",
    dandanplay_priority_network: "Network First",
    dandanplay_priority_local_only: "Local Only",
    dandanplay_priority_network_only: "Network Only",
    dandanplay_auto_match: "Auto Match",
    dandanplay_select_match: "Network Danmaku",
    dandanplay_status_idle: "Not active",
    dandanplay_status_matching: "Matching...",
    dandanplay_status_loading: "Loading comments...",
    dandanplay_status_loaded: "Loaded",
    dandanplay_status_error: "Error",
    dandanplay_status_no_match: "No match found",
    dandanplay_status_multiple_matches: "Select a match"
  },
  ja: {
    danmaku_visible: "\u30b3\u30e1\u30f3\u30c8\u8868\u793a",
    opacity: "\u30b3\u30e1\u30f3\u30c8\u900f\u660e\u5ea6",
    font_scale: "\u30d5\u30a9\u30f3\u30c8\u500d\u7387",

    advanced: "\u9ad8\u5ea6\u306a\u8a2d\u5b9a",
    comment_limit: "\u30b3\u30e1\u30f3\u30c8\u5236\u9650",
    stroke_color: "\u7e01\u53d6\u308a\u306e\u8272",
    stroke_inversion: "\u9006\u7e01\u53d6\u308a\u8272",
    stroke_opacity: "\u7e01\u53d6\u308a\u900f\u660e\u5ea6",
    stroke_width: "\u7e01\u53d6\u308a\u306e\u592a\u3055",
    scroll_speed: "\u4e2d\u592e\u901f\u5ea6",
    danmaku_not_found: "\u30b3\u30e1\u30f3\u30c8\u30d5\u30a1\u30a4\u30eb\u304c\u898b\u3064\u304b\u308a\u307e\u305b\u3093",
    file_add: "\u8ffd\u52a0",
    dandanplay_label: "\u5f3e\u5f3ePlay",
    dandanplay_anime: "\u30a2\u30cb\u30e1",
    dandanplay_episode: "\u8a71",
    dandanplay_count: "\u30b3\u30e1\u30f3\u30c8\u6570",
    dandanplay_refresh: "\u66f4\u65b0",
    dandanplay_search: "\u691c\u7d22",
    dandanplay_search_go: "Go",
    dandanplay_priority: "\u512a\u5148\u5ea6",
    dandanplay_priority_local: "\u30ed\u30fc\u30ab\u30eb\u512a\u5148",
    dandanplay_priority_network: "\u30cd\u30c3\u30c8\u30ef\u30fc\u30af\u512a\u5148",
    dandanplay_priority_local_only: "\u30ed\u30fc\u30ab\u30eb\u306e\u307f",
    dandanplay_priority_network_only: "\u30cd\u30c3\u30c8\u30ef\u30fc\u30af\u306e\u307f",
    dandanplay_auto_match: "\u81ea\u52d5\u30de\u30c3\u30c1",
    dandanplay_select_match: "\u30cd\u30c3\u30c8\u30ef\u30fc\u30af\u30b3\u30e1\u30f3\u30c8",
    dandanplay_status_idle: "\u672a\u4f7f\u7528",
    dandanplay_status_matching: "\u30de\u30c3\u30c1\u4e2d...",
    dandanplay_status_loading: "\u30b3\u30e1\u30f3\u30c8\u8aad\u307f\u8fbc\u307f\u4e2d...",
    dandanplay_status_loaded: "\u8aad\u307f\u8fbc\u307f\u5b8c\u4e86",
    dandanplay_status_error: "\u30a8\u30e9\u30fc",
    dandanplay_status_no_match: "\u30de\u30c3\u30c1\u306a\u3057",
    dandanplay_status_multiple_matches: "\u30de\u30c3\u30c1\u3092\u9078\u629e"
  },
  zh: {
    danmaku_visible: "\u5f39\u5e55\u663e\u793a",
    opacity: "\u5f39\u5e55\u900f\u660e\u5ea6",
    font_scale: "\u5b57\u4f53\u7f29\u653e",

    advanced: "\u9ad8\u7ea7\u8bbe\u7f6e",
    comment_limit: "\u5f39\u5e55\u4e0a\u9650",
    stroke_color: "\u63cf\u8fb9\u989c\u8272",
    stroke_inversion: "\u53cd\u8272\u63cf\u8fb9",
    stroke_opacity: "\u63cf\u8fb9\u900f\u660e\u5ea6",
    stroke_width: "\u63cf\u8fb9\u7c97\u7ec6",
    scroll_speed: "\u4e2d\u592e\u901f\u5ea6",
    danmaku_not_found: "\u672a\u627e\u5230\u5f39\u5e55\u6587\u4ef6",
    file_add: "\u6dfb\u52a0",
    dandanplay_label: "\u5f39\u5f39Play",
    dandanplay_anime: "\u756a\u5267",
    dandanplay_episode: "\u96c6\u6570",
    dandanplay_count: "\u5f39\u5e55\u6570",
    dandanplay_refresh: "\u5237\u65b0",
    dandanplay_search: "\u624b\u52a8\u641c\u7d22",
    dandanplay_search_go: "\u641c\u7d22",
    dandanplay_priority: "\u52a0\u8f7d\u4f18\u5148\u7ea7",
    dandanplay_priority_local: "\u672c\u5730\u4f18\u5148",
    dandanplay_priority_network: "\u7f51\u7edc\u4f18\u5148",
    dandanplay_priority_local_only: "\u4ec5\u672c\u5730",
    dandanplay_priority_network_only: "\u4ec5\u7f51\u7edc",
    dandanplay_auto_match: "\u81ea\u52a8\u5339\u914d",
    dandanplay_select_match: "\u7f51\u7edc\u5f39\u5e55",
    dandanplay_status_idle: "\u672a\u542f\u7528",
    dandanplay_status_matching: "\u5339\u914d\u4e2d...",
    dandanplay_status_loading: "\u52a0\u8f7d\u5f39\u5e55\u4e2d...",
    dandanplay_status_loaded: "\u5df2\u52a0\u8f7d",
    dandanplay_status_error: "\u9519\u8bef",
    dandanplay_status_no_match: "\u672a\u627e\u5230\u5339\u914d",
    dandanplay_status_multiple_matches: "\u8bf7\u9009\u62e9\u5339\u914d"
  }
};

function getBrowserLang() {
  var lang = navigator.language || "en";
  if (lang.startsWith("ja")) return "ja";
  if (lang.startsWith("zh")) return "zh";
  return "en";
}

function applyI18n() {
  var lang = getBrowserLang();
  var dict = i18n[lang];
  document.querySelectorAll("[data-i18n]").forEach(function(el) {
    var key = el.getAttribute("data-i18n");
    if (dict[key]) el.textContent = dict[key];
  });
}

function updateUI() {
  var hasFiles = fileListState.xmlFiles.length > 0 || fileListState.jsonFiles.length > 0 || fileListState.unknownFiles.length > 0;
  var hasDanmaku = state.danmakuLoaded || hasFiles;
  toggleDanmaku.checked = state.enabled && hasDanmaku;
  toggleDanmaku.disabled = !hasDanmaku;
  opacitySlider.value = state.canvasOpacity;
  opacityValue.textContent = Math.round(state.canvasOpacity * 100) + "%";
  fontsizeSlider.value = Math.round(state.canvasFontScale * 100);
  fontsizeValue.textContent = Math.round(state.canvasFontScale * 100) + "%";
  strokeOpacitySlider.value = Math.round(state.strokeOpacity * 100);
  strokeOpacityValue.textContent = Math.round(state.strokeOpacity * 100) + "%";
  strokeWidthSlider.value = state.strokeWidth;
  strokeWidthValue.textContent = String(state.strokeWidth) + 'px';
  strokeColorInput.value = state.strokeColor;
  strokeInversionInput.value = state.strokeInversionColor;
  if (commentLimitRow) commentLimitRow.style.display = state.commentLimit > 0 ? '' : 'none';
  commentLimitSlider.value = state.commentLimit;
  commentLimitValue.textContent = state.commentLimit > 0 ? String(state.commentLimit) : 'Off';
  speedSlider.value = Math.round(state.scrollSpeed * 100);
  speedValue.textContent = Math.round(state.scrollSpeed * 100) + '%';
  if (canvasRendererToggle) canvasRendererToggle.checked = state.useCanvasRenderer;
}

toggleDanmaku.addEventListener("change", function () {
  if (toggleDanmaku.disabled) { toggleDanmaku.checked = false; return; }
  state.enabled = toggleDanmaku.checked;
  updateEnabledUI();
  iina.postMessage("toggle-danmaku");
});

advancedToggle.addEventListener("click", function () {
  advancedOpen = !advancedOpen;
  advancedContent.style.display = advancedOpen ? '' : 'none';
  advancedArrow.textContent = advancedOpen ? '▼' : '▶';
});

if (fileAddBtn) {
  fileAddBtn.addEventListener("click", function () {
    iina.postMessage("danmaku-file-add");
  });
}

if (canvasRendererToggle) {
  canvasRendererToggle.addEventListener("change", function () {
    var useCanvas = canvasRendererToggle.checked;
    state.useCanvasRenderer = useCanvas;
    iina.postMessage("set-canvas-mode", { mode: useCanvas ? 'default' : 'css' });
  });
}

opacitySlider.addEventListener("input", function () {
  var val = parseFloat(opacitySlider.value);
  state.canvasOpacity = val;
  opacityValue.textContent = Math.round(val * 100) + "%";
  iina.postMessage("set-opacity", { opacity: val });
});

fontsizeSlider.addEventListener("input", function () {
  var val = parseFloat(fontsizeSlider.value) / 100;
  state.canvasFontScale = val;
  fontsizeValue.textContent = Math.round(val * 100) + "%";
  iina.postMessage("set-fontscale", { scale: val });
});

strokeOpacitySlider.addEventListener("input", function () {
  var val = parseFloat(strokeOpacitySlider.value) / 100;
  state.strokeOpacity = val;
  strokeOpacityValue.textContent = Math.round(val * 100) + "%";
  iina.postMessage("set-stroke-opacity", { opacity: val });
});

strokeWidthSlider.addEventListener("input", function () {
  var val = parseFloat(strokeWidthSlider.value);
  state.strokeWidth = val;
  strokeWidthValue.textContent = String(val) + 'px';
  iina.postMessage("set-stroke-width", { width: val });
});

strokeColorInput.addEventListener("input", function () {
  state.strokeColor = strokeColorInput.value;
  iina.postMessage("set-stroke-color", { color: state.strokeColor });
});

strokeInversionInput.addEventListener("input", function () {
  state.strokeInversionColor = strokeInversionInput.value;
  iina.postMessage("set-stroke-inversion-color", { color: state.strokeInversionColor });
});

commentLimitSlider.addEventListener("input", function () {
  var val = parseInt(commentLimitSlider.value, 10);
  state.commentLimit = val;
  commentLimitValue.textContent = val > 0 ? String(val) : 'Off';
  iina.postMessage("set-comment-limit", { limit: val });
});

speedSlider.addEventListener("input", function () {
  var val = parseFloat(speedSlider.value) / 100;
  state.scrollSpeed = val;
  speedValue.textContent = Math.round(val * 100) + '%';
  iina.postMessage("set-scroll-speed", { speed: val });
});

iina.onMessage("danmaku-state", function (data) {
  if (data.enabled !== undefined) state.enabled = data.enabled;
  if (data.canvasMode !== undefined) state.useCanvasRenderer = data.canvasMode === 'default';
  if (data.canvasOpacity !== undefined) state.canvasOpacity = data.canvasOpacity;
  if (data.canvasFontScale !== undefined) state.canvasFontScale = data.canvasFontScale;
  if (data.strokeOpacity !== undefined) state.strokeOpacity = data.strokeOpacity;
  if (data.strokeWidth !== undefined) state.strokeWidth = data.strokeWidth;
  if (data.strokeColor !== undefined) state.strokeColor = data.strokeColor;
  if (data.strokeInversionColor !== undefined) state.strokeInversionColor = data.strokeInversionColor;
  if (data.commentLimit !== undefined) state.commentLimit = data.commentLimit;
  if (data.scrollSpeed !== undefined) state.scrollSpeed = data.scrollSpeed;
  if (data.danmakuFileType !== undefined) state.danmakuType = data.danmakuFileType;
  if (data.danmakuFileName !== undefined) state.danmakuFileName = data.danmakuFileName;
  if (data.danmakuRelativePath !== undefined) state.danmakuRelativePath = data.danmakuRelativePath;
  if (data.danmakuLoaded !== undefined) state.danmakuLoaded = data.danmakuLoaded;
  updateUI();
  updateEnabledUI();
});

iina.onMessage("danmaku-type", function (data) {
  if (data.fileType !== undefined) state.danmakuType = data.fileType;
  if (data.fileName !== undefined) state.danmakuFileName = data.fileName;
  if (data.relativePath !== undefined) state.danmakuRelativePath = data.relativePath;
  if (data.isLoaded !== undefined) state.danmakuLoaded = data.isLoaded;
  updateUI();
  updateEnabledUI();
});

iina.onMessage("danmaku-file-list", function (data) {
  var count = (data.jsonFiles ? data.jsonFiles.length : 0);
  debugLog('danmaku-file-list received, jsonFiles=' + count + ' selected=' + (data.selectedPaths ? data.selectedPaths.length : 0));
  if (data.jsonFiles) {
    for (var i = 0; i < data.jsonFiles.length; i++) {
      debugLog('  [' + i + '] filename="' + data.jsonFiles[i].filename + '" len=' + data.jsonFiles[i].filename.length + ' type=' + data.jsonFiles[i].type);
    }
  }
  fileListState.xmlFiles = data.xmlFiles || [];
  fileListState.jsonFiles = data.jsonFiles || [];
  fileListState.unknownFiles = data.unknownFiles || [];
  fileListState.selectedPaths = data.selectedPaths || [];
  renderFileList();
  updateDanmakuInfoUI();
});

iina.onMessage("danmaku-file-error", function (data) {
  fileListState.errorPaths[data.path] = data.message;
  renderFileList();
});

applyI18n();
iina.postMessage("request-state");

var ddpMatchesExpanded = false;

function ddpUpdateUI() {
  try {
    if (ddpError) {
      ddpError.style.display = (ddpState.status === 'error' || ddpState.status === 'no-match') ? '' : 'none';
      if (ddpState.error && (ddpState.status === 'error' || ddpState.status === 'no-match')) {
        ddpError.textContent = ddpState.error;
      }
    }

    if (ddpAutoNetwork) ddpAutoNetwork.checked = ddpState.autoNetwork;

    var hasMatches = ddpState.matches && ddpState.matches.length > 0;
    if (ddpMatches) ddpMatches.style.display = '';
    if (ddpMatchesList) {
      if (hasMatches) {
        ddpMatchesList.innerHTML = '';
        for (var i = 0; i < ddpState.matches.length; i++) {
          (function(match) {
            var item = document.createElement('div');
            var isSelected = ddpState.episodeId && String(match.episodeId) === String(ddpState.episodeId);
            item.className = 'dandanplay-match-item' + (isSelected ? ' selected' : '');
            item.setAttribute('data-clickable', '');
            var title = document.createElement('div');
            title.className = 'dandanplay-match-title';
            title.textContent = match.animeTitle + ' - ' + match.episodeTitle;
            if (isSelected && ddpState.matchType) {
              var typeLabel = document.createElement('span');
              typeLabel.className = 'dandanplay-match-type-label';
              typeLabel.textContent = ddpState.matchType === 'hash' ? '（hash）' : '（文件名关联）';
              if (ddpState.matchType === 'filename') {
                typeLabel.title = 'hash 未匹配到网络弹幕，显示文件名关联列表';
              }
              title.appendChild(typeLabel);
            }
            item.appendChild(title);
            item.addEventListener('click', function() {
              iina.postMessage("dandanplay-select-match", { match: match });
            });
            ddpMatchesList.appendChild(item);
          })(ddpState.matches[i]);
        }
        ddpMatchesList.style.display = ddpMatchesExpanded ? '' : 'none';
      } else {
        ddpMatchesList.style.display = 'none';
      }
    }
    if (ddpMatchesArrow) ddpMatchesArrow.className = 'toggle-arrow' + (ddpMatchesExpanded ? ' expanded' : '');
  } catch (e) {}
}

if (ddpAutoNetwork) {
  ddpAutoNetwork.addEventListener("change", function () {
    iina.postMessage("dandanplay-set-auto-network", { autoNetwork: ddpAutoNetwork.checked });
  });
}

var ddpMatchesToggle = document.getElementById("dandanplay-matches-toggle");
var ddpMatchesArrow = document.getElementById("dandanplay-matches-arrow");
if (ddpMatchesToggle) {
  ddpMatchesToggle.addEventListener("click", function () {
    ddpMatchesExpanded = !ddpMatchesExpanded;
    if (ddpMatchesExpanded && !ddpState.matches && ddpState.status !== 'matching' && ddpState.status !== 'loading') {
      iina.postMessage("dandanplay-trigger-match");
    }
    if (ddpMatchesList) ddpMatchesList.style.display = ddpMatchesExpanded ? '' : 'none';
    if (ddpMatchesArrow) ddpMatchesArrow.className = 'toggle-arrow' + (ddpMatchesExpanded ? ' expanded' : '');
  });
}

if (ddpSearchBtn) {
  ddpSearchBtn.addEventListener("click", function () {
    var visible = ddpSearchPanel.style.display !== 'none';
    ddpSearchPanel.style.display = visible ? 'none' : '';
    if (!visible && ddpSearchInput) ddpSearchInput.focus();
  });
}

if (ddpSearchResultsToggle) {
  ddpSearchResultsToggle.addEventListener("click", function () {
    var hidden = ddpSearchResults.style.display === 'none';
    ddpSearchResults.style.display = hidden ? '' : 'none';
    if (ddpSearchResultsArrow) ddpSearchResultsArrow.textContent = hidden ? '\u25BC' : '\u25B6';
  });
}

var ddpSearchTimer = null;
var ddpSearchPending = false;

function ddpDoSearch() {
  var keyword = ddpSearchInput ? ddpSearchInput.value.trim() : '';
  debugLog('ddpDoSearch called, keyword="' + keyword + '"');
  if (!keyword) return;
  if (ddpSearchTimer) clearTimeout(ddpSearchTimer);
  if (ddpSearchResults) {
    ddpSearchResults.innerHTML = '';
    if (ddpSearchResultsWrapper) ddpSearchResultsWrapper.style.display = '';
    if (ddpSearchResultsToggle) ddpSearchResultsToggle.style.display = 'none';
    var loadingEl = document.createElement('div');
    loadingEl.style.cssText = 'font-size:11px;opacity:0.5;padding:4px';
    loadingEl.textContent = '...';
    ddpSearchResults.appendChild(loadingEl);
  }
  if (ddpSearchResultsArrow) ddpSearchResultsArrow.textContent = '\u25B6';
  ddpSearchPending = true;
  ddpSearchTimer = setTimeout(function() {
    debugLog('sending dandanplay-search, keyword="' + keyword + '"');
    iina.postMessage("dandanplay-search", { keyword: keyword });
    ddpSearchTimer = null;
  }, 500);
}

if (ddpSearchGoBtn) {
  ddpSearchGoBtn.addEventListener("click", ddpDoSearch);
}

if (ddpSearchInput) {
  ddpSearchInput.addEventListener("keydown", function (e) {
    if (e.key === 'Enter') ddpDoSearch();
  });
}

iina.onMessage("dandanplay-status", function (data) {
  try {
    if (data.status !== undefined) ddpState.status = data.status;
    if (data.animeTitle !== undefined) ddpState.animeTitle = data.animeTitle;
    if (data.episodeTitle !== undefined) ddpState.episodeTitle = data.episodeTitle;
    if (data.episodeId !== undefined) ddpState.episodeId = data.episodeId;
    if (data.commentCount !== undefined) ddpState.commentCount = data.commentCount;
    if (data.error !== undefined) ddpState.error = data.error;
    if (data.matches !== undefined) ddpState.matches = data.matches;
    if (data.autoNetwork !== undefined) ddpState.autoNetwork = data.autoNetwork;
    if (data.matchType !== undefined) ddpState.matchType = data.matchType;
    ddpUpdateUI();
  } catch (e) {}
});

iina.onMessage("dandanplay-search-result", function (data) {
  debugLog('received dandanplay-search-result, typeof=' + typeof data + ' hasAnimes=' + (data && data.animes ? data.animes.length : 0) + ' error=' + (data && data.error ? data.error : 'null') + ' ddpSearchResults=' + (ddpSearchResults ? 'exists' : 'null'));
  ddpSearchPending = false;
  try {
    if (!ddpSearchResults) {
      debugLog('ddpSearchResults is null, returning');
      return;
    }
    ddpSearchResults.innerHTML = '';
    if (ddpSearchResultsWrapper) ddpSearchResultsWrapper.style.display = '';

    if (data && data.error) {
      debugLog('error in result: ' + data.error);
      if (ddpSearchResultsToggle) ddpSearchResultsToggle.style.display = 'none';
      var errEl = document.createElement('div');
      errEl.className = 'dandanplay-error';
      errEl.textContent = data.error;
      ddpSearchResults.appendChild(errEl);
      return;
    }

    var animes = (data && data.animes) || [];
    debugLog('rendering ' + animes.length + ' animes, childCount before=' + ddpSearchResults.childElementCount + ' html="' + ddpSearchResults.innerHTML.substring(0, 100) + '"');
    if (animes.length === 0) {
      if (ddpSearchResultsToggle) ddpSearchResultsToggle.style.display = 'none';
      var emptyEl = document.createElement('div');
      emptyEl.style.cssText = 'font-size:11px;opacity:0.5;padding:4px';
      emptyEl.textContent = '\u2014';
      ddpSearchResults.appendChild(emptyEl);
      return;
    }

    if (ddpSearchResultsHeader) ddpSearchResultsHeader.textContent = '\u641C\u7D22\u7ED3\u679C (' + animes.length + ')';
    if (ddpSearchResultsArrow) ddpSearchResultsArrow.textContent = '\u25BC';
    if (ddpSearchResultsToggle) ddpSearchResultsToggle.style.display = '';
    ddpSearchResults.style.display = '';

    for (var i = 0; i < animes.length; i++) {
      (function(anime) {
        var item = document.createElement('div');
        item.className = 'dandanplay-search-result-item';
        item.setAttribute('data-clickable', '');

        var title = document.createElement('div');
        title.className = 'dandanplay-search-result-title';
        title.textContent = anime.animeTitle || '\u2014';

        var sub = document.createElement('div');
        sub.className = 'dandanplay-search-result-episodes';
        sub.textContent = 'Click to load episodes';

        item.appendChild(title);
        item.appendChild(sub);

        var epLoading = false;
        item.addEventListener('click', function () {
          if (item._epList) {
            item._epList.style.display = item._epList.style.display === 'none' ? '' : 'none';
            return;
          }
          if (epLoading) return;
          epLoading = true;
          sub.textContent = 'Loading episodes...';
          iina.postMessage("dandanplay-get-bangumi", { bangumiId: String(anime.animeId), animeTitle: anime.animeTitle });
        });

        ddpSearchResults.appendChild(item);
      })(animes[i]);
    }
    debugLog('after render childCount=' + ddpSearchResults.childElementCount + ' html="' + ddpSearchResults.innerHTML.substring(0, 100) + '" ddpSearchPanel.display=' + (ddpSearchPanel ? ddpSearchPanel.style.display : 'null'));
  } catch (e) {
    debugLog('catch: ' + (e.message || e) + ' stack=' + (e.stack || 'none'));
    ddpSearchResults.innerHTML = '';
    var errEl = document.createElement('div');
    errEl.className = 'dandanplay-error';
    errEl.textContent = 'Render error: ' + e.message;
    ddpSearchResults.appendChild(errEl);
  }
});

iina.onMessage("dandanplay-bangumi-result", function (data) {
  debugLog('received bangumi-result, typeof=' + typeof data + ' animeTitle="' + (data.animeTitle || '') + '" episodes=' + (data.episodes ? data.episodes.length : 0) + ' error=' + (data.error || 'null'));
  try {
    if (!ddpSearchResults || data.error) {
      debugLog('bangumi-result: skip, ddpSearchResults=' + (ddpSearchResults ? 'exists' : 'null') + ' error=' + (data.error || 'null'));
      return;
    }
    var animeTitle = data.animeTitle;
    var episodes = data.episodes || [];

    var items = ddpSearchResults.querySelectorAll('.dandanplay-search-result-item');
    debugLog('bangumi-result: found ' + items.length + ' items, looking for animeTitle="' + animeTitle + '"');
    for (var i = 0; i < items.length; i++) {
      (function(item) {
        var titleEl = item.querySelector('.dandanplay-search-result-title');
        if (!titleEl || titleEl.textContent !== animeTitle) return;
        debugLog('bangumi-result: matched item, episodes=' + episodes.length);

        var subEl = item.querySelector('.dandanplay-search-result-episodes');
        if (subEl) subEl.textContent = episodes.length + ' episodes';

        var epList = document.createElement('div');
        epList.className = 'dandanplay-episode-list';
        item._epList = epList;          // store for click handler toggle
        for (var j = 0; j < episodes.length; j++) {
          (function(ep) {
            var epItem = document.createElement('div');
            epItem.className = 'dandanplay-episode-item';
            epItem.setAttribute('data-clickable', '');
            epItem.textContent = ep.episodeTitle || ('Episode ' + (j + 1));
            epItem.addEventListener('click', function (e) {
              e.stopPropagation();
              iina.postMessage("dandanplay-select-episode", {
                episodeId: ep.episodeId,
                animeTitle: animeTitle,
                episodeTitle: ep.episodeTitle
              });
            });
            epList.appendChild(epItem);
          })(episodes[j]);
        }
        item.appendChild(epList);
      })(items[i]);
    }
  } catch (e) {}
});
