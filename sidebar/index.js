var toggleDanmaku = document.getElementById("toggle-danmaku");
var canvasModeSelect = document.getElementById("canvas-mode-select");
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

var advancedOpen = false; // Start collapsed

var settingsSections = [opacitySlider.closest('.section'), fontsizeSlider.closest('.section'), strokeOpacitySlider.closest('.section')];

var state = {
  enabled: true,
  canvasMode: 'default',
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
    canvas_mode_label: "Render Mode",
    canvas_mode_css: "CSS Auto",
    canvas_mode_default: "Canvas Auto",
    canvas_mode_html5: "Canvas HTML5",
    canvas_mode_flash: "Canvas Flash",
    advanced: "Advanced",
    comment_limit: "Comment Limit",
    stroke_color: "Stroke Color",
    stroke_inversion: "Invert Color",
    stroke_opacity: "Stroke Opacity",
    stroke_width: "Stroke Width",
    scroll_speed: "Center Speed",
    stroke_opacity: "Opacity",
    stroke_width: "Width",
    danmaku_not_found: "No danmaku file found",
    file_add: "Add"
  },
  ja: {
    danmaku_visible: "\u30b3\u30e1\u30f3\u30c8\u8868\u793a",
    opacity: "\u30b3\u30e1\u30f3\u30c8\u900f\u660e\u5ea6",
    font_scale: "\u30d5\u30a9\u30f3\u30c8\u500d\u7387",
    canvas_mode_label: "\u30e2\u30fc\u30c9",
    canvas_mode_css: "CSS Auto",
    canvas_mode_default: "\u30ad\u30e3\u30f3\u30d0\u30b9 Auto",
    canvas_mode_html5: "\u30ad\u30e3\u30f3\u30d0\u30b9 HTML5",
    canvas_mode_flash: "\u30ad\u30e3\u30f3\u30d0\u30b9 Flash",
    advanced: "\u9ad8\u5ea6\u306a\u8a2d\u5b9a",
    comment_limit: "\u30b3\u30e1\u30f3\u30c8\u5236\u9650",
    stroke_color: "\u7e01\u53d6\u308a\u306e\u8272",
    stroke_inversion: "\u9006\u7e01\u53d6\u308a\u8272",
    stroke_opacity: "\u7e01\u53d6\u308a\u900f\u660e\u5ea6",
    stroke_width: "\u7e01\u53d6\u308a\u306e\u592a\u3055",
    scroll_speed: "\u4e2d\u592e\u901f\u5ea6",
    danmaku_not_found: "\u30b3\u30e1\u30f3\u30c8\u30d5\u30a1\u30a4\u30eb\u304c\u898b\u3064\u304b\u308a\u307e\u305b\u3093",
    file_add: "\u8ffd\u52a0"
  },
  zh: {
    danmaku_visible: "\u5f39\u5e55\u663e\u793a",
    opacity: "\u5f39\u5e55\u900f\u660e\u5ea6",
    font_scale: "\u5b57\u4f53\u7f29\u653e",
    canvas_mode_label: "\u6e32\u67d3\u6a21\u5f0f",
    canvas_mode_css: "CSS Auto",
    canvas_mode_default: "Canvas Auto",
    canvas_mode_html5: "Canvas HTML5",
    canvas_mode_flash: "Canvas Flash",
    advanced: "\u9ad8\u7ea7\u8bbe\u7f6e",
    comment_limit: "\u5f39\u5e55\u4e0a\u9650",
    stroke_color: "\u63cf\u8fb9\u989c\u8272",
    stroke_inversion: "\u53cd\u8272\u63cf\u8fb9",
    stroke_opacity: "\u63cf\u8fb9\u900f\u660e\u5ea6",
    stroke_width: "\u63cf\u8fb9\u7c97\u7ec6",
    scroll_speed: "\u4e2d\u592e\u901f\u5ea6",
    danmaku_not_found: "\u672a\u627e\u5230\u5f39\u5e55\u6587\u4ef6",
    file_add: "\u6dfb\u52a0"
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
  if (commentLimitEnable) commentLimitEnable.checked = state.commentLimit > 0;
  if (commentLimitRow) commentLimitRow.style.display = state.commentLimit > 0 ? '' : 'none';
  commentLimitSlider.value = state.commentLimit;
  commentLimitValue.textContent = state.commentLimit > 0 ? String(state.commentLimit) : 'Off';
  speedSlider.value = Math.round(state.scrollSpeed * 100);
  speedValue.textContent = Math.round(state.scrollSpeed * 100) + '%';
  if (canvasModeSelect) canvasModeSelect.value = state.canvasMode || 'default';
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

canvasModeSelect.addEventListener("change", function () {
  var mode = canvasModeSelect.value;
  state.canvasMode = mode;
  iina.postMessage("set-canvas-mode", { mode: mode });
});

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
  if (data.canvasMode !== undefined) state.canvasMode = data.canvasMode;
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
  if (canvasModeSelect) canvasModeSelect.value = state.canvasMode || 'default';
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
