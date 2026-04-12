var btnToggle = document.getElementById("btn-toggle");
var opacitySlider = document.getElementById("opacity-slider");
var opacityValue = document.getElementById("opacity-value");
var fontsizeSlider = document.getElementById("fontsize-slider");
var fontsizeValue = document.getElementById("fontsize-value");
var durationSlider = document.getElementById("duration-slider");
var durationValue = document.getElementById("duration-value");
var lanesSlider = document.getElementById("lanes-slider");
var lanesValue = document.getElementById("lanes-value");
var blockScroll = document.getElementById("block-scroll");
var blockTop = document.getElementById("block-top");
var blockBottom = document.getElementById("block-bottom");
var danmakuInfo = document.getElementById("danmaku-info");

var state = {
  enabled: true,
  opacity: 0.7,
  fontSize: 25,
  speed: 680,
  scrollDuration: 8000,
  scrollLanes: 500,
  blockScroll: false,
  blockTop: false,
  blockBottom: false,
  count: 0,
};

function updateUI() {
  btnToggle.textContent = state.enabled ? "关闭" : "开启";
  btnToggle.className = "btn " + (state.enabled ? "btn-on" : "btn-off");
  opacitySlider.value = state.opacity;
  opacityValue.textContent = Math.round(state.opacity * 100) + "%";
  fontsizeSlider.value = state.fontSize;
  fontsizeValue.textContent = state.fontSize + "px";
  durationSlider.value = state.scrollDuration;
  durationValue.textContent = (state.scrollDuration / 1000).toFixed(1) + "s";
  lanesSlider.value = state.scrollLanes;
  lanesValue.textContent = state.scrollLanes;
  blockScroll.checked = state.blockScroll;
  blockTop.checked = state.blockTop;
  blockBottom.checked = state.blockBottom;
  danmakuInfo.textContent = state.count > 0 ? "已加载 " + state.count + " 条弹幕" : "未加载弹幕";
}

function sendBlockType() {
  iina.postMessage("block-type", {
    blockScroll: blockScroll.checked,
    blockTop: blockTop.checked,
    blockBottom: blockBottom.checked,
  });
}

btnToggle.addEventListener("click", function () {
  iina.postMessage("toggle-danmaku");
});

opacitySlider.addEventListener("input", function () {
  var val = parseFloat(opacitySlider.value);
  opacityValue.textContent = Math.round(val * 100) + "%";
  iina.postMessage("set-opacity", { opacity: val });
});

fontsizeSlider.addEventListener("input", function () {
  var val = parseInt(fontsizeSlider.value, 10);
  fontsizeValue.textContent = val + "px";
  iina.postMessage("set-fontsize", { size: val });
});

durationSlider.addEventListener("input", function () {
  var val = parseInt(durationSlider.value, 10);
  durationValue.textContent = (val / 1000).toFixed(1) + "s";
  iina.postMessage("set-scroll-duration", { duration: val });
});

lanesSlider.addEventListener("input", function () {
  var val = parseInt(lanesSlider.value, 10);
  lanesValue.textContent = val;
  iina.postMessage("set-scroll-lanes", { lanes: val });
});

blockScroll.addEventListener("change", sendBlockType);
blockTop.addEventListener("change", sendBlockType);
blockBottom.addEventListener("change", sendBlockType);

iina.onMessage("danmaku-state", function (data) {
  if (data.enabled !== undefined) state.enabled = data.enabled;
  if (data.count !== undefined) state.count = data.count;
  if (data.opacity !== undefined) state.opacity = data.opacity;
  if (data.fontSize !== undefined) state.fontSize = data.fontSize;
  if (data.speed !== undefined) state.speed = data.speed;
  if (data.scrollDuration !== undefined) state.scrollDuration = data.scrollDuration;
  if (data.scrollLanes !== undefined) state.scrollLanes = data.scrollLanes;
  updateUI();
});

iina.onMessage("danmaku-count", function (data) {
  state.count = data.count || 0;
  updateUI();
});

iina.postMessage("request-state");
