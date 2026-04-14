var toggleDanmaku = document.getElementById("toggle-danmaku");
var opacitySlider = document.getElementById("opacity-slider");
var opacityValue = document.getElementById("opacity-value");
var fontsizeSlider = document.getElementById("fontsize-slider");
var fontsizeValue = document.getElementById("fontsize-value");
var durationSlider = document.getElementById("duration-slider");
var durationValue = document.getElementById("duration-value");
var blockScroll = document.getElementById("block-scroll");
var blockTop = document.getElementById("block-top");
var blockBottom = document.getElementById("block-bottom");
var maxPerSecSlider = document.getElementById("max-per-sec-slider");
var maxPerSecValue = document.getElementById("max-per-sec-value");

var state = {
  enabled: true,
  opacity: 0.7,
  fontScale: 1.0,
  speed: 680,
  scrollDuration: 8000,
  maxPerSec: 20,
  blockScroll: false,
  blockTop: false,
  blockBottom: false,
};

var i18n = {
  en: {
    danmaku_visible: "Danmaku On",
    opacity: "Opacity",
    font_scale: "Font Scale",
    scroll_duration: "Scroll Duration",
    danmaku_block: "Block",
    block_scroll: "Block Scroll",
    block_top: "Block Top",
    block_bottom: "Block Bottom",
    rate_limit: "Rate Limit",
    rate_limit_hint: "Max danmaku per second, 0 = unlimited",
    unlimited: "Unlimited"
  },
  ja: {
    danmaku_visible: "コメント表示",
    opacity: "透明度",
    font_scale: "フォント倍率",
    scroll_duration: "スクロール時間",
    danmaku_block: "コメント屏蔽",
    block_scroll: "スクロール屏蔽",
    block_top: "上部屏蔽",
    block_bottom: "下部屏蔽",
    rate_limit: "コメントレート制限",
    rate_limit_hint: "每秒最大コメント数、0 = 制限なし",
    unlimited: "制限なし"
  },
  zh: {
    danmaku_visible: "弹幕显示",
    opacity: "透明度",
    font_scale: "字体缩放",
    scroll_duration: "滚动时长",
    danmaku_block: "弹幕屏蔽",
    block_scroll: "滚动屏蔽",
    block_top: "顶部屏蔽",
    block_bottom: "底部屏蔽",
    rate_limit: "弹幕限流",
    rate_limit_hint: "每秒最大弹幕数，0 = 不限",
    unlimited: "不限"
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
  var lang = getBrowserLang();
  var unlimitedText = i18n[lang].unlimited;
  toggleDanmaku.checked = state.enabled;
  opacitySlider.value = state.opacity;
  opacityValue.textContent = Math.round(state.opacity * 100) + "%";
  fontsizeSlider.value = Math.round(state.fontScale * 100);
  fontsizeValue.textContent = Math.round(state.fontScale * 100) + "%";
  durationSlider.value = state.scrollDuration;
  durationValue.textContent = (state.scrollDuration / 1000).toFixed(1) + "s";
  maxPerSecSlider.value = state.maxPerSec;
  maxPerSecValue.textContent = state.maxPerSec === 0 ? unlimitedText : state.maxPerSec + "/s";
  blockScroll.checked = state.blockScroll;
  blockTop.checked = state.blockTop;
  blockBottom.checked = state.blockBottom;
}

function sendBlockType() {
  iina.postMessage("block-type", {
    blockScroll: blockScroll.checked,
    blockTop: blockTop.checked,
    blockBottom: blockBottom.checked,
  });
}

toggleDanmaku.addEventListener("change", function () {
  iina.postMessage("toggle-danmaku");
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

maxPerSecSlider.addEventListener("input", function () {
  var lang = getBrowserLang();
  var unlimitedText = i18n[lang].unlimited;
  var val = parseInt(maxPerSecSlider.value, 10);
  maxPerSecValue.textContent = val === 0 ? unlimitedText : val + "/s";
  iina.postMessage("set-max-per-sec", { maxPerSec: val });
});

iina.onMessage("danmaku-state", function (data) {
  if (data.enabled !== undefined) state.enabled = data.enabled;
  if (data.opacity !== undefined) state.opacity = data.opacity;
  if (data.fontScale !== undefined) state.fontScale = data.fontScale;
  if (data.speed !== undefined) state.speed = data.speed;
  if (data.scrollDuration !== undefined) state.scrollDuration = data.scrollDuration;
  if (data.maxPerSec !== undefined) state.maxPerSec = data.maxPerSec;
  updateUI();
});

applyI18n();
iina.postMessage("request-state");