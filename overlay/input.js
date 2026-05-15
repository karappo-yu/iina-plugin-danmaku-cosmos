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
    const mode = parseInt(p[1]);
    const size = parseInt(p[2]) || 25;
    let colorVal = parseInt(p[3]);
    if (colorVal < 0) colorVal = (colorVal >>> 0) & 0xFFFFFF;
    const commands = p[5] ? p[5].toLowerCase().split(/\s+/) : [];
    if (mode === 4) commands.push('shita');
    else if (mode === 5) commands.push('ue');
    else commands.push('naka');
    if (size >= 36) commands.push('big');
    else if (size <= 15) commands.push('small');
    commands.push('#' + colorVal.toString(16).padStart(6, '0'));
    list.push({
      t: Math.round(parseFloat(p[0]) * 100),
      text: match[2].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/<\/d/, ''),
      _isOwner: false,
      _commands: commands,
      _userId: 0,
      _dateSec: 2000000000
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
  return parseXmlDanmaku(decodeURIComponent(encodedStr));
};
