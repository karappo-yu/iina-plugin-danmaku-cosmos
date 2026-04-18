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
var cssOpacity = preferences.get("danmakuOpacity") || 0.7;
var canvasOpacity = preferences.get("danmakuCanvasOpacity") || 0.8;
var cssFontScale = preferences.get("danmakuFontScale") || 1.0;
var currentSpeed = preferences.get("danmakuSpeed");
var currentScrollDuration = preferences.get("scrollDuration");
var currentBlockForceLane = preferences.get("blockForceLane");
var currentMaxLaneRatio = preferences.get("maxLaneRatio") !== undefined ? preferences.get("maxLaneRatio") : 1.0;
var currentPlaybackSpeed = 1.0;
var currentRenderMode = 'css';
var overlayReady = false;

function getActiveOpacity() {
  return currentRenderMode === 'canvas' ? canvasOpacity : cssOpacity;
}

function getActiveFontScale() {
  return cssFontScale;
}
var pendingDanmaku = null;
var currentVideoUrl = null;
var timePosListenerID = null;
var windowScaleListenerID = null;
var speedListenerID = null;

var currentDanmakuStatus = {
  fileType: null,
  fileName: null,
  relativePath: null,
  isLoaded: false
};

function updateDanmakuStatus(status) {
  currentDanmakuStatus = status;
  sidebar.postMessage("danmaku-type", currentDanmakuStatus);
}

function danmakuNotFound() {
  updateDanmakuStatus({ fileType: null, fileName: null, relativePath: null, isLoaded: false });
  if (danmakuEnabled) {
    danmakuEnabled = false;
    preferences.set("danmakuEnabled", false);
    preferences.sync();
    overlay.postMessage("toggle-danmaku", { enabled: false });
    sidebar.postMessage("danmaku-state", { enabled: false });
    setObserver(false);
  }
}

function detectDanmakuFileType(content) {
  if (!content) return null;
  var s = content.trim();
  if (s.charAt(0) === '[') return 'nico-json';
  if (s.charAt(0) === '<') {
    if (s.indexOf('<packet') !== -1) return 'nico-xml';
    if (s.indexOf('<d p=') !== -1) return 'bilibili-xml';
  }
  return null;
}

function nicoXmlToV1Json(xmlStr) {
  var chatRegex = /<chat\s+([^>]*)>([\s\S]*?)<\/chat>/g;
  var comments = [];
  var match;
  while ((match = chatRegex.exec(xmlStr)) !== null) {
    var attrs = match[1];
    var text = match[2];
    var vpos = getXmlAttr(attrs, 'vpos');
    var mail = getXmlAttr(attrs, 'mail');
    var userId = getXmlAttr(attrs, 'user_id');
    var date = getXmlAttr(attrs, 'date');
    var no = getXmlAttr(attrs, 'no');
    var premium = getXmlAttr(attrs, 'premium');
    var dateNum = parseInt(date) || 0;
    var postedAt = dateNum > 0 ? new Date(dateNum * 1000).toISOString().replace(/\.000Z$/, '+09:00') : '1970-01-01T00:00:00+09:00';
    comments.push({
      id: no || "0",
      no: parseInt(no) || 0,
      vposMs: (parseInt(vpos) || 0) * 10,
      body: text,
      commands: mail ? mail.split(/\s+/).filter(function(s) { return s; }) : [],
      userId: userId || "",
      isPremium: premium === "1",
      score: 0,
      postedAt: postedAt,
      nicoruCount: 0,
      nicoruId: null,
      source: "trunk",
      isMyPost: false
    });
  }
  return JSON.stringify([{ id: 0, fork: "0", commentCount: comments.length, comments: comments }]);
}

function getXmlAttr(attrs, name) {
  var regex = new RegExp(name + '="([^"]*)"');
  var m = attrs.match(regex);
  return m ? m[1] : null;
}

function filePathFromUrl(url) {
  if (!url) return null;
  if (url.startsWith("file://")) {
    return decodeURIComponent(url.substring(7));
  }
  return url;
}

function extractEpisodeNumber(videoPath) {
  var filename = videoPath.replace(/.*[/\\]/, '').replace(/\.[^.]+$/, '');
  var match;
  match = filename.match(/\[(\d{1,3})\](?!.*\[)/);
  if (match) return parseInt(match[1], 10);
  match = filename.match(/\[\d{1,3}\]/g);
  if (match) {
    match = match[match.length - 1].match(/\[(\d{1,3})\]/);
    if (match) return parseInt(match[1], 10);
  }
  match = filename.match(/(?:^|[_\-.\s])(\d{1,3})(?:_|\-|\.|\s|$)/);
  if (match) return parseInt(match[1], 10);
  match = filename.match(/(?:^|[\[\]_\-.\s])(1?\d)(?:_|\.|\s|$)/i);
  if (match) return parseInt(match[1], 10);
  match = filename.match(/(?:第|話|话|Episode|Ep\.?)\s*(\d{1,3})/i);
  if (match) return parseInt(match[1], 10);
  return null;
}

function danmakuPathForVideo(videoUrl) {
  var path = filePathFromUrl(videoUrl);
  if (!path) return null;
  var jsonPath = path.replace(/\.[^.\/\\]+$/, ".json");
  if (file.exists(jsonPath)) return jsonPath;
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
  currentRenderMode = 'css';
  overlay.postMessage("set-render-mode", { mode: 'css' });
  sidebar.postMessage("danmaku-state", { renderMode: 'css' });

  if (core.status.isNetworkResource) {
    core.osd("网络资源，跳过弹幕加载");
    danmakuNotFound();
    if (overlayReady) overlay.postMessage("clear-danmaku", {});
    return;
  }

  var danmakuPath = danmakuPathForVideo(url);
  if (!danmakuPath) {
    core.osd("无法推导弹幕路径");
    danmakuNotFound();
    return;
  }

  if (!file.exists(danmakuPath)) {
    var videoBaseName = danmakuPath.replace(/\.[^.\/\\]+$/, '');
    var altDanmakuPath = videoBaseName.replace(/[/\\][^/\\]+$/, '/弹幕/' + videoBaseName.split('/').pop());
    if (!file.exists(altDanmakuPath + '.json') && !file.exists(altDanmakuPath + '.xml')) {
      altDanmakuPath = videoBaseName.replace(/[/\\][^/\\]+$/, '/Comments/' + videoBaseName.split('/').pop());
    }
    if (!file.exists(altDanmakuPath + '.json') && !file.exists(altDanmakuPath + '.xml')) {
      altDanmakuPath = videoBaseName.replace(/[/\\][^/\\]+$/, '/コメント/' + videoBaseName.split('/').pop());
    }
    if (file.exists(altDanmakuPath + '.json')) {
      danmakuPath = altDanmakuPath + '.json';
    } else if (file.exists(altDanmakuPath + '.xml')) {
      danmakuPath = altDanmakuPath + '.xml';
    } else {
      var epNum = extractEpisodeNumber(danmakuPath);
      if (epNum !== null) {
        var danmakuDir = videoBaseName.replace(/[/\\][^/\\]+$/, '/弹幕');
        var epDanmakuPath = danmakuDir + '/' + epNum;
        if (!file.exists(epDanmakuPath + '.json') && !file.exists(epDanmakuPath + '.xml')) {
          danmakuDir = videoBaseName.replace(/[/\\][^/\\]+$/, '/Comments');
          epDanmakuPath = danmakuDir + '/' + epNum;
        }
        if (!file.exists(epDanmakuPath + '.json') && !file.exists(epDanmakuPath + '.xml')) {
          danmakuDir = videoBaseName.replace(/[/\\][^/\\]+$/, '/コメント');
          epDanmakuPath = danmakuDir + '/' + epNum;
        }
        if (file.exists(epDanmakuPath + '.json')) {
          danmakuPath = epDanmakuPath + '.json';
        } else if (file.exists(epDanmakuPath + '.xml')) {
          danmakuPath = epDanmakuPath + '.xml';
        } else {
          pendingDanmaku = null;
          danmakuNotFound();
          if (overlayReady) overlay.postMessage("clear-danmaku", {});
          return;
        }
      } else {
        pendingDanmaku = null;
        danmakuNotFound();
        if (overlayReady) overlay.postMessage("clear-danmaku", {});
        return;
      }
    }
  }

  var xmlContent = file.read(danmakuPath);
  if (!xmlContent) {
    core.osd("无法读取弹幕文件");
    pendingDanmaku = null;
    danmakuNotFound();
    if (overlayReady) overlay.postMessage("clear-danmaku", {});
    return;
  }

  var fileType = detectDanmakuFileType(xmlContent);
  var sendContent = xmlContent;
  if (fileType === 'nico-xml') {
    sendContent = nicoXmlToV1Json(xmlContent);
  }
  var hexContent = stringToHex(sendContent);
  var danmakuFileName = danmakuPath.split("/").pop();
  var videoDir = filePathFromUrl(url).replace(/[/\\][^/\\]+$/, '');
  var relativePath = danmakuPath;
  if (danmakuPath.startsWith(videoDir + "/")) {
    relativePath = danmakuPath.substring(videoDir.length + 1);
  }
  updateDanmakuStatus({ fileType: fileType, fileName: danmakuFileName, relativePath: relativePath, isLoaded: true });

  var payload = {
    xmlContent: hexContent,
    opacity: getActiveOpacity(),
    fontScale: getActiveFontScale(),
    speed: currentSpeed,
    scrollDuration: currentScrollDuration,
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
    opacity: getActiveOpacity(),
    fontScale: getActiveFontScale(),
    speed: currentSpeed,
    scrollDuration: currentScrollDuration,
    blockForceLane: currentBlockForceLane,
    maxLaneRatio: currentMaxLaneRatio,
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
  if (speedListenerID) {
    event.off("mpv.speed.changed", speedListenerID);
    speedListenerID = null;
  }

  if (start && overlayReady && danmakuEnabled) {
    timePosListenerID = event.on("mpv.time-pos.changed", function (t) {
      overlay.postMessage("time-update", { time: t });
    });
    windowScaleListenerID = event.on("mpv.window-scale.changed", function () {
      overlay.postMessage("resize", {});
    });
    speedListenerID = event.on("mpv.speed.changed", function (speed) {
      currentPlaybackSpeed = speed;
      overlay.postMessage("playback-speed", { speed: speed });
    });
    var t = mpv.getNumber("time-pos");
    if (t !== undefined && t !== null) {
      overlay.postMessage("time-update", { time: t });
    }
    var speed = mpv.getNumber("speed");
    if (speed !== undefined && speed !== null) {
      currentPlaybackSpeed = speed;
      overlay.postMessage("playback-speed", { speed: speed });
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
    if (currentRenderMode === 'canvas') {
      canvasOpacity = data.opacity;
      preferences.set("danmakuCanvasOpacity", canvasOpacity);
    } else {
      cssOpacity = data.opacity;
      preferences.set("danmakuOpacity", cssOpacity);
    }
    preferences.sync();
    overlay.postMessage("set-opacity", { opacity: data.opacity });
  });

  sidebar.onMessage("set-fontscale", function (data) {
    cssFontScale = data.scale;
    preferences.set("danmakuFontScale", cssFontScale);
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

  sidebar.onMessage("set-lane-limit", function (data) {
    preferences.set("maxLaneRatio", data.maxLaneRatio);
    preferences.sync();
    overlay.postMessage("set-lane-limit", { maxLaneRatio: data.maxLaneRatio });
  });

  sidebar.onMessage("block-type", function (data) {
    overlay.postMessage("block-type", data);
  });

  sidebar.onMessage("block-force-lane", function (data) {
    currentBlockForceLane = data.blockForceLane;
    preferences.set("blockForceLane", currentBlockForceLane);
    preferences.sync();
    overlay.postMessage("block-force-lane", { blockForceLane: currentBlockForceLane });
  });

  sidebar.onMessage("set-render-mode", function (data) {
    currentRenderMode = data.mode;
    overlay.postMessage("set-render-mode", { mode: data.mode });
  });

  sidebar.onMessage("set-canvas-mode", function (data) {
    overlay.postMessage("set-canvas-mode", { mode: data.mode });
  });

  sidebar.onMessage("request-state", function () {
    sidebar.postMessage("danmaku-state", {
      enabled: danmakuEnabled,
      cssOpacity: cssOpacity,
      canvasOpacity: canvasOpacity,
      cssFontScale: cssFontScale,
      speed: currentSpeed,
      scrollDuration: currentScrollDuration,
      blockForceLane: currentBlockForceLane,
      maxLaneRatio: currentMaxLaneRatio,
      danmakuFileType: currentDanmakuStatus.fileType,
      danmakuFileName: currentDanmakuStatus.fileName,
      danmakuRelativePath: currentDanmakuStatus.relativePath,
      danmakuLoaded: currentDanmakuStatus.isLoaded,
    });
  });

  sidebar.onMessage("manual-load-danmaku", function () {
    iina.utils.chooseFile("选择弹幕文件", {
      allowedFileTypes: ["json", "xml"],
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
      var manualFileType = detectDanmakuFileType(xmlContent);
      var manualSendContent = xmlContent;
      if (manualFileType === 'nico-xml') {
        manualSendContent = nicoXmlToV1Json(xmlContent);
      }
      var hexContent = stringToHex(manualSendContent);
      var manualFileName = path.split("/").pop();
      var manualRelPath = manualFileName;
      updateDanmakuStatus({ fileType: manualFileType, fileName: manualFileName, relativePath: manualRelPath, isLoaded: true });
      overlay.postMessage("load-danmaku", {
        xmlContent: hexContent,
        opacity: getActiveOpacity(),
        fontScale: getActiveFontScale(),
        speed: currentSpeed,
        scrollDuration: currentScrollDuration,
      });
      core.osd("已加载弹幕: " + manualFileName);
      if (!danmakuEnabled) {
        danmakuEnabled = true;
        preferences.set("danmakuEnabled", true);
        preferences.sync();
        overlay.postMessage("toggle-danmaku", { enabled: true });
        overlay.show();
        setObserver(true);
        sidebar.postMessage("danmaku-state", { enabled: true });
      }
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
});

overlay.onMessage("danmaku-error", function (data) {
  console.warn("Danmaku error: " + (data.message || "unknown"));
});

overlay.onMessage("canvas-unsupported", function () {
  core.osd("Canvas渲染不支持Bilibili XML弹幕");
  sidebar.postMessage("danmaku-state", { renderMode: 'css' });
  overlay.postMessage("set-render-mode", { mode: 'css' });
});

overlay.onMessage("danmaku-type", function (data) {
  currentDanmakuStatus.fileType = data.type;
  sidebar.postMessage("danmaku-type", currentDanmakuStatus);
});

overlay.onMessage("seek-disable", function () {
  core.osd("弹幕：禁止跳转");
});

overlay.onMessage("seek-enable", function () {
  core.osd("弹幕：允许跳转");
});

overlay.onMessage("jump", function (data) {
  if (data.targetSec !== undefined && data.targetSec !== null) {
    mpv.set("time-pos", data.targetSec);
    if (data.message) {
      core.osd("弹幕跳转: " + data.message);
    }
  }
});

overlay.onMessage("jump-video", function (data) {
  if (data.videoId) {
    core.osd("弹幕跳转: " + data.videoId + (data.message ? " " + data.message : ""));
  }
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
    iina.utils.chooseFile("选择弹幕文件", {
      allowedFileTypes: ["json", "xml"],
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
      var manualFileType = detectDanmakuFileType(xmlContent);
      var manualSendContent = xmlContent;
      if (manualFileType === 'nico-xml') {
        manualSendContent = nicoXmlToV1Json(xmlContent);
      }
      var hexContent = stringToHex(manualSendContent);
      var manualFileName = path.split("/").pop();
      var manualRelPath = manualFileName;
      updateDanmakuStatus({ fileType: manualFileType, fileName: manualFileName, relativePath: manualRelPath, isLoaded: true });
      overlay.postMessage("load-danmaku", {
        xmlContent: hexContent,
        opacity: getActiveOpacity(),
        fontScale: getActiveFontScale(),
        speed: currentSpeed,
        scrollDuration: currentScrollDuration,
      });
      core.osd("已发送弹幕: " + path.split("/").pop());
      if (!danmakuEnabled) {
        danmakuEnabled = true;
        preferences.set("danmakuEnabled", true);
        preferences.sync();
        overlay.postMessage("toggle-danmaku", { enabled: true });
        overlay.show();
        setObserver(true);
        sidebar.postMessage("danmaku-state", { enabled: true });
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
