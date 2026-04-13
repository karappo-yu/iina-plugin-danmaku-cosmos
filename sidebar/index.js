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

function updateUI() {
  toggleDanmaku.checked = state.enabled;
  opacitySlider.value = state.opacity;
  opacityValue.textContent = Math.round(state.opacity * 100) + "%";
  fontsizeSlider.value = Math.round(state.fontScale * 100);
  fontsizeValue.textContent = Math.round(state.fontScale * 100) + "%";
  durationSlider.value = state.scrollDuration;
  durationValue.textContent = (state.scrollDuration / 1000).toFixed(1) + "s";
  maxPerSecSlider.value = state.maxPerSec;
  maxPerSecValue.textContent = state.maxPerSec === 0 ? "不限" : state.maxPerSec + "/s";
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
  var val = parseInt(maxPerSecSlider.value, 10);
  maxPerSecValue.textContent = val === 0 ? "不限" : val + "/s";
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

iina.postMessage("request-state");