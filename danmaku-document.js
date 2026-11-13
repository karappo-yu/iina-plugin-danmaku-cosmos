// Source text exists only at this I/O boundary. The IR retains native rendering
// metadata (especially date/premium) as well as normalized filtering fields.
function decodeXmlText(text) {
  const entities = {amp: '&', lt: '<', gt: '>', quot: '"', apos: "'"};
  return text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, function (entity, key) {
    key = key.toLowerCase();
    if (key[0] !== '#') return entities[key];
    const code = key[1] === 'x' ? parseInt(key.slice(2), 16) : Number(key.slice(1));
    return code > 0 && code <= 0x10FFFF && !(code >= 0xD800 && code <= 0xDFFF) ? String.fromCodePoint(code) : entity;
  });
}

function decodeXmlContent(text) {
  return text.replace(/\r\n?/g, '\n').split(/(<!\[CDATA\[[\s\S]*?\]\]>|<!--[\s\S]*?-->)/g).map(function (part) {
    if (part.startsWith('<!--')) return '';
    return part.startsWith('<![CDATA[') ? part.slice(9, -3) : decodeXmlText(part);
  }).join('');
}

function getCommentPosition(commands) {
  for (let i = 0; i < Math.min(commands.length, 64); i++) {
    const command = commands[i].toLowerCase();
    if (command === 'ue' || command === 'shita' || command === 'naka') return command;
  }
  return 'naka';
}

function emptyDateInfo() {
  return {totalCount: 0, firstDay: null, lastDay: null, dayCounts: [], undatedCount: 0};
}

function postedAtSeconds(value) {
  if (typeof value !== 'string' || !value) return 0;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) value += 'T00:00:00+09:00';
  else if (!/(?:Z|[+-]\d{2}:?\d{2})$/i.test(value)) value += '+09:00';
  const time = Date.parse(value);
  return isFinite(time) ? Math.floor(time / 1000) : 0;
}

function skipXmlDoctype(text, offset) {
  let quote = '', subset = 0;
  for (let i = offset + 9; i < text.length; i++) {
    let char = text[i];
    if (quote) { if (char === quote) quote = ''; continue; }
    let close = text.slice(i, i + 4) === '<!--' ? '-->' : text.slice(i, i + 2) === '<?' ? '?>' : null;
    if (close) {
      let end = text.indexOf(close, i + 2);
      if (end < 0) break;
      i = end + close.length - 1;
    } else if (char === '"' || char === "'") quote = char;
    else if (char === '[') subset++;
    else if (char === ']') subset--;
    else if (char === '>' && subset === 0) return i + 1;
  }
  throw new Error('Invalid XML declaration');
}

// Inspect only the prolog and first root tag. Comment bodies and CDATA can
// contain literal XML-looking text and must never participate in detection.
function detectXmlSource(text) {
  let offset = 0;
  while (offset < text.length) {
    while (offset < text.length && /\s|\uFEFF/.test(text.charAt(offset))) offset++;
    let end;
    if (text.slice(offset, offset + 2) === '<?') {
      end = text.indexOf('?>', offset + 2);
      if (end < 0) break;
      offset = end + 2;
    } else if (text.slice(offset, offset + 4) === '<!--') {
      end = text.indexOf('-->', offset + 4);
      if (end < 0) break;
      offset = end + 3;
    } else if (text.slice(offset, offset + 9) === '<!DOCTYPE' && /\s/.test(text[offset + 9] || '')) {
      offset = skipXmlDoctype(text, offset);
    } else {
      // Eight characters cover the longest supported root and its delimiter.
      let root = /^<(packet|chat|i|d)(?=[\s/>])/.exec(text.slice(offset, offset + 8));
      if (root) return {offset: offset, sourceType: root[1] === 'packet' || root[1] === 'chat' ? 'nico-xml' : 'bilibili-xml'};
      break;
    }
  }
  throw new Error('Unsupported danmaku source');
}

function parseDanmakuSource(rawContent, path, sourceHint) {
  let source = rawContent;
  let sourceType = sourceHint;
  if (typeof source === 'string') {
    const text = source.trim();
    if (text[0] === '[' || text[0] === '{') source = JSON.parse(text);
    else {
      const xml = detectXmlSource(text);
      sourceType = xml.sourceType;
      source = text.slice(xml.offset);
    }
  }
  if (source && source.source === 'dandanplay') { sourceType = 'dandanplay'; source = source.comments; }
  if (typeof source !== 'string' && !Array.isArray(source)) throw new Error('Invalid danmaku source');
  if (!sourceType || sourceType === 'nico-json') {
    sourceType = source.some(function (entry) { return entry && Array.isArray(entry.comments); }) ? 'nico-json-v1' : 'nico-json-legacy';
  }
  const comments = [], counts = new Map(), dateInfo = emptyDateInfo();
  let durationSec = null, ordinal = 0;
  function add(value) {
    const id = ordinal++;
    if (typeof value.text !== 'string' || value.text === '' || !Number.isSafeInteger(Math.round(value.vpos))) return;
    const commands = (Array.isArray(value.commands) ? value.commands : String(value.commands || '').split(/\s+/)).filter(function (c) { return typeof c === 'string' && c.length > 0; });
    if (value.isOwner && value.text[0] === '/' && commands.indexOf('invisible') === -1) commands.push('invisible');
    const dateSec = Number.isSafeInteger(Math.floor(value.dateSec)) && value.dateSec > 0 ? Math.floor(value.dateSec) : 0;
    const day = value.dated && dateSec > 0 ? Math.floor((dateSec + 32400) / 86400) : null;
    const comment = {
      id: id, vpos: Math.round(value.vpos), text: value.text, simplifiedText: null,
      pos: getCommentPosition(commands), commands: Object.freeze(commands), userId: String(value.userId == null ? '' : value.userId),
      no: Number(value.no) || 0, day: day, nicoru: Number(value.nicoru) || 0,
      isOwner: !!value.isOwner, isEasy: !!value.isEasy,
      dateSec: dateSec, dateUsec: Math.max(0, Math.min(999999, Math.floor(Number(value.dateUsec)) || 0)),
      premium: value.premium !== false, isMyPost: !!value.isMyPost,
      densityOrder: value.densityOrder > 0 ? value.densityOrder : null,
    };
    // Only the memoized conversion may change; all source fields are immutable.
    Object.keys(comment).forEach(function (key) { if (key !== 'simplifiedText') Object.defineProperty(comment, key, {writable: false}); });
    Object.seal(comment);
    comments.push(comment);
    if (value.dated && !comment.isOwner && !comment.isEasy) {
      dateInfo.totalCount++;
      if (day === null) dateInfo.undatedCount++;
      else counts.set(day, (counts.get(day) || 0) + 1);
    }
  }
  if (sourceType === 'nico-json-v1') {
    source.forEach(function (thread) {
      if (!thread || !Array.isArray(thread.comments)) return;
      if (durationSec === null && thread.fork === 'main' && Number.isFinite(thread.duration) && thread.duration > 0) durationSec = thread.duration;
      thread.comments.forEach(function (c) {
        if (!c || c.deleted === 1) return;
        add({vpos: typeof c.vposMs === 'number' ? Math.floor(c.vposMs / 10) : NaN, text: c.body,
          commands: c.commands, userId: c.userId, no: c.no, densityOrder: c.no, nicoru: c.nicoruCount,
          dateSec: postedAtSeconds(c.postedAt), dated: true, isOwner: thread.fork === 'owner', isEasy: thread.fork === 'easy',
          premium: !!c.isPremium, isMyPost: c.isMyPost});
      });
    });
  } else if (sourceType === 'nico-json-legacy') {
    source.forEach(function (entry) {
      const c = entry && entry.chat;
      if (!c || Array.isArray(c) || c.deleted === 1) return;
      add({vpos: c.vpos, text: c.content, commands: c.mail, userId: c.user_id, no: c.no, densityOrder: c.no,
        nicoru: c.nicoru, dateSec: Number(c.date), dateUsec: c.date_usec, dated: true, isOwner: !c.user_id, premium: c.premium === 1});
    });
  } else if (sourceType === 'dandanplay') {
    source.forEach(function (c) {
      if (!c) return;
      if (typeof c.p === 'string') {
        const p = c.p.split(','), time = Number(p[0]), mode = Number(p[1]), color = Number(p[2]);
        if (!p[0].trim() || !Number.isFinite(time) || !Number.isInteger(mode) || mode < 1 || mode > 6 || !Number.isFinite(color)) return;
        add({vpos: time * 100, text: c.m, commands: [mode === 4 ? 'shita' : mode === 5 ? 'ue' : 'naka', '#' + ((color >>> 0) & 0xFFFFFF).toString(16).padStart(6, '0')], userId: p[3], dateSec: 1767196800});
      } else if (c.vpos !== undefined && c.commands) {
        // Versioned IR disk cache. Revalidate once, at the read boundary.
        add(Object.assign({}, c));
      } else {
        // Read compatibility for existing DDP caches/exports.
        add({vpos: c.t, text: c.text, commands: c._commands, userId: c._userId, no: c._no, isOwner: c._isOwner, dateSec: c._dateSec || 1767196800});
      }
    });
  } else {
    const nico = sourceType === 'nico-xml';
    const re = nico
      ? /<!--[\s\S]*?-->|<chat\b((?:"[^"]*"|'[^']*'|[^'">])*)>((?:<!\[CDATA\[[\s\S]*?\]\]>|[\s\S])*?)<\/chat\s*>/g
      : /<!--[\s\S]*?-->|<d\b((?:"[^"]*"|'[^']*'|[^'">])*)>((?:<!\[CDATA\[[\s\S]*?\]\]>|[\s\S])*?)<\/d\s*>/g;
    let match;
    while ((match = re.exec(source)) !== null) {
      if (match[1] === undefined) continue;
      if (/\/\s*$/.test(match[1])) { re.lastIndex = match.index + (nico ? 6 : 3) + match[1].length; continue; }
      const attrs = Object.create(null), attrRe = /(?:^|\s)([\w:-]+)\s*=\s*(["'])([\s\S]*?)\2/g;
      let attr;
      while ((attr = attrRe.exec(match[1])) !== null) attrs[attr[1]] = decodeXmlText(attr[3]);
      if (attrs.deleted === '1') continue;
      const text = decodeXmlContent(match[2]);
      if (nico) {
        add({vpos: attrs.vpos && attrs.vpos.trim() ? Number(attrs.vpos) : NaN, text: text, commands: attrs.mail, userId: attrs.user_id,
          no: Number(attrs.no), densityOrder: Number(attrs.no), dateSec: Number(attrs.date), dateUsec: Number(attrs.date_usec), dated: true,
          nicoru: Number(attrs.nicoru), isOwner: attrs.fork === '1' || attrs.fork === 'owner', premium: attrs.premium === '1'});
      } else {
        const p = (attrs.p || '').split(','), time = Number(p[0]), mode = Number(p[1]), size = Number(p[2]);
        if (!p[0].trim() || !Number.isInteger(mode) || mode < 1 || mode > 6) continue;
        const commands = [mode === 4 ? 'shita' : mode === 5 ? 'ue' : 'naka'];
        if (size >= 36) commands.push('big'); else if (size > 0 && size <= 15) commands.push('small');
        const color = Number.isFinite(Number(p[3])) ? (Number(p[3]) >>> 0) & 0xFFFFFF : 0xFFFFFF;
        commands.push('#' + color.toString(16).padStart(6, '0'));
        add({vpos: time * 100, text: text, commands: commands, userId: p[6], no: Number(p[7]), densityOrder: Number(p[4]), dateSec: 1767196800});
      }
    }
  }
  dateInfo.dayCounts = Array.from(counts, function (entry) { return Object.freeze(entry); }).sort(function (a, b) { return a[0] - b[0]; });
  if (dateInfo.dayCounts.length) {
    dateInfo.firstDay = dateInfo.dayCounts[0][0];
    dateInfo.lastDay = dateInfo.dayCounts[dateInfo.dayCounts.length - 1][0];
  }
  Object.freeze(dateInfo.dayCounts);
  return Object.freeze({path: path || '', sourceType: sourceType, durationSec: durationSec, dateInfo: Object.freeze(dateInfo), comments: Object.freeze(comments)});
}

function selectDensity(comments, density) {
  if (!(density > 0)) return comments;
  density = Math.max(1, Math.floor(density));
  const windows = new Map(), keep = new Set();
  comments.forEach(function (c) {
    if (c.isOwner || c.isEasy || c.nicoru >= 3) { keep.add(c); return; }
    const win = Math.floor(c.vpos / 6000);
    if (!windows.has(win)) windows.set(win, []);
    windows.get(win).push(c);
  });
  windows.forEach(function (group) {
    if (group.length <= density) group.forEach(function (c) { keep.add(c); });
    else if (group.every(function (c) { return c.densityOrder !== null; })) {
      group.sort(function (a, b) { return b.densityOrder - a.densityOrder || a.id - b.id; });
      group.slice(0, density).forEach(function (c) { keep.add(c); });
    } else {
      for (let i = 0; i < density; i++) keep.add(group[Math.floor(i * group.length / density)]);
    }
  });
  return comments.filter(function (c) { return keep.has(c); });
}

// Shared static policy for the screen and list: greedy earliest host, inclusive
// window, same text AND position, owners excluded, blocked groups kept separate.
// Fixed comments use this same static policy rather than a second progressive UI.
function mergeProjectedComments(items, windowVpos) {
  if (!(windowVpos > 0)) return items;
  const hosts = new Map(), result = [];
  items.slice().sort(function (a, b) { return a.comment.vpos - b.comment.vpos || a.comment.id - b.comment.id; }).forEach(function (item) {
    const c = item.comment;
    let bucket = hosts.get(item.text);
    if (!bucket) { bucket = new Map(); hosts.set(item.text, bucket); }
    const key = c.pos + ':' + item.blocked;
    const host = !c.isOwner && bucket.get(key);
    if (host && c.vpos - host.comment.vpos <= windowVpos) host.count++;
    else {
      const next = Object.assign({}, item, {count: 1});
      result.push(next);
      if (!c.isOwner) bucket.set(key, next);
    }
  });
  return result;
}

function projectDanmaku(doc, settings) {
  settings = settings || {};
  const sliced = doc.comments.filter(function (c) {
    return c.isOwner || c.isEasy || c.day === null || settings.startDay == null || settings.endDay == null || (c.day >= settings.startDay && c.day <= settings.endDay);
  });
  const kept = selectDensity(sliced, settings.density);
  const items = kept.map(function (c) {
    let text = c.text;
    if (settings.forceSimplified && settings.simplify && !(c.isOwner && /^[/@＠]/.test(c.text))) {
      if (c.simplifiedText === null) c.simplifiedText = settings.simplify(c.text);
      text = c.simplifiedText;
    }
    return {comment: c, text: text, blocked: !c.isOwner && !!(settings.isBlocked && settings.isBlocked(text, c.pos)), count: 1};
  });
  const merged = mergeProjectedComments(items, settings.dedupeWindow);
  const users = new Map(), formatted = [], browserItems = [];
  const suffixColors = ['#ff8080', '#80d8ff', '#ffd580', '#b9f6a5', '#d5a6ff', '#ffb3da'];
  merged.forEach(function (item) {
    const c = item.comment, text = item.text + (item.count > 1 ? 'x' + item.count : '');
    browserItems.push({id: c.id, t: c.vpos, text: text, blocked: item.blocked, count: item.count, _fixed: c.pos !== 'naka', _owner: c.isOwner});
    if (item.blocked) return;
    if (!users.has(c.userId)) users.set(c.userId, users.size);
    formatted.push({id: c.id, no: c.no, vpos: c.vpos, content: text, date: c.dateSec, date_usec: c.dateUsec,
      owner: c.isOwner, premium: c.premium, mail: c.commands.slice(), user_id: users.get(c.userId), layer: -1, is_my_post: c.isMyPost,
      comboSuffix: item.count > 1 ? 'x' + item.count : undefined,
      comboSuffixColor: item.count > 1 ? suffixColors[c.id % suffixColors.length] : undefined});
  });
  browserItems.sort(function (a, b) { return a.t - b.t || a.id - b.id; });
  return {formatted: formatted, items: browserItems, totalCount: doc.comments.length, sourceTotalCount: sliced.length,
    filteredCount: kept.length, dateSlicedCount: sliced.length, densityKeptCount: kept.length};
}

module.exports = {parseDanmakuSource: parseDanmakuSource, projectDanmaku: projectDanmaku, emptyDateInfo: emptyDateInfo,
  getCommentPosition: getCommentPosition, decodeXmlText: decodeXmlText, mergeProjectedComments: mergeProjectedComments};
