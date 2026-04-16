/**
 * input.js — 弹幕数据解析
 *
 * 支持 Nico V1 JSON、Nico XML、Bilibili XML 三种格式的弹幕数据解析。
 * 对应原项目: src/input/*.ts
 */

/**
 * 解析 Nico V1 JSON 格式弹幕
 *
 * 数据结构: [{ fork, comments: [{ body, commands, vposMs, isPremium, userId, ... }] }]
 *
 * @param {Array} jsonData - V1 API 返回的线程数组
 * @returns {Array} 解析后的弹幕列表
 */
function parseJsonDanmaku(jsonData) {
  const list = [];

  for (const thread of jsonData) {
    const isOwner = thread.fork === 'owner';
    for (const comment of thread.comments) {
      if (!comment.body) continue;

      const vpos = comment.vposMs / 10;
      const commands = comment.commands || [];
      const content = comment.body;
      const mc = parseMailCommands(commands, comment.isPremium);
      const isFlash = isFlashDanmaku(0, commands);
      const displayText = isFlash ? preprocessFlashText(content) : content;

      // 投稿者弹幕：处理 Nicoscript
      if (isOwner) {
        processReverseScript(vpos, content, commands);
        processSpeedScript(vpos, content, commands);
        processBanScript(vpos, content, commands);
        processSeekDisableScript(vpos, content, commands);
        processJumpScript(vpos, content, commands);
        processReplaceScript(vpos, content, commands, mc);
      }

      const nicoscriptInvisible = isOwner && isNicoscript(content);

      if (isOwner) {
        processDefaultScript(vpos, content, commands, mc);
      }

      const item = {
        t: vpos,
        m: mc.mode,
        c: mc.color,
        text: displayText,
        size: mc.size,
        _isOwner: isOwner,
        _isFlash: isFlash,
        _userId: comment.userId || 0,
        _dateSec: comment.dateSec || 0,
        _commands: commands,
        _layer: -1,  // 默认层，CA 分层后由 assignCALayers 修改
        font: mc.font,
        invisible: mc.invisible || nicoscriptInvisible,
        live: mc.live,
        full: mc.full,
        ender: mc.ender,
        patissier: mc.patissier,
        durationSec: mc.durationSec,
        strokeColor: mc.strokeColor,
        wakuColor: mc.wakuColor,
        fillColor: mc.fillColor,
        dmOpacity: mc.opacity
      };
      applyReplaceScripts(vpos, item);
      list.push(item);
    }
  }

  return list;
}

/**
 * 解析 Nico XML（<chat> 标签）
 */
function parseNicoXml(chats) {
  const list = [];

  for (let i = 0; i < chats.length; i++) {
    const el = chats[i];
    const text = el.textContent;
    if (!text) continue;

    const vpos = parseInt(el.getAttribute('vpos') || "0", 10);
    const mail = el.getAttribute('mail') || "";
    const commands = mail.toLowerCase().split(/\s+/);
    const isOwner = false;
    const isNicoscriptCmd = isNicoscript(text);
    const userId = el.getAttribute('user_id') || '';
    const dateSec = parseInt(el.getAttribute('date') || "0", 10);
    const isPremium = el.getAttribute('premium') === "1";
    const mc = parseMailCommands(commands, isPremium);
    const isFlash = isFlashDanmaku(dateSec, commands);
    const displayText = isFlash ? preprocessFlashText(text) : text;

    if (isNicoscriptCmd) {
      processReverseScript(vpos, text, commands);
      processSpeedScript(vpos, text, commands);
      processBanScript(vpos, text, commands);
      processSeekDisableScript(vpos, text, commands);
      processJumpScript(vpos, text, commands);
      processReplaceScript(vpos, text, commands, mc);
    }

    const nicoscriptInvisible = isNicoscriptCmd;

    if (isNicoscriptCmd) {
      processDefaultScript(vpos, text, commands, mc);
    }

    const item = {
      t: vpos,
      m: mc.mode,
      c: mc.color,
      text: displayText,
      size: mc.size,
      _isOwner: isOwner,
      _isFlash: isFlash,
      _userId: userId || 0,
      _dateSec: dateSec || 0,
      _commands: commands,
      _layer: -1,  // 默认层，CA 分层后由 assignCALayers 修改
      font: mc.font,
      invisible: mc.invisible || nicoscriptInvisible,
      live: mc.live,
      full: mc.full,
      ender: mc.ender,
      patissier: mc.patissier,
      durationSec: mc.durationSec,
      strokeColor: mc.strokeColor,
      wakuColor: mc.wakuColor,
      fillColor: mc.fillColor,
      dmOpacity: mc.opacity
    };
    applyReplaceScripts(vpos, item);
    list.push(item);
  }

  return list;
}

/**
 * 解析 Bilibili XML（<d p="..."> 标签）
 */
function parseBilibiliXml(xmlStr) {
  const list = [];
  const regex = /<d p="([^"]+)">([\s\S]*?)<\/d>/g;
  let match;

  while ((match = regex.exec(xmlStr)) !== null) {
    let p = match[1].split(",");
    let colorVal = parseInt(p[3]);
    if (colorVal < 0) colorVal = (colorVal >>> 0) & 0xFFFFFF;
    let danmakuSize = parseInt(p[2]) || 25;
    const vpos = Math.round(parseFloat(p[0]) * 100);
    const text = match[2].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/<\/d/, '');
    const commands = p[5] ? p[5].toLowerCase().split(/\s+/) : [];
    processSpeedScript(vpos, text, commands);
    const mc = parseMailCommands(commands);

    const item = {
      t: vpos,
      m: parseInt(p[1]),
      c: "#" + colorVal.toString(16).padStart(6, '0'),
      text: text,
      size: danmakuSize,
      _isOwner: true,
      _isFlash: false,
      _userId: 0,
      _dateSec: 0,
      _commands: commands,
      _layer: -1,  // 默认层
      font: mc.font,
      invisible: mc.invisible,
      live: mc.live,
      full: mc.full,
      ender: mc.ender,
      patissier: mc.patissier,
      durationSec: mc.durationSec,
      strokeColor: mc.strokeColor,
      wakuColor: mc.wakuColor,
      fillColor: mc.fillColor,
      dmOpacity: mc.opacity
    };
    applyReplaceScripts(vpos, item);
    list.push(item);
  }

  return list;
}

/**
 * 解析 XML 格式弹幕（自动区分 Nico XML 和 Bilibili XML）
 */
function parseXmlDanmaku(xmlStr) {
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(xmlStr, "text/xml");
  const chats = xmlDoc.getElementsByTagName('chat');

  // Nico XML 格式（<chat> 标签）
  if (chats.length > 0) {
    return parseNicoXml(chats);
  }

  // Bilibili XML 格式（<d> 标签）
  return parseBilibiliXml(xmlStr);
}

/**
 * 统一入口：根据编码数据自动检测格式并解析
 *
 * @param {string} encodedStr - 十六进制编码的弹幕数据
 * @returns {Array} 解析后的弹幕列表
 */
window.parseDanmaku = function (encodedStr) {
  const xmlStr = decodeURIComponent(encodedStr);
  const tryJson = encodedStr.startsWith('%5b') || encodedStr.startsWith('%5B') || encodedStr.startsWith('[');

  if (tryJson) {
    try {
      const jsonData = JSON.parse(decodeURIComponent(encodedStr));
      return parseJsonDanmaku(jsonData);
    } catch (e) {
      console.warn('JSON parse failed, falling back to XML:', e);
      return parseXmlDanmaku(xmlStr);
    }
  }

  return parseXmlDanmaku(xmlStr);
};
