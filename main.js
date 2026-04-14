var overlay = iina.overlay;
var sidebar = iina.sidebar;
var event = iina.event;
var console = iina.console;
var menu = iina.menu;
var core = iina.core;
var file = iina.file;
var preferences = iina.preferences;
var mpv = iina.mpv;

var danmakuEnabled = preferences.get("danmakuEnabled");
var currentOpacity = preferences.get("danmakuOpacity");
var currentFontScale = preferences.get("danmakuFontScale");
var currentSpeed = preferences.get("danmakuSpeed");
var currentScrollDuration = preferences.get("scrollDuration");
var currentMaxPerSec = preferences.get("maxDanmakuPerSecond");
var overlayReady = false;
var pendingDanmaku = null;
var currentVideoUrl = null;
var timePosListenerID = null;
var windowScaleListenerID = null;

function filePathFromUrl(url) {
  if (!url) return null;
  if (url.startsWith("file://")) {
    return decodeURIComponent(url.substring(7));
  }
  return url;
}

function danmakuPathForVideo(videoUrl) {
  var path = filePathFromUrl(videoUrl);
  if (!path) return null;
  return path.replace(/\.[^.\/\\]+$/, ".xml");
}

function stringToHex(str) {
  return Array.from(str).map(function (c) {
    return c.charCodeAt(0) < 128
      ? c.charCodeAt(0).toString(16).padStart(2, "0")
      : encodeURIComponent(c).replace(/\%/g, "").toLowerCase();
  }).join("");
}

function loadDanmakuForVideo(url) {
  currentVideoUrl = url;

  if (core.status.isNetworkResource) {
    core.osd("网络资源，跳过弹幕加载");
    if (overlayReady) overlay.postMessage("clear-danmaku", {});
    return;
  }

  var danmakuPath = danmakuPathForVideo(url);
  if (!danmakuPath) {
    core.osd("无法推导弹幕路径");
    return;
  }

  if (!file.exists(danmakuPath)) {
    var altDanmakuPath = danmakuPath.replace(/[/\\][^/\\]+$/, '/弹幕$&');
    if (file.exists(altDanmakuPath)) {
      danmakuPath = altDanmakuPath;
    } else {
      pendingDanmaku = null;
      if (overlayReady) overlay.postMessage("clear-danmaku", {});
      return;
    }
  }

  var xmlContent = file.read(danmakuPath);
  if (!xmlContent) {
    core.osd("无法读取弹幕文件");
    pendingDanmaku = null;
    if (overlayReady) overlay.postMessage("clear-danmaku", {});
    return;
  }

  var hexContent = stringToHex(xmlContent);
  var payload = {
    xmlContent: hexContent,
    opacity: currentOpacity,
    fontScale: currentFontScale,
    speed: currentSpeed,
    scrollDuration: currentScrollDuration,
    maxPerSec: currentMaxPerSec,
  };

  if (overlayReady) {
    overlay.postMessage("load-danmaku", payload);
    core.osd("已加载弹幕: " + danmakuPath.split("/").pop());
    setObserver(true);
  } else {
    pendingDanmaku = payload;
    core.osd("弹幕排队中…");
  }
}

function markOverlayReady() {
  if (overlayReady) return;
  overlayReady = true;
  overlay.show();
  overlay.postMessage("ack", {});

  overlay.postMessage("apply-settings", {
    opacity: currentOpacity,
    fontScale: currentFontScale,
    speed: currentSpeed,
    scrollDuration: currentScrollDuration,
    maxPerSec: currentMaxPerSec,
  });

  if (pendingDanmaku) {
    overlay.postMessage("load-danmaku", pendingDanmaku);
    var path = danmakuPathForVideo(currentVideoUrl);
    core.osd("已加载弹幕: " + (path ? path.split("/").pop() : ""));
    pendingDanmaku = null;
    setObserver(true);
  } else if (danmakuEnabled && !core.status.idle && currentVideoUrl) {
    loadDanmakuForVideo(currentVideoUrl);
  } else if (danmakuEnabled && !core.status.idle && core.status.url) {
    loadDanmakuForVideo(core.status.url);
  }
}

function setObserver(start) {
  if (timePosListenerID) {
    event.off("mpv.time-pos.changed", timePosListenerID);
    timePosListenerID = null;
  }
  if (windowScaleListenerID) {
    event.off("mpv.window-scale.changed", windowScaleListenerID);
    windowScaleListenerID = null;
  }

  if (start && !core.status.paused && overlayReady && danmakuEnabled) {
    timePosListenerID = event.on("mpv.time-pos.changed", function (t) {
      overlay.postMessage("time-update", { time: t });
    });
    windowScaleListenerID = event.on("mpv.window-scale.changed", function () {
      overlay.postMessage("resize", {});
    });
    var t = mpv.getNumber("time-pos");
    if (t !== undefined && t !== null) {
      overlay.postMessage("time-update", { time: t });
    }
    overlay.postMessage("resize", {});
  }
}

function registerSidebarHandlers() {
  sidebar.onMessage("toggle-danmaku", function () {
    danmakuEnabled = !danmakuEnabled;
    preferences.set("danmakuEnabled", danmakuEnabled);
    preferences.sync();
    overlay.postMessage("toggle-danmaku", { enabled: danmakuEnabled });
    if (danmakuEnabled) {
      overlay.show();
      setObserver(true);
      core.osd("弹幕已开启");
    } else {
      setObserver(false);
      core.osd("弹幕已关闭");
    }
    sidebar.postMessage("danmaku-state", { enabled: danmakuEnabled });
  });

  sidebar.onMessage("set-opacity", function (data) {
    currentOpacity = data.opacity;
    preferences.set("danmakuOpacity", currentOpacity);
    preferences.sync();
    overlay.postMessage("set-opacity", { opacity: data.opacity });
  });

  sidebar.onMessage("set-fontscale", function (data) {
    currentFontScale = data.scale;
    preferences.set("danmakuFontScale", currentFontScale);
    preferences.sync();
    overlay.postMessage("set-fontscale", { scale: data.scale });
  });

  sidebar.onMessage("set-speed", function (data) {
    currentSpeed = data.speed;
    preferences.set("danmakuSpeed", currentSpeed);
    preferences.sync();
    overlay.postMessage("set-speed", { speed: data.speed });
  });

  sidebar.onMessage("set-scroll-duration", function (data) {
    currentScrollDuration = data.duration;
    preferences.set("scrollDuration", currentScrollDuration);
    preferences.sync();
    overlay.postMessage("set-scroll-duration", { duration: data.duration });
  });

  sidebar.onMessage("set-max-per-sec", function (data) {
    currentMaxPerSec = data.maxPerSec;
    preferences.set("maxDanmakuPerSecond", currentMaxPerSec);
    preferences.sync();
    overlay.postMessage("set-max-per-sec", { maxPerSec: data.maxPerSec });
  });

  sidebar.onMessage("block-type", function (data) {
    overlay.postMessage("block-type", data);
  });

  sidebar.onMessage("request-state", function () {
    sidebar.postMessage("danmaku-state", {
      enabled: danmakuEnabled,
      opacity: currentOpacity,
      fontScale: currentFontScale,
      speed: currentSpeed,
      scrollDuration: currentScrollDuration,
      maxPerSec: currentMaxPerSec,
    });
  });
}

event.on("iina.window-loaded", function () {
  overlay.loadFile("overlay/index.html");
  sidebar.loadFile("sidebar/index.html");
  registerSidebarHandlers();
});

overlay.onMessage("overlay-ready", function () {
  markOverlayReady();
});

event.on("iina.plugin-overlay-loaded", function () {
  overlay.show();
  setTimeout(function () {
    if (!overlayReady) markOverlayReady();
  }, 2000);
});

event.on("iina.file-loaded", function (url) {
  currentVideoUrl = url;
  if (danmakuEnabled) loadDanmakuForVideo(url);
});

event.on("mpv.pause.changed", function () {
  if (!overlayReady) return;
  var paused = core.status.paused;
  overlay.postMessage("pause-state", { paused: paused });
  setObserver(!paused);
});

overlay.onMessage("danmaku-error", function (data) {
  console.warn("Danmaku error: " + (data.message || "unknown"));
});

menu.addItem(
  menu.item("切换弹幕显示", function () {
    danmakuEnabled = !danmakuEnabled;
    preferences.set("danmakuEnabled", danmakuEnabled);
    preferences.sync();
    overlay.postMessage("toggle-danmaku", { enabled: danmakuEnabled });
    if (danmakuEnabled) {
      overlay.show();
      setObserver(true);
      core.osd("弹幕已开启");
    } else {
      setObserver(false);
      core.osd("弹幕已关闭");
    }
    sidebar.postMessage("danmaku-state", { enabled: danmakuEnabled });
  }, { keyBinding: "D" })
);

menu.addItem(
  menu.item("手动加载弹幕文件…", function () {
    iina.utils.chooseFile("选择弹幕XML文件", {
      allowedFileTypes: ["xml"],
    }).then(function(path) {
      if (!path) {
        core.osd("未选择文件");
        return;
      }
      var xmlContent = file.read(path);
      if (!xmlContent) {
        core.osd("无法读取弹幕文件");
        return;
      }
      core.osd("读取到内容长度: " + xmlContent.length);
      var hexContent = stringToHex(xmlContent);
      overlay.postMessage("load-danmaku", {
        xmlContent: hexContent,
        opacity: currentOpacity,
        fontScale: currentFontScale,
        speed: currentSpeed,
        scrollDuration: currentScrollDuration,
        maxPerSec: currentMaxPerSec,
      });
      core.osd("已发送弹幕: " + path.split("/").pop());
      if (!danmakuEnabled) {
        danmakuEnabled = true;
        overlay.show();
        setObserver(true);
      }
    });
  })
);

menu.addItem(menu.separator());

menu.addItem(
  menu.item("显示弹幕覆盖层", function () {
    overlay.show();
  })
);

menu.addItem(
  menu.item("隐藏弹幕覆盖层", function () {
    overlay.hide();
  })
);

console.log("Danmaku Cosmos plugin initialized");
