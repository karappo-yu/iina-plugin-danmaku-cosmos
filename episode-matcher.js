// Local danmaku discovery and episode-number matching heuristics.

function filePathFromUrl(url) {
  if (!url) return null;
  if (url.startsWith("file://")) {
    try { return decodeURIComponent(url.substring(7)); } catch (e) { return url.substring(7); }
  }
  return null;
}

function extractNumberFromName(name) {
  let match;
  // High-certainty explicit markers take precedence over bare heuristics
  // (avoids false positives like H.264, x265, 10bit, 2nd Season).
  match = name.match(/S\d{1,2}E(\d{1,3})(?!\d|p\b|bit\b)/i);
  if (match) return parseInt(match[1], 10);
  // Numbered episode suffixes take precedence over volume/season numbers.
  let suffix = /(\d{1,3})\s*(?:話|话|集)/g;
  while ((match = suffix.exec(name)) !== null) {
    let prefix = name.slice(0, match.index);
    // 全12话/共 12集 describe the series length, not this file's episode.
    if (/\d$/.test(prefix) || /(?:全|共)\s*$/.test(prefix)) continue;
    return parseInt(match[1], 10);
  }
  // A bare 第 also occurs in season labels (第2季/第2期). Only full
  // numbered suffixes above count; English markers must start a token.
  match = name.match(/(?:^|[^a-z])(?:Episode|Ep\.?)\s*(\d{1,3})(?!\d|p\b|bit\b)/i);
  if (match) return parseInt(match[1], 10);
  // Bracketed episode numbers may carry a release revision suffix ([01v2]).
  match = name.match(/\[(\d{1,3})(?:v\d)?\](?!.*\[)/i);
  if (match) return parseInt(match[1], 10);
  match = name.match(/\[\d{1,3}(?:v\d)?\]/gi);
  if (match) {
    match = match[match.length - 1].match(/\[(\d{1,3})/);
    if (match) return parseInt(match[1], 10);
  }
  // Fansub style "Title - 07": the number after a spaced dash is the episode,
  // even when the title itself contains numbers (Mob Psycho 100 - 07,
  // 86 - Eighty Six - 03, Spy x Family 2 - 04). The last such token wins.
  let dashMatches = name.match(/\s[-\u2013\u2014]\s*\d{1,3}(?:v\d)?(?=$|[\s.\[\]()_\-])/gi);
  if (dashMatches) {
    match = dashMatches[dashMatches.length - 1].match(/(\d{1,3})(?:v\d)?$/i);
    if (match) return parseInt(match[1], 10);
  }
  // Vol. 通常指卷/碟号, 优先级低于明确的集数标记和方括号集数 ("Show Vol.2 [05]" 应为第 5 集)。
  match = name.match(/(?:^|[^a-z])Vol\.?\s*(\d{1,3})(?!\d|p\b|bit\b)/i);
  if (match) return parseInt(match[1], 10);
  match = name.match(/(?:^|[_\-.\s])(\d{1,3})(?:_|\-|\.|\s|$)/);
  if (match) return parseInt(match[1], 10);
  match = name.match(/(?:^|[\[\]_\-.\s])(1?\d)(?:_|\.|\s|$)/i);
  if (match) return parseInt(match[1], 10);
  return null;
}

function extractEpisodeNumber(videoPath) {
  let filename = videoPath.replace(/.*[/\\]/, '').replace(/\.[^.]+$/, '');
  return extractNumberFromName(filename);
}

function extractDanmakuNumber(filename) {
  return extractNumberFromName(filename.replace(/\.[^.]+$/, ''));
}

function findDanmakuByEpisode(videoUrl, fileApi) {
  let path = filePathFromUrl(videoUrl);
  if (!path) return { xmlFiles: [], jsonFiles: [] };

  let videoDir = path.replace(/[/\\][^/\\]+$/, '');
  let videoEpNum = extractEpisodeNumber(path);
  let videoBaseName = path.replace(/.*[/\\]/, '').replace(/\.[^.]+$/, '').normalize('NFC');

  let searchDirs = [videoDir];
  let altDirNames = ['弹幕', 'Comments', 'コメント'];
  for (let i = 0; i < altDirNames.length; i++) {
    let altDir = videoDir + '/' + altDirNames[i];
    if (fileApi.exists(altDir)) searchDirs.push(altDir);
  }

  let exactXmlFiles = [];
  let exactJsonFiles = [];
  let prefixXmlFiles = [];
  let prefixJsonFiles = [];
  let epNumXmlFiles = [];
  let epNumJsonFiles = [];
  let seenPaths = Object.create(null);

  for (let d = 0; d < searchDirs.length; d++) {
    let dir = searchDirs[d];
    let items;
    try { items = fileApi.list(dir, { includeSubDir: false }); } catch (e) { continue; }
    if (!items) continue;

    for (let j = 0; j < items.length; j++) {
      let item = items[j];
      if (item.isDir) continue;
      let fname = item.filename;
      if (fname.charAt(0) === '.') continue;
      let ext = fname.lastIndexOf('.') >= 0 ? fname.substring(fname.lastIndexOf('.') + 1).toLowerCase() : '';
      if (ext !== 'json' && ext !== 'xml') continue;

      let filePath = dir + '/' + fname;
      if (seenPaths[filePath]) continue;
      seenPaths[filePath] = true;

      let relativePath = filePath;
      if (filePath.startsWith(videoDir + "/")) relativePath = filePath.substring(videoDir.length + 1);

      let fileEpNum = extractDanmakuNumber(fname);
      let fileBaseName = fname.replace(/\.[^.]+$/, '');
      let normalizedBaseName = fileBaseName.normalize('NFC');
      let isExactMatch = normalizedBaseName === videoBaseName;
      let isPrefixMatch = !isExactMatch && normalizedBaseName.startsWith(videoBaseName);
      if (/\d$/.test(videoBaseName) && /^\d/.test(normalizedBaseName.slice(videoBaseName.length))) isPrefixMatch = false;
      let fileInfo = {
        filename: fname,
        path: filePath,
        relativePath: relativePath,
        type: ext.toUpperCase(),
        _matchRank: (isExactMatch ? 0 : isPrefixMatch ? 4 : 8) + (d === 0 ? 0 : 2) + (ext === 'json' ? 0 : 1)
      };

      if (isExactMatch) {
        if (ext === 'xml') exactXmlFiles.push(fileInfo); else exactJsonFiles.push(fileInfo);
      } else if (isPrefixMatch) {
        if (ext === 'xml') prefixXmlFiles.push(fileInfo); else prefixJsonFiles.push(fileInfo);
      } else if (videoEpNum !== null && fileEpNum !== null && fileEpNum === videoEpNum) {
        if (ext === 'xml') epNumXmlFiles.push(fileInfo); else epNumJsonFiles.push(fileInfo);
      }
    }
  }

  let xmlFiles = exactXmlFiles.concat(prefixXmlFiles).concat(epNumXmlFiles);
  let jsonFiles = exactJsonFiles.concat(prefixJsonFiles).concat(epNumJsonFiles);
  return { xmlFiles: xmlFiles, jsonFiles: jsonFiles };
}

module.exports = {
  filePathFromUrl: filePathFromUrl,
  extractNumberFromName: extractNumberFromName,
  extractEpisodeNumber: extractEpisodeNumber,
  extractDanmakuNumber: extractDanmakuNumber,
  findDanmakuByEpisode: findDanmakuByEpisode
};
