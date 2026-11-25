// DanDanPlay HTTP client, macOS file-hash helper, and versioned disk cache I/O.

const DDP_API_BASE = 'https://api.dandanplay.net';
const DDP_LOAD_ORIGIN = { AUTO: 'auto', MANUAL: 'manual' };

function ddpParseBody(res) {
  if (!res) return null;
  let text = res.text;
  if (typeof text === 'string' && text.length > 0) {
    try { return JSON.parse(text); } catch (e) {}
  }
  if (res.data !== undefined && res.data !== null && typeof res.data === 'object') {
    return res.data;
  }
  if (typeof res.data === 'string' && res.data.length > 0) {
    try { return JSON.parse(res.data); } catch (e) {}
  }
  return null;
}

function ddpErrStr(err) {
  if (!err) return 'Unknown error';
  if (typeof err === 'string') return err;
  if (err.message) return err.message;
  try { return JSON.stringify(err); } catch (e) { return String(err); }
}

function ddpPathHash(videoPath) {
  if (!videoPath) return '';
  let hash = 5381;
  for (let i = 0; i < videoPath.length; i++) {
    hash = ((hash << 5) + hash) + videoPath.charCodeAt(i);
    hash = hash & hash;
  }
  return (hash >>> 0).toString(36);
}

function ddpCacheFile(videoPath) {
  if (!videoPath) return null;
  return '@data/danmaku-cache/' + ddpPathHash(videoPath) + '.json';
}

function projectMatches(matches) {
  if (!matches) return null;
  let result = new Array(matches.length);
  for (let i = 0; i < matches.length; i++) {
    let match = matches[i] || {};
    result[i] = {
      animeTitle: match.animeTitle,
      episodeId: match.episodeId,
      episodeTitle: match.episodeTitle
    };
  }
  return result;
}

function createDdpClient(deps) {
  let appId = deps.appId;
  let appSecret = deps.appSecret;
  let http = deps.http;
  let utils = deps.utils;
  let file = deps.file;
  let log = deps.console;
  let parseDanmakuSource = deps.parseDanmakuSource;
  let t = deps.t;

  let ddpCacheDirPromise = null;
  let cacheWriteQueue = Promise.resolve();

  function request(method, path, queryParams, body) {
    let url = DDP_API_BASE + path;
    let options = {
      headers: {
        'X-AppId': appId,
        'X-AppSecret': appSecret,
        'Accept': 'application/json',
        'User-Agent': 'DanmakuCosmos/IINA'
      }
    };
    if (queryParams && typeof queryParams === 'object') {
      let strParams = {};
      for (let key in queryParams) {
        if (Object.prototype.hasOwnProperty.call(queryParams, key)) {
          strParams[key] = String(queryParams[key]);
        }
      }
      options.params = strParams;
    }
    if (body) {
      options.data = body;
      options.headers['Content-Type'] = 'application/json';
    }
    if (method === 'GET') return http.get(url, options);
    return http.post(url, options);
  }

  // DDP matches the first 16 MiB's MD5 and the full file size. Use an async
  // subprocess with macOS base tools; pipefail requires bash rather than sh.
  function calcFileHash(filePath) {
    if (!filePath) return Promise.resolve(null);
    let script = 'set -e\n'
      + 'set -o pipefail\n'
      + 'f="$1"\n'
      + 'test -r "$f"\n'
      + 'h=$(dd if="$f" bs=1m count=16 2>/dev/null | /sbin/md5 -q)\n'
      + 'sz=$(stat -f %z "$f")\n'
      + 'printf "%s %s\\n" "$h" "$sz"';
    try {
      return utils.exec('/bin/bash', ['-c', script, 'ddp-hash', filePath]).then(function (result) {
        if (!result || result.status !== 0 || !result.stdout) return null;
        let parts = result.stdout.trim().split(/\s+/);
        if (parts.length >= 2 && /^[0-9a-f]{32}$/.test(parts[0])) {
          return { hash: parts[0], fileSize: parseInt(parts[1], 10) || 0 };
        }
        return null;
      }).catch(function () {
        return null;
      });
    } catch (e) {
      return Promise.resolve(null);
    }
  }

  function matchVideo(fileName, filePath) {
    let nameWithoutExt = fileName.replace(/\.[^.]+$/, '');
    return calcFileHash(filePath).then(function (hashInfo) {
      if (hashInfo) {
        return request('POST', '/api/v2/match', null, {
          fileName: nameWithoutExt,
          fileHash: hashInfo.hash,
          fileSize: hashInfo.fileSize,
          videoDuration: 0,
          matchMode: 'hashAndFileName'
        });
      }
      return request('POST', '/api/v2/match', null, {
        fileName: nameWithoutExt,
        fileHash: '00000000000000000000000000000000',
        fileSize: 0,
        videoDuration: 0,
        matchMode: 'fileNameOnly'
      });
    });
  }

  function searchAnime(keyword) {
    return request('GET', '/api/v2/search/anime', { keyword: keyword });
  }

  function getComments(episodeId) {
    return request('GET', '/api/v2/comment/' + episodeId, {
      withRelated: 'true',
      chConvert: '0' // OpenCC is the sole conversion policy.
    });
  }

  function getBangumi(bangumiId) {
    return request('GET', '/api/v2/bangumi/' + bangumiId);
  }

  function httpError(res, data) {
    let base = data && typeof data.errorMessage === 'string' && data.errorMessage
      ? data.errorMessage : t('ddp_api_error');
    if (res && typeof res.statusCode === 'number' && (res.statusCode < 200 || res.statusCode >= 300)) {
      return base + ' (' + res.statusCode + ')';
    }
    return base;
  }

  function convertComments(comments) {
    return parseDanmakuSource(comments, '', 'dandanplay');
  }

  function ensureCacheDir() {
    if (ddpCacheDirPromise) return ddpCacheDirPromise;
    try {
      let cacheDir = utils.resolvePath('@data/danmaku-cache/');
      if (!cacheDir) return Promise.resolve(null);
      if (file.exists(cacheDir)) return Promise.resolve(cacheDir);
      // IINA has no file.mkdir API. Await mkdir before the first cache write.
      ddpCacheDirPromise = utils.exec('/bin/mkdir', ['-p', cacheDir]).then(function (result) {
        return result && result.status === 0 ? cacheDir : null;
      }).catch(function (error) {
        log.log('[ddp] cache directory error: ' + error);
        return null;
      }).then(function (dir) {
        ddpCacheDirPromise = null;
        return dir;
      });
      return ddpCacheDirPromise;
    } catch (e) {
      return Promise.resolve(null);
    }
  }

  function saveVideoCache(videoPath, episodeId, animeTitle, episodeTitle, comments) {
    if (!videoPath || !episodeId) return Promise.resolve(false);
    let content = JSON.stringify({
      videoPath: videoPath,
      episodeId: episodeId,
      animeTitle: animeTitle || '',
      episodeTitle: episodeTitle || '',
      cachedAt: Date.now(),
      schemaVersion: 2,
      comments: comments && comments.sourceType ? comments.comments : comments || []
    });
    cacheWriteQueue = cacheWriteQueue.then(ensureCacheDir).then(function (dir) {
      if (!dir) return false;
      if (file.write(ddpCacheFile(videoPath), content) === false) throw new Error('Cache write failed');
      return true;
    }).catch(function (e) {
      log.log('[ddp] saveVideoCache error: ' + e);
      return false;
    });
    return cacheWriteQueue;
  }

  function readVideoCache(videoPath) {
    if (!videoPath) return null;
    try {
      let f = ddpCacheFile(videoPath);
      if (!f || !file.exists(f)) return null;
      let content = file.read(f);
      if (!content) return null;
      let data = JSON.parse(content);
      if (!data || !data.episodeId || !Array.isArray(data.comments)) return null;
      if (data.videoPath && data.videoPath !== videoPath) return null;
      let cachedAt = Number(data.cachedAt);
      let age = Date.now() - cachedAt;
      if (!isFinite(cachedAt) || cachedAt <= 0 || age < 0 || age >= 24 * 60 * 60 * 1000) {
        data.stale = true;
      }
      data.document = parseDanmakuSource(data.comments, '', 'dandanplay');
      data.comments = data.document.comments;
      return data;
    } catch (e) {
      log.log('[ddp] readVideoCache error: ' + e);
      return null;
    }
  }

  return {
    matchVideo: matchVideo,
    searchAnime: searchAnime,
    getComments: getComments,
    getBangumi: getBangumi,
    httpError: httpError,
    convertComments: convertComments,
    saveVideoCache: saveVideoCache,
    readVideoCache: readVideoCache
  };
}

module.exports = {
  DDP_LOAD_ORIGIN: DDP_LOAD_ORIGIN,
  ddpParseBody: ddpParseBody,
  ddpErrStr: ddpErrStr,
  ddpCacheFile: ddpCacheFile,
  projectMatches: projectMatches,
  createDdpClient: createDdpClient
};
