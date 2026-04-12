var cm = null;
var danmakuVisible = true;
var currentOpacity = 0.7;
var isPaused = false;
var readyTimer = null;
var cmTime = 0;
var scrollDuration = 8000;
var scrollLanes = 500;
var fixedMaxWidthRatio = 0.8;
var seekThreshold = 5.5;

var _nicoStroke = "-1px -1px 0 #000,1px -1px 0 #000,-1px 1px 0 #000,1px 1px 0 #000,-2px 0 0 #000,2px 0 0 #000,0 -2px 0 #000,0 2px 0 #000,-1px -2px 0 #000,1px -2px 0 #000,-1px 2px 0 #000,1px 2px 0 #000,-2px -1px 0 #000,2px -1px 0 #000,-2px 1px 0 #000,2px 1px 0 #000";
var _nicoFontFamily = "'Hiragino Sans','Hiragino Kaku Gothic ProN','Noto Sans JP','Yu Gothic','Meiryo','MS Gothic','MS Mincho',SimHei,SimSun,monospace";

function buildCmtCSS(fontSize) {
  var css = ".cmt{font-family:" + _nicoFontFamily + " !important;text-shadow:" + _nicoStroke + " !important;white-space:pre !important;}";
  if (fontSize) {
    css += ".cmt{font-size:" + fontSize + "px !important;}";
  }
  return css;
}

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

function patchScrollDuration() {
  var origInit = ScrollComment.prototype.init;
  ScrollComment.prototype.init = function (recycle) {
    origInit.call(this, recycle);
    this.dur = scrollDuration;
    this.ttl = scrollDuration;
  };

  var origCssInit = CssScrollComment.prototype.init;
  CssScrollComment.prototype.init = function (recycle) {
    origCssInit.call(this, recycle);
    this.dur = scrollDuration;
    this.ttl = scrollDuration;
  };
}

function patchFixedCommentAutoSize() {
  var _canvas = document.createElement("canvas");
  var _ctx = _canvas.getContext("2d");

  function getEffectiveFontSize(commentObj) {
    var fontStyle = document.getElementById("dm-font-style");
    if (fontStyle) {
      var match = fontStyle.textContent.match(/font-size:\s*(\d+)px/);
      if (match) return parseInt(match[1], 10);
    }
    return commentObj.size || 25;
  }

  var origCoreInit = CoreComment.prototype.init;
  CoreComment.prototype.init = function (recycle) {
    origCoreInit.call(this, recycle);
    if (this.mode !== 4 && this.mode !== 5) return;
    if (!this.dom || !this.parent) return;
    var containerWidth = this.parent.width;
    if (containerWidth <= 0) return;
    var maxWidth = containerWidth * fixedMaxWidthRatio;
    var fontSize = getEffectiveFontSize(this);
    _ctx.font = fontSize + "px " + _nicoFontFamily;
    var textWidth = _ctx.measureText(this.text || "").width;
    if (textWidth > maxWidth && textWidth > 0) {
      var newSize = Math.max(10, Math.floor(fontSize * maxWidth / textWidth));
      this.dom.style.setProperty("font-size", newSize + "px", "important");
      this.dom.style.setProperty("line-height", newSize + "px", "important");
    }
  };
}

function initCommentManager() {
  var container = document.getElementById("commentCanvas");
  if (!container) return;

  patchColorSetter();
  patchScrollDuration();
  patchFixedCommentAutoSize();

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
  style.innerHTML = buildCmtCSS();
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
  cm.setBounds();
}

function seekToTime(newTimeMs) {
  if (!cm || !cm.timeline || cm.timeline.length === 0) return;

  cm.clear();
  cm.seek(newTimeMs);

  var newTimeSec = newTimeMs / 1000;
  var durSec = scrollDuration / 1000;
  var candidates = [];

  for (var i = 0; i < cm.timeline.length; i++) {
    var cmtData = cm.timeline[i];
    if (cmtData.stime > newTimeSec) break;
    var cmtEnd = cmtData.stime + durSec;
    if (cmtEnd <= newTimeSec) continue;
    if (cmtData.mode !== 1 && cmtData.mode !== 2 && cmtData.mode !== 6) continue;
    if (!cm.validate(cmtData)) continue;
    candidates.push(cmtData);
  }

  if (candidates.length === 0) return;

  var containerWidth = cm.width;
  if (containerWidth <= 0) return;

  var _canvas = document.createElement("canvas");
  var _ctx = _canvas.getContext("2d");
  var fontStyle = document.getElementById("dm-font-style");
  var globalFontSize = 25;
  if (fontStyle) {
    var match = fontStyle.textContent.match(/font-size:\s*(\d+)px/);
    if (match) globalFontSize = parseInt(match[1], 10);
  }

  candidates.forEach(function (cmtData) {
    var elapsed = newTimeSec - cmtData.stime;
    var remaining = durSec - elapsed;
    if (remaining <= 0) return;

    var fontSize = cmtData.size || globalFontSize;
    _ctx.font = fontSize + "px " + _nicoFontFamily;
    var textWidth = _ctx.measureText(cmtData.text || "").width;
    var totalDistance = containerWidth + textWidth;
    var currentX = containerWidth - (elapsed / durSec) * totalDistance;

    if (currentX < -textWidth || currentX > containerWidth) return;

    var cmt = cm.factory.create(cm, cmtData);
    cm._allocateSpace(cmt);

    cmt.dom.style.transition = "none";
    cmt.dom.style.left = currentX + "px";
    cmt._x = currentX;
    cmt._dirtyCSS = true;
    cmt.ttl = remaining * 1000;
    cmt.dur = scrollDuration;

    cm.runline.push(cmt);

    requestAnimationFrame(function () {
      cmt.dom.style.transition = "transform " + cmt.ttl + "ms linear";
      cmt.x = -textWidth;
      cmt._dirtyCSS = false;
    });
  });
}

iina.onMessage("apply-settings", function (data) {
  if (data.opacity !== undefined) {
    currentOpacity = data.opacity;
    if (cm) cm.options.global.opacity = currentOpacity;
  }
  if (data.scrollDuration !== undefined) {
    scrollDuration = data.scrollDuration;
  }
  if (data.scrollLanes !== undefined) {
    scrollLanes = data.scrollLanes;
    if (cm) cm.options.scroll.scale = scrollLanes / 680;
  }
  if (data.fontSize !== undefined && cm) {
    var old = document.getElementById("dm-font-style");
    if (old) old.remove();
    var style = document.createElement("style");
    style.id = "dm-font-style";
    style.type = "text/css";
    style.innerHTML = buildCmtCSS(data.fontSize);
    document.getElementsByTagName("head")[0].appendChild(style);
  }
});

iina.onMessage("load-danmaku", function (data) {
  if (data.opacity !== undefined) {
    currentOpacity = data.opacity;
  }
  if (data.scrollDuration !== undefined) {
    scrollDuration = data.scrollDuration;
  }
  if (data.scrollLanes !== undefined) {
    scrollLanes = data.scrollLanes;
  }
  loadDanmakuFromHex(data.xmlContent);
  if (cm && currentOpacity !== undefined) {
    cm.options.global.opacity = currentOpacity;
  }
  if (cm && scrollLanes !== undefined) {
    cm.options.scroll.scale = scrollLanes / 680;
  }
});

iina.onMessage("clear-danmaku", function () {
  clearDanmaku();
});

iina.onMessage("time-update", function (data) {
  if (!cm || !danmakuVisible) return;
  var t = data.time;
  if (Math.abs(cmTime - t) > seekThreshold) {
    seekToTime(Math.floor(t * 1000));
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

iina.onMessage("set-scroll-duration", function (data) {
  scrollDuration = data.duration;
  if (cm) {
    cm.clear();
  }
});

iina.onMessage("set-scroll-lanes", function (data) {
  scrollLanes = data.lanes;
  if (cm) {
    cm.options.scroll.scale = scrollLanes / 680;
  }
});

iina.onMessage("set-fontsize", function (data) {
  if (!cm) return;
  var old = document.getElementById("dm-font-style");
  if (old) old.remove();

  var style = document.createElement("style");
  style.id = "dm-font-style";
  style.type = "text/css";
  style.innerHTML = buildCmtCSS(data.size);
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
