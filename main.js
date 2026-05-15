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
var canvasOpacity = preferences.get("danmakuCanvasOpacity") || 0.8;
var canvasFontScale = preferences.get("niconicommentsFontScale") || 1.0;
var currentCanvasMode = preferences.get("canvasMode") || 'default';
var strokeOpacity = preferences.get("strokeOpacity") !== undefined ? preferences.get("strokeOpacity") : 0.4;
var strokeWidth = preferences.get("strokeWidth") !== undefined ? preferences.get("strokeWidth") : 2.8;
var strokeColor = preferences.get("strokeColor") || '#000000';
var strokeInversionColor = preferences.get("strokeInversionColor") || '#ffffff';
var commentLimit = preferences.get("commentLimit") !== undefined ? preferences.get("commentLimit") : 0;
var scrollSpeed = preferences.get("scrollSpeed") !== undefined ? preferences.get("scrollSpeed") : 0.95;
var currentPlaybackSpeed = 1.0;
var overlayReady = false;
var preferencesSyncTimer = null;

function syncPreferencesSoon() {
  if (preferencesSyncTimer) clearTimeout(preferencesSyncTimer);
  preferencesSyncTimer = setTimeout(function () {
    preferences.sync();
    preferencesSyncTimer = null;
  }, 250);
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

var danmakuFileList = {
  xmlFiles: [],
  jsonFiles: [],
  unknownFiles: [],
  selectedPaths: []
};

var danmakuCache = {};

function updateDanmakuStatus(status) {
  currentDanmakuStatus = status;
  sidebar.postMessage("danmaku-type", currentDanmakuStatus);
}

function danmakuNotFound() {
  updateDanmakuStatus({ fileType: null, fileName: null, relativePath: null, isLoaded: false });
}

function filePathFromUrl(url) {
  if (!url) return null;
  if (url.startsWith("file://")) return decodeURIComponent(url.substring(7));
  return null;
}

function detectDanmakuType(content) {
  if (!content) return 'bilibili-xml';
  var s = content.trim();
  if (s.charAt(0) === '[') return 'nico-json';
  if (s.indexOf('<packet') !== -1) return 'nico-xml';
  return 'bilibili-xml';
}

function extractNumberFromName(name) {
  var match;
  match = name.match(/\[(\d{1,3})\](?!.*\[)/);
  if (match) return parseInt(match[1], 10);
  match = name.match(/\[\d{1,3}\]/g);
  if (match) {
    match = match[match.length - 1].match(/\[(\d{1,3})\]/);
    if (match) return parseInt(match[1], 10);
  }
  match = name.match(/(?:^|[_\-.\s])(\d{1,3})(?:_|\-|\.|\s|$)/);
  if (match) return parseInt(match[1], 10);
  match = name.match(/(?:^|[\[\]_\-.\s])(1?\d)(?:_|\.|\s|$)/i);
  if (match) return parseInt(match[1], 10);
  match = name.match(/(?:第|話|话|Episode|Ep\.?)\s*(\d{1,3})/i);
  if (match) return parseInt(match[1], 10);
  return null;
}

function extractEpisodeNumber(videoPath) {
  var filename = videoPath.replace(/.*[/\\]/, '').replace(/\.[^.]+$/, '');
  return extractNumberFromName(filename);
}

function extractDanmakuNumber(filename) {
  return extractNumberFromName(filename.replace(/\.[^.]+$/, ''));
}

function findDanmakuByEpisode(videoUrl) {
  var path = filePathFromUrl(videoUrl);
  if (!path) return { xmlFiles: [], jsonFiles: [], unknownFiles: [] };

  var videoDir = path.replace(/[/\\][^/\\]+$/, '');
  var videoEpNum = extractEpisodeNumber(path);
  var videoBaseName = path.replace(/.*[/\\]/, '').replace(/\.[^.]+$/, '').normalize('NFC');

  var searchDirs = [videoDir];
  var altDirNames = ['弹幕', 'Comments', 'コメント'];
  for (var i = 0; i < altDirNames.length; i++) {
    var altDir = videoDir + '/' + altDirNames[i];
    if (file.exists(altDir)) searchDirs.push(altDir);
  }

  var exactXmlFiles = [];
  var exactJsonFiles = [];
  var prefixXmlFiles = [];
  var prefixJsonFiles = [];
  var epNumXmlFiles = [];
  var epNumJsonFiles = [];
  var unknownFiles = [];
  var seenPaths = {};

  for (var d = 0; d < searchDirs.length; d++) {
    var dir = searchDirs[d];
    var items;
    try { items = file.list(dir, { includeSubDir: false }); } catch (e) { continue; }
    if (!items) continue;

    for (var j = 0; j < items.length; j++) {
      var item = items[j];
      if (item.isDir) continue;
      var fname = item.filename;
      var ext = fname.lastIndexOf('.') >= 0 ? fname.substring(fname.lastIndexOf('.') + 1).toLowerCase() : '';
      if (ext !== 'json' && ext !== 'xml') continue;

      var filePath = dir + '/' + fname;
      if (seenPaths[filePath]) continue;
      seenPaths[filePath] = true;

      var relativePath = filePath;
      if (filePath.startsWith(videoDir + "/")) relativePath = filePath.substring(videoDir.length + 1);

      var fileEpNum = extractDanmakuNumber(fname);
      var fileBaseName = fname.replace(/\.[^.]+$/, '');
      var normalizedBaseName = fileBaseName.normalize('NFC');
      var isExactMatch = normalizedBaseName === videoBaseName;
      var isPrefixMatch = !isExactMatch && normalizedBaseName.startsWith(videoBaseName);
      var fileInfo = {
        filename: fname,
        path: filePath,
        relativePath: relativePath,
        type: ext.toUpperCase()
      };

      if (isExactMatch) {
        if (ext === 'xml') exactXmlFiles.push(fileInfo); else exactJsonFiles.push(fileInfo);
      } else if (isPrefixMatch) {
        if (ext === 'xml') prefixXmlFiles.push(fileInfo); else prefixJsonFiles.push(fileInfo);
      } else if (videoEpNum !== null && fileEpNum !== null && fileEpNum === videoEpNum) {
        if (ext === 'xml') epNumXmlFiles.push(fileInfo); else epNumJsonFiles.push(fileInfo);
      } else if (fileEpNum === null) {
        unknownFiles.push(fileInfo);
      }
    }
  }

  if (exactXmlFiles.length > 0 || exactJsonFiles.length > 0) {
    return { xmlFiles: exactXmlFiles, jsonFiles: exactJsonFiles, unknownFiles: unknownFiles };
  }
  if (prefixXmlFiles.length > 0 || prefixJsonFiles.length > 0) {
    return { xmlFiles: prefixXmlFiles, jsonFiles: prefixJsonFiles, unknownFiles: unknownFiles };
  }
  return { xmlFiles: epNumXmlFiles, jsonFiles: epNumJsonFiles, unknownFiles: unknownFiles };
}

function encodeContent(str) {
  return encodeURIComponent(str);
}

function loadDanmakuForVideo(url) {
  currentVideoUrl = url;
  danmakuCache = {};

  if (core.status.isNetworkResource) {
    core.osd("网络资源，跳过弹幕加载");
    danmakuNotFound();
    danmakuFileList = { xmlFiles: [], jsonFiles: [], unknownFiles: [], selectedPaths: [] };
    sidebar.postMessage("danmaku-file-list", danmakuFileList);
    if (overlayReady) overlay.postMessage("clear-danmaku", {});
    return;
  }

  var discovered = findDanmakuByEpisode(url);
  danmakuFileList = {
    xmlFiles: discovered.xmlFiles,
    jsonFiles: discovered.jsonFiles,
    unknownFiles: discovered.unknownFiles,
    selectedPaths: []
  };

  sidebar.postMessage("danmaku-file-list", danmakuFileList);

  var allMatched = danmakuFileList.xmlFiles.concat(danmakuFileList.jsonFiles);
  if (allMatched.length === 0) {
    danmakuNotFound();
    if (overlayReady) overlay.postMessage("clear-danmaku", {});
    return;
  }

  var firstFile = allMatched[0];
  danmakuFileList.selectedPaths = [firstFile.path];

  var xmlContent = file.read(firstFile.path);
  if (!xmlContent) {
    core.osd("无法读取弹幕文件: " + firstFile.filename);
    danmakuNotFound();
    return;
  }

  var encodedContent = encodeContent(xmlContent);
  danmakuCache[firstFile.path] = encodedContent;

  var fileType = detectDanmakuType(xmlContent);
  updateDanmakuStatus({ fileType: fileType, fileName: firstFile.filename, relativePath: firstFile.relativePath, isLoaded: true });

  sidebar.postMessage("danmaku-file-list", danmakuFileList);

  var payload = {
    xmlContent: encodedContent,
    path: firstFile.path,
    danmakuType: fileType,
    opacity: canvasOpacity,
    canvasFontScale: canvasFontScale,
    strokeColor: strokeColor,
    strokeInversionColor: strokeInversionColor,
    strokeOpacity: strokeOpacity,
    strokeWidth: strokeWidth,
    commentLimit: commentLimit,
    scrollSpeed: scrollSpeed,
  };

  if (overlayReady) {
    overlay.postMessage("load-danmaku", payload);
    core.osd("已加载弹幕: " + firstFile.filename);
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
    opacity: canvasOpacity,
    canvasFontScale: canvasFontScale,
    canvasMode: currentCanvasMode,
    strokeColor: strokeColor,
    strokeInversionColor: strokeInversionColor,
    strokeOpacity: strokeOpacity,
    strokeWidth: strokeWidth,
    commentLimit: commentLimit,
    scrollSpeed: scrollSpeed,
  });

  if (pendingDanmaku) {
    overlay.postMessage("load-danmaku", pendingDanmaku);
    var loadedName = danmakuFileList.selectedPaths.length > 0 ? danmakuFileList.selectedPaths[0].split("/").pop() : "";
    core.osd("已加载弹幕: " + loadedName);
    pendingDanmaku = null;
    setObserver(true);
  } else if (danmakuEnabled && !core.status.idle && currentVideoUrl) {
    loadDanmakuForVideo(currentVideoUrl);
  } else if (danmakuEnabled && !core.status.idle && core.status.url) {
    loadDanmakuForVideo(core.status.url);
  }
}

function setObserver(start) {
  if (timePosListenerID) { event.off("mpv.time-pos.changed", timePosListenerID); timePosListenerID = null; }
  if (windowScaleListenerID) { event.off("mpv.window-scale.changed", windowScaleListenerID); windowScaleListenerID = null; }
  if (speedListenerID) { event.off("mpv.speed.changed", speedListenerID); speedListenerID = null; }

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
    if (t !== undefined && t !== null) overlay.postMessage("time-update", { time: t });
    var speed = mpv.getNumber("speed");
    if (speed !== undefined && speed !== null) {
      currentPlaybackSpeed = speed;
      overlay.postMessage("playback-speed", { speed: speed });
    }
    overlay.postMessage("resize", {});
  }
}

function toggleDanmaku() {
  danmakuEnabled = !danmakuEnabled;
  preferences.set("danmakuEnabled", danmakuEnabled);
  preferences.sync();
  overlay.postMessage("toggle-danmaku", { enabled: danmakuEnabled });
  if (danmakuEnabled) { overlay.show(); setObserver(true); core.osd("弹幕已开启"); }
  else { setObserver(false); core.osd("弹幕已关闭"); }
  sidebar.postMessage("danmaku-state", { enabled: danmakuEnabled });
}

function ensureDanmakuEnabled() {
  if (danmakuEnabled) return;
  danmakuEnabled = true;
  preferences.set("danmakuEnabled", true);
  preferences.sync();
  overlay.postMessage("toggle-danmaku", { enabled: true });
  overlay.show();
  setObserver(true);
  sidebar.postMessage("danmaku-state", { enabled: true });
}

function registerSidebarHandlers() {
  sidebar.onMessage("toggle-danmaku", function () { toggleDanmaku(); });

  sidebar.onMessage("set-opacity", function (data) {
    canvasOpacity = data.opacity;
    preferences.set("danmakuCanvasOpacity", canvasOpacity);
    syncPreferencesSoon();
    overlay.postMessage("set-opacity", { opacity: data.opacity });
  });

  sidebar.onMessage("set-fontscale", function (data) {
    canvasFontScale = data.scale;
    preferences.set("niconicommentsFontScale", canvasFontScale);
    syncPreferencesSoon();
    overlay.postMessage("set-fontscale", { scale: data.scale });
  });

  sidebar.onMessage("set-canvas-mode", function (data) {
    currentCanvasMode = data.mode;
    preferences.set("canvasMode", currentCanvasMode);
    syncPreferencesSoon();
    overlay.postMessage("set-canvas-mode", { mode: data.mode });
  });

  sidebar.onMessage("set-stroke-opacity", function (data) {
    strokeOpacity = data.opacity;
    preferences.set("strokeOpacity", strokeOpacity);
    syncPreferencesSoon();
    overlay.postMessage("set-stroke-opacity", { opacity: data.opacity });
  });

  sidebar.onMessage("set-stroke-width", function (data) {
    strokeWidth = data.width;
    preferences.set("strokeWidth", strokeWidth);
    syncPreferencesSoon();
    overlay.postMessage("set-stroke-width", { width: data.width });
  });

  sidebar.onMessage("set-stroke-color", function (data) {
    strokeColor = data.color;
    preferences.set("strokeColor", strokeColor);
    syncPreferencesSoon();
    overlay.postMessage("set-stroke-color", { color: data.color });
  });

  sidebar.onMessage("set-stroke-inversion-color", function (data) {
    strokeInversionColor = data.color;
    preferences.set("strokeInversionColor", strokeInversionColor);
    syncPreferencesSoon();
    overlay.postMessage("set-stroke-inversion-color", { color: data.color });
  });

  sidebar.onMessage("set-comment-limit", function (data) {
    commentLimit = data.limit;
    preferences.set("commentLimit", commentLimit);
    syncPreferencesSoon();
    overlay.postMessage("set-comment-limit", { limit: data.limit });
  });

  sidebar.onMessage("set-scroll-speed", function (data) {
    scrollSpeed = data.speed;
    preferences.set("scrollSpeed", scrollSpeed);
    syncPreferencesSoon();
    overlay.postMessage("set-scroll-speed", { speed: data.speed });
  });

  sidebar.onMessage("request-state", function () {
    sidebar.postMessage("danmaku-state", {
      enabled: danmakuEnabled,
      canvasMode: currentCanvasMode,
      canvasOpacity: canvasOpacity,
      canvasFontScale: canvasFontScale,
      strokeOpacity: strokeOpacity,
      strokeWidth: strokeWidth,
      strokeColor: strokeColor,
      strokeInversionColor: strokeInversionColor,
      commentLimit: commentLimit,
      scrollSpeed: scrollSpeed,
      danmakuFileType: currentDanmakuStatus.fileType,
      danmakuFileName: currentDanmakuStatus.fileName,
      danmakuRelativePath: currentDanmakuStatus.relativePath,
      danmakuLoaded: currentDanmakuStatus.isLoaded,
    });
    sidebar.postMessage("danmaku-file-list", danmakuFileList);
  });

  sidebar.onMessage("manual-load-danmaku", function () {
    iina.utils.chooseFile("选择弹幕文件", { allowedFileTypes: ["json", "xml"] }).then(function(path) {
      if (!path) { core.osd("未选择文件"); return; }
      var xmlContent = file.read(path);
      if (!xmlContent) { core.osd("无法读取弹幕文件"); return; }
      core.osd("读取到内容长度: " + xmlContent.length);
      var encodedContent = encodeContent(xmlContent);
      var manualFileName = path.split("/").pop();
      var manualRelPath = manualFileName;
      var manualFileType = detectDanmakuType(xmlContent);
      updateDanmakuStatus({ fileType: manualFileType, fileName: manualFileName, relativePath: manualRelPath, isLoaded: true });
      overlay.postMessage("load-danmaku", {
        xmlContent: encodedContent,
        path: path,
        danmakuType: manualFileType,
        opacity: canvasOpacity,
        canvasFontScale: canvasFontScale,
        strokeColor: strokeColor,
        strokeInversionColor: strokeInversionColor,
        strokeOpacity: strokeOpacity,
        strokeWidth: strokeWidth,
        commentLimit: commentLimit,
        scrollSpeed: scrollSpeed,
      });
      core.osd("已加载弹幕: " + manualFileName);
      ensureDanmakuEnabled();
    });
  });

  sidebar.onMessage("danmaku-file-check", function (data) {
    var filePath = data.path;
    var checked = data.checked;

    if (checked) {
      if (danmakuFileList.selectedPaths.indexOf(filePath) !== -1) return;
      danmakuFileList.selectedPaths.push(filePath);

      var encodedContent = danmakuCache[filePath];
      if (!encodedContent) {
        var rawContent = file.read(filePath);
        if (!rawContent) {
          core.osd("无法读取弹幕文件: " + filePath.split("/").pop());
          sidebar.postMessage("danmaku-file-error", { path: filePath, message: "无法读取文件" });
          danmakuFileList.selectedPaths = danmakuFileList.selectedPaths.filter(function(p) { return p !== filePath; });
          sidebar.postMessage("danmaku-file-list", danmakuFileList);
          return;
        }
        encodedContent = encodeContent(rawContent);
        danmakuCache[filePath] = encodedContent;
      }

      overlay.postMessage("add-danmaku-file", { path: filePath, xmlContent: encodedContent });

      var checkFileName = filePath.split("/").pop();
      var allFiles = danmakuFileList.xmlFiles.concat(danmakuFileList.jsonFiles).concat(danmakuFileList.unknownFiles);
      var checkFileInfo = null;
      for (var fi = 0; fi < allFiles.length; fi++) {
        if (allFiles[fi].path === filePath) { checkFileInfo = allFiles[fi]; break; }
      }
      var checkRelPath = checkFileInfo ? checkFileInfo.relativePath : checkFileName;
      var checkFileType = detectDanmakuType(decodeURIComponent(encodedContent));
      updateDanmakuStatus({ fileType: checkFileType, fileName: checkFileName, relativePath: checkRelPath, isLoaded: true });

      sidebar.postMessage("danmaku-file-list", danmakuFileList);
      core.osd("已加载弹幕: " + checkFileName);
      ensureDanmakuEnabled();
    } else {
      danmakuFileList.selectedPaths = danmakuFileList.selectedPaths.filter(function(p) { return p !== filePath; });
      overlay.postMessage("remove-danmaku-file", { path: filePath });
      sidebar.postMessage("danmaku-file-list", danmakuFileList);
      core.osd("已移除弹幕: " + filePath.split("/").pop());

      if (danmakuFileList.selectedPaths.length === 0) {
        overlay.postMessage("clear-danmaku", {});
        updateDanmakuStatus({ fileType: null, fileName: null, relativePath: null, isLoaded: false });
      }
    }
  });

  sidebar.onMessage("danmaku-file-add", function () {
    iina.utils.chooseFile("选择弹幕文件", { allowedFileTypes: ["json", "xml"] }).then(function(path) {
      if (!path) return;

      var allFiles = danmakuFileList.xmlFiles.concat(danmakuFileList.jsonFiles).concat(danmakuFileList.unknownFiles);
      for (var i = 0; i < allFiles.length; i++) {
        if (allFiles[i].path === path) { core.osd("文件已在列表中"); return; }
      }

      var fname = path.split("/").pop();
      var ext = fname.lastIndexOf('.') >= 0 ? fname.substring(fname.lastIndexOf('.') + 1).toLowerCase() : '';
      var videoDir = currentVideoUrl ? filePathFromUrl(currentVideoUrl).replace(/[/\\][^/\\]+$/, '') : '';
      var relativePath = path;
      if (videoDir && path.startsWith(videoDir + "/")) relativePath = path.substring(videoDir.length + 1);

      var fileInfo = { filename: fname, path: path, relativePath: relativePath, type: ext.toUpperCase() };

      if (ext === 'xml') danmakuFileList.xmlFiles.push(fileInfo);
      else if (ext === 'json') danmakuFileList.jsonFiles.push(fileInfo);
      else danmakuFileList.unknownFiles.push(fileInfo);

      danmakuFileList.selectedPaths.push(path);

      var content = file.read(path);
      if (content) {
        danmakuCache[path] = encodeContent(content);
        overlay.postMessage("add-danmaku-file", { path: path, xmlContent: danmakuCache[path] });
        var addFileType = detectDanmakuType(content);
        updateDanmakuStatus({ fileType: addFileType, fileName: fname, relativePath: relativePath, isLoaded: true });
        core.osd("已添加弹幕: " + fname);
      } else {
        core.osd("无法读取弹幕文件: " + fname);
        sidebar.postMessage("danmaku-file-error", { path: path, message: "无法读取文件" });
      }

      sidebar.postMessage("danmaku-file-list", danmakuFileList);
      ensureDanmakuEnabled();
    });
  });

  sidebar.onMessage("danmaku-file-delete", function (data) {
    var filePath = data.path;
    danmakuFileList.xmlFiles = danmakuFileList.xmlFiles.filter(function(f) { return f.path !== filePath; });
    danmakuFileList.jsonFiles = danmakuFileList.jsonFiles.filter(function(f) { return f.path !== filePath; });
    danmakuFileList.unknownFiles = danmakuFileList.unknownFiles.filter(function(f) { return f.path !== filePath; });

    var wasSelected = danmakuFileList.selectedPaths.indexOf(filePath) !== -1;
    danmakuFileList.selectedPaths = danmakuFileList.selectedPaths.filter(function(p) { return p !== filePath; });

    if (wasSelected) overlay.postMessage("remove-danmaku-file", { path: filePath });
    delete danmakuCache[filePath];
    sidebar.postMessage("danmaku-file-list", danmakuFileList);

    if (danmakuFileList.selectedPaths.length === 0) {
      updateDanmakuStatus({ fileType: null, fileName: null, relativePath: null, isLoaded: false });
    }
  });
}

event.on("iina.window-loaded", function () {
  overlay.loadFile("overlay/index.html");
  sidebar.loadFile("sidebar/index.html");
  registerSidebarHandlers();
});

overlay.onMessage("overlay-ready", function () { markOverlayReady(); });

event.on("iina.plugin-overlay-loaded", function () {
  overlay.show();
  setTimeout(function () { if (!overlayReady) markOverlayReady(); }, 2000);
});

event.on("iina.file-loaded", function (url) {
  currentVideoUrl = url;
  if (danmakuEnabled) loadDanmakuForVideo(url);
});

event.on("mpv.pause.changed", function () {
  if (!overlayReady) return;
  overlay.postMessage("pause-state", { paused: core.status.paused });
});

overlay.onMessage("danmaku-type", function (data) {
  currentDanmakuStatus.fileType = data.type;
  sidebar.postMessage("danmaku-type", currentDanmakuStatus);
});

overlay.onMessage("seek-disable", function () { core.osd("弹幕：禁止跳转"); });
overlay.onMessage("seek-enable", function () { core.osd("弹幕：允许跳转"); });

overlay.onMessage("jump", function (data) {
  if (data.targetSec !== undefined && data.targetSec !== null) {
    mpv.set("time-pos", data.targetSec);
    if (data.message) core.osd("弹幕跳转: " + data.message);
  }
});

overlay.onMessage("jump-video", function (data) {
  if (data.videoId) core.osd("弹幕跳转: " + data.videoId + (data.message ? " " + data.message : ""));
});

menu.addItem(
  menu.item("切换弹幕显示", function () { toggleDanmaku(); }, { keyBinding: "D" })
);

menu.addItem(
  menu.item("手动加载弹幕文件…", function () {
    iina.utils.chooseFile("选择弹幕文件", { allowedFileTypes: ["json", "xml"] }).then(function(path) {
      if (!path) { core.osd("未选择文件"); return; }
      var xmlContent = file.read(path);
      if (!xmlContent) { core.osd("无法读取弹幕文件"); return; }
      core.osd("读取到内容长度: " + xmlContent.length);
      var encodedContent = encodeContent(xmlContent);
      var manualFileName = path.split("/").pop();
      var manualRelPath = manualFileName;
      var manualFileType = detectDanmakuType(xmlContent);
      updateDanmakuStatus({ fileType: manualFileType, fileName: manualFileName, relativePath: manualRelPath, isLoaded: true });
      overlay.postMessage("load-danmaku", {
        xmlContent: encodedContent,
        path: path,
        danmakuType: manualFileType,
        opacity: canvasOpacity,
        canvasFontScale: canvasFontScale,
        strokeColor: strokeColor,
        strokeInversionColor: strokeInversionColor,
        strokeOpacity: strokeOpacity,
        strokeWidth: strokeWidth,
        commentLimit: commentLimit,
        scrollSpeed: scrollSpeed,
      });
      core.osd("已发送弹幕: " + path.split("/").pop());
      ensureDanmakuEnabled();
    });
  })
);

menu.addItem(menu.separator());

menu.addItem(
  menu.item("显示弹幕覆盖层", function () { overlay.show(); })
);

menu.addItem(
  menu.item("隐藏弹幕覆盖层", function () { overlay.hide(); })
);

console.log("niconicocomments-only plugin initialized");
