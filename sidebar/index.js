var toggleDanmaku = document.getElementById("toggle-danmaku");
var canvasRendererToggle = document.getElementById("canvas-renderer-toggle");
var danmakuForceSimplifiedToggle = document.getElementById("danmaku-force-simplified-toggle"); 
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
var offsetInput = document.getElementById("danmaku-offset-input");
var fontSelect = document.getElementById("danmaku-font-select");
var fontCustomRow = document.getElementById("danmaku-font-custom-row");
var fontCustomInput = document.getElementById("danmaku-font-custom");
var fontWeightSlider = document.getElementById("danmaku-font-weight-slider");
var fontWeightValue = document.getElementById("danmaku-font-weight-value");
var stylePresetSegmented = document.getElementById("style-preset-segmented");
var filterSection = document.getElementById("danmaku-filter-section");
var filterDateNew = document.getElementById("danmaku-filter-date-new");
var filterDateOld = document.getElementById("danmaku-filter-date-old");
var filterCount = document.getElementById("filter-count");
var rangeSelector = document.getElementById("danmaku-range-selector");
var filterCoverage = document.getElementById("filter-coverage");
var filterHandleLeft = document.getElementById("filter-handle-left");
var filterHandleRight = document.getElementById("filter-handle-right");
var densitySection = document.getElementById("danmaku-density-section");
var densitySlider = document.getElementById("density-slider");
var densityValue = document.getElementById("density-value");
var densityCount = document.getElementById("density-count");
var tabBasic = document.getElementById("tab-basic");
var tabAdvanced = document.getElementById("tab-advanced");
var tabFilter = document.getElementById("tab-filter");
var tabButtons = document.querySelectorAll(".tabbar .tab");
var fileAddBtn = document.getElementById("danmaku-file-add-btn");

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
  useCanvasRenderer: false,
  danmakuForceSimplified: true,
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
  scrollSpeed: 1.0,
  danmakuOffsetSeconds: 0,
  danmakuFontFamily: "",
  danmakuFontWeight: "400",
  stylePreset: "nico",
  nicoJsonTotalCount: 0,
  danmakuFilterOffset: 0,
  danmakuFilterLimit: 0,
  danmakuFilterDensity: 0,
  filteredCount: 0,
  rangeStartDate: null,
  rangeEndDate: null,
};

var fileListState = {
  xmlFiles: [],
  jsonFiles: [],
  selectedPaths: [],
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

  // Track selector: solid dot when selected, empty placeholder otherwise
  var selector = document.createElement('div');
  selector.className = 'danmaku-file-selector';
  var dot = document.createElement('div');
  dot.className = isChecked ? 'danmaku-file-dot' : 'danmaku-file-empty-dot';
  selector.appendChild(dot);
  item.appendChild(selector);

  var name = document.createElement('span');
  name.className = 'danmaku-file-item-name';
  name.textContent = fileInfo.filename;
  name.title = fileInfo.relativePath || fileInfo.filename;
  item.appendChild(name);

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

  var lang = getBrowserLang();
  var xmlTitle = lang === 'zh' ? 'XML 弹幕' : lang === 'ja' ? 'XML\u30b3\u30e1\u30f3\u30c8' : 'XML Danmaku';
  var jsonTitle = lang === 'zh' ? 'JSON 弹幕' : lang === 'ja' ? 'JSON\u30b3\u30e1\u30f3\u30c8' : 'JSON Danmaku';

  if (fileListState.xmlFiles.length > 0) {
    var xmlGroup = createFileGroup(xmlTitle, fileListState.xmlFiles, fileListState.selectedPaths);
    if (xmlGroup) container.appendChild(xmlGroup);
  }
  if (fileListState.jsonFiles.length > 0) {
    var jsonGroup = createFileGroup(jsonTitle, fileListState.jsonFiles, fileListState.selectedPaths);
    if (jsonGroup) container.appendChild(jsonGroup);
  }

}

function updateDanmakuInfoUI() {
  var fileListSection = document.getElementById('danmaku-file-list-section');
  var hasDanmaku = state.danmakuLoaded || fileListState.xmlFiles.length > 0 || fileListState.jsonFiles.length > 0;
  if (fileListSection) fileListSection.style.display = '';
  toggleDanmaku.disabled = !hasDanmaku;
  if (!hasDanmaku) toggleDanmaku.checked = false;
}

function updateEnabledUI() {
  var hasFiles = fileListState.xmlFiles.length > 0 || fileListState.jsonFiles.length > 0;
  var show = state.enabled && (state.danmakuLoaded || hasFiles);
  settingsSections.forEach(function(sec) {
    if (sec) sec.style.display = show ? '' : 'none';
  });
  updateDanmakuInfoUI();
  updateFilterUI();
}

var i18n = {
  en: {
    danmaku_visible: "Danmaku On",
    opacity: "Danmaku Opacity",
    font_scale: "Font Scale",
    danmaku_filter: "Date Slice",
    density_filter: "Count (/min)",

    advanced: "Advanced",
    tab_basic: "Basic",
    tab_advanced: "Advanced",
    style_preset: "Style Preset",
    style_balanced: "Balanced",
    danmaku_offset: "Danmaku Offset (s)",
    danmaku_font_family: "Font Family",
    danmaku_font_custom: "Custom Font",
    danmaku_font_weight: "Weight",
    comment_limit: "Comment Limit",
    stroke_color: "Stroke Color",
    stroke_inversion: "Invert Color",
    stroke_opacity: "Opacity",
    stroke_width: "Width",
    scroll_speed: "Scroll Speed",
    file_add: "Add Local",
    off: "Off",
    dandanplay_search_placeholder: "Anime title...",
    dandanplay_search: "Search",
    dandanplay_search_go: "Go",
    dandanplay_match: "Network Match",
    ddp_auto_network: "Auto-load network danmaku",
    canvas_renderer: "Use Canvas renderer",
    danmaku_force_simplified: "Force Simplified Chinese",
    search_results: "Search Results",
    click_load_episodes: "Click to load episodes",
    loading_episodes: "Loading episodes...",
    episodes_count: "{n} episodes",
    match_type_hash: "(hash)",
    match_type_filename: "(filename match)",
    match_type_filename_title: "Hash match failed; showing filename-related matches",
    tab_filter: "Filter",
    filter_title: "Danmaku List",
    filter_back_live: "Back to Live",
    filter_view_all: "All",
    filter_view_blocked: "Blocked",
    filter_view_merged: "Merged",
    filter_empty: "No danmaku loaded",
    filter_empty_blocked: "No blocked danmaku",
    filter_empty_merged: "No merged danmaku",
    blocklist_title: "Block Words",
    blocklist_add: "Add",
    blocklist_empty: "No block words yet",
    blocklist_placeholder: "word or regex...",
    blocklist_remove: "Remove",
    dedupe_title: "Deduplicate",
    dedupe_window: "Window (sec)"
  },
  ja: {
    danmaku_visible: "\u30b3\u30e1\u30f3\u30c8\u8868\u793a",
    opacity: "\u30b3\u30e1\u30f3\u30c8\u900f\u660e\u5ea6",
    font_scale: "\u30d5\u30a9\u30f3\u30c8\u500d\u7387",
    danmaku_filter: "\u65e5\u4ed8\u30b9\u30e9\u30a4\u30b9",
    density_filter: "\u6570\u91cf",

    advanced: "\u9ad8\u5ea6\u306a\u8a2d\u5b9a",
    tab_basic: "\u57fa\u672c",
    tab_advanced: "\u8a73\u7d30",
    style_preset: "\u30b9\u30bf\u30a4\u30eb\u30d7\u30ea\u30bb\u30c3\u30c8",
    style_balanced: "\u30d0\u30e9\u30f3\u30b9",
    danmaku_offset: "\u30b3\u30e1\u30f3\u30c8\u6642\u9593\u30aa\u30d5\u30bb\u30c3\u30c8 (\u79d2)",
    danmaku_font_family: "\u30d5\u30a9\u30f3\u30c8",
    danmaku_font_custom: "\u30ab\u30b9\u30bf\u30e0\u30d5\u30a9\u30f3\u30c8",
    danmaku_font_weight: "\u592a\u3055",
    comment_limit: "\u30b3\u30e1\u30f3\u30c8\u5236\u9650",
    stroke_color: "\u7e01\u53d6\u308a\u306e\u8272",
    stroke_inversion: "\u9006\u7e01\u53d6\u308a\u8272",
    stroke_opacity: "\u7e01\u53d6\u308a\u900f\u660e\u5ea6",
    stroke_width: "\u7e01\u53d6\u308a\u306e\u592a\u3055",
    scroll_speed: "\u30b9\u30af\u30ed\u30fc\u30eb\u901f\u5ea6",
    file_add: "\u30ed\u30fc\u30ab\u30eb\u8ffd\u52a0",
    off: "\u30aa\u30d5",
    dandanplay_search_placeholder: "\u30a2\u30cb\u30e1\u30bf\u30a4\u30c8\u30eb...",
    dandanplay_search: "\u691c\u7d22",
    dandanplay_search_go: "Go",
    dandanplay_match: "\u30cd\u30c3\u30c8\u30de\u30c3\u30c1",
    ddp_auto_network: "\u30cd\u30c3\u30c8\u30ef\u30fc\u30af\u30b3\u30e1\u30f3\u30c8\u3092\u81ea\u52d5\u8aad\u307f\u8fbc\u307f",
    canvas_renderer: "Canvas \u63cf\u753b\u3092\u4f7f\u7528",
    danmaku_force_simplified: "\u7c21\u4f53\u5b57\u306b\u5f37\u5236\u5909\u63db",
    search_results: "\u691c\u7d22\u7d50\u679c",
    click_load_episodes: "\u30af\u30ea\u30c3\u30af\u3057\u3066\u8a71\u6570\u3092\u8868\u793a",
    loading_episodes: "\u8a71\u6570\u3092\u8aad\u307f\u8fbc\u307f\u4e2d...",
    episodes_count: "{n}\u8a71",
    match_type_hash: "\uff08hash\uff09",
    match_type_filename: "\uff08\u30d5\u30a1\u30a4\u30eb\u540d\u4e00\u81f4\uff09",
    match_type_filename_title: "hash \u30de\u30c3\u30c1\u5931\u6557\u3001\u30d5\u30a1\u30a4\u30eb\u540d\u95a2\u9023\u30ea\u30b9\u30c8\u3092\u8868\u793a",
    tab_filter: "\u30d5\u30a3\u30eb\u30bf\u30fc",
    filter_title: "\u30b3\u30e1\u30f3\u30c8\u4e00\u89a7",
    filter_back_live: "\u6700\u65b0\u3078",
    filter_view_all: "\u3059\u3079\u3066",
    filter_view_blocked: "\u30d6\u30ed\u30c3\u30af",
    filter_view_merged: "\u5408\u4f75",
    filter_empty: "\u30b3\u30e1\u30f3\u30c8\u672a\u8aad\u8fbc",
    filter_empty_blocked: "\u30d6\u30ed\u30c3\u30af\u3055\u308c\u305f\u30b3\u30e1\u30f3\u30c8\u306f\u3042\u308a\u307e\u305b\u3093",
    filter_empty_merged: "\u5408\u4f75\u3055\u308c\u305f\u30b3\u30e1\u30f3\u30c8\u306f\u3042\u308a\u307e\u305b\u3093",
    blocklist_title: "\u30d6\u30ed\u30c3\u30af\u8a9e",
    blocklist_add: "\u8ffd\u52a0",
    blocklist_empty: "\u307e\u3060\u30d6\u30ed\u30c3\u30af\u8a9e\u306f\u3042\u308a\u307e\u305b\u3093",
    blocklist_placeholder: "\u5358\u8a9e\u307e\u305f\u306f\u6b63\u898f\u8868\u73fe...",
    blocklist_remove: "\u524a\u9664",
    dedupe_title: "\u91cd\u8907\u30b3\u30e1\u30f3\u30c8\u5408\u4f75",
    dedupe_window: "\u5408\u4f75\u7bc4\u56f2 (\u79d2)"
  },
  zh: {
    danmaku_visible: "\u5f39\u5e55\u663e\u793a",
    opacity: "\u5f39\u5e55\u900f\u660e\u5ea6",
    font_scale: "\u5b57\u4f53\u7f29\u653e",
    danmaku_filter: "\u65e5\u671f\u5207\u7247",
    density_filter: "\u6570\u91cf",

    advanced: "\u9ad8\u7ea7\u8bbe\u7f6e",
    tab_basic: "\u57fa\u7840",
    tab_advanced: "\u9ad8\u7ea7",
    style_preset: "\u98ce\u683c\u9884\u8bbe",
    style_balanced: "\u5e73\u8861",
    danmaku_offset: "\u5f39\u5e55\u65f6\u95f4\u504f\u79fb (\u79d2)",
    danmaku_font_family: "\u5b57\u4f53",
    danmaku_font_custom: "\u81ea\u5b9a\u4e49\u5b57\u4f53",
    danmaku_font_weight: "\u7c97\u7ec6",
    comment_limit: "\u5f39\u5e55\u4e0a\u9650",
    stroke_color: "\u63cf\u8fb9\u989c\u8272",
    stroke_inversion: "\u53cd\u8272\u63cf\u8fb9",
    stroke_opacity: "\u63cf\u8fb9\u900f\u660e\u5ea6",
    stroke_width: "\u63cf\u8fb9\u7c97\u7ec6",
    scroll_speed: "\u6eda\u52a8\u901f\u5ea6",
    file_add: "\u672c\u5730\u6dfb\u52a0",
    off: "\u5173\u95ed",
    dandanplay_search_placeholder: "\u52a8\u753b\u6807\u9898...",
    dandanplay_search: "\u624b\u52a8\u641c\u7d22",
    dandanplay_search_go: "\u641c\u7d22",
    dandanplay_match: "\u7f51\u7edc\u5339\u914d",
    ddp_auto_network: "\u81ea\u52a8\u52a0\u8f7d\u7f51\u7edc\u5f39\u5e55",
    canvas_renderer: "\u4f7f\u7528 Canvas \u6e32\u67d3",
    danmaku_force_simplified: "\u5f3a\u5236\u8f6c\u6362\u7b80\u4f53", 
    search_results: "\u641c\u7d22\u7ed3\u679c",
    click_load_episodes: "\u70b9\u51fb\u52a0\u8f7d\u96c6\u6570\u5217\u8868",
    loading_episodes: "\u6b63\u5728\u52a0\u8f7d\u96c6\u6570...",
    episodes_count: "{n} \u96c6",
    match_type_hash: "\uff08hash\uff09",
    match_type_filename: "\uff08\u6587\u4ef6\u540d\u5173\u8054\uff09",
    match_type_filename_title: "hash \u672a\u5339\u914d\u5230\u7f51\u7edc\u5f39\u5e55\uff0c\u663e\u793a\u6587\u4ef6\u540d\u5173\u8054\u5217\u8868",
    tab_filter: "\u8fc7\u6ee4",
    filter_title: "\u5f39\u5e55\u5217\u8868",
    filter_back_live: "\u56de\u5230\u5b9e\u65f6",
    filter_view_all: "\u5168\u90e8",
    filter_view_blocked: "\u5df2\u5c4f\u853d",
    filter_view_merged: "\u5df2\u5408\u5e76",
    filter_empty: "\u672a\u52a0\u8f7d\u5f39\u5e55",
    filter_empty_blocked: "\u65e0\u5df2\u5c4f\u853d\u5f39\u5e55",
    filter_empty_merged: "\u65e0\u5df2\u5408\u5e76\u5f39\u5e55",
    blocklist_title: "\u5c4f\u853d\u8bcd",
    blocklist_add: "\u6dfb\u52a0",
    blocklist_empty: "\u6682\u65e0\u5c4f\u853d\u8bcd",
    blocklist_placeholder: "\u5c4f\u853d\u8bcd\u6216\u6b63\u5219...",
    blocklist_remove: "\u5220\u9664",
    dedupe_title: "\u5f39\u5e55\u53bb\u91cd",
    dedupe_window: "\u53bb\u91cd\u533a\u95f4 (\u79d2)"
  }
};

function getBrowserLang() {
  var lang = navigator.language || "en";
  if (lang.startsWith("ja")) return "ja";
  if (lang.startsWith("zh")) return "zh";
  return "en";
}

function t(key) {
  var dict = i18n[getBrowserLang()] || i18n.en;
  return dict[key] || i18n.en[key] || key;
}

function applyI18n() {
  var lang = getBrowserLang();
  var dict = i18n[lang];
  document.querySelectorAll("[data-i18n]").forEach(function(el) {
    var key = el.getAttribute("data-i18n");
    if (dict[key]) el.textContent = dict[key];
  });
  document.querySelectorAll("[data-i18n-placeholder]").forEach(function(el) {
    var key = el.getAttribute("data-i18n-placeholder");
    if (dict[key]) el.placeholder = dict[key];
  });
}

function updateOffsetUI() {
  if (offsetInput) {
    offsetInput.value = state.danmakuOffsetSeconds;
  }
}

var FONT_PRESETS = {
  "": "",
  gothic: '"Hiragino Kaku Gothic ProN", "Hiragino Sans", "ヒラギノ角ゴ ProN", sans-serif',
  mincho: '"Hiragino Mincho ProN", "ヒラギノ明朝 ProN", serif',
  maru: '"Hiragino Maru Gothic ProN", "ヒラギノ丸ゴ ProN", sans-serif',
  yugothic: '"Yu Gothic", YuGothic, yugothic, "Hiragino Sans", sans-serif',
  yumincho: '"Yu Mincho", YuMincho, yumincho, "Hiragino Mincho ProN", serif',
  pingfang: '"PingFang SC", "PingFang TC", "Hiragino Sans GB", sans-serif',
  songti: '"Songti SC", "SimSun", "宋体", serif',
  kaiti: '"Kaiti SC", "KaiTi", "楷体", serif',
  yahei: '"Microsoft YaHei", "微软雅黑", "PingFang SC", sans-serif',
  simsun: '"SimSun", "宋体", serif',
  sans: "sans-serif",
  serif: "serif",
  mono: "monospace"
};

function fontFamilyToPresetKey(family) {
  for (var key in FONT_PRESETS) {
    if (FONT_PRESETS.hasOwnProperty(key) && key !== "" && FONT_PRESETS[key] === family) return key;
  }
  return "custom";
}

function updateFontUI() {
  if (!fontSelect || !fontCustomInput || !fontCustomRow) return;
  var key = state.danmakuFontFamily ? fontFamilyToPresetKey(state.danmakuFontFamily) : "";
  fontSelect.value = key;
  if (key === "custom") {
    fontCustomRow.style.display = "";
    fontCustomInput.value = state.danmakuFontFamily;
  } else {
    fontCustomRow.style.display = "none";
  }
  if (fontWeightSlider) {
    fontWeightSlider.value = state.danmakuFontWeight || "400";
  }
  if (fontWeightValue) {
    fontWeightValue.textContent = fontWeightSlider ? fontWeightSlider.value : "400";
  }
}

var STYLE_PRESETS = {
  nico: { fontScale: 1.0, fontWeight: "400", strokeWidth: 2.8, scrollSpeed: 1.0 },
  balanced: { fontScale: 0.5, fontWeight: "400", strokeWidth: 3, scrollSpeed: 0.5 },
  bilibili: { fontScale: 0.35, fontWeight: "200", strokeWidth: 2.5, scrollSpeed: 0.4 }
};

function applyStylePreset(p) {
  // 字体缩放
  state.canvasFontScale = p.fontScale;
  fontsizeSlider.value = Math.round(p.fontScale * 100);
  fontsizeValue.textContent = Math.round(p.fontScale * 100) + "%";
  iina.postMessage("set-fontscale", { scale: p.fontScale });
  // 字体粗细
  state.danmakuFontWeight = p.fontWeight;
  iina.postMessage("set-danmaku-font", { fontFamily: state.danmakuFontFamily, fontWeight: p.fontWeight });
  // 描边粗细
  state.strokeWidth = p.strokeWidth;
  strokeWidthSlider.value = p.strokeWidth;
  strokeWidthValue.textContent = String(p.strokeWidth) + 'px';
  iina.postMessage("set-stroke-width", { width: p.strokeWidth });
  // 滚动速度
  state.scrollSpeed = p.scrollSpeed;
  speedSlider.value = Math.round(p.scrollSpeed * 100);
  speedValue.textContent = Math.round(p.scrollSpeed * 100) + '%';
  iina.postMessage("set-scroll-speed", { speed: p.scrollSpeed });
  updateFontUI();
}

function updateUI() {
  var hasFiles = fileListState.xmlFiles.length > 0 || fileListState.jsonFiles.length > 0;
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
  commentLimitSlider.value = state.commentLimit;
  commentLimitValue.textContent = state.commentLimit > 0 ? String(state.commentLimit) : t('off');
  speedSlider.value = Math.round(state.scrollSpeed * 100);
  speedValue.textContent = Math.round(state.scrollSpeed * 100) + '%';
  if (canvasRendererToggle) canvasRendererToggle.checked = state.useCanvasRenderer;
  if (danmakuForceSimplifiedToggle) danmakuForceSimplifiedToggle.checked = state.danmakuForceSimplified; 
  updateOffsetUI();
  updateFontUI();
  syncStylePresetUI();
  updateFilterUI();
}

function syncStylePresetUI() {
  if (!stylePresetSegmented) return;
  var items = stylePresetSegmented.querySelectorAll(".seg-item");
  for (var i = 0; i < items.length; i++) {
    items[i].classList.toggle("active", items[i].dataset.preset === state.stylePreset);
  }
}

function updateFilterUI() {
  var showRange = state.enabled && state.danmakuLoaded && state.danmakuType === 'nico-json' && state.nicoJsonTotalCount > 100;
  if (filterSection) filterSection.style.display = showRange ? '' : 'none';
  if (showRange) {
    updateRangeSelector();
  }

  var showDensity = state.enabled && state.danmakuLoaded && state.danmakuType === 'nico-json';
  if (densitySection) densitySection.style.display = showDensity ? '' : 'none';
  if (showDensity) {
    updateDensitySlider();
  }
}

function updateDensitySlider() {
  if (!densitySlider || !densityValue) return;
  var density = state.danmakuFilterDensity || 0;
  if (density > 0) {
    densitySlider.value = density;
    densityValue.textContent = density + ' /min';
  } else {
    densitySlider.value = 600;
    densityValue.textContent = t('off');
  }
  if (densityCount) {
    densityCount.textContent = state.filteredCount > 0 ? '\uff08' + state.filteredCount + '\uff09' : '';
  }
}

function updateRangeSelector() {
  var total = state.nicoJsonTotalCount;
  if (total <= 0) {
    if (filterCount) filterCount.textContent = '0';
    if (filterDateNew) filterDateNew.textContent = '';
    if (filterDateOld) filterDateOld.textContent = '';
    if (filterCoverage) {
      filterCoverage.style.left = '0%';
      filterCoverage.style.width = '100%';
    }
    return;
  }
  var offset = state.danmakuFilterOffset || 0;
  var limit = state.danmakuFilterLimit > 0 ? state.danmakuFilterLimit : total;
  if (offset + limit > total) {
    offset = Math.max(0, total - limit);
  }
  if (filterCoverage) {
    var leftPct = (offset / total) * 100;
    var widthPct = (limit / total) * 100;
    filterCoverage.style.left = leftPct + '%';
    filterCoverage.style.width = widthPct + '%';
  }
  if (filterCount) {
    filterCount.textContent = limit;
  }
  if (filterDateNew && filterDateOld) {
    if (state.rangeStartDate && state.rangeEndDate) {
      filterDateNew.textContent = state.rangeStartDate;
      filterDateOld.textContent = state.rangeEndDate;
    } else {
      filterDateNew.textContent = '';
      filterDateOld.textContent = '';
    }
  }
}

toggleDanmaku.addEventListener("change", function () {
  if (toggleDanmaku.disabled) { toggleDanmaku.checked = false; return; }
  state.enabled = toggleDanmaku.checked;
  updateEnabledUI();
  iina.postMessage("toggle-danmaku");
});

// Tab switching (basic / advanced / filter)
if (tabButtons.length) {
  tabButtons.forEach(function (tab) {
    tab.addEventListener("click", function () {
      var name = tab.dataset.tab;
      tabButtons.forEach(function (t) {
        t.classList.toggle("active", t === tab);
      });
      if (tabBasic) tabBasic.style.display = name === "basic" ? "" : "none";
      if (tabAdvanced) tabAdvanced.style.display = name === "advanced" ? "" : "none";
      if (tabFilter) {
        var showFilter = name === "filter";
        tabFilter.style.display = showFilter ? "" : "none";
        if (showFilter) {
          // sidebar 懒加载: 主动拉取弹幕列表 + 开启播放时间推送
          // 带上插件根目录(file:// 定位),供 main 读取 overlay/lib/opencc.min.js(简繁转换)
          iina.postMessage("danmaku-browser-request", { pluginRoot: browserPluginRoot() });
          iina.postMessage("danmaku-browser-watch", { watch: true });
          iina.postMessage("danmaku-blocklist-request");
          iina.postMessage("danmaku-dedupe-request");
        } else {
          iina.postMessage("danmaku-browser-watch", { watch: false });
        }
        browserCountWatchSend();
      }
    });
  });
}

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

if (danmakuForceSimplifiedToggle) {
  danmakuForceSimplifiedToggle.addEventListener("change", function () {
    var forceSimp = danmakuForceSimplifiedToggle.checked;
    state.danmakuForceSimplified = forceSimp;
    
    // 向 IINA 的核心主脚本传递设置更新命令
    iina.postMessage("set-danmaku-force-simplified", { value: forceSimp });
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
  commentLimitValue.textContent = val > 0 ? String(val) : t('off');
  iina.postMessage("set-comment-limit", { limit: val });
});

if (offsetInput) {
  offsetInput.addEventListener("input", function () {
    var val = parseFloat(offsetInput.value);
    if (isNaN(val)) val = 0;
    state.danmakuOffsetSeconds = val;
    iina.postMessage("set-danmaku-offset", { offset: state.danmakuOffsetSeconds });
    updateOffsetUI();
  });
}

if (fontSelect) {
  fontSelect.addEventListener("change", function () {
    var key = fontSelect.value;
    if (key === "custom") {
      fontCustomRow.style.display = "";
      fontCustomInput.focus();
      var customFamily = fontCustomInput.value.trim();
      if (customFamily) {
        state.danmakuFontFamily = customFamily;
        iina.postMessage("set-danmaku-font", { fontFamily: customFamily, fontWeight: state.danmakuFontWeight });
      }
    } else {
      fontCustomRow.style.display = "none";
      var preset = FONT_PRESETS[key] !== undefined ? FONT_PRESETS[key] : "";
      state.danmakuFontFamily = preset;
      iina.postMessage("set-danmaku-font", { fontFamily: preset, fontWeight: state.danmakuFontWeight });
    }
  });
}

if (fontCustomInput) {
  fontCustomInput.addEventListener("input", function () {
    state.danmakuFontFamily = fontCustomInput.value.trim();
    iina.postMessage("set-danmaku-font", { fontFamily: state.danmakuFontFamily, fontWeight: state.danmakuFontWeight });
  });
}

if (fontWeightSlider) {
  fontWeightSlider.addEventListener("input", function () {
    state.danmakuFontWeight = fontWeightSlider.value;
    if (fontWeightValue) fontWeightValue.textContent = fontWeightSlider.value;
    iina.postMessage("set-danmaku-font", { fontFamily: state.danmakuFontFamily, fontWeight: state.danmakuFontWeight });
    });
}

speedSlider.addEventListener("input", function () {
  var val = parseFloat(speedSlider.value) / 100;
  state.scrollSpeed = val;
  speedValue.textContent = Math.round(val * 100) + '%';
  iina.postMessage("set-scroll-speed", { speed: val });
});

if (stylePresetSegmented) {
  stylePresetSegmented.addEventListener("click", function (e) {
    var item = e.target && e.target.closest ? e.target.closest(".seg-item") : null;
    if (!item) return;
    var presetName = item.dataset.preset;
    var preset = STYLE_PRESETS[presetName];
    if (!preset) return;
    applyStylePreset(preset);
    state.stylePreset = presetName;
    iina.postMessage("set-style-preset", { preset: presetName });
    syncStylePresetUI();
  });
}

var MIN_FILTER_LIMIT = 100;
var filterDragMode = null;
var filterDragStartX = 0;
var filterDragStartOffset = 0;
var filterDragStartLimit = 0;
var filterTimer = null;

function sendFilterChange(offset, limit) {
  state.danmakuFilterOffset = offset;
  state.danmakuFilterLimit = limit;
  if (filterTimer) clearTimeout(filterTimer);
  filterTimer = setTimeout(function () {
    iina.postMessage("set-danmaku-filter", { offset: offset, limit: limit });
    filterTimer = null;
  }, 300);
}

function applyFilterDrag(clientX) {
  var total = state.nicoJsonTotalCount;
  if (total <= 0) return;
  var trackRect = rangeSelector.getBoundingClientRect();
  var trackWidth = trackRect.width;
  if (trackWidth <= 0) return;
  var dx = clientX - filterDragStartX;
  var dxCount = Math.round((dx / trackWidth) * total);

  if (filterDragMode === 'move') {
    var newOffset = filterDragStartOffset + dxCount;
    var limit = filterDragStartLimit;
    if (newOffset < 0) newOffset = 0;
    if (newOffset + limit > total) newOffset = total - limit;
    if (newOffset < 0) newOffset = 0;
    var finalLimit = limit < total ? limit : 0;
    updateRangeSelectorState(newOffset, finalLimit, total);
    sendFilterChange(newOffset, finalLimit);
  } else if (filterDragMode === 'resize-left') {
    var newLimit = filterDragStartLimit - dxCount;
    var newOffset2 = filterDragStartOffset + dxCount;
    if (newLimit < MIN_FILTER_LIMIT) {
      newLimit = MIN_FILTER_LIMIT;
      newOffset2 = filterDragStartOffset + (filterDragStartLimit - MIN_FILTER_LIMIT);
    }
    if (newOffset2 < 0) {
      newLimit = newLimit + newOffset2;
      newOffset2 = 0;
      if (newLimit < MIN_FILTER_LIMIT) newLimit = MIN_FILTER_LIMIT;
    }
    if (newOffset2 + newLimit > total) {
      newLimit = total - newOffset2;
    }
    var finalLimit2 = newLimit < total ? newLimit : 0;
    updateRangeSelectorState(newOffset2, finalLimit2, total);
    sendFilterChange(newOffset2, finalLimit2);
  } else if (filterDragMode === 'resize-right') {
    var newLimit3 = filterDragStartLimit + dxCount;
    if (newLimit3 < MIN_FILTER_LIMIT) newLimit3 = MIN_FILTER_LIMIT;
    if (filterDragStartOffset + newLimit3 > total) {
      newLimit3 = total - filterDragStartOffset;
    }
    var finalLimit3 = newLimit3 < total ? newLimit3 : 0;
    updateRangeSelectorState(filterDragStartOffset, finalLimit3, total);
    sendFilterChange(filterDragStartOffset, finalLimit3);
  }
}

function updateRangeSelectorState(offset, limit, total) {
  var displayLimit = limit > 0 ? limit : total;
  state.danmakuFilterOffset = offset;
  state.danmakuFilterLimit = limit;
  if (filterCoverage) {
    var leftPct = (offset / total) * 100;
    var widthPct = (displayLimit / total) * 100;
    filterCoverage.style.left = leftPct + '%';
    filterCoverage.style.width = widthPct + '%';
  }
  if (filterCount) {
    filterCount.textContent = displayLimit;
  }
}

if (filterCoverage) {
  filterCoverage.addEventListener("mousedown", function (e) {
    if (e.target.classList.contains('range-handle')) return;
    filterDragMode = 'move';
    filterDragStartX = e.clientX;
    filterDragStartOffset = state.danmakuFilterOffset || 0;
    filterDragStartLimit = state.danmakuFilterLimit > 0 ? state.danmakuFilterLimit : state.nicoJsonTotalCount;
    e.preventDefault();
  });
}

if (filterHandleLeft) {
  filterHandleLeft.addEventListener("mousedown", function (e) {
    filterDragMode = 'resize-left';
    filterDragStartX = e.clientX;
    filterDragStartOffset = state.danmakuFilterOffset || 0;
    filterDragStartLimit = state.danmakuFilterLimit > 0 ? state.danmakuFilterLimit : state.nicoJsonTotalCount;
    e.preventDefault();
    e.stopPropagation();
  });
}

if (filterHandleRight) {
  filterHandleRight.addEventListener("mousedown", function (e) {
    filterDragMode = 'resize-right';
    filterDragStartX = e.clientX;
    filterDragStartOffset = state.danmakuFilterOffset || 0;
    filterDragStartLimit = state.danmakuFilterLimit > 0 ? state.danmakuFilterLimit : state.nicoJsonTotalCount;
    e.preventDefault();
    e.stopPropagation();
  });
}

document.addEventListener("keydown", function (e) {
  var target = e.target || {};
  var tagName = (target.tagName || '').toLowerCase();
  if (tagName === 'input' || tagName === 'textarea' || tagName === 'select') return;
  var key = e.key ? e.key.toLowerCase() : '';
  if (key === 'a' || key === 'd') {
    e.preventDefault();
    var delta = Math.abs(state.danmakuOffsetSeconds || 0);
    if (delta <= 0) delta = 1;
    if (key === 'a') {
      state.danmakuOffsetSeconds = (state.danmakuOffsetSeconds || 0) - delta;
    } else {
      state.danmakuOffsetSeconds = (state.danmakuOffsetSeconds || 0) + delta;
    }
    iina.postMessage("set-danmaku-offset", { offset: state.danmakuOffsetSeconds });
    updateOffsetUI();
  }
});

document.addEventListener("mousemove", function (e) {
  if (filterDragMode) {
    applyFilterDrag(e.clientX);
  }
});

document.addEventListener("mouseup", function () {
  filterDragMode = null;
});

if (densitySlider) {
  densitySlider.addEventListener("input", function () {
    var val = parseInt(densitySlider.value, 10);
    if (val >= 600) {
      densityValue.textContent = t('off');
    } else {
      densityValue.textContent = val + ' /min';
    }
  });
  densitySlider.addEventListener("change", function () {
    var val = parseInt(densitySlider.value, 10);
    var density = val >= 600 ? 0 : val;
    state.danmakuFilterDensity = density;
    iina.postMessage("set-danmaku-filter-density", { density: density });
  });
}

iina.onMessage("danmaku-filter-info", function (data) {
  if (data.fileType !== undefined) state.danmakuType = data.fileType;
  state.nicoJsonTotalCount = data.totalCount || 0;
  state.danmakuFilterOffset = data.filterOffset || 0;
  state.danmakuFilterLimit = data.filterLimit || 0;
  state.danmakuFilterDensity = data.filterDensity || 0;
  state.filteredCount = data.filteredCount || 0;
  state.rangeStartDate = data.rangeStartDate || null;
  state.rangeEndDate = data.rangeEndDate || null;
  updateFilterUI();
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
  if (data.danmakuTimeOffsetSec !== undefined) state.danmakuOffsetSeconds = data.danmakuTimeOffsetSec;
  if (data.danmakuFontFamily !== undefined) state.danmakuFontFamily = data.danmakuFontFamily;
  if (data.danmakuFontWeight !== undefined) state.danmakuFontWeight = data.danmakuFontWeight;
  if (data.stylePreset !== undefined) state.stylePreset = data.stylePreset;
  if (data.danmakuForceSimplified !== undefined) state.danmakuForceSimplified = !!data.danmakuForceSimplified;
  if (data.danmakuFileType !== undefined) state.danmakuType = data.danmakuFileType;
  if (data.danmakuFileName !== undefined) state.danmakuFileName = data.danmakuFileName;
  if (data.danmakuRelativePath !== undefined) state.danmakuRelativePath = data.danmakuRelativePath;
  if (data.danmakuLoaded !== undefined) state.danmakuLoaded = data.danmakuLoaded;
  if (data.danmakuFilterDensity !== undefined) state.danmakuFilterDensity = data.danmakuFilterDensity;
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
              typeLabel.textContent = ddpState.matchType === 'hash' ? t('match_type_hash') : t('match_type_filename');
              if (ddpState.matchType === 'filename') {
                typeLabel.title = t('match_type_filename_title');
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
  } catch (e) {}
}

if (ddpAutoNetwork) {
  ddpAutoNetwork.addEventListener("change", function () {
    iina.postMessage("dandanplay-set-auto-network", { autoNetwork: ddpAutoNetwork.checked });
  });
}

// 「网络匹配」按钮:展开/收起匹配结果列表;展开时无结果则触发 hash/文件名匹配
// (承接原「网络弹幕」展开头的逻辑)
var ddpMatchBtn = document.getElementById("dandanplay-match-btn");
if (ddpMatchBtn) {
  ddpMatchBtn.addEventListener("click", function () {
    ddpMatchesExpanded = !ddpMatchesExpanded;
    if (ddpMatchesExpanded) {
      // 展开匹配结果时,先收起手动搜索面板(与搜索按钮的行为对称,两列结果不叠加)
      if (ddpSearchPanel) ddpSearchPanel.style.display = 'none';
      if (!ddpState.matches && ddpState.status !== 'matching' && ddpState.status !== 'loading') {
        iina.postMessage("dandanplay-trigger-match");
      }
    }
    if (ddpMatchesList) ddpMatchesList.style.display = ddpMatchesExpanded ? '' : 'none';
  });
}

if (ddpSearchBtn) {
  ddpSearchBtn.addEventListener("click", function () {
    var visible = ddpSearchPanel.style.display !== 'none';
    ddpSearchPanel.style.display = visible ? 'none' : '';
    if (!visible) {
      // 打开手动搜索面板时,收起网络匹配结果列表(避免两列结果叠在一起)
      ddpMatchesExpanded = false;
      if (ddpMatchesList) ddpMatchesList.style.display = 'none';
      if (ddpSearchInput) ddpSearchInput.focus();
    }
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
    // 新视频加载时 main.js 会 ddpResetState() 推送 status='idle':
    // 复位为闭合,避免新视频残留上一个视频的展开状态(列表为空却展开,
    // 用户要收起再展开才能触发匹配)。展开头部时会自动触发匹配
    if (data.status === 'idle') ddpMatchesExpanded = false;
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

    if (ddpSearchResultsHeader) ddpSearchResultsHeader.textContent = t('search_results') + ' (' + animes.length + ')';
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
        sub.textContent = t('click_load_episodes');

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
          sub.textContent = t('loading_episodes');
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
        if (subEl) subEl.textContent = t('episodes_count').replace('{n}', episodes.length);

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

/* ========== Filter tab: danmaku browser list ==========
   全量时间线列表(按 vpos 排序),直播聊天栏式实时跟随: 播放推进时列表锚定
   vpos 对应行并保持其在可视区底部,新出现的弹幕在底部"推出"。
   列表是虚拟滚动: 只渲染视口附近的 ~几十行,滚动时重算,几万条也不卡。
   数据由 sidebar 主动向 main.js 拉取(danmaku-browser-request,懒加载约束);
   main 侧按与 overlay 相同的过滤(切片/密度/强制简体)构建,保证列表与渲染一致。 */
var BROWSER_ROW_H = 26;
var browserItems = [];         // [{t, text, blocked, merged}] 按 t 升序(全量,接收原样)
var browserViewMode = 'all';   // 列表视图: all | blocked | merged
var browserVpos = -1;          // 最近一次时间消息的 vpos(1/100s)
var browserFollowLive = true;  // 跟随模式: 锚定 vpos 行滚动(用户手动翻阅时退出)
var totalEl = document.getElementById("danmaku-browser-total");

// 三个列表容器,各自的数据/渲染缓存/滚动位置完全独立。
// 数据到达时三个都渲染好;切换视图只是改 display——不重建、不碰滚动、无副作用。
var browserLists = {
  all:     { el: document.getElementById("danmaku-browser-list-all"),     items: [], rowNodes: new Map() },
  blocked: { el: document.getElementById("danmaku-browser-list-blocked"), items: [], rowNodes: new Map() },
  merged:  { el: document.getElementById("danmaku-browser-list-merged"),  items: [], rowNodes: new Map() }
};
Object.keys(browserLists).forEach(function (kind) {
  var list = browserLists[kind];
  list.spacerEl = list.el.querySelector(".danmaku-browser-spacer");
  list.emptyEl = list.el.querySelector(".danmaku-browser-empty");
});

function browserCurrentList() {
  return browserLists[browserViewMode];
}

// sidebar 自身的 file:// 根目录,上报给 main 用于读 overlay/lib/opencc.min.js
function browserPluginRoot() {
  try {
    var u = new URL('../', window.location.href);
    var p = decodeURIComponent(u.pathname);
    if (p.length > 1 && p.charAt(p.length - 1) === '/') p = p.slice(0, -1);
    return p;
  } catch (e) {
    return '';
  }
}

function browserFmtTime(vpos) {
  var sec = Math.floor((vpos || 0) / 100);
  var h = Math.floor(sec / 3600);
  var m = Math.floor((sec % 3600) / 60);
  var s = sec % 60;
  var p = function (n) { return n < 10 ? "0" + n : String(n); };
  return h > 0 ? h + ":" + p(m) + ":" + p(s) : p(m) + ":" + p(s);
}

// 二分查找: 最后一个 t <= vpos 的行号(用于无在屏弹幕时锚定当前位置)
function browserRowForVpos(vpos, items) {
  var lo = 0, hi = items.length - 1, ans = -1;
  while (lo <= hi) {
    var mid = (lo + hi) >> 1;
    if (items[mid].t <= vpos) { ans = mid; lo = mid + 1; }
    else hi = mid - 1;
  }
  return ans;
}

// 弹幕内容里的时间(m:ss / h:mm:ss)→ 可点击链接,点击 seek 到该时间。
// 普通文本保留为文本节点(可复制),时间部分拆成独立 span。
function browserRenderTextWithLinks(text, container) {
  var re = /(\d{1,2}):(\d{2})(?::(\d{2}))?/g;
  var last = 0, m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) container.appendChild(document.createTextNode(text.slice(last, m.index)));
    var sec = m[3] !== undefined
      ? parseInt(m[1], 10) * 3600 + parseInt(m[2], 10) * 60 + parseInt(m[3], 10)
      : parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
    var link = document.createElement("span");
    link.className = "danmaku-time-link";
    link.textContent = m[0];
    (function (vpos) {
      link.addEventListener("click", function (e) {
        e.stopPropagation(); // 不干扰行内文本选择
        iina.postMessage("danmaku-seek", { vpos: vpos });
      });
    })(sec * 100);
    container.appendChild(link);
    last = m.index + m[0].length;
  }
  if (last < text.length) container.appendChild(document.createTextNode(text.slice(last)));
  if (last === 0 && container.childNodes.length === 0) container.textContent = text;
}

// 渲染一个列表容器的可视窗口(虚拟滚动)。容器滚动位置自洽:
// scrollTop 被 clamp 到自身数据范围,渲染窗口永远跟随视口。
function browserRenderList(list) {
  if (!list || !list.el) return;
  var items = list.items;
  var total = items.length;
  list.spacerEl.style.height = (total * BROWSER_ROW_H) + "px";
  if (total === 0) {
    list.rowNodes.forEach(function (el) { el.remove(); });
    list.rowNodes.clear();
    list.emptyEl.style.display = "";
    return;
  }
  list.emptyEl.style.display = "none";
  var rawScrollTop = list.el.scrollTop;
  var viewH = list.el.clientHeight;
  var maxScroll = Math.max(0, total * BROWSER_ROW_H - viewH);
  var scrollTop = Math.min(rawScrollTop, maxScroll);
  var first = Math.max(0, Math.floor(scrollTop / BROWSER_ROW_H) - 8);
  var last = Math.min(total - 1, Math.ceil((scrollTop + viewH) / BROWSER_ROW_H) + 8);
  if (first > last) {
    first = 0;
    last = Math.min(total - 1, Math.ceil(viewH / BROWSER_ROW_H) + 8);
  }
  list.rowNodes.forEach(function (el, row) {
    if (row < first || row > last) { el.remove(); list.rowNodes.delete(row); }
  });
  // 已屏蔽视图整列表都是屏蔽弹幕,不画删除线(视图本身表明身份)
  var isBlockedView = list === browserLists.blocked;
  for (var row = first; row <= last; row++) {
    var node = list.rowNodes.get(row);
    if (node) continue;
    var item = items[row];
    var div = document.createElement("div");
    div.className = "danmaku-browser-row" + (item.blocked && !isBlockedView ? " blocked" : "");
    div.style.top = (row * BROWSER_ROW_H) + "px";
    var time = document.createElement("span");
    time.className = "danmaku-browser-time";
    time.textContent = browserFmtTime(item.t);
    // 点击时间戳 → 跳转到该弹幕时间(main 做 seek,含弹幕偏移换算)
    (function (vpos) {
      time.addEventListener("click", function (e) {
        e.stopPropagation(); // 不干扰整行的复制选择
        iina.postMessage("danmaku-seek", { vpos: vpos });
      });
    })(item.t);
    var text = document.createElement("span");
    text.className = "danmaku-browser-text";
    // 弹幕内容里的时间(m:ss / h:mm:ss,如"空降 01:39")渲染为可点击跳转
    browserRenderTextWithLinks(item.text, text);
    div.appendChild(time);
    div.appendChild(text);
    list.spacerEl.appendChild(div);
    list.rowNodes.set(row, div);
  }
}

// 切换列表视图(全部/已屏蔽/已合并): 三个列表早已渲染好,只切 display
function browserSetViewMode(mode) {
  if (mode !== 'all' && mode !== 'blocked' && mode !== 'merged') return;
  browserViewMode = mode;
  if (browserViewSelect) browserViewSelect.value = mode;
  browserLists.all.el.style.display = mode === 'all' ? "" : "none";
  browserLists.blocked.el.style.display = mode === 'blocked' ? "" : "none";
  browserLists.merged.el.style.display = mode === 'merged' ? "" : "none";
  browserUpdateTotal();
  browserUpdateDiag();
}

// 当前视图条数显示
function browserUpdateTotal() {
  if (!totalEl) return;
  var n = browserCurrentList().items.length;
  totalEl.textContent = n > 0 ? n.toLocaleString() : "";
}

function browserUpdateLiveUI() {
  var liveEl = document.getElementById("danmaku-browser-live");
  if (liveEl) {
    liveEl.textContent = browserVpos >= 0 && browserItems.length > 0
      ? browserFmtTime(browserVpos)
      : '';
  }
  var btn = document.getElementById("danmaku-browser-follow-btn");
  if (btn) btn.style.display = (browserFollowLive || browserItems.length === 0) ? "none" : "";
}

// 聊天栏式跟随: 锚定 vpos 对应行并保持其在可视区底部,新弹幕到点在底部"推出"
function browserFollowToLive() {
  var list = browserCurrentList();
  if (!list || list.items.length === 0) return;
  var anchorRow = browserRowForVpos(browserVpos, list.items);
  if (anchorRow < 0) return;
  var viewH = list.el.clientHeight;
  var target = Math.max(0, (anchorRow + 1) * BROWSER_ROW_H - viewH);
  browserProgramScrollTop = target;
  list.el.scrollTop = target;
  browserRenderList(list); // 立即渲染,不等浏览器派发 scroll 事件
}

var browserNextChunk = 0;
var browserLastRefreshRequest = 0;

// ── 诊断计数器(过滤 tab 状态行,数据异常时展示) ──
var browserDiag = { watchSent: 0, dataMsgs: 0, timeMsgs: 0, decodeErrs: 0 };

function browserUpdateDiag() {
  var el = document.getElementById("danmaku-browser-status");
  if (!el) return;
  if (browserItems.length > 0) {
    el.textContent = 'browser v22';
    el.classList.remove('broken');
    return;
  }
  el.classList.add('broken');
  el.textContent = 'v22 watch→' + browserDiag.watchSent
    + ' data←' + browserDiag.dataMsgs
    + ' time←' + browserDiag.timeMsgs
    + ' items=' + browserItems.length
    + ' err=' + browserDiag.decodeErrs;
}

function browserCountWatchSend() {
  browserDiag.watchSent++;
  browserUpdateDiag();
}

// 数据缺失时重发拉取请求,限流避免循环
function requestBrowserDataRefresh() {
  var now = Date.now();
  if (now - browserLastRefreshRequest < 1500) return;
  browserLastRefreshRequest = now;
  debugLog('danmaku-browser: data missing, re-requesting');
  iina.postMessage("danmaku-browser-request", { pluginRoot: browserPluginRoot() });
  iina.postMessage("danmaku-browser-watch", { watch: true });
  browserCountWatchSend();
}

// main.js 以 base64 编码投递(绕开 IINA 桥的模板字符串注入);解码失败返回 null
function browserDecodePayload(payload) {
  try {
    var bin = atob(payload);
    var bytes = [];
    for (var i = 0; i < bin.length; i++) bytes.push(bin.charCodeAt(i));
    return JSON.parse(browserUtf8Decode(bytes));
  } catch (e) {
    return null;
  }
}

function browserUtf8Decode(bytes) {
  var out = '';
  for (var i = 0; i < bytes.length;) {
    var b = bytes[i];
    if (b < 0x80) {
      out += String.fromCharCode(b);
      i++;
    } else if (b < 0xE0) {
      out += String.fromCharCode(((b & 0x1F) << 6) | (bytes[i + 1] & 0x3F));
      i += 2;
    } else if (b < 0xF0) {
      out += String.fromCharCode(((b & 0x0F) << 12) | ((bytes[i + 1] & 0x3F) << 6) | (bytes[i + 2] & 0x3F));
      i += 3;
    } else {
      var cp = ((b & 0x07) << 18) | ((bytes[i + 1] & 0x3F) << 12) | ((bytes[i + 2] & 0x3F) << 6) | (bytes[i + 3] & 0x3F);
      out += String.fromCharCode(((cp - 0x10000) >> 10) + 0xD800, ((cp - 0x10000) & 0x3FF) + 0xDC00);
      i += 4;
    }
  }
  return out;
}

iina.onMessage("danmaku-browser-data", function (data) {
  if (!data) return;
  browserDiag.dataMsgs++;
  var items = null;
  if (typeof data.payload === 'string') {
    items = browserDecodePayload(data.payload);
    if (items === null) {
      browserDiag.decodeErrs++;
      browserUpdateDiag();
      requestBrowserDataRefresh(); // 解码失败: 请求重发
      return;
    }
  } else if (Array.isArray(data.items)) {
    items = data.items;
  }
  if (items === null) {
    browserUpdateDiag();
    return;
  }
  // 兼容旧格式(无 chunkIndex/done 的单条消息)
  var chunkIndex = data.chunkIndex === undefined ? 0 : data.chunkIndex;
  var isDone = data.done !== false;
  if (chunkIndex === 0) {
    // 新数据或重发: 重置状态
    browserItems = [];
    browserVpos = -1;
    browserNextChunk = 1;
    Object.keys(browserLists).forEach(function (kind) {
      var list = browserLists[kind];
      list.items = [];
      list.rowNodes.forEach(function (el) { el.remove(); });
      list.rowNodes.clear();
    });
  } else if (chunkIndex === browserNextChunk) {
    browserNextChunk = chunkIndex + 1;
  } else {
    requestBrowserDataRefresh(); // 丢块/乱序: 丢弃不完整数据并重新拉取
    browserUpdateDiag();
    return;
  }
  // 追加本块
  for (var i = 0; i < items.length; i++) {
    var item = items[i];
    if (!item || typeof item.t !== 'number' || !isFinite(item.t) || !item.text) continue;
    browserItems.push({ t: item.t, text: item.text, blocked: !!item.blocked, merged: !!item.merged });
  }
  if (!isDone) {
    // 传输中不渲染(三个容器在 done 时一次性渲染)
    browserUpdateDiag();
    return;
  }
  // 全部收齐: 按标记一次性分类给三个容器并各自渲染(切换只切 display)
  debugLog('danmaku-browser: data complete, total=' + browserItems.length + ', chunks=' + (chunkIndex + 1));
  browserLists.all.items = browserItems;
  browserLists.blocked.items = [];
  browserLists.merged.items = [];
  for (var bi = 0; bi < browserItems.length; bi++) {
    if (browserItems[bi].blocked) browserLists.blocked.items.push(browserItems[bi]);
    if (browserItems[bi].merged) browserLists.merged.items.push(browserItems[bi]);
  }
  browserRenderList(browserLists.all);
  browserRenderList(browserLists.blocked);
  browserRenderList(browserLists.merged);
  browserUpdateTotal();
  browserUpdateLiveUI();
  browserUpdateDiag();
});

// 播放时间推送(main.js 300ms 节流): 更新锚点;跟随模式下滚动到 vpos 行(聊天栏式)
iina.onMessage("danmaku-visible-time", function (data) {
  if (!data || typeof data.time !== 'number') return;
  browserDiag.timeMsgs++;
  var vpos = Math.round((data.time + (data.offset || 0)) * 100);
  browserVpos = vpos;
  // 自愈: 时间信号在流动但本地无列表数据 → 重新拉取
  if (browserItems.length === 0) requestBrowserDataRefresh();
  browserUpdateLiveUI();
  browserUpdateDiag();
  if (browserFollowLive) browserFollowToLive();
});

var browserProgramScrollTop = -1; // 程序滚动目标(跟随锚定);scroll 事件据此区分手动/程序滚动

// 每个列表容器独立监听滚动: 虚拟渲染重算窗口;手动滚动退出跟随
Object.keys(browserLists).forEach(function (kind) {
  var list = browserLists[kind];
  list.el.addEventListener("scroll", function () {
    if (browserProgramScrollTop >= 0 && Math.abs(list.el.scrollTop - browserProgramScrollTop) < 1) {
      browserProgramScrollTop = -1;
      browserRenderList(list); // 程序滚动(跟随锚定): 重渲染,不退出跟随
      return;
    }
    browserProgramScrollTop = -1;
    if (browserFollowLive && kind === browserViewMode) {
      browserFollowLive = false; // 用户手动翻阅: 暂停跟随
      browserUpdateLiveUI();
    }
    browserRenderList(list);
  });
});

var browserFollowBtn = document.getElementById("danmaku-browser-follow-btn");
if (browserFollowBtn) {
  browserFollowBtn.addEventListener("click", function () {
    browserFollowLive = true;
    browserUpdateLiveUI();
    browserFollowToLive();
  });
}

// 侧栏初始在基础 tab: 显式关掉监听,清除 main.js 侧可能残留的 watch 状态
iina.postMessage("danmaku-browser-watch", { watch: false });
browserCountWatchSend();
browserUpdateDiag();

// 弹幕列表视图下拉(原生 select,样式与字体选择器一致)
var browserViewSelect = document.getElementById("danmaku-browser-view-select");
if (browserViewSelect) {
  browserViewSelect.addEventListener("change", function () {
    browserSetViewMode(this.value);
  });
}

/* ========== 屏蔽词(tag 列表 + 开关 + 添加/删除) ========== */
var blocklistToggle = document.getElementById("danmaku-blocklist-toggle");
var blocklistPanel = document.getElementById("danmaku-blocklist-panel");
var blocklistTags = document.getElementById("danmaku-blocklist-tags");
var blocklistEmpty = document.getElementById("danmaku-blocklist-empty");
var blocklistInput = document.getElementById("danmaku-blocklist-input");
var blocklistAddBtn = document.getElementById("danmaku-blocklist-add-btn");
var blocklistWords = [];

function renderBlocklist() {
  if (!blocklistTags) return;
  blocklistTags.innerHTML = '';
  if (blocklistEmpty) blocklistEmpty.style.display = blocklistWords.length === 0 ? "" : "none";
  for (var i = 0; i < blocklistWords.length; i++) {
    var chip = document.createElement("span");
    chip.className = "danmaku-blocklist-tag";
    var label = document.createElement("span");
    label.className = "danmaku-blocklist-tag-text";
    label.textContent = blocklistWords[i];
    var x = document.createElement("button");
    x.className = "danmaku-blocklist-tag-x";
    x.textContent = "\u00d7";
    x.title = t('blocklist_remove');
    x.setAttribute("data-clickable", "");
    (function (idx) {
      x.addEventListener("click", function () {
        iina.postMessage("danmaku-blocklist-remove", { index: idx });
      });
    })(i);
    chip.appendChild(label);
    chip.appendChild(x);
    blocklistTags.appendChild(chip);
  }
}

function applyBlocklistState(state) {
  if (!state) return;
  if (typeof state.enabled === 'boolean') {
    if (blocklistToggle) blocklistToggle.checked = state.enabled;
    if (blocklistPanel) blocklistPanel.style.display = state.enabled ? "" : "none";
  }
  if (Array.isArray(state.words)) {
    blocklistWords = state.words.slice();
    renderBlocklist();
  }
}

iina.onMessage("danmaku-blocklist-state", function (data) {
  applyBlocklistState(data);
});

if (blocklistToggle) {
  blocklistToggle.addEventListener("change", function () {
    var on = blocklistToggle.checked;
    if (blocklistPanel) blocklistPanel.style.display = on ? "" : "none";
    iina.postMessage("danmaku-blocklist-set-enabled", { enabled: on });
  });
}

if (blocklistAddBtn && blocklistInput) {
  blocklistAddBtn.addEventListener("click", function () {
    if (blocklistInput.style.display === "none") {
      // 第一次点击: 显示输入框
      blocklistInput.style.display = "";
      blocklistInput.focus();
      return;
    }
    // 输入框已显示: 提交(空内容不提交)
    var w = blocklistInput.value.trim();
    if (!w) return;
    iina.postMessage("danmaku-blocklist-add", { word: w });
    blocklistInput.value = "";
    blocklistInput.style.display = "none";
  });
  blocklistInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter") {
      blocklistAddBtn.click();
    } else if (e.key === "Escape") {
      blocklistInput.value = "";
      blocklistInput.style.display = "none";
    }
  });
}

/* ========== 弹幕去重(开关 + 区间输入) ========== */
var dedupeToggle = document.getElementById("danmaku-dedupe-toggle");
var dedupeRow = document.getElementById("danmaku-dedupe-row");
var dedupeInput = document.getElementById("danmaku-dedupe-input");

function applyDedupeState(state) {
  if (!state) return;
  if (typeof state.enabled === 'boolean') {
    if (dedupeToggle) dedupeToggle.checked = state.enabled;
    if (dedupeRow) dedupeRow.style.display = state.enabled ? "" : "none";
  }
  if (typeof state.window === 'number' && dedupeInput) {
    dedupeInput.value = String(state.window);
  }
}

iina.onMessage("danmaku-dedupe-state", function (data) {
  applyDedupeState(data);
});

if (dedupeToggle && dedupeInput) {
  dedupeToggle.addEventListener("change", function () {
    var on = dedupeToggle.checked;
    if (dedupeRow) dedupeRow.style.display = on ? "" : "none";
    iina.postMessage("danmaku-dedupe-set", { enabled: on });
  });
  dedupeInput.addEventListener("change", function () {
    var w = parseFloat(dedupeInput.value);
    if (!isFinite(w)) {
      dedupeInput.value = "2";
      return;
    }
    if (w < 1) w = 1;
    if (w > 5) w = 5;
    dedupeInput.value = String(w);
    iina.postMessage("danmaku-dedupe-set", { window: w });
  });
}
