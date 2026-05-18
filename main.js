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

var DDP_APP_ID = preferences.get("dandanplayAppId") || 't43832ky57';
var DDP_APP_SECRET = preferences.get("dandanplayAppSecret") || 'IDnPEdEKDIziKeYVxm6VcaJE4Bv2fnzT';
var DDP_API_BASE = 'https://api.dandanplay.net';

var dandanplayPriority = preferences.get("dandanplayPriority") || 'local-first';
var dandanplayChConvert = preferences.get("dandanplayChConvert") !== undefined ? preferences.get("dandanplayChConvert") : 0;
var dandanplayWithRelated = preferences.get("dandanplayWithRelated") !== undefined ? preferences.get("dandanplayWithRelated") : true;

var dandanplayState = {
  status: 'idle',
  animeTitle: '',
  episodeTitle: '',
  episodeId: null,
  commentCount: 0,
  error: '',
  comments: null,
  matches: null
};

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

  var xmlFiles = exactXmlFiles.concat(prefixXmlFiles).concat(epNumXmlFiles);
  var jsonFiles = exactJsonFiles.concat(prefixJsonFiles).concat(epNumJsonFiles);
  return { xmlFiles: xmlFiles, jsonFiles: jsonFiles, unknownFiles: unknownFiles };
}

function encodeContent(str) {
  return encodeURIComponent(str);
}

function sha256(str) {
  function rr(n, x) { return (x >>> n) | (x << (32 - n)); }
  var K = [
    0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
    0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
    0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
    0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
    0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2
  ];
  var H = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
  var bytes = [];
  for (var i = 0; i < str.length; i++) {
    var c = str.charCodeAt(i);
    if (c < 128) { bytes.push(c); }
    else if (c < 2048) { bytes.push(192|(c>>6)); bytes.push(128|(c&63)); }
    else if (c >= 0xd800 && c <= 0xdbff) {
      var lo = str.charCodeAt(++i);
      var cp = ((c-0xd800)<<10)+(lo-0xdc00)+0x10000;
      bytes.push(240|(cp>>18)); bytes.push(128|((cp>>12)&63)); bytes.push(128|((cp>>6)&63)); bytes.push(128|(cp&63));
    } else { bytes.push(224|(c>>12)); bytes.push(128|((c>>6)&63)); bytes.push(128|(c&63)); }
  }
  var bitLen = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  bytes.push(0,0,0,0);
  bytes.push((bitLen>>>24)&0xff,(bitLen>>>16)&0xff,(bitLen>>>8)&0xff,bitLen&0xff);
  for (var off = 0; off < bytes.length; off += 64) {
    var w = [];
    for (var t = 0; t < 16; t++) {
      w[t] = (bytes[off+t*4]<<24)|(bytes[off+t*4+1]<<16)|(bytes[off+t*4+2]<<8)|bytes[off+t*4+3];
    }
    for (var t = 16; t < 64; t++) {
      var s0 = rr(7,w[t-15])^rr(18,w[t-15])^(w[t-15]>>>3);
      var s1 = rr(17,w[t-2])^rr(19,w[t-2])^(w[t-2]>>>10);
      w[t] = (w[t-16]+s0+w[t-7]+s1)|0;
    }
    var a=H[0],b=H[1],c=H[2],d=H[3],e=H[4],f=H[5],g=H[6],h=H[7];
    for (var t = 0; t < 64; t++) {
      var S1 = rr(6,e)^rr(11,e)^rr(25,e);
      var ch = (e&f)^(~e&g);
      var temp1 = (h+S1+ch+K[t]+w[t])|0;
      var S0 = rr(2,a)^rr(13,a)^rr(22,a);
      var maj = (a&b)^(a&c)^(b&c);
      var temp2 = (S0+maj)|0;
      h=g; g=f; f=e; e=(d+temp1)|0; d=c; c=b; b=a; a=(temp1+temp2)|0;
    }
    H[0]=(H[0]+a)|0; H[1]=(H[1]+b)|0; H[2]=(H[2]+c)|0; H[3]=(H[3]+d)|0;
    H[4]=(H[4]+e)|0; H[5]=(H[5]+f)|0; H[6]=(H[6]+g)|0; H[7]=(H[7]+h)|0;
  }
  var hex = '';
  for (var i = 0; i < 8; i++) hex += ('00000000'+(H[i]>>>0).toString(16)).slice(-8);
  return hex;
}

function base64EncodeHex(hexStr) {
  var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  var result = '';
  var len = hexStr.length;
  for (var i = 0; i < len; i += 6) {
    var b0 = parseInt(hexStr.substr(i, 2), 16);
    var b1 = (i + 2 < len) ? parseInt(hexStr.substr(i + 2, 2), 16) : 0;
    var b2 = (i + 4 < len) ? parseInt(hexStr.substr(i + 4, 2), 16) : 0;
    result += chars[b0 >> 2];
    result += chars[((b0 & 3) << 4) | (b1 >> 4)];
    result += (i + 2 < len) ? chars[((b1 & 15) << 2) | (b2 >> 6)] : '=';
    result += (i + 4 < len) ? chars[b2 & 63] : '=';
  }
  return result;
}

function ddpCalcSignature(appId, timestamp, path, appSecret) {
  var raw = appId + timestamp + path + appSecret;
  var hash = sha256(raw);
  return base64EncodeHex(hash);
}

function ddpRequest(method, path, queryParams, body) {
  var url = DDP_API_BASE + path;
  var options = {
    headers: {
      'X-AppId': DDP_APP_ID,
      'X-AppSecret': DDP_APP_SECRET,
      'Accept': 'application/json',
      'User-Agent': 'DanmakuCosmos/IINA'
    }
  };
  if (queryParams && typeof queryParams === 'object') {
    var strParams = {};
    for (var key in queryParams) {
      if (queryParams.hasOwnProperty(key)) {
        strParams[key] = String(queryParams[key]);
      }
    }
    options.params = strParams;
  }
  if (body) {
    options.data = body;
    options.headers['Content-Type'] = 'application/json';
  }
  if (method === 'GET') return iina.http.get(url, options);
  return iina.http.post(url, options);
}

function ddpParseBody(res) {
  if (!res) return null;
  var text = res.text;
  if (typeof text === 'string' && text.length > 0) {
    try { return JSON.parse(text); } catch (e) {}
  }
  if (res.data !== undefined && res.data !== null && typeof res.data === 'object') {
    try { return JSON.parse(JSON.stringify(res.data)); } catch (e) {}
  }
  if (typeof res.data === 'string' && res.data.length > 0) {
    try { return JSON.parse(res.data); } catch (e) {}
  }
  return null;
}

function ddpCalcFileHash(filePath) {
  if (!filePath) return null;
  try {
    var scriptPath = iina.utils.resolvePath('@data/ddp_hash.py');
    var script = 'import hashlib,sys,os\n'
      + 'try:\n'
      + '  p=sys.argv[1];f=open(p,"rb");h=hashlib.md5(f.read(16*1024*1024)).hexdigest();f.close()\n'
      + '  print(h+" "+str(os.path.getsize(p)))\n'
      + 'except Exception as e:\n'
      + '  print("ERROR "+str(e))';
    try { file.write(scriptPath, script); } catch(e) { console.log('[ddp] hash write: ' + e); }

    var escapedPath = filePath.replace(/'/g, "'\\''");
    var cmd = 'python3 ' + "'" + scriptPath + "' " + "'" + escapedPath + "'";
    console.log('[ddp] hash cmd: ' + cmd);
    return iina.utils.exec('/bin/sh', ['-c', cmd]).then(function(result) {
      console.log('[ddp] hash: status=' + (result ? result.status : 'null') + ' stdout=' + (result && result.stdout ? result.stdout.trim() : 'null'));
      if (!result || result.status !== 0 || !result.stdout) return null;
      var parts = result.stdout.trim().split(' ');
      if (parts.length >= 2 && parts[0].length === 32 && parts[0] !== 'ERROR') {
        return { hash: parts[0], fileSize: parseInt(parts[1], 10) || 0 };
      }
      return null;
    }).catch(function(err) {
      console.log('[ddp] hash catch: ' + err);
      return null;
    });
  } catch(e) {
    console.log('[ddp] hash: ' + e);
    return Promise.resolve(null);
  }
}

function ddpMatchVideo(fileName, filePath) {
  var nameWithoutExt = fileName.replace(/\.[^.]+$/, '');
  console.log('[ddp] match: fileName=' + nameWithoutExt + ' filePath=' + filePath);
  return ddpCalcFileHash(filePath).then(function(hashInfo) {
    console.log('[ddp] match: hashInfo=' + JSON.stringify(hashInfo));
    if (hashInfo) {
      console.log('[ddp] match: using hashAndFileName');
      return ddpRequest('POST', '/api/v2/match', null, {
        fileName: nameWithoutExt,
        fileHash: hashInfo.hash,
        fileSize: hashInfo.fileSize,
        videoDuration: 0,
        matchMode: 'hashAndFileName'
      });
    }
    console.log('[ddp] match: fallback to fileNameOnly');
    return ddpRequest('POST', '/api/v2/match', null, {
      fileName: nameWithoutExt,
      fileHash: '00000000000000000000000000000000',
      fileSize: 0,
      videoDuration: 0,
      matchMode: 'fileNameOnly'
    });
  });
}

function ddpSearchAnime(keyword) {
  return ddpRequest('GET', '/api/v2/search/anime', { keyword: keyword });
}

function ddpGetComments(episodeId) {
  return ddpRequest('GET', '/api/v2/comment/' + episodeId, {
    withRelated: dandanplayWithRelated ? 'true' : 'false',
    chConvert: String(dandanplayChConvert)
  });
}

function ddpGetBangumi(bangumiId) {
  return ddpRequest('GET', '/api/v2/bangumi/' + bangumiId);
}

function ddpErrStr(err) {
  if (!err) return 'Unknown error';
  if (typeof err === 'string') return err;
  if (err.message) return err.message;
  try { return JSON.stringify(err); } catch (e) { return String(err); }
}

function ddpConvertComments(ddpComments) {
  var list = [];
  for (var i = 0; i < ddpComments.length; i++) {
    var c = ddpComments[i];
    if (!c.p || !c.m) continue;
    var parts = c.p.split(',');
    if (parts.length < 3) continue;
    var timeSec = parseFloat(parts[0]);
    var mode = parseInt(parts[1]);
    var colorDec = parseInt(parts[2]);
    if (isNaN(timeSec) || isNaN(mode) || isNaN(colorDec)) continue;
    if (colorDec < 0) colorDec = (colorDec >>> 0) & 0xFFFFFF;
    var colorHex = '#' + colorDec.toString(16).padStart(6, '0');
    var commands = [];
    if (mode === 4) commands.push('shita');
    else if (mode === 5) commands.push('ue');
    else commands.push('naka');
    commands.push(colorHex);
    list.push({
      t: Math.round(timeSec * 100),
      text: c.m,
      _isOwner: false,
      _commands: commands,
      _userId: parseInt(parts[3]) || 0,
      _dateSec: 0
    });
  }
  return list;
}

function ddpCachePath(episodeId) {
  return '@data/danmaku-cache/' + episodeId + '.json';
}

function ddpReadCache(episodeId) {
  try {
    var path = ddpCachePath(episodeId);
    if (!file.exists(path)) return null;
    var content = file.read(path);
    if (!content) return null;
    return JSON.parse(content);
  } catch (e) {
    return null;
  }
}

function ddpWriteCache(episodeId, data) {
  try {
    var path = ddpCachePath(episodeId);
    file.write(path, JSON.stringify(data));
  } catch (e) {}
}

function ddpSyncState() {
  sidebar.postMessage("dandanplay-status", {
    status: dandanplayState.status,
    animeTitle: dandanplayState.animeTitle,
    episodeTitle: dandanplayState.episodeTitle,
    episodeId: dandanplayState.episodeId,
    commentCount: dandanplayState.commentCount,
    error: dandanplayState.error,
    matches: dandanplayState.matches ? JSON.parse(JSON.stringify(dandanplayState.matches)) : null,
    priority: dandanplayPriority
  });
}

function ddpResetState() {
  dandanplayState = {
    status: 'idle',
    animeTitle: '',
    episodeTitle: '',
    episodeId: null,
    commentCount: 0,
    error: '',
    comments: null,
    matches: null
  };
  ddpSyncState();
}

function ddpAutoMatchAndLoad(url) {
  if (dandanplayPriority === 'local-only') return;

  var path = filePathFromUrl(url);
  var fileName;
  if (path) {
    fileName = path.replace(/.*[/\\]/, '');
  } else {
    try { fileName = decodeURIComponent(url.replace(/.*[/\\]/, '').replace(/[?#].*/, '')); } catch (e) { fileName = url; }
  }
  if (!fileName) return;

  dandanplayState = {
    status: 'matching',
    animeTitle: '',
    episodeTitle: '',
    episodeId: null,
    commentCount: 0,
    error: '',
    comments: null,
    matches: null
  };
  ddpSyncState();

  ddpMatchVideo(fileName, path).then(function(res) {
    console.log('[ddp] autoMatch: statusCode=' + res.statusCode);
    var data = ddpParseBody(res);
    console.log('[ddp] autoMatch: isMatched=' + (data ? data.isMatched : 'null') + ' matches=' + (data && data.matches ? data.matches.length : 0));
    if (res.statusCode === 403) {
      dandanplayState.status = 'error';
      dandanplayState.error = 'Auth error (403): ' + (res.reason || 'check AppId/AppSecret');
      ddpSyncState();
      return;
    }
    if (!data) {
      dandanplayState.status = 'error';
      dandanplayState.error = 'API response error (status=' + res.statusCode + ', text=' + (res.text ? res.text.substring(0, 100) : 'empty') + ')';
      ddpSyncState();
      return;
    }
    if (data.success === false) {
      dandanplayState.status = 'error';
      dandanplayState.error = data.errorMessage || 'API error';
      ddpSyncState();
      return;
    }
    if (!data.matches || data.matches.length === 0) {
      dandanplayState.status = 'no-match';
      dandanplayState.error = 'No match found';
      ddpSyncState();
      core.osd("弹弹play: 未找到匹配");
      return;
    }

    dandanplayState.matches = JSON.parse(JSON.stringify(data.matches));

    if (data.isMatched) {
      var match = data.matches[0];
      var forceLoad = (dandanplayPriority === 'network-first' || dandanplayPriority === 'network-only');
      ddpLoadComments(match.episodeId, match.animeTitle, match.episodeTitle, forceLoad);
    } else {
      ddpSyncState();
    }
  }).catch(function(err) {
    dandanplayState.status = 'error';
    dandanplayState.error = ddpErrStr(err);
    ddpSyncState();
    core.osd("弹弹play: 网络错误");
  });
}

function ddpAddToFileListAndLoad(episodeId, animeTitle, episodeTitle, converted, forceLoad) {
  var virtualPath = 'dandanplay://' + episodeId;
  var displayName = '🌐 ' + (animeTitle || 'DanDanPlay') + ' - ' + (episodeTitle || '');
  danmakuCache[virtualPath] = encodeContent(JSON.stringify(converted));

  var alreadyExists = false;
  var allFiles = danmakuFileList.xmlFiles.concat(danmakuFileList.jsonFiles);
  for (var i = 0; i < allFiles.length; i++) {
    if (allFiles[i].path === virtualPath) { alreadyExists = true; break; }
  }
  if (!alreadyExists) {
    danmakuFileList.jsonFiles.push({
      path: virtualPath,
      filename: displayName,
      relativePath: 'DanDanPlay #' + episodeId,
      type: 'DDP'
    });
  }

  var shouldAutoLoad = forceLoad;
  if (!shouldAutoLoad) {
    if (dandanplayPriority === 'network-first' || dandanplayPriority === 'network-only') shouldAutoLoad = true;
    if (dandanplayPriority === 'local-first' && !currentDanmakuStatus.isLoaded) shouldAutoLoad = true;
  }

  if (shouldAutoLoad) {
    danmakuFileList.selectedPaths = [virtualPath];
    updateDanmakuStatus({ fileType: 'dandanplay', fileName: displayName, relativePath: 'DanDanPlay #' + episodeId, isLoaded: true });
    sidebar.postMessage("danmaku-file-list", danmakuFileList);

    var payload = {
      xmlContent: danmakuCache[virtualPath],
      path: virtualPath,
      danmakuType: 'dandanplay',
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
      core.osd("已加载网络弹幕: " + displayName);
      ensureDanmakuEnabled();
    } else {
      pendingDanmaku = payload;
    }
  } else {
    sidebar.postMessage("danmaku-file-list", danmakuFileList);
  }
}

function ddpLoadComments(episodeId, animeTitle, episodeTitle, forceLoad) {
  dandanplayState.status = 'loading';
  dandanplayState.episodeId = episodeId;
  dandanplayState.animeTitle = animeTitle || '';
  dandanplayState.episodeTitle = episodeTitle || '';
  ddpSyncState();

  var cached = ddpReadCache(episodeId);
  if (cached && cached.comments && cached.comments.length > 0) {
    var cacheAge = Date.now() - (cached.cachedAt || 0);
    if (cacheAge < 24 * 60 * 60 * 1000) {
      dandanplayState.status = 'loaded';
      dandanplayState.commentCount = cached.comments.length;
      dandanplayState.comments = cached.comments;
      ddpSyncState();
      ddpAddToFileListAndLoad(episodeId, animeTitle, episodeTitle, cached.comments, forceLoad);
      return;
    }
  }

  ddpGetComments(episodeId).then(function(res) {
    if (res.statusCode === 403) {
      dandanplayState.status = 'error';
      dandanplayState.error = 'Auth error (403): ' + (res.reason || 'check AppId/AppSecret');
      ddpSyncState();
      return;
    }
    var data = ddpParseBody(res);
    if (!data) {
      dandanplayState.status = 'error';
      dandanplayState.error = 'API response error';
      ddpSyncState();
      return;
    }
    if (!data.comments || data.comments.length === 0) {
      dandanplayState.status = 'error';
      dandanplayState.error = 'No comments available';
      ddpSyncState();
      return;
    }

    var converted = ddpConvertComments(data.comments);

    ddpWriteCache(episodeId, {
      episodeId: episodeId,
      animeTitle: animeTitle || '',
      episodeTitle: episodeTitle || '',
      cachedAt: Date.now(),
      comments: converted
    });

    dandanplayState.status = 'loaded';
    dandanplayState.commentCount = converted.length;
    dandanplayState.comments = converted;
    ddpSyncState();
    ddpAddToFileListAndLoad(episodeId, animeTitle, episodeTitle, converted, forceLoad);
  }).catch(function(err) {
    dandanplayState.status = 'error';
    dandanplayState.error = ddpErrStr(err);
    ddpSyncState();
    core.osd("弹弹play: 加载弹幕失败");
  });
}

function loadDanmakuForVideo(url) {
  currentVideoUrl = url;
  danmakuCache = {};
  ddpResetState();

  if (core.status.isNetworkResource) {
    core.osd("网络资源，跳过本地弹幕加载");
    danmakuNotFound();
    danmakuFileList = { xmlFiles: [], jsonFiles: [], unknownFiles: [], selectedPaths: [] };
    sidebar.postMessage("danmaku-file-list", danmakuFileList);
    if (overlayReady) overlay.postMessage("clear-danmaku", {});
    if (dandanplayPriority !== 'local-only') {
      ddpAutoMatchAndLoad(url);
    }
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
  var hasLocal = allMatched.length > 0;

  if (dandanplayPriority === 'network-first') {
    ddpAutoMatchAndLoad(url);
    if (hasLocal) {
      var firstFile = allMatched[0];
      loadLocalDanmaku(firstFile);
    } else {
      danmakuNotFound();
    }
  } else if (dandanplayPriority === 'network-only') {
    danmakuNotFound();
    if (overlayReady) overlay.postMessage("clear-danmaku", {});
    ddpAutoMatchAndLoad(url);
  } else if (dandanplayPriority === 'local-first') {
    if (hasLocal) {
      var firstFile = allMatched[0];
      loadLocalDanmaku(firstFile);
    } else {
      danmakuNotFound();
      ddpAutoMatchAndLoad(url);
    }
  } else {
    if (hasLocal) {
      var firstFile = allMatched[0];
      loadLocalDanmaku(firstFile);
    } else {
      danmakuNotFound();
    }
  }
}

function loadLocalDanmaku(fileInfo) {
  danmakuFileList.selectedPaths = [fileInfo.path];

  var xmlContent = file.read(fileInfo.path);
  if (!xmlContent) {
    core.osd("无法读取弹幕文件: " + fileInfo.filename);
    danmakuNotFound();
    return;
  }
  var encodedContent = encodeContent(xmlContent);
  danmakuCache[fileInfo.path] = encodedContent;

  var fileType = detectDanmakuType(xmlContent);
  updateDanmakuStatus({ fileType: fileType, fileName: fileInfo.filename, relativePath: fileInfo.relativePath, isLoaded: true });

  sidebar.postMessage("danmaku-file-list", danmakuFileList);

  var payload = {
    xmlContent: encodedContent,
    path: fileInfo.path,
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
    core.osd("已加载弹幕: " + fileInfo.filename);
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
  sidebar.postMessage("danmaku-state", { enabled: danmakuEnabled, canvasMode: currentCanvasMode });
}

function ensureDanmakuEnabled() {
  if (danmakuEnabled) return;
  danmakuEnabled = true;
  preferences.set("danmakuEnabled", true);
  preferences.sync();
  overlay.postMessage("toggle-danmaku", { enabled: true });
  overlay.show();
  setObserver(true);
  sidebar.postMessage("danmaku-state", { enabled: true, canvasMode: currentCanvasMode });
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
    if (dandanplayState.episodeId && dandanplayState.status === 'loaded') {
      var virtualPath = 'dandanplay://' + dandanplayState.episodeId;
      var found = false;
      var allFiles = danmakuFileList.xmlFiles.concat(danmakuFileList.jsonFiles);
      for (var i = 0; i < allFiles.length; i++) {
        if (allFiles[i].path === virtualPath) { found = true; break; }
      }
      if (!found && danmakuCache[virtualPath]) {
        var displayName = '🌐 ' + (dandanplayState.animeTitle || 'DanDanPlay') + ' - ' + (dandanplayState.episodeTitle || '');
        danmakuFileList.jsonFiles.push({
          path: virtualPath,
          filename: displayName,
          relativePath: 'DanDanPlay #' + dandanplayState.episodeId,
          type: 'DDP'
        });
      }
    }
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
    ddpSyncState();
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

  sidebar.onMessage("select-danmaku-file", function (data) {
    var filePath = data.path;

    var encodedContent = danmakuCache[filePath];
    if (!encodedContent && filePath.indexOf('dandanplay://') !== 0) {
      var rawContent = file.read(filePath);
      if (!rawContent) {
        core.osd("无法读取弹幕文件: " + filePath.split("/").pop());
        return;
      }
      encodedContent = encodeContent(rawContent);
      danmakuCache[filePath] = encodedContent;
    }

    if (!encodedContent) {
      core.osd("弹幕内容不可用");
      return;
    }

    danmakuFileList.selectedPaths = [filePath];

    var fileName = filePath.indexOf('dandanplay://') === 0 ? filePath : filePath.split("/").pop();
    var allFiles = danmakuFileList.xmlFiles.concat(danmakuFileList.jsonFiles).concat(danmakuFileList.unknownFiles);
    var fileInfo = null;
    for (var fi = 0; fi < allFiles.length; fi++) {
      if (allFiles[fi].path === filePath) { fileInfo = allFiles[fi]; break; }
    }
    var relPath = fileInfo ? fileInfo.relativePath : fileName;
    var fileType = filePath.indexOf('dandanplay://') === 0 ? 'dandanplay' : detectDanmakuType(decodeURIComponent(encodedContent));
    updateDanmakuStatus({ fileType: fileType, fileName: fileInfo ? fileInfo.filename : fileName, relativePath: relPath, isLoaded: true });

    sidebar.postMessage("danmaku-file-list", danmakuFileList);

    overlay.postMessage("load-danmaku", {
      xmlContent: encodedContent,
      path: filePath,
      danmakuType: fileType,
      opacity: canvasOpacity,
      canvasFontScale: canvasFontScale,
      strokeColor: strokeColor,
      strokeInversionColor: strokeInversionColor,
      strokeOpacity: strokeOpacity,
      strokeWidth: strokeWidth,
      commentLimit: commentLimit,
      scrollSpeed: scrollSpeed,
    });
    core.osd("已加载弹幕: " + (fileInfo ? fileInfo.filename : fileName));
    ensureDanmakuEnabled();
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

      danmakuFileList.selectedPaths = [];

      var content = file.read(path);
      if (content) {
        danmakuCache[path] = encodeContent(content);
        core.osd("已添加弹幕: " + fname + "，点击加载");
      } else {
        core.osd("无法读取弹幕文件: " + fname);
        sidebar.postMessage("danmaku-file-error", { path: path, message: "无法读取文件" });
      }

      sidebar.postMessage("danmaku-file-list", danmakuFileList);
    });
  });

  sidebar.onMessage("danmaku-file-delete", function (data) {
    var filePath = data.path;
    danmakuFileList.xmlFiles = danmakuFileList.xmlFiles.filter(function(f) { return f.path !== filePath; });
    danmakuFileList.jsonFiles = danmakuFileList.jsonFiles.filter(function(f) { return f.path !== filePath; });
    danmakuFileList.unknownFiles = danmakuFileList.unknownFiles.filter(function(f) { return f.path !== filePath; });

    danmakuFileList.selectedPaths = danmakuFileList.selectedPaths.filter(function(p) { return p !== filePath; });
    delete danmakuCache[filePath];
    sidebar.postMessage("danmaku-file-list", danmakuFileList);

    if (danmakuFileList.selectedPaths.length === 0) {
      updateDanmakuStatus({ fileType: null, fileName: null, relativePath: null, isLoaded: false });
    }
  });

  sidebar.onMessage("dandanplay-set-priority", function (data) {
    dandanplayPriority = data.priority;
    preferences.set("dandanplayPriority", dandanplayPriority);
    syncPreferencesSoon();
    ddpSyncState();
  });

  sidebar.onMessage("dandanplay-search", function (data) {
    var keyword = data.keyword;
    if (!keyword) return;
    ddpSearchAnime(keyword).then(function(res) {
      var result = ddpParseBody(res);
      if (!result || !result.animes || result.animes.length === 0) {
        sidebar.postMessage("dandanplay-search-result", JSON.stringify({ animes: [], error: 'No results found' }));
        return;
      }
      sidebar.postMessage("dandanplay-search-result", JSON.stringify({ animes: result.animes }));
    }).catch(function(err) {
      sidebar.postMessage("dandanplay-search-result", JSON.stringify({ animes: [], error: ddpErrStr(err) }));
    });
  });

  sidebar.onMessage("dandanplay-select-episode", function (data) {
    ddpLoadComments(data.episodeId, data.animeTitle, data.episodeTitle, true);
  });

  sidebar.onMessage("dandanplay-get-bangumi", function (data) {
    var bangumiId = data.bangumiId;
    var animeTitle = data.animeTitle;
    ddpGetBangumi(bangumiId).then(function(res) {
      var result = ddpParseBody(res);
      if (!result) {
        sidebar.postMessage("dandanplay-bangumi-result", JSON.stringify({ animeTitle: animeTitle, episodes: [], error: 'Parse error' }));
        return;
      }
      sidebar.postMessage("dandanplay-bangumi-result", JSON.stringify({ animeTitle: animeTitle, episodes: result.episodes || [] }));
    }).catch(function(err) {
      sidebar.postMessage("dandanplay-bangumi-result", JSON.stringify({ animeTitle: animeTitle, episodes: [], error: ddpErrStr(err) }));
    });
  });

  sidebar.onMessage("dandanplay-select-match", function (data) {
    var match = data.match;
    if (match && match.episodeId) {
      ddpLoadComments(match.episodeId, match.animeTitle, match.episodeTitle, true);
    }
  });

  sidebar.onMessage("dandanplay-trigger-match", function () {
    if (currentVideoUrl) {
      ddpAutoMatchAndLoad(currentVideoUrl);
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
