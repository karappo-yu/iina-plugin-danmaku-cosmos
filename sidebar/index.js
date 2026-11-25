function onPluginMessage(name, callback) {
  iina.onMessage(name, function (data) {
    if (data && typeof data.__encoded === 'string') {
      data = JSON.parse(decodeURIComponent(data.__encoded));
    }
    callback(data);
  });
}

var toggleDanmaku = document.getElementById("toggle-danmaku");
var canvasRendererToggle = document.getElementById("canvas-renderer-toggle");
var danmakuForceSimplifiedToggle = document.getElementById("danmaku-force-simplified-toggle"); 
let danmakuForceSimplifiedRow = document.getElementById("danmaku-force-simplified-row");
var danmakuAutoOffsetToggle = document.getElementById("danmaku-auto-offset-toggle"); 
let danmakuAutoOffsetRow = document.getElementById("danmaku-auto-offset-row");
let blockTopToggle = document.getElementById("danmaku-block-top-toggle");
let blockBottomToggle = document.getElementById("danmaku-block-bottom-toggle");
var opacitySlider = document.getElementById("opacity-slider");
var opacityValue = document.getElementById("opacity-value");
var fontsizeSlider = document.getElementById("fontsize-slider");
var fontsizeValue = document.getElementById("fontsize-value");
var strokeOpacitySlider = document.getElementById("stroke-opacity-slider");
var strokeOpacityValue = document.getElementById("stroke-opacity-value");
var strokeWidthSlider = document.getElementById("stroke-width-slider");
var strokeWidthValue = document.getElementById("stroke-width-value");
let cssTextShadowControl = document.getElementById("css-text-shadow-control");
let cssTextShadowBlurSlider = document.getElementById("css-text-shadow-blur-slider");
let cssTextShadowBlurValue = document.getElementById("css-text-shadow-blur-value");
var strokeColorInput = document.getElementById("stroke-color");
var strokeInversionInput = document.getElementById("stroke-inversion-color");
var commentLimitSlider = document.getElementById("comment-limit-slider");
var commentLimitValue = document.getElementById("comment-limit-value");
// The rightmost stop means unlimited; keep this in sync with index.html's max.
let COMMENT_LIMIT_SLIDER_UNLIMITED = 210;
var speedSlider = document.getElementById("speed-slider");
var speedValue = document.getElementById("speed-value");
var offsetInput = document.getElementById("danmaku-offset-input");
var durationMismatchHint = document.getElementById("duration-mismatch-hint");
var fontSelect = document.getElementById("danmaku-font-select");
var fontCustomRow = document.getElementById("danmaku-font-custom-row");
var fontCustomInput = document.getElementById("danmaku-font-custom");
var fontWeightSlider = document.getElementById("danmaku-font-weight-slider");
var fontWeightValue = document.getElementById("danmaku-font-weight-value");
var stylePresetSegmented = document.getElementById("style-preset-segmented");
var filterSection = document.getElementById("danmaku-filter-section");
let filterDateStart = document.getElementById("danmaku-filter-date-start");
let filterDateEnd = document.getElementById("danmaku-filter-date-end");
var filterCount = document.getElementById("filter-count");
var rangeSelector = document.getElementById("danmaku-range-selector");
var filterCoverage = document.getElementById("filter-coverage");
var filterHandleLeft = document.getElementById("filter-handle-left");
var filterHandleRight = document.getElementById("filter-handle-right");
var densitySlider = document.getElementById("density-slider");
var densityValue = document.getElementById("density-value");
var densityCount = document.getElementById("density-count");
// The rightmost stop means unlimited; keep this in sync with index.html's max.
var DENSITY_SLIDER_OFF = 550;
let pendingDensityValue = null;
let endDensityInputEdit = function () {};
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
  episodeId: null,
  error: null,
  matches: null,
  matchType: '',
  autoNetwork: false
};

var settingsSections = [
  document.getElementById('danmaku-basic-sliders-card') || opacitySlider.closest('.section')
];

var state = {
  dateInfo: {firstDay: null, lastDay: null, dayCounts: [], undatedCount: 0},
  danmakuFilterStartDay: null, danmakuFilterEndDay: null,
};

var fileListState = {
  xmlFiles: [],
  jsonFiles: [],
  selectedPaths: [],
  errorPaths: {}
};

function createFileItem(fileInfo, isChecked) {
  var item = document.createElement('div');
  item.className = 'danmaku-file-item' + (isChecked ? ' selected' : '');

  item.addEventListener('click', function () {
    iina.postMessage("select-danmaku-file", { path: fileInfo.path });
  });

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

  if (fileInfo.type) {
    var tag = document.createElement('span');
    tag.className = 'danmaku-file-type-tag';
    tag.textContent = fileInfo.type;
    item.appendChild(tag);
  }

  if (fileListState.errorPaths[fileInfo.path]) {
    var errorEl = document.createElement('div');
    errorEl.className = 'danmaku-file-item-error';
    errorEl.textContent = fileListState.errorPaths[fileInfo.path];
    item.appendChild(errorEl);
  }

  return item;
}

function createFileGroup(files, selectedPaths) {
  if (files.length === 0) return null;
  var group = document.createElement('div');
  group.className = 'danmaku-file-group';
  for (var i = 0; i < files.length; i++) {
    var isChecked = selectedPaths.indexOf(files[i].path) !== -1;
    group.appendChild(createFileItem(files[i], isChecked));
  }
  return group;
}

function renderFileList() {
  var container = document.getElementById('danmaku-file-list-container');
  if (!container) return;
  container.innerHTML = '';
  var allFiles = fileListState.xmlFiles.concat(fileListState.jsonFiles);
  allFiles.sort(function (a, b) { return String(a.filename).localeCompare(String(b.filename)); });
  var group = createFileGroup(allFiles, fileListState.selectedPaths);
  if (group) {
    container.appendChild(group);
  } else {
    var emptyGroup = document.createElement('div');
    emptyGroup.className = 'danmaku-file-group';
    var emptyRow = document.createElement('div');
    emptyRow.className = 'danmaku-file-item danmaku-file-empty-row';
    var emptyText = document.createElement('span');
    emptyText.className = 'danmaku-file-item-name';
    emptyText.textContent = t('filter_empty');
    emptyRow.appendChild(emptyText);
    emptyGroup.appendChild(emptyRow);
    container.appendChild(emptyGroup);
  }
}

function updateEnabledUI() {
  if (state.enabled === undefined) return;
  var hasFiles = fileListState.xmlFiles.length > 0 || fileListState.jsonFiles.length > 0;
  var show = state.enabled && (state.danmakuLoaded || hasFiles);
  settingsSections.forEach(function(sec) {
    if (sec) sec.style.display = show ? '' : 'none';
  });
  updateFilterUI();
}

var i18n = {
  en: {
    font_default: "Default",
    font_custom: "Custom\u2026",
    font_japanese: "Japanese",
    font_chinese: "Chinese",
    font_generic: "Generic",
    filter_empty: "No danmaku loaded",
    render_error: "Unable to display results",
    click_retry: "Click to retry",
    episode_number: "Episode {n}",
    danmaku_visible: "Danmaku On",
    opacity: "Danmaku Opacity",
    font_scale: "Font Scale",
    danmaku_filter: "Date Slice",
    date_filter_start: "Start date",
    date_filter_end: "End date",
    density_filter: "Danmaku Density",

    tab_basic: "Basic",
    tab_advanced: "Advanced",
    style_preset: "Style Preset",
    style_balanced: "Balanced",
    danmaku_offset: "Danmaku Offset (s)",
    duration_diff_label: "Duration diff:",
    duration_diff_longer: "video is {diff}s longer than danmaku source",
    duration_diff_shorter: "video is {diff}s shorter than danmaku source",
    danmaku_font_family: "Font Family",
    danmaku_font_custom: "Custom Font",
    danmaku_font_weight: "Weight",
    comment_limit: "Max on Screen",
    stroke_color: "Stroke / Shadow Color",
    stroke_inversion: "Invert Color",
    stroke_opacity: "Stroke / Shadow Opacity",
    stroke_width: "Width",
    css_text_shadow_blur: "Shadow blur",
    scroll_speed: "Scroll Speed",
    file_add: "Add Local",
    unlimited: "Unlimited",
    dandanplay_search_placeholder: "Anime title...",
    dandanplay_search: "Search",
    dandanplay_search_go: "Go",
    dandanplay_match: "Network Match",
    ddp_auto_network: "Auto-load network danmaku",
    canvas_renderer: "Use Canvas renderer",
    danmaku_force_simplified: "Force Simplified Chinese",
    danmaku_auto_offset: "Auto set intro offset",
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
    blocklist_title: "Block Words",
    blocklist_add: "Add",
    blocklist_placeholder: "word or /regex/...",
    blocklist_remove: "Remove",
    block_top: "Block Top Danmaku",
    block_bottom: "Block Bottom Danmaku",
    dedupe_title: "Deduplicate",
    dedupe_window: "Window (sec)",
    blocklist_invalid: "Invalid or potentially slow regex; matched as plain text"
  },
  ja: {
    font_default: "\u65e2\u5b9a",
    font_custom: "\u30ab\u30b9\u30bf\u30e0\u2026",
    font_japanese: "\u65e5\u672c\u8a9e",
    font_chinese: "\u4e2d\u56fd\u8a9e",
    font_generic: "\u6c4e\u7528",
    filter_empty: "\u30b3\u30e1\u30f3\u30c8\u672a\u8aad\u307f\u8fbc\u307f",
    render_error: "\u7d50\u679c\u3092\u8868\u793a\u3067\u304d\u307e\u305b\u3093",
    click_retry: "\u30af\u30ea\u30c3\u30af\u3057\u3066\u518d\u8a66\u884c",
    episode_number: "\u7b2c{n}\u8a71",
    danmaku_visible: "\u30b3\u30e1\u30f3\u30c8\u8868\u793a",
    opacity: "\u30b3\u30e1\u30f3\u30c8\u900f\u660e\u5ea6",
    font_scale: "\u30d5\u30a9\u30f3\u30c8\u500d\u7387",
    danmaku_filter: "\u65e5\u4ed8\u30b9\u30e9\u30a4\u30b9",
    date_filter_start: "\u958b\u59cb\u65e5",
    date_filter_end: "\u7d42\u4e86\u65e5",
    density_filter: "\u30b3\u30e1\u30f3\u30c8\u5bc6\u5ea6",

    tab_basic: "\u57fa\u672c",
    tab_advanced: "\u8a73\u7d30",
    style_preset: "\u30b9\u30bf\u30a4\u30eb\u30d7\u30ea\u30bb\u30c3\u30c8",
    style_balanced: "\u30d0\u30e9\u30f3\u30b9",
    danmaku_offset: "\u30b3\u30e1\u30f3\u30c8\u6642\u9593\u30aa\u30d5\u30bb\u30c3\u30c8 (\u79d2)",
    duration_diff_label: "\u6642\u9593\u5dee:",
    duration_diff_longer: "\u52d5\u753b\u304c\u30b3\u30e1\u30f3\u30c8\u30bd\u30fc\u30b9\u3088\u308a {diff}\u79d2\u9577\u3044",
    duration_diff_shorter: "\u52d5\u753b\u304c\u30b3\u30e1\u30f3\u30c8\u30bd\u30fc\u30b9\u3088\u308a {diff}\u79d2\u77ed\u3044",
    danmaku_font_family: "\u30d5\u30a9\u30f3\u30c8",
    danmaku_font_custom: "\u30ab\u30b9\u30bf\u30e0\u30d5\u30a9\u30f3\u30c8",
    danmaku_font_weight: "\u592a\u3055",
    comment_limit: "\u540c\u6642\u8868\u793a\u4e0a\u9650",
    stroke_color: "\u7e01\u53d6\u308a\u30fb\u5f71\u306e\u8272",
    stroke_inversion: "\u9006\u7e01\u53d6\u308a\u8272",
    stroke_opacity: "\u7e01\u53d6\u308a\u30fb\u5f71\u306e\u4e0d\u900f\u660e\u5ea6",
    stroke_width: "\u7e01\u53d6\u308a\u306e\u592a\u3055",
    css_text_shadow_blur: "\u5f71\u306e\u307c\u304b\u3057",
    scroll_speed: "\u30b9\u30af\u30ed\u30fc\u30eb\u901f\u5ea6",
    file_add: "\u30ed\u30fc\u30ab\u30eb\u8ffd\u52a0",
    unlimited: "\u7121\u5236\u9650",
    dandanplay_search_placeholder: "\u30a2\u30cb\u30e1\u30bf\u30a4\u30c8\u30eb...",
    dandanplay_search: "\u691c\u7d22",
    dandanplay_search_go: "Go",
    dandanplay_match: "\u30cd\u30c3\u30c8\u30de\u30c3\u30c1",
    ddp_auto_network: "\u30cd\u30c3\u30c8\u30ef\u30fc\u30af\u30b3\u30e1\u30f3\u30c8\u3092\u81ea\u52d5\u8aad\u307f\u8fbc\u307f",
    canvas_renderer: "Canvas \u63cf\u753b\u3092\u4f7f\u7528",
    danmaku_force_simplified: "\u7c21\u4f53\u5b57\u306b\u5f37\u5236\u5909\u63db",
    danmaku_auto_offset: "\u30aa\u30d5\u30bb\u30c3\u30c8\u81ea\u52d5\u8a2d\u5b9a",
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
    blocklist_title: "\u30d6\u30ed\u30c3\u30af\u8a9e",
    blocklist_add: "\u8ffd\u52a0",
    blocklist_placeholder: "\u5358\u8a9e\u307e\u305f\u306f /\u6b63\u898f\u8868\u73fe/...",
    blocklist_remove: "\u524a\u9664",
    block_top: "\u4e0a\u90e8\u30b3\u30e1\u30f3\u30c8\u3092\u30d6\u30ed\u30c3\u30af",
    block_bottom: "\u4e0b\u90e8\u30b3\u30e1\u30f3\u30c8\u3092\u30d6\u30ed\u30c3\u30af",
    dedupe_title: "\u91cd\u8907\u30b3\u30e1\u30f3\u30c8\u5408\u4f75",
    dedupe_window: "\u5408\u4f75\u7bc4\u56f2 (\u79d2)",
    blocklist_invalid: "\u7121\u52b9\u307e\u305f\u306f\u51e6\u7406\u304c\u91cd\u3044\u6b63\u898f\u8868\u73fe\u306e\u305f\u3081\u3001\u901a\u5e38\u306e\u6587\u5b57\u5217\u3068\u3057\u3066\u7167\u5408\u3057\u307e\u3059"
  },
  zh: {
    font_default: "\u9ed8\u8ba4",
    font_custom: "\u81ea\u5b9a\u4e49\u2026",
    font_japanese: "\u65e5\u6587",
    font_chinese: "\u4e2d\u6587",
    font_generic: "\u901a\u7528",
    filter_empty: "\u672a\u52a0\u8f7d\u5f39\u5e55",
    render_error: "\u65e0\u6cd5\u663e\u793a\u7ed3\u679c",
    click_retry: "\u70b9\u51fb\u91cd\u8bd5",
    episode_number: "\u7b2c {n} \u96c6",
    danmaku_visible: "\u5f39\u5e55\u663e\u793a",
    opacity: "\u5f39\u5e55\u900f\u660e\u5ea6",
    font_scale: "\u5b57\u4f53\u7f29\u653e",
    danmaku_filter: "\u65e5\u671f\u5207\u7247",
    date_filter_start: "\u5f00\u59cb\u65e5\u671f",
    date_filter_end: "\u7ed3\u675f\u65e5\u671f",
    density_filter: "\u5f39\u5e55\u5bc6\u5ea6",

    tab_basic: "\u57fa\u7840",
    tab_advanced: "\u9ad8\u7ea7",
    style_preset: "\u98ce\u683c\u9884\u8bbe",
    style_balanced: "\u5e73\u8861",
    danmaku_offset: "\u5f39\u5e55\u65f6\u95f4\u504f\u79fb (\u79d2)",
    duration_diff_label: "\u5f53\u524d\u5dee\u503c:",
    duration_diff_longer: "\u89c6\u9891\u6bd4\u5f39\u5e55\u6e90\u957f {diff} \u79d2",
    duration_diff_shorter: "\u89c6\u9891\u6bd4\u5f39\u5e55\u6e90\u77ed {diff} \u79d2",
    danmaku_font_family: "\u5b57\u4f53",
    danmaku_font_custom: "\u81ea\u5b9a\u4e49\u5b57\u4f53",
    danmaku_font_weight: "\u7c97\u7ec6",
    comment_limit: "\u540c\u5c4f\u4e0a\u9650",
    stroke_color: "\u63cf\u8fb9 / \u9634\u5f71\u989c\u8272",
    stroke_inversion: "\u53cd\u8272\u63cf\u8fb9",
    stroke_opacity: "\u63cf\u8fb9 / \u9634\u5f71\u4e0d\u900f\u660e\u5ea6",
    stroke_width: "\u63cf\u8fb9\u7c97\u7ec6",
    css_text_shadow_blur: "\u9634\u5f71\u6a21\u7cca",
    scroll_speed: "\u6eda\u52a8\u901f\u5ea6",
    file_add: "\u672c\u5730\u6dfb\u52a0",
    unlimited: "\u65e0\u9650\u5236",
    dandanplay_search_placeholder: "\u52a8\u753b\u6807\u9898...",
    dandanplay_search: "\u624b\u52a8\u641c\u7d22",
    dandanplay_search_go: "\u641c\u7d22",
    dandanplay_match: "\u7f51\u7edc\u5339\u914d",
    ddp_auto_network: "\u81ea\u52a8\u52a0\u8f7d\u7f51\u7edc\u5f39\u5e55",
    canvas_renderer: "\u4f7f\u7528 Canvas \u6e32\u67d3",
    danmaku_force_simplified: "\u5f3a\u5236\u8f6c\u6362\u7b80\u4f53", 
    danmaku_auto_offset: "\u81ea\u52a8\u8bbe\u7f6e\u7247\u5934\u504f\u79fb", 
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
    blocklist_title: "\u5c4f\u853d\u8bcd",
    blocklist_add: "\u6dfb\u52a0",
    blocklist_placeholder: "\u5c4f\u853d\u8bcd\u6216 /\u6b63\u5219/...",
    blocklist_remove: "\u5220\u9664",
    block_top: "\u5c4f\u853d\u9876\u90e8\u5f39\u5e55",
    block_bottom: "\u5c4f\u853d\u5e95\u90e8\u5f39\u5e55",
    dedupe_title: "\u5f39\u5e55\u53bb\u91cd",
    dedupe_window: "\u53bb\u91cd\u533a\u95f4 (\u79d2)",
    blocklist_invalid: "\u6b63\u5219\u65e0\u6548\u6216\u53ef\u80fd\u5bfc\u81f4\u5361\u987f\uff0c\u5df2\u6309\u666e\u901a\u6587\u5b57\u5339\u914d"
  }
};

function getBrowserLang() {
  var lang = navigator.language || "en";
  if (lang.startsWith("ja")) return "ja";
  if (lang.startsWith("zh")) return "zh";
  return "en";
}

// main sends its language with the state snapshot so OSD and sidebar agree;
// the WebView locale is only the initial guess.
var uiLang = getBrowserLang();

function t(key) {
  var dict = i18n[uiLang] || i18n.en;
  return dict[key] || i18n.en[key] || key;
}

function applyI18n() {
  var lang = uiLang;
  var dict = i18n[lang] || i18n.en;
  document.querySelectorAll("[data-i18n]").forEach(function(el) {
    var key = el.getAttribute("data-i18n");
    if (dict[key]) el.textContent = dict[key];
  });
  document.documentElement.lang = lang;
  document.querySelectorAll("[data-i18n-aria-label]").forEach(function (el) {
    el.setAttribute('aria-label', t(el.getAttribute('data-i18n-aria-label')));
  });
  document.querySelectorAll("[data-i18n-label]").forEach(function (el) {
    el.label = t(el.getAttribute("data-i18n-label"));
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

function updateDurationDiffUI() {
  if (!durationMismatchHint) return;
  var diff = state.nicoJsonDurationDiff;
  if (diff === null || diff === undefined || !isFinite(diff)) {
    durationMismatchHint.style.display = "none";
    durationMismatchHint.textContent = "";
    return;
  }
  var abs = Math.round(Math.abs(diff) * 10) / 10;
  var absStr = (abs % 1 === 0) ? String(Math.round(abs)) : String(abs);
  var msgKey = diff > 0 ? 'duration_diff_longer' : 'duration_diff_shorter';
  durationMismatchHint.textContent = t('duration_diff_label') + ' ' + t(msgKey).replace('{diff}', absStr);
  durationMismatchHint.style.display = "";
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

// macOS WebKit may keep a range focused after a button click. Only an
// active pointer drag owns the preview; focus alone must not block state echoes.
function trackSliderDrag(slider) {
  let drag = {active: false};
  if (!slider) return drag;
  function begin(event) {
    if (event.button !== undefined && event.button !== 0) return;
    drag.active = true;
  }
  function end() { drag.active = false; }
  slider.addEventListener('pointerdown', begin);
  slider.addEventListener('mousedown', begin);
  // Register change before the submit handler so even a synchronous echo is
  // accepted. Do not reset the value here: pointerup may precede change.
  slider.addEventListener('change', end);
  // WebKit can blur the input as a native range drag starts. Window blur,
  // pointer cancellation and release end the gesture; element blur does not.
  slider.addEventListener('lostpointercapture', end);
  document.addEventListener('pointerup', end, true);
  document.addEventListener('pointercancel', end, true);
  document.addEventListener('mouseup', end, true);
  if (typeof window.addEventListener === 'function') window.addEventListener('blur', end);
  return drag;
}

const opacitySliderDrag = trackSliderDrag(opacitySlider);
const fontsizeSliderDrag = trackSliderDrag(fontsizeSlider);
const strokeOpacitySliderDrag = trackSliderDrag(strokeOpacitySlider);
const strokeWidthSliderDrag = trackSliderDrag(strokeWidthSlider);
const speedSliderDrag = trackSliderDrag(speedSlider);
const fontWeightSliderDrag = trackSliderDrag(fontWeightSlider);
const cssTextShadowBlurSliderDrag = trackSliderDrag(cssTextShadowBlurSlider);
const commentLimitSliderDrag = trackSliderDrag(commentLimitSlider);
const densitySliderDrag = trackSliderDrag(densitySlider);

// View-only edit state: an empty Custom choice is not a preference change.
let fontCustomEmptyChoice = false;
let fontCustomComposing = false;
let pendingFontFamily = null;

function submitCustomFont() {
  let family = fontCustomInput.value.trim();
  if (fontCustomEmptyChoice && !family) return;
  fontCustomEmptyChoice = false;
  if (family === pendingFontFamily || (pendingFontFamily === null && family === state.danmakuFontFamily)) return;
  pendingFontFamily = family;
  iina.postMessage('set-danmaku-font', {fontFamily: family});
}

function updateFontUI() {
  if (!fontSelect || !fontCustomInput || !fontCustomRow) return;
  let family = pendingFontFamily !== null ? pendingFontFamily : state.danmakuFontFamily;
  var key = fontCustomEmptyChoice ? 'custom' : family ? fontFamilyToPresetKey(family) : "";
  // State echoes may arrive for every keystroke. The focused field owns its
  // draft (including spaces, composition and selection) until editing ends.
  if (document.activeElement !== fontCustomInput && !fontCustomComposing) {
    fontSelect.value = key;
    fontCustomRow.style.display = key === "custom" ? "" : "none";
    if (key === "custom" && !fontCustomEmptyChoice && fontCustomInput.value !== family) {
      fontCustomInput.value = family;
    }
  }
  if (fontWeightSlider && !fontWeightSliderDrag.active) {
    fontWeightSlider.value = state.danmakuFontWeight || "500";
  }
  if (fontWeightValue) {
    fontWeightValue.textContent = fontWeightSlider ? fontWeightSlider.value : "500";
  }
}

function updateUI() {
  if (state.enabled === undefined) return;
  toggleDanmaku.checked = !!state.enabled;
  // Enabling without a source lets main retry discovery for the current video.
  toggleDanmaku.disabled = false;
  if (!opacitySliderDrag.active) {
    opacitySlider.value = state.canvasOpacity;
    opacityValue.textContent = Math.round(state.canvasOpacity * 100) + "%";
  }
  if (!fontsizeSliderDrag.active) {
    fontsizeSlider.value = Math.round(state.canvasFontScale * 100);
    fontsizeValue.textContent = Math.round(state.canvasFontScale * 100) + "%";
  }
  if (!strokeOpacitySliderDrag.active) {
    strokeOpacitySlider.value = Math.round(state.strokeOpacity * 100);
    strokeOpacityValue.textContent = Math.round(state.strokeOpacity * 100) + "%";
  }
  if (!strokeWidthSliderDrag.active) {
    strokeWidthSlider.value = state.strokeWidth;
    strokeWidthValue.textContent = String(state.strokeWidth) + 'px';
  }
  if (!cssTextShadowBlurSliderDrag.active && state.cssTextShadowBlur !== undefined) {
    cssTextShadowBlurSlider.value = state.cssTextShadowBlur;
    cssTextShadowBlurValue.textContent = String(state.cssTextShadowBlur) + 'px';
  }
  updateCssTextShadowMode(state.useCanvasRenderer);
  strokeColorInput.value = state.strokeColor;
  strokeInversionInput.value = state.strokeInversionColor;
  if (!commentLimitSliderDrag.active) {
    commentLimitSlider.value = state.commentLimit > 0 ? state.commentLimit : COMMENT_LIMIT_SLIDER_UNLIMITED;
    commentLimitValue.textContent = state.commentLimit > 0 ? String(state.commentLimit) : t('unlimited');
  }
  if (!speedSliderDrag.active) {
    speedSlider.value = Math.round(state.scrollSpeed * 100);
    speedValue.textContent = Math.round(state.scrollSpeed * 100) + '%';
  }
  if (canvasRendererToggle) canvasRendererToggle.checked = state.useCanvasRenderer;
  updateForceSimplifiedUI();
  if (danmakuAutoOffsetToggle) danmakuAutoOffsetToggle.checked = state.danmakuAutoOffset; 
  if (danmakuAutoOffsetRow) {
    let showAutoOffset = (state.danmakuLoaded || fileListState.selectedPaths.length > 0) && state.danmakuType === 'nico-json' && state.nicoJsonHasDuration;
    danmakuAutoOffsetRow.style.display = showAutoOffset ? '' : 'none';
  }
  updateOffsetUI();
  updateDurationDiffUI();
  updateFontUI();
  syncStylePresetUI();
  updateFilterUI();
}

function updateForceSimplifiedUI() {
  if (danmakuForceSimplifiedToggle) danmakuForceSimplifiedToggle.checked = state.danmakuForceSimplified;
  let isNico = typeof state.danmakuType === 'string' && state.danmakuType.indexOf('nico-') === 0;
  if (danmakuForceSimplifiedRow) danmakuForceSimplifiedRow.style.display = isNico ? 'none' : '';
}

function updateCssTextShadowMode(useCanvas) {
  cssTextShadowBlurSlider.disabled = !!useCanvas;
  cssTextShadowControl.style.display = useCanvas ? 'none' : '';
}

function syncStylePresetUI() {
  if (!stylePresetSegmented) return;
  var items = stylePresetSegmented.querySelectorAll(".seg-item");
  for (var i = 0; i < items.length; i++) {
    items[i].classList.toggle("active", items[i].dataset.preset === state.stylePreset);
  }
}

function updateFilterUI() {
  let showRange = state.enabled && (state.danmakuLoaded || fileListState.selectedPaths.length > 0) && state.dateInfo.firstDay !== null;
  if (filterSection) filterSection.style.display = showRange ? '' : 'none';
  if (showRange) {
    updateRangeSelector();
  }

  updateDensitySlider();
}

function updateDensitySlider() {
  if (!densitySlider || !densityValue) return;
  var density = state.danmakuFilterDensity || 0;
  if (densitySliderDrag.active || pendingDensityValue !== null) {
    // Keep the captured preview while a pause is pending, including keyboard
    // edits and interrupted drags; only the count below follows main.
  } else if (density > 0) {
    densitySlider.value = density;
    densityValue.textContent = density + ' /min';
  } else {
    densitySlider.value = DENSITY_SLIDER_OFF;
    densityValue.textContent = t('unlimited');
  }
  if (densityCount) {
    densityCount.textContent = state.sourceTotalCount > 0
      ? state.filteredCount + '/' + state.sourceTotalCount : '';
  }
}

function getSelectedDateRange() {
  let days = filterDateAxis.days;
  if (!days.length) return null;
  let startIndex = state.danmakuFilterStartDay === null ? 0
    : Math.min(days.length - 1, filterDayIndex(state.danmakuFilterStartDay));
  let endIndex = state.danmakuFilterEndDay === null ? days.length - 1
    : Math.max(startIndex, filterDayIndex(state.danmakuFilterEndDay + 1) - 1);
  return { start: days[startIndex], end: days[endIndex], startIndex: startIndex, endIndex: endIndex };
}

function formatFilterDay(day) {
  return new Date(day * 86400000).toISOString().slice(0, 10);
}

// Each dated comment gets the same track width; handles snap to whole-day boundaries.
let filterDateAxis = { days: [], counts: [0], total: 0 };

function buildFilterDateAxis(info) {
  let axis = { days: [], counts: [0], total: 0 };
  info.dayCounts.forEach(function (entry) {
    if (entry[1] <= 0) return;
    axis.days.push(entry[0]);
    axis.total += entry[1];
    axis.counts.push(axis.total);
  });
  return axis;
}

function filterDayIndex(day) {
  let low = 0;
  let high = filterDateAxis.days.length;
  while (low < high) {
    let mid = Math.floor((low + high) / 2);
    if (filterDateAxis.days[mid] < day) low = mid + 1;
    else high = mid;
  }
  return low;
}

function filterDayToCount(day) {
  return filterDateAxis.counts[filterDayIndex(day)];
}

function filterCountToDay(count, isEnd) {
  let axis = filterDateAxis;
  count = Math.max(0, Math.min(axis.total, count));
  let low = 0;
  let high = axis.counts.length - 1;
  while (low < high) {
    let mid = Math.floor((low + high) / 2);
    if (axis.counts[mid] < count) low = mid + 1;
    else high = mid;
  }
  if (low > 0 && count - axis.counts[low - 1] < axis.counts[low] - count) low -= 1;
  return axis.days[Math.max(0, Math.min(axis.days.length - 1, isEnd ? low - 1 : low))];
}

function updateRangeSelector() {
  let range = getSelectedDateRange();
  if (!range || filterDateAxis.total <= 0) return;
  let info = state.dateInfo;
  let startCount = filterDayToCount(range.start);
  let endCount = filterDayToCount(range.end + 1);
  if (filterCoverage) {
    filterCoverage.style.left = (startCount / filterDateAxis.total * 100) + '%';
    filterCoverage.style.width = ((endCount - startCount) / filterDateAxis.total * 100) + '%';
  }
  let count = info.undatedCount + endCount - startCount;
  if (filterCount) filterCount.textContent = String(count);
  if (filterDateStart) filterDateStart.textContent = formatFilterDay(range.start);
  if (filterDateEnd) filterDateEnd.textContent = formatFilterDay(range.end);
  [[filterHandleLeft, range.start, info.firstDay, range.end],
    [filterHandleRight, range.end, range.start, info.lastDay]].forEach(function (entry) {
    if (!entry[0]) return;
    entry[0].setAttribute('aria-valuenow', entry[1]);
    entry[0].setAttribute('aria-valuetext', formatFilterDay(entry[1]));
    entry[0].setAttribute('aria-valuemin', entry[2]);
    entry[0].setAttribute('aria-valuemax', entry[3]);
  });
}

toggleDanmaku.addEventListener("change", function () {
  iina.postMessage("toggle-danmaku");
});

var activeTabName = 'basic';

if (tabButtons.length) {
  tabButtons.forEach(function (tab) {
    tab.addEventListener("click", function () {
      var name = tab.dataset.tab;
      if (name !== activeTabName) endDensityInputEdit();
      activeTabName = name;
      tabButtons.forEach(function (t) {
        t.classList.toggle("active", t === tab);
      });
      if (tabBasic) tabBasic.style.display = name === "basic" ? "" : "none";
      if (tabAdvanced) tabAdvanced.style.display = name === "advanced" ? "" : "none";
      if (tabFilter) {
        var showFilter = name === "filter";
        tabFilter.style.display = showFilter ? "" : "none";
        if (showFilter) {
          // The lazy sidebar requests its list when the Filter tab opens.
          iina.postMessage("danmaku-browser-request", {});
          iina.postMessage("danmaku-browser-watch", { watch: true });
        } else {
          iina.postMessage("danmaku-browser-watch", { watch: false });
        }
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
    updateCssTextShadowMode(useCanvas);
    iina.postMessage("set-canvas-mode", { mode: useCanvas ? 'default' : 'css' });
  });
}

if (danmakuForceSimplifiedToggle) {
  danmakuForceSimplifiedToggle.addEventListener("change", function () {
    var forceSimp = danmakuForceSimplifiedToggle.checked;
    
    iina.postMessage("set-danmaku-force-simplified", { value: forceSimp });
  });
}

if (danmakuAutoOffsetToggle) {
  danmakuAutoOffsetToggle.addEventListener("change", function () {
    var on = danmakuAutoOffsetToggle.checked;
    iina.postMessage("set-danmaku-auto-offset", { value: on });
  });
}

opacitySlider.addEventListener("input", function () {
  var val = parseFloat(opacitySlider.value);
  opacityValue.textContent = Math.round(val * 100) + "%";
  iina.postMessage("set-opacity", { opacity: val });
});

fontsizeSlider.addEventListener("input", function () {
  var val = parseFloat(fontsizeSlider.value) / 100;
  fontsizeValue.textContent = Math.round(val * 100) + "%";
  iina.postMessage("set-fontscale", { scale: val });
});

strokeOpacitySlider.addEventListener("input", function () {
  var val = parseFloat(strokeOpacitySlider.value) / 100;
  strokeOpacityValue.textContent = Math.round(val * 100) + "%";
  iina.postMessage("set-stroke-opacity", { opacity: val });
});

strokeWidthSlider.addEventListener("input", function () {
  var val = parseFloat(strokeWidthSlider.value);
  strokeWidthValue.textContent = String(val) + 'px';
  iina.postMessage("set-stroke-width", { width: val });
});

function previewCssTextShadowBlur() {
  if (cssTextShadowBlurSlider.disabled) return;
  let blur = parseFloat(cssTextShadowBlurSlider.value);
  cssTextShadowBlurValue.textContent = String(blur) + 'px';
}

cssTextShadowBlurSlider.addEventListener('input', previewCssTextShadowBlur);
cssTextShadowBlurSlider.addEventListener('change', previewCssTextShadowBlur);
bindLiveRangePost(cssTextShadowBlurSlider, 'set-css-text-shadow-blur', 'blur', function () {
  return cssTextShadowBlurSlider.disabled ? null : parseFloat(cssTextShadowBlurSlider.value);
});

strokeColorInput.addEventListener("input", function () {
  iina.postMessage("set-stroke-color", { color: strokeColorInput.value });
});

strokeInversionInput.addEventListener("input", function () {
  iina.postMessage("set-stroke-inversion-color", { color: strokeInversionInput.value });
});

commentLimitSlider.addEventListener("input", function () {
  let val = parseInt(commentLimitSlider.value, 10);
  commentLimitValue.textContent = val >= COMMENT_LIMIT_SLIDER_UNLIMITED ? t('unlimited') : String(val);
});

commentLimitSlider.addEventListener("change", function () {
  let val = parseInt(commentLimitSlider.value, 10);
  let limit = val >= COMMENT_LIMIT_SLIDER_UNLIMITED ? 0 : val;
  iina.postMessage("set-comment-limit", { limit: limit });
});

var DANMAKU_OFFSET_MIN = -30;
var DANMAKU_OFFSET_MAX = 30;
function clampDanmakuOffset(value) {
  var rounded = Math.round(value * 1000) / 1000;
  return Math.max(DANMAKU_OFFSET_MIN, Math.min(DANMAKU_OFFSET_MAX, rounded));
}

if (offsetInput) {
  offsetInput.addEventListener("change", function () {
    var val = parseFloat(offsetInput.value);
    if (isNaN(val)) val = 0;
    val = clampDanmakuOffset(val);
    offsetInput.value = val;
    iina.postMessage("set-danmaku-offset", { offset: val });
  });
}

if (fontSelect) {
  fontSelect.addEventListener("change", function () {
    var key = fontSelect.value;
    if (key === "custom") {
      fontCustomEmptyChoice = !fontCustomInput.value.trim();
      fontCustomRow.style.display = "";
      fontCustomInput.focus();
      var customFamily = fontCustomInput.value.trim();
      if (customFamily) {
        submitCustomFont();
      }
    } else {
      fontCustomEmptyChoice = false;
      fontCustomRow.style.display = "none";
      var preset = FONT_PRESETS[key] !== undefined ? FONT_PRESETS[key] : "";
      pendingFontFamily = preset !== state.danmakuFontFamily || pendingFontFamily !== null ? preset : null;
      iina.postMessage("set-danmaku-font", { fontFamily: preset });
    }
  });
}

if (fontCustomInput) {
  fontCustomInput.addEventListener('compositionstart', function () {
    fontCustomComposing = true;
  });
  fontCustomInput.addEventListener('compositionend', function () {
    fontCustomComposing = false;
    submitCustomFont();
    updateFontUI();
  });
  fontCustomInput.addEventListener("blur", function () {
    if (fontCustomComposing) return;
    if (!fontCustomEmptyChoice) submitCustomFont();
    updateFontUI();
  });
  fontCustomInput.addEventListener("input", function (event) {
    if (event.isComposing || fontCustomComposing) return;
    submitCustomFont();
  });
}

// Every input is a new intent, even when a preset restored another value.
// Suppress only the matching change at the end of this input edit.
function bindLiveRangePost(slider, message, field, readValue) {
  let lastInputValue = null;
  let post = function (value) {
    if (value === null) return; // A disabled control may decline the edit.
    let payload = {};
    payload[field] = value;
    iina.postMessage(message, payload);
  };
  slider.addEventListener('input', function () {
    lastInputValue = readValue();
    post(lastInputValue);
  });
  slider.addEventListener('change', function () {
    let value = readValue();
    let previousInput = lastInputValue;
    lastInputValue = null;
    if (value !== previousInput) post(value);
  });
}

if (fontWeightSlider) {
  fontWeightSlider.addEventListener("input", function () {
    if (fontWeightValue) fontWeightValue.textContent = fontWeightSlider.value;
  });
  bindLiveRangePost(fontWeightSlider, 'set-danmaku-font', 'fontWeight', function () { return fontWeightSlider.value; });
}

speedSlider.addEventListener("input", function () {
  var val = parseFloat(speedSlider.value) / 100;
  speedValue.textContent = Math.round(val * 100) + '%';
});

bindLiveRangePost(speedSlider, 'set-scroll-speed', 'speed', function () { return parseFloat(speedSlider.value) / 100; });

if (stylePresetSegmented) {
  stylePresetSegmented.addEventListener("click", function (e) {
    var item = e.target && e.target.closest ? e.target.closest(".seg-item") : null;
    if (!item) return;
    var presetName = item.dataset.preset;
    if (!presetName) return;
    iina.postMessage("set-style-preset", { preset: presetName });
  });
}

let filterDragMode = null;
let filterDragStartX = 0;
let filterDragStartDay = null;
let filterDragEndDay = null;
let filterTimer = null;

function flushFilterChange() {
  if (!filterTimer) return;
  clearTimeout(filterTimer);
  filterTimer = null;
  iina.postMessage("set-danmaku-filter", {
    startDay: state.danmakuFilterStartDay,
    endDay: state.danmakuFilterEndDay
  });
}

function sendFilterChange(startDay, endDay) {
  let current = getSelectedDateRange();
  if (current && current.start === startDay && current.end === endDay) return;
  state.danmakuFilterStartDay = startDay;
  state.danmakuFilterEndDay = endDay;
  updateRangeSelector();
  if (filterTimer) clearTimeout(filterTimer);
  filterTimer = setTimeout(flushFilterChange, 300);
}

function applyFilterDrag(clientX) {
  let info = state.dateInfo;
  if (info.firstDay === null || filterDateAxis.total <= 0) return;
  let trackWidth = rangeSelector.getBoundingClientRect().width;
  if (trackWidth <= 0) return;
  let deltaCount = (clientX - filterDragStartX) / trackWidth * filterDateAxis.total;
  let start = filterDragStartDay;
  let end = filterDragEndDay;
  if (deltaCount !== 0) {
    if (filterDragMode === 'resize-left') {
      start = Math.min(end, filterCountToDay(filterDayToCount(start) + deltaCount, false));
    } else if (filterDragMode === 'resize-right') {
      end = Math.max(start, filterCountToDay(filterDayToCount(end + 1) + deltaCount, true));
    }
  }
  sendFilterChange(start, end);
}

function beginFilterDrag(mode, e) {
  let range = getSelectedDateRange();
  if (!range) return;
  filterDragMode = mode;
  filterDragStartX = e.clientX;
  filterDragStartDay = range.start;
  filterDragEndDay = range.end;
  e.preventDefault();
}

function bindDateHandle(handle, isStart) {
  if (!handle) return;
  handle.addEventListener("mousedown", function (e) {
    handle.focus();
    beginFilterDrag(isStart ? 'resize-left' : 'resize-right', e);
    e.stopPropagation();
  });
  handle.addEventListener("keydown", function (e) {
    let range = getSelectedDateRange();
    if (!range || e.metaKey || e.ctrlKey || e.altKey) return;
    let delta = e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1
      : e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : 0;
    if (!delta && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    e.stopPropagation();
    let min = isStart ? 0 : range.startIndex;
    let max = isStart ? range.endIndex : filterDateAxis.days.length - 1;
    let index = e.key === 'Home' ? min : e.key === 'End' ? max : (isStart ? range.startIndex : range.endIndex) + delta;
    let day = filterDateAxis.days[Math.max(min, Math.min(max, index))];
    sendFilterChange(isStart ? day : range.start, isStart ? range.end : day);
  });
}

bindDateHandle(filterHandleLeft, true);
bindDateHandle(filterHandleRight, false);

document.addEventListener("keydown", function (e) {
  var target = e.target || {};
  var tagName = (target.tagName || '').toLowerCase();
  if (tagName === 'input' || tagName === 'textarea' || tagName === 'select') return;
  var key = e.key ? e.key.toLowerCase() : '';
  // Shift+D is reserved for the global danmaku toggle; modifier combinations
  // must not also adjust the time offset.
  if ((key === 'a' || key === 'd') && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
    e.preventDefault();
    var current = parseFloat(offsetInput && offsetInput.value) || 0;
    var step = (offsetInput && parseFloat(offsetInput.step)) || 0.5;
    var offset = clampDanmakuOffset(current + (key === 'a' ? -step : step));
    if (offsetInput) offsetInput.value = offset;
    iina.postMessage("set-danmaku-offset", { offset: offset });
  }
});

function endFilterDrag() {
  if (!filterDragMode) return;
  filterDragMode = null;
  flushFilterChange();
}

document.addEventListener("mousemove", function (e) {
  if (!filterDragMode) return;
  // A release outside the WebView never reaches this document; the next move
  // with no button held ends the drag instead of continuing it.
  if (e.buttons === 0) { endFilterDrag(); return; }
  applyFilterDrag(e.clientX);
});

document.addEventListener("mouseup", endFilterDrag);
if (typeof window.addEventListener === 'function') window.addEventListener('blur', endFilterDrag);

// Each density change re-projects and reloads every comment, so a drag applies
// only when it pauses; release always sends the final value right away.
var DENSITY_PAUSE_MS = 150;
if (densitySlider) {
  let densityTimer = null;
  let densityInputValue = null;
  // End input/change pairing without dropping a captured pending setting.
  endDensityInputEdit = function () { densityInputValue = null; };
  document.addEventListener('pointercancel', endDensityInputEdit);
  if (typeof window.addEventListener === 'function') window.addEventListener('blur', endDensityInputEdit);
  let readDensity = function () {
    let value = parseInt(densitySlider.value, 10);
    return value >= DENSITY_SLIDER_OFF ? 0 : value;
  };
  let sendDensity = function () {
    if (densityTimer) clearTimeout(densityTimer);
    densityTimer = null;
    if (pendingDensityValue === null) return;
    let density = pendingDensityValue;
    pendingDensityValue = null;
    iina.postMessage("set-danmaku-filter-density", { density: density });
  };
  densitySlider.addEventListener("input", function () {
    var val = parseInt(densitySlider.value, 10);
    if (val >= DENSITY_SLIDER_OFF) {
      densityValue.textContent = t('unlimited');
    } else {
      densityValue.textContent = val + ' /min';
    }
    densityInputValue = readDensity();
    pendingDensityValue = densityInputValue;
    if (densityTimer) clearTimeout(densityTimer);
    densityTimer = setTimeout(sendDensity, DENSITY_PAUSE_MS);
  });
  densitySlider.addEventListener("change", function () {
    // A timer may already have sent this input. Do not turn an echoed DOM
    // value into a new edit; change-only operations still submit normally.
    if (densityInputValue === null) {
      let density = readDensity();
      if (pendingDensityValue !== null || density !== state.danmakuFilterDensity) pendingDensityValue = density;
    }
    densityInputValue = null;
    sendDensity();
  });
}

onPluginMessage("danmaku-filter-info", function (data) {
  if (data.fileType !== undefined) state.danmakuType = data.fileType;
  state.sourceTotalCount = data.sourceTotalCount || 0;
  if (!filterDragMode && !filterTimer) {
    state.danmakuFilterStartDay = data.filterStartDay == null ? null : data.filterStartDay;
    state.danmakuFilterEndDay = data.filterEndDay == null ? null : data.filterEndDay;
  }
  state.dateInfo = data.dateInfo || { firstDay: null, lastDay: null, dayCounts: [], undatedCount: 0 };
  filterDateAxis = buildFilterDateAxis(state.dateInfo);
  state.danmakuFilterDensity = data.filterDensity || 0;
  state.filteredCount = data.filteredCount || 0;
  updateForceSimplifiedUI();
  updateFilterUI();
});

onPluginMessage("danmaku-state", function (data) {
  if (typeof data.uiLang === 'string' && i18n[data.uiLang] && data.uiLang !== uiLang) {
    uiLang = data.uiLang;
    applyI18n();
    renderFileList();
    renderBlocklist();
  }
  if (data.enabled !== undefined) state.enabled = data.enabled;
  if (data.canvasMode !== undefined) state.useCanvasRenderer = data.canvasMode === 'default';
  if (data.canvasOpacity !== undefined) state.canvasOpacity = data.canvasOpacity;
  if (data.canvasFontScale !== undefined) state.canvasFontScale = data.canvasFontScale;
  if (data.strokeOpacity !== undefined) state.strokeOpacity = data.strokeOpacity;
  if (data.strokeWidth !== undefined) state.strokeWidth = data.strokeWidth;
  if (data.cssTextShadowBlur !== undefined) state.cssTextShadowBlur = data.cssTextShadowBlur;
  if (data.strokeColor !== undefined) {
    state.strokeColor = data.strokeColor;
  }
  if (data.strokeInversionColor !== undefined) {
    state.strokeInversionColor = data.strokeInversionColor;
  }
  if (data.commentLimit !== undefined) state.commentLimit = data.commentLimit;
  if (data.scrollSpeed !== undefined) state.scrollSpeed = data.scrollSpeed;
  if (data.danmakuTimeOffsetSec !== undefined) state.danmakuOffsetSeconds = data.danmakuTimeOffsetSec;
  if (data.nicoJsonDurationDiff !== undefined) state.nicoJsonDurationDiff = data.nicoJsonDurationDiff;
  if (data.nicoJsonHasDuration !== undefined) state.nicoJsonHasDuration = !!data.nicoJsonHasDuration;
  if (data.danmakuFontFamily !== undefined) {
    state.danmakuFontFamily = data.danmakuFontFamily;
    if (pendingFontFamily === data.danmakuFontFamily) pendingFontFamily = null;
  }
  if (data.danmakuFontWeight !== undefined) state.danmakuFontWeight = data.danmakuFontWeight;
  if (data.stylePreset !== undefined) state.stylePreset = data.stylePreset;
  if (data.danmakuForceSimplified !== undefined) state.danmakuForceSimplified = !!data.danmakuForceSimplified;
  if (data.danmakuAutoOffset !== undefined) state.danmakuAutoOffset = !!data.danmakuAutoOffset;
  applyPositionFilterState(data);
  if (data.blocklist) applyBlocklistState(data.blocklist);
  if (data.dedupe) applyDedupeState(data.dedupe);
  if (data.danmakuBrowserVisible !== undefined) applyBrowserVis(data.danmakuBrowserVisible);
  if (data.danmakuFileType !== undefined) state.danmakuType = data.danmakuFileType;
  if (data.danmakuLoaded !== undefined) state.danmakuLoaded = data.danmakuLoaded;
  if (data.danmakuFilterDensity !== undefined) state.danmakuFilterDensity = data.danmakuFilterDensity;
  updateUI();
  updateEnabledUI();
});

onPluginMessage("danmaku-file-list", function (data) {
  if ((fileListState.selectedPaths[0] || '') !== ((data.selectedPaths || [])[0] || '')) {
    endDensityInputEdit();
    if (filterTimer) clearTimeout(filterTimer);
    filterTimer = null;
    filterDragMode = null;
  }
  fileListState.xmlFiles = data.xmlFiles || [];
  fileListState.jsonFiles = data.jsonFiles || [];
  fileListState.selectedPaths = data.selectedPaths || [];
  fileListState.selectedPaths.forEach(function (path) { delete fileListState.errorPaths[path]; });
  renderFileList();
  updateUI();
  updateEnabledUI();
});

onPluginMessage("danmaku-file-error", function (data) {
  fileListState.errorPaths[data.path] = data.message;
  renderFileList();
});

applyI18n();
renderFileList();

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

var ddpMatchBtn = document.getElementById("dandanplay-match-btn");
if (ddpMatchBtn) {
  ddpMatchBtn.addEventListener("click", function () {
    ddpMatchesExpanded = !ddpMatchesExpanded;
    if (ddpMatchesExpanded) {
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
let ddpSearchId = 0;
// main answers only the newest bangumi request, so an older row still waiting
// must be released when another row is clicked or it stays "loading" forever.
let ddpPendingBangumiItem = null;

function releasePendingBangumiItem(except) {
  let item = ddpPendingBangumiItem;
  if (!item || item === except) return;
  ddpPendingBangumiItem = null;
  item._epLoading = false;
  if (item._epSub) item._epSub.textContent = t('click_load_episodes');
}

function ddpDoSearch() {
  var keyword = ddpSearchInput ? ddpSearchInput.value.trim() : '';
  if (!keyword) return;
  let searchId = ++ddpSearchId;
  ddpPendingBangumiItem = null;
  if (ddpSearchTimer) clearTimeout(ddpSearchTimer);
  if (ddpSearchResults) {
    ddpSearchResults.innerHTML = '';
    ddpSearchResults.style.display = '';
    if (ddpSearchResultsWrapper) ddpSearchResultsWrapper.style.display = '';
    if (ddpSearchResultsToggle) ddpSearchResultsToggle.style.display = 'none';
    var loadingEl = document.createElement('div');
    loadingEl.style.cssText = 'font-size:11px;opacity:0.5;padding:4px';
    loadingEl.textContent = '...';
    ddpSearchResults.appendChild(loadingEl);
  }
  if (ddpSearchResultsArrow) ddpSearchResultsArrow.textContent = '\u25B6';
  ddpSearchTimer = setTimeout(function() {
    iina.postMessage("dandanplay-search", { keyword: keyword, searchId: searchId });
    ddpSearchTimer = null;
  }, 500);
}

if (ddpSearchGoBtn) {
  ddpSearchGoBtn.addEventListener("click", ddpDoSearch);
}

if (ddpSearchInput) {
  let ddpSearchComposing = false;
  ddpSearchInput.addEventListener("compositionstart", function () { ddpSearchComposing = true; });
  ddpSearchInput.addEventListener("compositionend", function () { ddpSearchComposing = false; });
  ddpSearchInput.addEventListener("keydown", function (e) {
    if (ddpSearchComposing || e.isComposing || e.keyCode === 229) return;
    if (e.key === 'Enter') ddpDoSearch();
  });
}

onPluginMessage("dandanplay-status", function (data) {
  try {
    if (data.status !== undefined) ddpState.status = data.status;
    // Reset the previous video's expanded panel so reopening can trigger matching.
    if (data.status === 'idle') {
      ddpMatchesExpanded = false;
      releasePendingBangumiItem();
    }
    if (data.episodeId !== undefined) ddpState.episodeId = data.episodeId;
    if (data.error !== undefined) ddpState.error = data.error;
    if (data.matches !== undefined) ddpState.matches = data.matches;
    if (data.autoNetwork !== undefined) ddpState.autoNetwork = data.autoNetwork;
    if (data.matchType !== undefined) ddpState.matchType = data.matchType;
    ddpUpdateUI();
  } catch (e) {}
});

onPluginMessage("dandanplay-search-result", function (data) {
  if (data.searchId !== ddpSearchId) return;
  try {
    if (!ddpSearchResults) {
      return;
    }
    ddpSearchResults.innerHTML = '';
    if (ddpSearchResultsWrapper) ddpSearchResultsWrapper.style.display = '';

    if (data && data.error) {
      if (ddpSearchResultsToggle) ddpSearchResultsToggle.style.display = 'none';
      var errEl = document.createElement('div');
      errEl.className = 'dandanplay-error';
      errEl.textContent = data.error;
      ddpSearchResults.appendChild(errEl);
      return;
    }

    var animes = (data && data.animes) || [];
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
        item.dataset.animeId = String(anime.animeId);
        item.setAttribute('data-clickable', '');

        var title = document.createElement('div');
        title.className = 'dandanplay-search-result-title';
        title.textContent = anime.animeTitle || '\u2014';

        var sub = document.createElement('div');
        sub.className = 'dandanplay-search-result-episodes';
        sub.textContent = t('click_load_episodes');

        item.appendChild(title);
        item.appendChild(sub);
        item._epSub = sub;

        item.addEventListener('click', function () {
          if (item._epList) {
            item._epList.style.display = item._epList.style.display === 'none' ? '' : 'none';
            return;
          }
          if (item._epLoading) return;
          releasePendingBangumiItem(item);
          item._epLoading = true;
          ddpPendingBangumiItem = item;
          sub.textContent = t('loading_episodes');
          iina.postMessage("dandanplay-get-bangumi", { bangumiId: String(anime.animeId), animeTitle: anime.animeTitle, searchId: ddpSearchId });
        });

        ddpSearchResults.appendChild(item);
      })(animes[i]);
    }
  } catch (e) {
    ddpSearchResults.innerHTML = '';
    var errEl = document.createElement('div');
    errEl.className = 'dandanplay-error';
    errEl.textContent = t('render_error');
    ddpSearchResults.appendChild(errEl);
  }
});

onPluginMessage("dandanplay-bangumi-result", function (data) {
  if (data.searchId !== ddpSearchId) return;
  try {
    if (!ddpSearchResults) {
      return;
    }
    var animeTitle = data.animeTitle;
    var episodes = data.episodes || [];

    var items = ddpSearchResults.querySelectorAll('.dandanplay-search-result-item');
    for (var i = 0; i < items.length; i++) {
      (function(item) {
        if (item.dataset.animeId !== String(data.bangumiId)) return;
        item._epLoading = false;
        if (ddpPendingBangumiItem === item) ddpPendingBangumiItem = null;

        var subEl = item.querySelector('.dandanplay-search-result-episodes');
        if (data.error) {
          if (subEl) subEl.textContent = data.error + ' — ' + t('click_retry');
          return;
        }
        if (subEl) subEl.textContent = t('episodes_count').replace('{n}', episodes.length);

        var epList = document.createElement('div');
        epList.className = 'dandanplay-episode-list';
        item._epList = epList;
        for (var j = 0; j < episodes.length; j++) {
          (function(ep) {
            var epItem = document.createElement('div');
            epItem.className = 'dandanplay-episode-item';
            epItem.setAttribute('data-clickable', '');
            epItem.textContent = ep.episodeTitle || t('episode_number').replace('{n}', j + 1);
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

// Virtualize the projected timeline and follow playback with the current row at the bottom.
var BROWSER_ROW_H = 26;
var browserVpos = -1; // Centiseconds, including the danmaku offset.
var browserFollowLive = true;
var browserRenderedSourceKey = '';
var browserSourceChanged = false;
var totalEl = document.getElementById("danmaku-browser-total");

var browserList = {
  el: document.getElementById("danmaku-browser-list-all"),
  items: [],
  rowNodes: new Map()
};
browserList.spacerEl = browserList.el.querySelector(".danmaku-browser-spacer");
browserList.emptyEl = browserList.el.querySelector(".danmaku-browser-empty");

function browserFmtTime(vpos) {
  var sec = Math.floor((vpos || 0) / 100);
  var h = Math.floor(sec / 3600);
  var m = Math.floor((sec % 3600) / 60);
  var s = sec % 60;
  var p = function (n) { return n < 10 ? "0" + n : String(n); };
  return h > 0 ? h + ":" + p(m) + ":" + p(s) : p(m) + ":" + p(s);
}

// Return the last row at or before the playback position, including gaps between comments.
function browserRowForVpos(vpos, items) {
  var lo = 0, hi = items.length - 1, ans = -1;
  while (lo <= hi) {
    var mid = (lo + hi) >> 1;
    if (items[mid].t <= vpos) { ans = mid; lo = mid + 1; }
    else hi = mid - 1;
  }
  return ans;
}

// Make embedded timestamps seekable while keeping the remaining text selectable.
function browserRenderTextWithLinks(text, container) {
  var re = /(^|[^\d:])(\d{1,2}):(\d{2})(?::(\d{2}))?(?![\d:])/g;
  var last = 0, m;
  while ((m = re.exec(text)) !== null) {
    var hasHours = m[4] !== undefined;
    var hours = hasHours ? parseInt(m[2], 10) : 0;
    var mins = hasHours ? parseInt(m[3], 10) : parseInt(m[2], 10);
    var secs = hasHours ? parseInt(m[4], 10) : parseInt(m[3], 10);
    if (mins >= 60 || secs >= 60) continue;
    var timeStart = m.index + m[1].length;
    var timeText = m[0].slice(m[1].length);
    if (timeStart > last) container.appendChild(document.createTextNode(text.slice(last, timeStart)));
    var sec = hours * 3600 + mins * 60 + secs;
    var link = document.createElement("span");
    link.className = "danmaku-time-link";
    link.textContent = timeText;
    (function (vpos) {
      link.addEventListener("click", function (e) {
        e.stopPropagation();
        iina.postMessage("danmaku-seek", { vpos: vpos });
      });
    })(sec * 100);
    container.appendChild(link);
    last = m.index + m[0].length;
  }
  if (last === 0) container.textContent = text;
  else if (last < text.length) container.appendChild(document.createTextNode(text.slice(last)));
}

// Clamp the virtual window after projections shrink the list.
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
  for (var row = first; row <= last; row++) {
    var node = list.rowNodes.get(row);
    if (node) continue;
    var item = items[row];
    var div = document.createElement("div");
    div.className = "danmaku-browser-row" + (item.blocked ? " blocked" : "") + (item.owner ? " owner" : "");
    div.style.top = (row * BROWSER_ROW_H) + "px";
    var time = document.createElement("span");
    time.className = "danmaku-browser-time";
    time.textContent = browserFmtTime(item.t);
    // Main converts the danmaku position back to video time using the offset.
    (function (vpos) {
      time.addEventListener("click", function (e) {
        e.stopPropagation();
        iina.postMessage("danmaku-seek", { vpos: vpos });
      });
    })(item.t);
    var text = document.createElement("span");
    text.className = "danmaku-browser-text";
    browserRenderTextWithLinks(item.text, text);
    div.appendChild(time);
    div.appendChild(text);
    list.spacerEl.appendChild(div);
    list.rowNodes.set(row, div);
  }
}

function browserUpdateTotal() {
  if (!totalEl) return;
  let n = 0;
  for (let i = 0; i < browserList.items.length; i++) {
    if (!browserList.items[i].blocked) n++;
  }
  totalEl.textContent = browserList.items.length > 0 ? "(" + n.toLocaleString() + ")" : "";
}

function browserUpdateLiveUI() {
  var btn = document.getElementById("danmaku-browser-follow-btn");
  if (btn) btn.style.display = (browserFollowLive || browserList.items.length === 0) ? "none" : "";
}

function browserFollowToLive() {
  var list = browserList;
  if (list.items.length === 0) return;
  var anchorRow = browserRowForVpos(browserVpos, list.items);
  var viewH = list.el.clientHeight;
  var target = Math.max(0, (anchorRow + 1) * BROWSER_ROW_H - viewH);
  browserProgramScrollTop = target;
  list.el.scrollTop = target;
  browserRenderList(list);
}

var browserNextChunk = 0;
let browserDataLoaded = false;
var browserLastRefreshRequest = 0;

// Throttle recovery requests to avoid a loop when list data is missing.
function requestBrowserDataRefresh() {
  var now = Date.now();
  if (now - browserLastRefreshRequest < 1500) return;
  browserLastRefreshRequest = now;
  iina.postMessage("danmaku-browser-request", {});
  iina.postMessage("danmaku-browser-watch", { watch: true });
}

onPluginMessage("danmaku-browser-data", function (data) {
  if (!data) return;
  var items = data.items;
  if (!Array.isArray(items)) return;
  // Untagged payloads represent a complete, single-chunk list.
  var chunkIndex = data.chunkIndex === undefined ? 0 : data.chunkIndex;
  var isDone = data.done !== false;
  if (chunkIndex === 0) {
    browserList.items = [];
    browserDataLoaded = false;
    browserNextChunk = 1;
    browserList.rowNodes.forEach(function (el) { el.remove(); });
    browserList.rowNodes.clear();
    // Source changes resume live following; setting changes preserve the browsing position.
    var curSrc = (fileListState.selectedPaths && fileListState.selectedPaths.length > 0)
      ? fileListState.selectedPaths[0] : '';
    browserSourceChanged = (curSrc !== browserRenderedSourceKey);
    browserRenderedSourceKey = curSrc;
  } else if (chunkIndex === browserNextChunk) {
    browserNextChunk = chunkIndex + 1;
  } else {
    requestBrowserDataRefresh(); // Retry missing or out-of-order chunks.
    return;
  }
  for (var i = 0; i < items.length; i++) {
    var item = items[i];
    if (!item || typeof item.t !== 'number' || !isFinite(item.t) || !item.text) continue;
    browserList.items.push({ t: item.t, text: item.text, blocked: !!item.blocked, owner: !!item._owner });
  }
  if (!isDone) return;
  browserDataLoaded = true;
  var maxScroll = Math.max(0, browserList.items.length * BROWSER_ROW_H - browserList.el.clientHeight);
  if (browserList.el.scrollTop > maxScroll) {
    browserProgramScrollTop = maxScroll;
    browserList.el.scrollTop = maxScroll;
  }
  browserRenderList(browserList);
  browserUpdateTotal();
  browserUpdateLiveUI();
  // Restore following after scroll events caused by rebuilding the list.
  if (browserSourceChanged) {
    browserSourceChanged = false;
    setTimeout(function () {
      browserFollowLive = true;
      browserUpdateLiveUI();
      if (browserVpos >= 0) browserFollowToLive();
    }, 0);
  }
});

onPluginMessage("danmaku-visible-time", function (data) {
  if (!data || typeof data.time !== 'number') return;
  var vpos = Math.round((data.time + (data.offset || 0)) * 100);
  browserVpos = vpos;
  if (!browserVisToggle || !browserVisToggle.checked) return;
  if (!browserDataLoaded && browserNextChunk === 0) requestBrowserDataRefresh();
  browserUpdateLiveUI();
  if (browserFollowLive) browserFollowToLive();
});

var browserProgramScrollTop = -1; // Distinguish programmatic scrolling from user input.

browserList.el.addEventListener("scroll", function () {
  if (browserProgramScrollTop >= 0 && Math.abs(browserList.el.scrollTop - browserProgramScrollTop) < 1) {
    // Keep the target until the user scrolls away: one scroll can emit multiple events.
    browserRenderList(browserList);
    return;
  }
  browserProgramScrollTop = -1;
  if (browserFollowLive) {
    browserFollowLive = false;
    browserUpdateLiveUI();
  }
  browserRenderList(browserList);
});

var browserFollowBtn = document.getElementById("danmaku-browser-follow-btn");
if (browserFollowBtn) {
  browserFollowBtn.addEventListener("click", function () {
    browserFollowLive = true;
    browserUpdateLiveUI();
    browserFollowToLive();
  });
}

// Reset main's watch state when the sidebar opens on the Basic tab.
iina.postMessage("danmaku-browser-watch", { watch: false });

// Closing the sidebar on the Filter tab sends no tab switch; pause the
// playback-time push while hidden and resume it when shown again.
document.addEventListener("visibilitychange", function () {
  if (document.visibilityState === 'hidden') endDensityInputEdit();
  if (activeTabName !== 'filter') return;
  if (document.visibilityState === 'hidden') {
    iina.postMessage("danmaku-browser-watch", { watch: false });
  } else if (document.visibilityState === 'visible') {
    iina.postMessage("danmaku-browser-request", {});
    iina.postMessage("danmaku-browser-watch", { watch: true });
  }
});

var browserVisToggle = document.getElementById("danmaku-browser-vis-toggle");
var browserListWrap = document.querySelector(".danmaku-browser-list-wrap");

function applyBrowserVis(v) {
  if (browserListWrap) browserListWrap.style.display = v ? "" : "none";
  if (browserVisToggle) browserVisToggle.checked = !!v;
  if (totalEl) totalEl.style.display = v ? "" : "none";
}
if (browserVisToggle) {
  browserVisToggle.addEventListener("change", function () {
    var v = browserVisToggle.checked;
    applyBrowserVis(v);
    iina.postMessage("danmaku-browser-vis-set", { visible: v });
  });
}

var blocklistToggle = document.getElementById("danmaku-blocklist-toggle");
var blocklistPanel = document.getElementById("danmaku-blocklist-panel");
var blocklistList = document.getElementById("danmaku-blocklist-list");
var blocklistWords = [];
var blocklistInvalid = [];
let blocklistEdit = null;

function renderBlocklist() {
  if (!blocklistList || blocklistEdit) return;
  if (blocklistPanel && blocklistToggle) blocklistPanel.style.display = blocklistToggle.checked ? '' : 'none';
  blocklistList.innerHTML = '';
  for (var i = 0; i < blocklistWords.length; i++) {
    var item = document.createElement("div");
    var invalid = blocklistInvalid.indexOf(blocklistWords[i]) !== -1;
    item.className = "danmaku-blocklist-item" + (invalid ? " invalid" : "");
    var label = document.createElement("span");
    label.className = "danmaku-blocklist-item-text";
    label.textContent = blocklistWords[i];
    if (invalid) label.title = t('blocklist_invalid');
    var x = document.createElement("button");
    x.className = "danmaku-blocklist-item-x";
    x.textContent = "\u00d7";
    x.title = t('blocklist_remove');
    x.setAttribute("data-clickable", "");
    (function (word) {
      x.addEventListener("click", function () {
        iina.postMessage("danmaku-blocklist-remove", { word: word }); // Values stay stable across list updates.
      });
    })(blocklistWords[i]);
    item.appendChild(label);
    item.appendChild(x);
    blocklistList.appendChild(item);
  }
  var addItem = document.createElement("div");
  addItem.className = "danmaku-blocklist-item danmaku-blocklist-add-item";
  addItem.textContent = "+ " + t('blocklist_add');
  addItem.setAttribute("data-clickable", "");
  addItem.addEventListener("click", blocklistStartAdd);
  blocklistList.appendChild(addItem);
}

function blocklistStartAdd() {
  var item = this;
  if (blocklistEdit || item.classList.contains('editing')) return;
  item.classList.add("editing");
  item.innerHTML = "";
  var inp = document.createElement("input");
  inp.type = "text";
  inp.className = "danmaku-blocklist-input";
  inp.placeholder = t('blocklist_placeholder');
  item.appendChild(inp);
  blocklistEdit = inp;
  var committing = false;
  var composing = false;
  var finishAfterComposition = false;
  var done = function () {
    if (committing) return;
    if (composing) { finishAfterComposition = true; return; }
    committing = true;
    blocklistEdit = null;
    var w = inp.value.trim();
    if (w) iina.postMessage("danmaku-blocklist-add", { word: w });
    renderBlocklist();
  };
  inp.addEventListener('compositionstart', function () { composing = true; });
  inp.addEventListener('compositionend', function () {
    composing = false;
    if (finishAfterComposition) done();
  });
  inp.addEventListener("keydown", function (e) {
    if (composing || e.isComposing || e.keyCode === 229) return;
    if (e.key === "Enter") {
      e.preventDefault();
      done();
    } else if (e.key === "Escape") {
      e.preventDefault();
      committing = true; // Prevent blur from submitting the canceled edit.
      blocklistEdit = null;
      renderBlocklist();
    }
  });
  inp.addEventListener("blur", done);
  inp.focus();
}

function applyBlocklistState(state) {
  if (!state) return;
  if (typeof state.enabled === 'boolean') {
    if (blocklistToggle) blocklistToggle.checked = state.enabled;
    if (blocklistPanel) blocklistPanel.style.display = state.enabled || blocklistEdit ? "" : "none";
  }
  if (Array.isArray(state.words)) {
    blocklistWords = state.words.slice();
    blocklistInvalid = Array.isArray(state.invalid) ? state.invalid.slice() : [];
    renderBlocklist();
  }
}

if (blocklistToggle) {
  blocklistToggle.addEventListener("change", function () {
    var on = blocklistToggle.checked;
    if (blocklistPanel) blocklistPanel.style.display = on ? "" : "none";
    iina.postMessage("danmaku-blocklist-set-enabled", { enabled: on });
  });
}

function applyPositionFilterState(data) {
  if (!data) return;
  if (typeof data.danmakuBlockTopEnabled === 'boolean' && blockTopToggle) {
    blockTopToggle.checked = data.danmakuBlockTopEnabled;
  }
  if (typeof data.danmakuBlockBottomEnabled === 'boolean' && blockBottomToggle) {
    blockBottomToggle.checked = data.danmakuBlockBottomEnabled;
  }
}

if (blockTopToggle) {
  blockTopToggle.addEventListener("change", function () {
    iina.postMessage("danmaku-position-filter-set", { danmakuBlockTopEnabled: blockTopToggle.checked });
  });
}
if (blockBottomToggle) {
  blockBottomToggle.addEventListener("change", function () {
    iina.postMessage("danmaku-position-filter-set", { danmakuBlockBottomEnabled: blockBottomToggle.checked });
  });
}

var dedupeToggle = document.getElementById("danmaku-dedupe-toggle");
var dedupeRow = document.getElementById("danmaku-dedupe-row");
var dedupeSegmented = document.getElementById("danmaku-dedupe-segmented");
var dedupeSegItems = dedupeSegmented ? dedupeSegmented.querySelectorAll(".seg-item") : [];
var dedupeWindowTimer = null;

function applyDedupeState(state) {
  if (!state) return;
  if (typeof state.enabled === 'boolean') {
    if (dedupeToggle) dedupeToggle.checked = state.enabled;
    if (dedupeRow) dedupeRow.style.display = state.enabled ? "" : "none";
  }
  if (typeof state.window === 'number') {
    for (var i = 0; i < dedupeSegItems.length; i++) {
      dedupeSegItems[i].classList.toggle("active", dedupeSegItems[i].dataset.window === String(state.window));
    }
  }
}

if (dedupeToggle && dedupeSegmented) {
  dedupeToggle.addEventListener("change", function () {
    var on = dedupeToggle.checked;
    if (dedupeRow) dedupeRow.style.display = on ? "" : "none";
    iina.postMessage("danmaku-dedupe-set", { enabled: on });
  });
  // Debounce clicks because changing the window reprojects and reloads the comments.
  for (var i = 0; i < dedupeSegItems.length; i++) {
    (function (btn) {
      btn.addEventListener("click", function () {
        var w = parseFloat(btn.dataset.window);
        if (!isFinite(w)) return;
        for (var j = 0; j < dedupeSegItems.length; j++) {
          dedupeSegItems[j].classList.toggle("active", dedupeSegItems[j] === btn);
        }
        if (dedupeWindowTimer) clearTimeout(dedupeWindowTimer);
        dedupeWindowTimer = setTimeout(function () {
          dedupeWindowTimer = null;
          iina.postMessage("danmaku-dedupe-set", { window: w });
        }, 300);
      });
    })(dedupeSegItems[i]);
  }
}

// Keep virtualization filled when the sidebar height changes, including while paused.
if (typeof ResizeObserver !== 'undefined') {
  new ResizeObserver(function () {
    if (browserFollowLive && browserVpos >= 0) browserFollowToLive();
    else browserRenderList(browserList);
  }).observe(browserList.el);
}

iina.postMessage("request-state");
