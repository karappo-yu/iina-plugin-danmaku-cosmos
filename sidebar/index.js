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

function getActiveOpacity() {
  return state.renderMode === 'canvas' ? state.canvasOpacity : state.cssOpacity;
}

function getActiveFontScale() {
  return state.cssFontScale;
}

function isCanvasSupported() {
  return state.danmakuType === 'nico-xml' || state.danmakuType === 'nico-json';
}

function updateDanmakuInfoUI() {
  var fileInfoEl = document.getElementById('danmaku-file-info');
  var notFoundEl = document.getElementById('danmaku-not-found');
  if (!state.danmakuLoaded) {
    if (fileInfoEl) fileInfoEl.style.display = 'none';
    if (notFoundEl) notFoundEl.style.display = '';
    toggleDanmaku.disabled = true;
    toggleDanmaku.checked = false;
    return;
  }
  if (fileInfoEl) fileInfoEl.style.display = '';
  if (notFoundEl) notFoundEl.style.display = 'none';
  toggleDanmaku.disabled = false;
  var nameEl = fileInfoEl ? fileInfoEl.querySelector('.danmaku-file-name') : null;
  var pathEl = fileInfoEl ? fileInfoEl.querySelector('.danmaku-file-path') : null;
  if (nameEl) nameEl.textContent = state.danmakuFileName || '';
  if (pathEl) pathEl.textContent = state.danmakuRelativePath || '';
}

function updateCanvasModeUI() {
  var isCanvas = state.renderMode === 'canvas';
  var supported = isCanvasSupported();
  var canUseCanvas = supported && (state.danmakuType === 'nico-json');
  if (!canUseCanvas) {
    if (canvasSection) canvasSection.style.display = 'none';
    return;
  }
  if (canvasSection) canvasSection.style.display = '';
  if (!isCanvas) {
    state.renderMode = 'css';
    renderModeCanvas.checked = false;
    iina.postMessage("set-render-mode", { mode: 'css' });
  }
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
  var show = state.enabled && state.danmakuLoaded;
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
    manual_load: "Load Danmaku"
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
    manual_load: "コメント読込"
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
    manual_load: "手动加载弹幕"
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
  toggleDanmaku.checked = state.enabled && state.danmakuLoaded;
  toggleDanmaku.disabled = !state.danmakuLoaded;
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

document.getElementById("manual-load-btn").addEventListener("click", function () {
  iina.postMessage("manual-load-danmaku");
});

renderModeCanvas.addEventListener("change", function () {
  if (!isCanvasSupported()) {
    renderModeCanvas.checked = false;
    return;
  }
  var mode = renderModeCanvas.checked ? 'canvas' : 'css';
  state.renderMode = mode;
  updateCanvasModeUI();
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
  durationValue.textContent = (val / 1000).toFixed(1) + "s";
  iina.postMessage("set-scroll-duration", { duration: val });
});

blockScroll.addEventListener("change", sendBlockType);
blockTop.addEventListener("change", sendBlockType);
blockBottom.addEventListener("change", sendBlockType);
blockForceLane.addEventListener("change", sendBlockType);

maxLaneSlider.addEventListener("input", function () {
  var val = parseInt(maxLaneSlider.value, 10) / 100;
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

applyI18n();
iina.postMessage("request-state");