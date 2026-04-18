/**
 * command.js — 弹幕命令（mail/commands）解析
 *
 * 将 Nico/Bilibili 的 mail 字符串或 commands 数组解析为结构化属性。
 * 对应原项目: src/utils/comment.ts (parseCommand / parseCommands)
 */

/**
 * 根据 size 数值返回大小 key（small / medium / big）
 */
window.getSizeKey = function (size) {
  if (size >= 36) return 'big';
  if (size <= 15) return 'small';
  return 'medium';
};

/**
 * 判断是否为 Flash 弹幕
 * - 2017/7/12 之前的弹幕视为 Flash
 * - 含 nico:flash 命令的也视为 Flash
 */
window.isFlashDanmaku = function (dateSec, commands) {
  if (dateSec > 0 && dateSec < FLASH_THRESHOLD) return true;
  for (const cmd of commands) {
    if (cmd.toLowerCase() === 'nico:flash') return true;
  }
  return false;
};

/**
 * 解析字号（px），根据 size key 和 Flash/HTML5 模式
 */
window.resolveFontSize = function (size, isFlash) {
  const sizeKey = getSizeKey(size);
  const mode = isFlash ? 'flash' : 'html5';
  return NICO_FONT_SIZE[mode][sizeKey];
};

/**
 * 解析颜色值：支持颜色名和 #hex 格式
 */
window.resolveColor = function (val) {
  if (!val) return null;
  const lower = val.toLowerCase();
  if (NICO_COLORS[lower]) return NICO_COLORS[lower];
  if (/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(val)) return val.toUpperCase();
  return null;
};

/**
 * 解析 mail / commands 数组，返回结构化弹幕属性
 *
 * @param {string[]} commands - 命令数组（如 ["naka", "big", "#ff0000"]）
 * @param {boolean} isPremium - 是否为付费用户（影响 hex 颜色解析）
 * @returns {{ mode, size, color, font, invisible, live, full, ender, patissier, durationSec, strokeColor, wakuColor, fillColor, opacity }}
 */
window.parseMailCommands = function (commands, isPremium = true) {
  let mode = 1;
  let size = 25;
  let color = '#FFFFFF';
  let colorSet = false;
  let locSet = false;
  let font = null;
  let invisible = false;
  let live = false;
  let full = false;
  let ender = false;
  let patissier = false;
  let durationSec = null;
  let strokeColor = null;
  let wakuColor = null;
  let fillColor = null;
  let opacity = null;

  for (const raw of commands) {
    const c = raw.toLowerCase();

    // 位置
    if (!locSet) {
      if (c === 'naka') { mode = 1; locSet = true; continue; }
      if (c === 'shita') { mode = 4; locSet = true; continue; }
      if (c === 'ue') { mode = 5; locSet = true; continue; }
    }

    // 字号关键字
    if (c === 'big' && size === 25) { size = 36; continue; }
    if (c === 'small' && size === 25) { size = 15; continue; }

    // smal@数字 / big@数字 / medium@数字 格式：字号关键字带参数
    // smal 是 small 的缩写，@后面的数字是具体字号
    const sizeParamMatch = /^(smal|small|big|medium)@([0-9]+)$/i.exec(c);
    if (sizeParamMatch) {
      const customSize = parseInt(sizeParamMatch[2], 10);
      if (customSize >= 1 && customSize <= 200) size = customSize;
      continue;
    }

    // 字体
    if (!font && (c === 'gothic' || c === 'mincho' || c === 'gulim' || c === 'simsun')) {
      font = c; continue;
    }

    // 开关类命令
    if (c === 'invisible') { invisible = true; continue; }
    if (c === '_live') { live = true; continue; }
    if (c === 'full') { full = true; continue; }
    if (c === 'ender') { ender = true; continue; }
    if (c === 'patissier') { patissier = true; continue; }

    // nico: 扩展命令（描边/边框/填充/透明度）
    if (c.startsWith('nico:stroke:') && !strokeColor) {
      strokeColor = resolveColor(raw.slice(12)); continue;
    }
    if (c.startsWith('nico:waku:') && !wakuColor) {
      wakuColor = resolveColor(raw.slice(10)); continue;
    }
    if (c.startsWith('nico:fill:') && !fillColor) {
      fillColor = resolveColor(raw.slice(10)); continue;
    }
    if (c.startsWith('nico:opacity:') && opacity === null) {
      const v = parseFloat(c.slice(13));
      if (!isNaN(v) && v >= 0 && v <= 1) opacity = v;
      continue;
    }

    // 颜色（颜色名或 #hex）
    if (!colorSet) {
      if (NICO_COLORS[c]) { color = NICO_COLORS[c]; colorSet = true; }
      else if (isPremium && raw.startsWith('#') && (raw.length === 7 || raw.length === 4)) {
        color = raw; colorSet = true;
      }
    }
  }

  return { mode, size, color, font, invisible, live, full, ender, patissier, durationSec, strokeColor, wakuColor, fillColor, opacity };
};

/**
 * 判断是否为 Nicoscript（以 @ 或全角＠开头的投稿者命令）
 */
window.isNicoscript = function (content) {
  return /^[@\uff20]\S+/.test(content);
};

/**
 * 解析定位弹幕内容（如 "0.5x0.3 文字"）
 */
window.parsePositionedContent = function (text) {
  const match = /^([\d.]+)x([\d.]+)/.exec(text);
  if (!match) return null;
  const posX = parseFloat(match[1]);
  const posY = parseFloat(match[2]);
  if (isNaN(posX) || isNaN(posY) || posX < 0 || posX > 1 || posY < 0 || posY > 1) return null;
  const rest = text.slice(match[0].length).replace(/^\s+/, '');
  return { posX, posY, text: rest || '' };
};
