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
  if (text.indexOf('&') === -1) return text;
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function parseBilibiliXml(xmlStr) {
  // Primary: DOMParser (correctly handles CDATA, self-closing, entities)
  try {
    var parser = new DOMParser();
    var xmlDoc = parser.parseFromString(xmlStr, "text/xml");
    if (xmlDoc.getElementsByTagName('parsererror').length === 0) {
      var dElements = xmlDoc.getElementsByTagName('d');
      if (dElements.length > 0) {
        var list = [];
        for (var i = 0; i < dElements.length; i++) {
          var el = dElements[i];
          var pAttr = el.getAttribute('p');
          if (!pAttr) continue;
          var parts = pAttr.split(",");
          var mode = parseInt(parts[1], 10);
      if (mode < 1 || mode > 6) continue;
      var size = parseInt(parts[2], 10) || 25;
      var colorVal = parseInt(parts[3], 10);
          if (colorVal < 0) colorVal = (colorVal >>> 0) & 0xFFFFFF;
          var commands = parts[5] ? parts[5].toLowerCase().split(/\s+/) : [];
          if (mode === 4) commands.push('shita');
          else if (mode === 5) commands.push('ue');
          else commands.push('naka');
          if (size >= 36) commands.push('big');
          else if (size <= 15) commands.push('small');
          commands.push('#' + colorVal.toString(16).padStart(6, '0'));
          list.push({
            t: Math.round(parseFloat(parts[0]) * 100),
            text: el.textContent || '',
            _isOwner: false,
            _commands: commands,
            _userId: 0,
            _dateSec: 1767196800,
            _sortDate: parseInt(parts[6], 10) || 0
          });
        }
        list.sort(function(a, b) { return a._sortDate - b._sortDate; });
        for (var j = 0; j < list.length; j++) {
          list[j]._no = j + 1;
          delete list[j]._sortDate;
        }
        return list;
      }
    }
  } catch (e) {
    // fall through to regex
  }

  // Fallback: regex (for malformed XML that DOMParser can't handle)
  var list = [];
  var regex = /<d p="([^"]+)">([\s\S]*?)<\/d>/g;
  var match;
  while ((match = regex.exec(xmlStr)) !== null) {
    var p = match[1].split(",");
    var mode = parseInt(p[1], 10);
    if (mode < 1 || mode > 6) continue;
    var size = parseInt(p[2], 10) || 25;
    var colorVal = parseInt(p[3], 10);
    if (colorVal < 0) colorVal = (colorVal >>> 0) & 0xFFFFFF;
    var commands = p[5] ? p[5].toLowerCase().split(/\s+/) : [];
    if (mode === 4) commands.push('shita');
    else if (mode === 5) commands.push('ue');
    else commands.push('naka');
    if (size >= 36) commands.push('big');
    else if (size <= 15) commands.push('small');
    commands.push('#' + colorVal.toString(16).padStart(6, '0'));
    list.push({
      t: Math.round(parseFloat(p[0]) * 100),
      text: decodeXmlText(match[2]),
      _isOwner: false,
      _commands: commands,
      _userId: 0,
      _dateSec: 1767196800,
      _sortDate: parseInt(p[6], 10) || 0
    });
  }
  list.sort(function(a, b) { return a._sortDate - b._sortDate; });
  for (var j = 0; j < list.length; j++) {
    list[j]._no = j + 1;
    delete list[j]._sortDate;
  }
  return list;
}

function parseXmlDanmaku(xmlStr) {
  if (xmlStr.indexOf('<chat') === -1 && xmlStr.indexOf('<packet') === -1) {
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
