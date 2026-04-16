var toggleDanmaku = document.getElementById("toggle-danmaku");
var renderModeCanvas = document.getElementById("render-mode-canvas");
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
  opacity: 0.7,
  fontScale: 1.0,
  speed: 680,
  scrollDuration: 8000,
  blockScroll: false,
  blockTop: false,
  blockBottom: false,
  blockForceLane: false,
  maxLaneRatio: 1.0,
};

function updateCanvasModeUI() {
  var isCanvas = state.renderMode === 'canvas';
  if (durationSection) durationSection.style.display = isCanvas ? 'none' : '';
  if (fontsizeSection) fontsizeSection.style.display = isCanvas ? 'none' : '';
  if (laneLimitSection) laneLimitSection.style.display = isCanvas ? 'none' : '';
  if (blockSection) blockSection.style.display = isCanvas ? 'none' : '';
  var canvasHint = document.querySelector('.canvas-hint');
  if (canvasHint) canvasHint.style.display = isCanvas ? '' : 'none';
}

function updateEnabledUI() {
  var show = state.enabled;
  settingsSections.forEach(function(sec) {
    if (sec) sec.style.display = show ? '' : 'none';
  });
  if (show) updateCanvasModeUI();
}

var i18n = {
  en: {
    danmaku_visible: "Danmaku On",
    render_canvas: "Canvas Render",
    render_canvas_hint: "Better compatibility with Comment Art",
    render_canvas_note: "Opacity is available",
    opacity: "Opacity",
    font_scale: "Font Scale",
    scroll_duration: "Scroll Duration",
    danmaku_block: "Block",
    block_force_lane: "Block Overflow",
    block_scroll: "Block Scroll",
    block_top: "Block Top",
    block_bottom: "Block Bottom",
    lane_limit: "Lane Limit"
  },
  ja: {
    danmaku_visible: "コメント表示",
    render_canvas: "Canvas描画",
    render_canvas_hint: "コメントアートとの互換性が高い",
    render_canvas_note: "透明度が有効",
    opacity: "透明度",
    font_scale: "フォント倍率",
    scroll_duration: "スクロール時間",
    danmaku_block: "コメント屏蔽",
    block_force_lane: "溢出屏蔽",
    block_scroll: "スクロール屏蔽",
    block_top: "上部屏蔽",
    block_bottom: "下部屏蔽",
    lane_limit: "軌道制限"
  },
  zh: {
    danmaku_visible: "弹幕显示",
    render_canvas: "Canvas渲染",
    render_canvas_hint: "对高级弹幕兼容性更好",
    render_canvas_note: "透明度可用",
    opacity: "透明度",
    font_scale: "字体缩放",
    scroll_duration: "滚动时长",
    danmaku_block: "弹幕屏蔽",
    block_force_lane: "过滤溢出",
    block_scroll: "滚动屏蔽",
    block_top: "顶部屏蔽",
    block_bottom: "底部屏蔽",
    lane_limit: "轨道限制"
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
  toggleDanmaku.checked = state.enabled;
  renderModeCanvas.checked = state.renderMode === 'canvas';
  opacitySlider.value = state.opacity;
  opacityValue.textContent = Math.round(state.opacity * 100) + "%";
  fontsizeSlider.value = Math.round(state.fontScale * 100);
  fontsizeValue.textContent = Math.round(state.fontScale * 100) + "%";
  durationSlider.value = state.scrollDuration;
  durationValue.textContent = (state.scrollDuration / 1000).toFixed(1) + "s";
  maxLaneSlider.value = Math.round(state.maxLaneRatio * 100);
  maxLaneValue.textContent = Math.round(state.maxLaneRatio * 100) + "%";
  blockScroll.checked = state.blockScroll;
  blockTop.checked = state.blockTop;
  blockBottom.checked = state.blockBottom;
  blockForceLane.checked = state.blockForceLane;
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
  state.enabled = toggleDanmaku.checked;
  updateEnabledUI();
  iina.postMessage("toggle-danmaku");
});

renderModeCanvas.addEventListener("change", function () {
  var mode = renderModeCanvas.checked ? 'canvas' : 'css';
  state.renderMode = mode;
  updateCanvasModeUI();
  iina.postMessage("set-render-mode", { mode: mode });
});

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
  if (data.opacity !== undefined) state.opacity = data.opacity;
  if (data.fontScale !== undefined) state.fontScale = data.fontScale;
  if (data.speed !== undefined) state.speed = data.speed;
  if (data.scrollDuration !== undefined) state.scrollDuration = data.scrollDuration;
  if (data.blockForceLane !== undefined) state.blockForceLane = data.blockForceLane;
  if (data.maxLaneRatio !== undefined) state.maxLaneRatio = data.maxLaneRatio;
  updateUI();
  updateEnabledUI();
});

applyI18n();
iina.postMessage("request-state");