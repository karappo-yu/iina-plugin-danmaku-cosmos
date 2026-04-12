var cm = null;
var danmakuVisible = true;
var currentOpacity = 0.7;
var isPaused = false;
var readyTimer = null;
var cmTime = 0;

function hexToString(hex) {
  return decodeURIComponent("%" + hex.match(/.{1,2}/g).join("%"));
}

function patchColorSetter() {
  var origDescriptor = Object.getOwnPropertyDescriptor(CoreComment.prototype, "color");
  if (!origDescriptor || !origDescriptor.set) return;

  Object.defineProperty(CoreComment.prototype, "color", {
    get: origDescriptor.get,
    set: function (c) {
      if (c < 0) {
        c = (c >>> 0) & 0xFFFFFF;
      }
      origDescriptor.set.call(this, c);
    },
    enumerable: true,
    configurable: true
  });
}

function initCommentManager() {
  var container = document.getElementById("commentCanvas");
  if (!container) return;

  patchColorSetter();

  cm = new CommentManager(container);
  cm.init();
  cm.start();

  injectFontStyle();
}

function injectFontStyle() {
  var old = document.getElementById("dm-font-style");
  if (old) old.remove();

  var style = document.createElement("style");
  style.id = "dm-font-style";
  style.type = "text/css";
  style.innerHTML = ".cmt{font-family:'Hiragino Sans','Hiragino Kaku Gothic ProN','Noto Sans JP','Yu Gothic','Meiryo','MS Gothic','MS Mincho',SimHei,SimSun,monospace !important;}";
  document.getElementsByTagName("head")[0].appendChild(style);
}

function loadDanmakuFromHex(hexString) {
  if (!cm) initCommentManager();
  if (!cm) return;

  var xmlString = hexToString(hexString);

  if (window._provider && window._provider instanceof CommentProvider) {
    window._provider.destroy();
  }
  window._provider = new CommentProvider();
  cm.clear();
  window._provider.addTarget(cm);
  cmResize();
  cm.init();
  cm.start();

  window._provider.addStaticSource(
    Promise.resolve(xmlString),
    CommentProvider.SOURCE_TEXT
  ).addParser(
    new BilibiliFormat.TextParser(),
    CommentProvider.SOURCE_TEXT
  );

  window._provider.start().then(function () {
    cm.start();
    iina.postMessage("danmaku-loaded", { count: cm.timeline.length });
  }).catch(function (e) {
    iina.postMessage("danmaku-error", { message: e.message || "Provider error" });
  });
}

function clearDanmaku() {
  if (window._provider && window._provider instanceof CommentProvider) {
    window._provider.destroy();
    window._provider = null;
  }
  if (!cm) return;
  cm.clear();
  cm.stop();
  cm.timeline = [];
  cm.position = 0;
  cm._lastPosition = 0;
}

function cmResize() {
  if (!cm) return;
  var player = document.getElementById("player");
  if (player) {
    var scale = player.offsetWidth / 680;
    cm.options.scroll.scale = scale;
  }
  cm.setBounds();
}

iina.onMessage("load-danmaku", function (data) {
  if (data.opacity !== undefined) {
    currentOpacity = data.opacity;
  }
  loadDanmakuFromHex(data.xmlContent);
  if (cm && currentOpacity !== undefined) {
    cm.options.global.opacity = currentOpacity;
  }
});

iina.onMessage("clear-danmaku", function () {
  clearDanmaku();
});

iina.onMessage("time-update", function (data) {
  if (!cm || !danmakuVisible) return;
  var t = data.time;
  if (Math.abs(cmTime - t) > 5.5) {
    cm.clear();
  }
  cmTime = t;
  cm.time(Math.floor(t * 1000));
});

iina.onMessage("pause-state", function (data) {
  isPaused = data.paused;
  if (!cm) return;
  if (isPaused) {
    cm.stop();
  } else {
    cm.start();
  }
});

iina.onMessage("toggle-danmaku", function (data) {
  danmakuVisible = data.enabled;
  var container = document.getElementById("danmaku-container");
  if (container) container.style.display = danmakuVisible ? "" : "none";
  if (!danmakuVisible && cm) cm.clear();
});

iina.onMessage("set-opacity", function (data) {
  currentOpacity = data.opacity;
  if (cm) cm.options.global.opacity = data.opacity;
});

iina.onMessage("set-speed", function (data) {
  if (!cm) return;
  var player = document.getElementById("player");
  if (player) {
    cm.options.scroll.scale = player.offsetWidth / data.speed;
  }
});

iina.onMessage("set-fontsize", function (data) {
  if (!cm) return;
  var old = document.getElementById("dm-font-style");
  if (old) old.remove();

  var style = document.createElement("style");
  style.id = "dm-font-style";
  style.type = "text/css";
  style.innerHTML = ".cmt{font-family:'Hiragino Sans','Hiragino Kaku Gothic ProN','Noto Sans JP','Yu Gothic','Meiryo','MS Gothic','MS Mincho',SimHei,SimSun,monospace !important;font-size:" + data.size + "px !important;}";
  document.getElementsByTagName("head")[0].appendChild(style);
});

iina.onMessage("block-type", function (data) {
  if (!cm) return;
  cm.filter.allowUnknownTypes = false;
  cm.filter.allowTypes[5] = !data.blockTop;
  cm.filter.allowTypes[4] = !data.blockBottom;
  cm.filter.allowTypes[1] = !data.blockScroll;
  cm.filter.allowTypes[2] = !data.blockScroll;
});

iina.onMessage("resize", function () {
  cmResize();
});

iina.onMessage("ack", function () {
  if (readyTimer) {
    clearInterval(readyTimer);
    readyTimer = null;
  }
});

window.addEventListener("resize", function () {
  cmResize();
});

document.addEventListener("visibilitychange", function () {
  if (!cm) return;
  if (document.visibilityState === "visible") {
    cm.start();
    cm.clear();
  } else {
    cm.stop();
    cm.clear();
  }
});

initCommentManager();

readyTimer = setInterval(function () {
  iina.postMessage("overlay-ready", {});
}, 300);

iina.postMessage("overlay-ready", {});
