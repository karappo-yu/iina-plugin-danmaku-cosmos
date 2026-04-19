var toggleDanmaku = document.getElementById("toggle-danmaku");
var renderModeCanvas = document.getElementById("render-mode-canvas");
var canvasModeSelect = document.getElementById("canvas-mode-select");
var opacitySlider = document.getElementById("opacity-slider");
var opacityValue = document.getElementById("opacity-value");
var fontsizeSlider = document.getElementById("fontsize-slider");
var fontsizeValue = document.getElementById("fontsize-value");
var durationSlider = document.getElementById("duration-slider");
var durationValue = document.getElementById("duration-value");
var blockScroll = document.getElementById("block-scroll");
var blockTop = document.getElementById("block-top");
var blockBottom = document.getElementById("block-bottom");
var blockForceLane = document.getElementById("block-force-lane");
var maxLaneSlider = document.getElementById("max-lane-slider");
var maxLaneValue = document.getElementById("max-lane-value");
var fileAddBtn = document.getElementById("danmaku-file-add-btn");

var durationSection = durationSlider.closest('.section');
var fontsizeSection = fontsizeSlider.closest('.section');
var laneLimitSection = maxLaneSlider.closest('.section');
var blockForceLaneLabel = blockForceLane.closest('.checkbox-label');

var opacitySection = opacitySlider.closest('.section');
var blockSection = blockScroll.closest('.section');
var canvasSection = renderModeCanvas.closest('.section');

var settingsSections = [canvasSection, laneLimitSection, opacitySection, fontsizeSection, durationSection, blockSection];

var state = {
  enabled: true,
  renderMode: 'css',
  canvasMode: 'default',
  danmakuType: 'none',
  danmakuFileName: null,
  danmakuRelativePath: null,
  danmakuLoaded: false,
  cssOpacity: 0.7,
  canvasOpacity: 0.8,
  cssFontScale: 1.0,
  speed: 680,
  scrollDuration: 8000,
  blockScroll: false,
  blockTop: false,
  blockBottom: false,
  blockForceLane: false,
  maxLaneRatio: 1.0,
};

var fileListState = {
  xmlFiles: [],
  jsonFiles: [],
  unknownFiles: [],
  selectedPaths: [],
  unknownExpanded: false,
  errorPaths: {}
};

var checkDebounceTimer = null;

function getActiveOpacity() {
  return state.renderMode === 'canvas' ? state.canvasOpacity : state.cssOpacity;
}

function getActiveFontScale() {
  return state.cssFontScale;
}

function isCanvasSupported() {
  if (fileListState.selectedPaths.length !== 1) return false;
  var selectedPath = fileListState.selectedPaths[0];
  var allFiles = fileListState.xmlFiles.concat(fileListState.jsonFiles).concat(fileListState.unknownFiles);
  for (var i = 0; i < allFiles.length; i++) {
    if (allFiles[i].path === selectedPath) {
      return allFiles[i].type === 'JSON';
    }
  }
  return false;
}

function isCanvasMode() {
  return state.renderMode === 'canvas';
}

function createFileItem(fileInfo, isChecked, isDisabled) {
  var item = document.createElement('div');
  item.className = 'danmaku-file-item' + (isDisabled ? ' disabled' : '');
  item.dataset.path = fileInfo.path;

  var checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = isChecked;
  checkbox.disabled = isDisabled;
  checkbox.setAttribute('data-clickable', '');
  checkbox.addEventListener('change', function () {
    debouncedFileCheck(fileInfo.path, checkbox.checked);
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
  deleteBtn.textContent = '×';
  deleteBtn.title = 'Delete';
  deleteBtn.setAttribute('data-clickable', '');
  deleteBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    iina.postMessage("danmaku-file-delete", { path: fileInfo.path });
  });

  item.appendChild(checkbox);
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

function createFileGroup(title, files, selectedPaths, isDisabled) {
  if (files.length === 0) return null;

  var group = document.createElement('div');
  group.className = 'danmaku-file-group';

  var titleEl = document.createElement('div');
  titleEl.className = 'danmaku-file-group-title';
  titleEl.textContent = title;
  group.appendChild(titleEl);

  for (var i = 0; i < files.length; i++) {
    var isChecked = selectedPaths.indexOf(files[i].path) !== -1;
    var item = createFileItem(files[i], isChecked, isDisabled);
    group.appendChild(item);
  }

  return group;
}

function renderFileList() {
  var container = document.getElementById('danmaku-file-list-container');
  if (!container) return;
  container.innerHTML = '';

  var isDisabled = isCanvasMode();
  var hasFiles = fileListState.xmlFiles.length > 0 || fileListState.jsonFiles.length > 0 || fileListState.unknownFiles.length > 0;

  var lang = getBrowserLang();
  var xmlTitle = lang === 'zh' ? 'XML 弹幕' : lang === 'ja' ? 'XMLコメント' : 'XML Danmaku';
  var jsonTitle = lang === 'zh' ? 'JSON 弹幕' : lang === 'ja' ? 'JSONコメント' : 'JSON Danmaku';
  var unknownTitle = lang === 'zh' ? '未识别集数' : lang === 'ja' ? '未認識エピソード' : 'Unknown Episode';

  if (fileListState.xmlFiles.length > 0) {
    var xmlGroup = createFileGroup(xmlTitle, fileListState.xmlFiles, fileListState.selectedPaths, isDisabled);
    if (xmlGroup) container.appendChild(xmlGroup);
  }

  if (fileListState.jsonFiles.length > 0) {
    var jsonGroup = createFileGroup(jsonTitle, fileListState.jsonFiles, fileListState.selectedPaths, isDisabled);
    if (jsonGroup) container.appendChild(jsonGroup);
  }

  if (fileListState.unknownFiles.length > 0) {
    var toggleEl = document.createElement('div');
    toggleEl.className = 'danmaku-file-unknown-toggle';
    var arrow = document.createElement('span');
    arrow.className = 'toggle-arrow' + (fileListState.unknownExpanded ? ' expanded' : '');
    arrow.textContent = '▶';
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
    var unknownGroup = createFileGroup('', fileListState.unknownFiles, fileListState.selectedPaths, isDisabled);
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
  if (lang === 'zh') {
    countEl.textContent = '已选 ' + selected + ' / ' + total + ' 个文件';
  } else if (lang === 'ja') {
    countEl.textContent = selected + ' / ' + total + ' ファイル選択';
  } else {
    countEl.textContent = selected + ' / ' + total + ' selected';
  }
}

function debouncedFileCheck(path, checked) {
  if (checkDebounceTimer) {
    clearTimeout(checkDebounceTimer);
  }
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
  if (!hasDanmaku) {
    toggleDanmaku.checked = false;
  }
}

function updateCanvasModeUI() {
  var isCanvas = state.renderMode === 'canvas';
  var supported = isCanvasSupported();
  if (!supported) {
    if (canvasSection) canvasSection.style.display = 'none';
    if (isCanvas) {
      state.renderMode = 'css';
      renderModeCanvas.checked = false;
      iina.postMessage("set-render-mode", { mode: 'css' });
    }
    return;
  }
  if (canvasSection) canvasSection.style.display = '';
  if (fontsizeSection) fontsizeSection.style.display = isCanvas ? 'none' : '';
  if (durationSection) durationSection.style.display = isCanvas ? 'none' : '';
  if (laneLimitSection) laneLimitSection.style.display = isCanvas ? 'none' : '';
  if (blockSection) blockSection.style.display = isCanvas ? 'none' : '';
  var canvasOptions = document.querySelector('.canvas-mode-options');
  if (canvasOptions) canvasOptions.style.display = isCanvas ? '' : 'none';
  var canvasUnsupported = document.querySelector('.canvas-unsupported');
  if (canvasUnsupported) canvasUnsupported.style.display = 'none';
}

function updateEnabledUI() {
  var hasFiles = fileListState.xmlFiles.length > 0 || fileListState.jsonFiles.length > 0 || fileListState.unknownFiles.length > 0;
  var show = state.enabled && (state.danmakuLoaded || hasFiles);
  settingsSections.forEach(function(sec) {
    if (sec) sec.style.display = show ? '' : 'none';
  });
  updateDanmakuInfoUI();
  if (show) {
    updateCanvasModeUI();
  }
}

var i18n = {
  en: {
    danmaku_visible: "Danmaku On",
    render_canvas: "Canvas Render",
    render_canvas_hint: "Better compatibility with Comment Art",
    render_canvas_unsupported: "Only available for Niconico format",
    render_canvas_note: "Opacity, Font Scale are available",
    canvas_mode: "Mode",
    canvas_mode_default: "Auto",
    canvas_mode_html5: "HTML5",
    canvas_mode_flash: "Flash",
    opacity: "Opacity",
    font_scale: "Font Scale",
    scroll_duration: "Scroll Duration",
    danmaku_block: "Block",
    block_force_lane: "Block Overflow",
    block_scroll: "Block Scroll",
    block_top: "Block Top",
    block_bottom: "Block Bottom",
    lane_limit: "Lane Limit",
    danmaku_not_found: "No danmaku file found",
    manual_load: "Load Danmaku",
    file_add: "Add"
  },
  ja: {
    danmaku_visible: "コメント表示",
    render_canvas: "Canvas描画",
    render_canvas_hint: "コメントアートとの互換性が高い",
    render_canvas_unsupported: "ニコニコ形式のみ利用可能",
    render_canvas_note: "透明度・フォント倍率が有効",
    canvas_mode: "モード",
    canvas_mode_default: "自動",
    canvas_mode_html5: "HTML5",
    canvas_mode_flash: "Flash",
    opacity: "透明度",
    font_scale: "フォント倍率",
    scroll_duration: "スクロール時間",
    danmaku_block: "コメント屏蔽",
    block_force_lane: "溢出屏蔽",
    block_scroll: "スクロール屏蔽",
    block_top: "上部屏蔽",
    block_bottom: "下部屏蔽",
    lane_limit: "軌道制限",
    danmaku_not_found: "弹幕ファイルが見つかりません",
    manual_load: "コメント読込",
    file_add: "追加"
  },
  zh: {
    danmaku_visible: "弹幕显示",
    render_canvas: "Canvas渲染",
    render_canvas_hint: "对高级弹幕兼容性更好",
    render_canvas_unsupported: "仅Niconico格式可用",
    render_canvas_note: "透明度、字体缩放可用",
    canvas_mode: "模式",
    canvas_mode_default: "自动",
    canvas_mode_html5: "HTML5",
    canvas_mode_flash: "Flash",
    opacity: "透明度",
    font_scale: "字体缩放",
    scroll_duration: "滚动时长",
    danmaku_block: "弹幕屏蔽",
    block_force_lane: "过滤溢出",
    block_scroll: "滚动屏蔽",
    block_top: "顶部屏蔽",
    block_bottom: "底部屏蔽",
    lane_limit: "轨道限制",
    danmaku_not_found: "未找到弹幕文件",
    manual_load: "手动加载弹幕",
    file_add: "添加"
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
  renderModeCanvas.checked = state.renderMode === 'canvas';
  renderModeCanvas.disabled = !isCanvasSupported();
  opacitySlider.value = getActiveOpacity();
  opacityValue.textContent = Math.round(getActiveOpacity() * 100) + "%";
  fontsizeSlider.value = Math.round(getActiveFontScale() * 100);
  fontsizeValue.textContent = Math.round(getActiveFontScale() * 100) + "%";
  durationSlider.value = state.scrollDuration;
  durationValue.textContent = (state.scrollDuration / 1000).toFixed(1) + "s";
  maxLaneSlider.value = Math.round(state.maxLaneRatio * 100);
  maxLaneValue.textContent = Math.round(state.maxLaneRatio * 100) + "%";
  blockScroll.checked = state.blockScroll;
  blockTop.checked = state.blockTop;
  blockBottom.checked = state.blockBottom;
  blockForceLane.checked = state.blockForceLane;
  if (canvasModeSelect) canvasModeSelect.value = state.canvasMode || 'default';
}

function sendBlockType() {
  iina.postMessage("block-type", {
    blockScroll: blockScroll.checked,
    blockTop: blockTop.checked,
    blockBottom: blockBottom.checked,
  });
  iina.postMessage("block-force-lane", {
    blockForceLane: blockForceLane.checked,
  });
}

toggleDanmaku.addEventListener("change", function () {
  if (toggleDanmaku.disabled) {
    toggleDanmaku.checked = false;
    return;
  }
  state.enabled = toggleDanmaku.checked;
  updateEnabledUI();
  iina.postMessage("toggle-danmaku");
});

if (fileAddBtn) {
  fileAddBtn.addEventListener("click", function () {
    iina.postMessage("danmaku-file-add");
  });
}

renderModeCanvas.addEventListener("change", function () {
  if (!isCanvasSupported()) {
    renderModeCanvas.checked = false;
    return;
  }
  var mode = renderModeCanvas.checked ? 'canvas' : 'css';
  state.renderMode = mode;
  updateCanvasModeUI();
  renderFileList();
  iina.postMessage("set-render-mode", { mode: mode });
  iina.postMessage("set-opacity", { opacity: getActiveOpacity() });
  iina.postMessage("set-fontscale", { scale: getActiveFontScale() });
  updateUI();
});

canvasModeSelect.addEventListener("change", function () {
  var mode = canvasModeSelect.value;
  state.canvasMode = mode;
  iina.postMessage("set-canvas-mode", { mode: mode });
});

opacitySlider.addEventListener("input", function () {
  var val = parseFloat(opacitySlider.value);
  if (state.renderMode === 'canvas') {
    state.canvasOpacity = val;
  } else {
    state.cssOpacity = val;
  }
  opacityValue.textContent = Math.round(val * 100) + "%";
  iina.postMessage("set-opacity", { opacity: val });
});

fontsizeSlider.addEventListener("input", function () {
  var val = parseFloat(fontsizeSlider.value) / 100;
  state.cssFontScale = val;
  fontsizeValue.textContent = Math.round(val * 100) + "%";
  iina.postMessage("set-fontscale", { scale: val });
});

durationSlider.addEventListener("input", function () {
  var val = parseInt(durationSlider.value, 10);
  state.scrollDuration = val;
  durationValue.textContent = (val / 1000).toFixed(1) + "s";
  iina.postMessage("set-scroll-duration", { duration: val });
});

blockScroll.addEventListener("change", function () {
  state.blockScroll = blockScroll.checked;
  sendBlockType();
});
blockTop.addEventListener("change", function () {
  state.blockTop = blockTop.checked;
  sendBlockType();
});
blockBottom.addEventListener("change", function () {
  state.blockBottom = blockBottom.checked;
  sendBlockType();
});
blockForceLane.addEventListener("change", function () {
  state.blockForceLane = blockForceLane.checked;
  sendBlockType();
});

maxLaneSlider.addEventListener("input", function () {
  var val = parseInt(maxLaneSlider.value, 10) / 100;
  state.maxLaneRatio = val;
  maxLaneValue.textContent = Math.round(val * 100) + "%";
  iina.postMessage("set-lane-limit", { maxLaneRatio: val });
});

iina.onMessage("danmaku-state", function (data) {
  if (data.enabled !== undefined) state.enabled = data.enabled;
  if (data.renderMode !== undefined) state.renderMode = data.renderMode;
  if (data.canvasMode !== undefined) state.canvasMode = data.canvasMode;
  if (data.cssOpacity !== undefined) state.cssOpacity = data.cssOpacity;
  if (data.canvasOpacity !== undefined) state.canvasOpacity = data.canvasOpacity;
  if (data.cssFontScale !== undefined) state.cssFontScale = data.cssFontScale;
  if (data.speed !== undefined) state.speed = data.speed;
  if (data.scrollDuration !== undefined) state.scrollDuration = data.scrollDuration;
  if (data.blockForceLane !== undefined) state.blockForceLane = data.blockForceLane;
  if (data.maxLaneRatio !== undefined) state.maxLaneRatio = data.maxLaneRatio;
  if (data.blockScroll !== undefined) state.blockScroll = data.blockScroll;
  if (data.blockTop !== undefined) state.blockTop = data.blockTop;
  if (data.blockBottom !== undefined) state.blockBottom = data.blockBottom;
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
  updateCanvasModeUI();
  renderModeCanvas.disabled = !isCanvasSupported();
});

iina.onMessage("danmaku-file-error", function (data) {
  fileListState.errorPaths[data.path] = data.message;
  renderFileList();
});

applyI18n();
iina.postMessage("request-state");
