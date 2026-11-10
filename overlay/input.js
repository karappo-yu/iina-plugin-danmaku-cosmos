function parseNicoXml(chats) {
  const list = [];
  for (let i = 0; i < chats.length; i++) {
    const el = chats[i];
    const text = el.textContent;
    if (!text) continue;
    list.push({
      t: parseInt(el.getAttribute('vpos') || "0", 10),
      text: text,
      _isOwner: false,
      _commands: (el.getAttribute('mail') || '').toLowerCase().split(/\s+/).filter(Boolean),
      _userId: el.getAttribute('user_id') || '',
      _dateSec: parseInt(el.getAttribute('date') || "0", 10),
      _no: parseInt(el.getAttribute('no') || "0", 10)
    });
  }
  return list;
}

function decodeXmlText(text) {
  let entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
  if (text.indexOf('&') === -1) return text;
  return text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, function (entity, key) {
    if (key.charAt(0) !== '#') return entities[key] === undefined ? entity : entities[key];
    let code = key.charAt(1).toLowerCase() === 'x' ? parseInt(key.slice(2), 16) : Number(key.slice(1));
    return code > 0 && code <= 0x10FFFF && !(code >= 0xD800 && code <= 0xDFFF) ? String.fromCodePoint(code) : entity;
  });
}

function decodeXmlContent(content) {
  // CDATA stays literal; ordinary text is decoded exactly once, like DOMParser.
  return content.replace(/\r\n?/g, '\n').split(/(<!\[CDATA\[[\s\S]*?\]\]>|<!--[\s\S]*?-->)/g).map(function (part) {
    if (part.indexOf('<!--') === 0) return '';
    return part.indexOf('<![CDATA[') === 0 ? part.slice(9, -3) : decodeXmlText(part);
  }).join('');
}

function buildBilibiliComment(pAttr, text) {
  if (!pAttr || !text) return null;
  let parts = pAttr.split(',');
  let mode = Number(parts[1]);
  let time = Number(parts[0]);
  if (!parts[0].trim() || !isFinite(time) || !Number.isInteger(mode) || mode < 1 || mode > 6) return null;
  let size = parseInt(parts[2], 10) || 25;
  let color = parseInt(parts[3], 10);
  if (!isFinite(color)) color = 0xFFFFFF;
  color = (color >>> 0) & 0xFFFFFF;
  let commands = [mode === 4 ? 'shita' : mode === 5 ? 'ue' : 'naka'];
  if (size >= 36) commands.push('big');
  else if (size <= 15) commands.push('small');
  commands.push('#' + color.toString(16).padStart(6, '0'));
  return { t: Math.round(time * 100), text: text, _isOwner: false,
    _commands: commands, _userId: parts[6] || '', _dateSec: 1767196800 };
}

function parseBilibiliXml(xmlStr) {
  let list = [];
  let add = function (p, text) {
    let comment = buildBilibiliComment(p, text);
    if (!comment) return;
    comment._no = list.length + 1;
    list.push(comment);
  };
  try {
    let xmlDoc = new DOMParser().parseFromString(xmlStr, 'text/xml');
    if (xmlDoc.getElementsByTagName('parsererror').length === 0) {
      let elements = xmlDoc.getElementsByTagName('d');
      for (let i = 0; i < elements.length; i++) add(elements[i].getAttribute('p'), elements[i].textContent);
      return list;
    }
  } catch (e) {}

  // Malformed exports still use the same field validation as the DOM path.
  let re = /<!--[\s\S]*?-->|<d\b((?:"[^"]*"|'[^']*'|[^'">])*)>((?:<!\[CDATA\[[\s\S]*?\]\]>|[\s\S])*?)<\/d\s*>/g;
  let match;
  while ((match = re.exec(xmlStr)) !== null) {
    if (match[1] === undefined) continue;
    if (/\/\s*$/.test(match[1])) { re.lastIndex = match.index + 3 + match[1].length; continue; }
    let attrs = /(?:^|\s)([\w:-]+)\s*=\s*(["'])([\s\S]*?)\2/g;
    let attr;
    while ((attr = attrs.exec(match[1])) !== null) {
      if (attr[1] === 'p') { add(decodeXmlText(attr[3]), decodeXmlContent(match[2])); break; }
    }
  }
  return list;
}

function parseXmlDanmaku(xmlStr) {
  if (!/<(?:chat|packet)\b/.test(xmlStr)) {
    return parseBilibiliXml(xmlStr);
  }
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(xmlStr, "text/xml");
  const chats = xmlDoc.getElementsByTagName('chat');
  if (chats.length > 0) return parseNicoXml(chats);
  return parseBilibiliXml(xmlStr);
}

window.parseDanmaku = function (input, alreadyDecoded) {
  return parseXmlDanmaku(alreadyDecoded ? input : decodeURIComponent(input));
};
