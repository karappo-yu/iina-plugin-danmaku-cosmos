function parseJsonDanmaku(jsonData) {
  const list = [];
  for (const thread of jsonData) {
    const isOwner = thread.fork === 'owner';
    for (const comment of thread.comments) {
      if (!comment.body) continue;
      list.push({
        t: comment.vposMs / 10,
        text: comment.body,
        _isOwner: isOwner,
        _commands: comment.commands || [],
        _userId: comment.userId || 0,
        _dateSec: comment.dateSec || 0
      });
    }
  }
  return list;
}

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
      _dateSec: parseInt(el.getAttribute('date') || "0", 10)
    });
  }
  return list;
}

function parseBilibiliXml(xmlStr) {
  const list = [];
  const regex = /<d p="([^"]+)">([\s\S]*?)<\/d>/g;
  let match;
  while ((match = regex.exec(xmlStr)) !== null) {
    let p = match[1].split(",");
    list.push({
      t: Math.round(parseFloat(p[0]) * 100),
      text: match[2].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/<\/d/, ''),
      _isOwner: false,
      _commands: p[5] ? p[5].toLowerCase().split(/\s+/) : [],
      _userId: 0,
      _dateSec: 0
    });
  }
  return list;
}

function parseXmlDanmaku(xmlStr) {
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(xmlStr, "text/xml");
  const chats = xmlDoc.getElementsByTagName('chat');
  if (chats.length > 0) return parseNicoXml(chats);
  return parseBilibiliXml(xmlStr);
}

window.parseDanmaku = function (encodedStr) {
  const raw = decodeURIComponent(encodedStr);
  const tryJson = encodedStr.startsWith('%5b') || encodedStr.startsWith('%5B') || encodedStr.startsWith('[');
  if (tryJson) {
    try { return parseJsonDanmaku(JSON.parse(raw)); }
    catch (e) { console.warn('JSON parse failed, falling back to XML:', e); }
  }
  return parseXmlDanmaku(raw);
};
