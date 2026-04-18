/**
 * renderer.js — 弹幕创建与 DOM 渲染
 *
 * 将解析后的弹幕数据渲染为 DOM 元素，处理各种模式（滚动/固定/定位）的布局逻辑。
 * 对应原项目: src/comments/*.ts
 */

const container = document.getElementById('danmaku-container');

// --- 渲染参数 ---
let scrollDuration = 4000;
let fixedDuration = 4000;
let fontScale = 1.0;
let danmakuVisible = true;
let blockForceLane = false;

/**
 * 设置渲染参数
 */
window.setRendererConfig = function (opts) {
  if (opts.scrollDuration !== undefined) scrollDuration = opts.scrollDuration;
  if (opts.fixedDuration !== undefined) fixedDuration = opts.fixedDuration;
  if (opts.fontScale !== undefined) fontScale = opts.fontScale;
  if (opts.danmakuVisible !== undefined) danmakuVisible = opts.danmakuVisible;
  if (opts.blockForceLane !== undefined) blockForceLane = opts.blockForceLane;
};

/**
 * 获取当前渲染参数
 */
window.getRendererConfig = function () {
  return { scrollDuration, fixedDuration, fontScale, danmakuVisible, blockForceLane };
};

/**
 * 获取容器引用
 */
window.getContainer = function () {
  return container;
};

// --- 活跃弹幕集合 ---
const activeDanmaku = new Set();

/**
 * 获取活跃弹幕集合
 */
window.getActiveDanmaku = function () {
  return activeDanmaku;
};

/**
 * 逆播放：反转所有活跃滚动弹幕的动画方向
 */
window.reverseAllActiveDanmaku = function (newReverseState, lastTime) {
  if (activeDanmaku.size === 0) return;

  const winW = window.innerWidth;

  activeDanmaku.forEach(item => {
    const el = item.el;
    const d = item.d;
    if (item.type !== 'scroll') return;
    const durMs = scrollDuration;
    const currentSpeedMult = getSpeedMultiplier(lastTime, d._isOwner);
    const adjustedDurMs = durMs / currentSpeedMult;
    const elapsedMs = (lastTime - d.t) * 10;
    const remainingMs = adjustedDurMs - elapsedMs;

    const rect = el.getBoundingClientRect();
    const currentX = rect.left;
    const elW = rect.width;

    el.style.animation = 'none';
    el.offsetHeight;

    if (newReverseState) {
      const mirroredX = winW - currentX;
      el.style.setProperty('--start-x', `${mirroredX}px`);
      el.style.setProperty('--end-x', `${winW + elW}px`);
    } else {
      const mirroredX = winW - currentX;
      el.style.setProperty('--start-x', `${mirroredX}px`);
      el.style.setProperty('--end-x', `${-elW}px`);
    }

    el.style.setProperty('--dur', `${remainingMs}ms`);
    el.style.setProperty('--delay', `0ms`);
    el.style.animation = '';
  });

  // 逆播放切换后需重置轨道
  resetLaneData();
};

/**
 * 创建并渲染一条弹幕
 *
 * @param {object} d - 弹幕数据对象
 * @param {number|null} currentTime - 当前视频时间（vpos），seek 时传入
 */
window.createDanmaku = function (d, currentTime = null) {
  if (!danmakuVisible) return;
  if (d.invisible) return;
  if (isBanActive(d.t)) return;

  // 获取默认命令覆盖
  const defCmd = getDefaultCommand(d.t);
  const effectiveMode = defCmd.loc || d.m;
  const effectiveColor = defCmd.color || d.c;
  const effectiveSize = defCmd.size || d.size;
  const effectiveFont = defCmd.font || d.font;

  // 弹幕类型判断
  const isScroll = effectiveMode >= 1 && effectiveMode <= 3;
  const isReverseScroll = effectiveMode === 6;
  const isBottom = effectiveMode === 4;
  const isTop = effectiveMode === 5;
  const isPositioned = effectiveMode === 7;

  // 类型屏蔽
  if ((isScroll || isReverseScroll) && window._blockScroll) return;
  if (isTop && window._blockTop) return;
  if (isBottom && window._blockBottom) return;

  // 持续时间
  const durMs = d.durationSec !== null && d.durationSec !== undefined
    ? d.durationSec * 1000
    : ((isScroll || isReverseScroll) ? scrollDuration : fixedDuration);
  const speedMult = getSpeedMultiplier(d.t, d._isOwner);
  const adjustedDurMs = durMs / speedMult;
  const videoTimeMs = d.t * 10;
  const elapsedMs = currentTime !== null ? (currentTime - d.t) * 10 : 0;

  if (elapsedMs >= adjustedDurMs || elapsedMs < 0) return;

  // 创建 DOM 元素
  const el = document.createElement('div');
  el.className = 'dm-item';

  // 文本内容处理
  let posX = null, posY = null;
  let displayText = d.text;
  // 所有弹幕：Tab 替换为全角空格×2（参考原项目 BaseComment 构造函数）
  displayText = displayText.replace(/\t/g, '\u2003');
  if (d._isFlash) {
    const processed = preprocessFlashTextWithRuby(displayText);
    if (processed.hasRuby) {
      el.innerHTML = processed.html;
    } else {
      el.textContent = preprocessFlashText(displayText);
    }
  } else if (isPositioned) {
    const parsed = parsePositionedContent(displayText);
    if (parsed) {
      posX = parsed.posX;
      posY = parsed.posY;
      el.textContent = parsed.text;
    } else {
      el.textContent = displayText;
    }
  } else {
    el.textContent = displayText;
  }

  // 颜色
  el.style.color = effectiveColor;
  el.dataset.size = effectiveSize;

  // 字号
  // 判断是否为标准字号（small=15, medium=25, big=36）
  const isStandardSize = effectiveSize === 15 || effectiveSize === 25 || effectiveSize === 36;
  const sizeKey = getSizeKey(effectiveSize);
  // 标准字号使用映射表，自定义字号直接使用传入值
  const resolvedFs = isStandardSize ? resolveFontSize(effectiveSize, d._isFlash) : effectiveSize;
  const lineCount = (d.text.match(/\n/g) || []).length + 1;
  const isMultiLine = lineCount > 1;
  // CA 弹幕 (layer >= 0) 不受全局 fontScale 缩放影响，保持原始比例
  // 参考 niconicomments: layer === -1 ? options.scale : 1
  const effectiveFontScale = (d._layer === -1) ? fontScale : 1.0;
  let danmakuFs;
  if (isMultiLine && d?.patissier) {
    danmakuFs = (100 / (lineCount * NICO_LINE_HEIGHT[sizeKey]) * effectiveFontScale).toFixed(4) + 'vh';
  } else {
    danmakuFs = (resolvedFs / 27 * (100 / 15) * effectiveFontScale).toFixed(4) + 'vh';
  }
  el.style.fontSize = danmakuFs;
  el.style.lineHeight = NICO_LINE_HEIGHT[sizeKey];

  // 字体族
  if (effectiveFont && NICO_FONTS[effectiveFont]) {
    el.classList.add(`dm-${effectiveFont}`);
    el.style.fontFamily = NICO_FONTS[effectiveFont];
  }

  // 描边
  if (d.strokeColor) {
    el.style.webkitTextStroke = `0.16vw ${d.strokeColor}`;
  } else if (d.c === '#000000' || d.c === 'black' || d.c === 'rgb(0,0,0)') {
    el.style.webkitTextStroke = '0.03vw rgba(255,255,255,0.7)';
  }

  // 边框/填充/透明度
  if (d.wakuColor) el.style.border = `1px solid ${d.wakuColor}`;
  if (d.fillColor) el.style.backgroundColor = d.fillColor;
  if (d.dmOpacity !== null && d.dmOpacity !== undefined) {
    el.style.setProperty('--dm-opacity', d.dmOpacity);
    el.classList.add('dm-custom-opacity');
  }

  // CSS 类标记
  if (d.live) el.classList.add('dm-live');
  if (d.full) el.classList.add('dm-full');
  if (d.ender) el.classList.add('dm-ender');
  if (d._isFlash) el.classList.add('dm-flash');

  if (isScroll || isReverseScroll) el.classList.add('dm-scroll');
  else if (isBottom) el.classList.add('dm-bottom');
  else if (isTop) el.classList.add('dm-top');
  else if (isPositioned) el.classList.add('dm-positioned');

  container.appendChild(el);

  // 固定弹幕：后半段降级优先级
  if ((isBottom || isTop) && !d.ender) {
    setTimeout(() => el.classList.add('priority-low'), adjustedDurMs / 2);
  }

  // ========== 定位弹幕 ==========
  if (isPositioned) {
    if (d._textW === undefined) d._textW = el.offsetWidth;
    const textW = d._textW;
    const winW = window.innerWidth;
    const maxW = d.full ? winW : winW * 0.95;
    if (textW > maxW) {
      el.style.transform = `translateX(-50%) scaleX(${maxW / textW})`;
    } else {
      el.style.transform = `translateX(-50%)`;
    }

    el.style.setProperty('--dur', `${adjustedDurMs}ms`);
    el.style.setProperty('--delay', `-${elapsedMs}ms`);

    if (posX !== null && posY !== null) {
      el.style.left = `${posX * 100}%`;
      el.style.top = `${posY * 100}%`;
    } else {
      el.style.left = '50%';
      el.style.top = '50%';
    }

    const item = { el, d, type: 'fixed' };
    activeDanmaku.add(item);

    el.addEventListener('animationend', () => {
      el.remove();
      activeDanmaku.delete(item);
    });
    return;
  }

  // ========== 多行弹幕 ==========
  if (isMultiLine) {
    // 多行弹幕需要启用换行
    el.style.whiteSpace = 'pre';

    if (isScroll || isReverseScroll) {
      el.classList.add('dm-scroll');
      el.style.setProperty('--dur', `${adjustedDurMs}ms`);
      el.style.setProperty('--delay', `-${elapsedMs}ms`);

      const isReverse = isReverseScroll || isReverseActive(d.t, d._isOwner);
      if (isReverse) {
        el.style.setProperty('--start-x', `-100%`);
        el.style.setProperty('--end-x', `100vw`);
      } else {
        el.style.setProperty('--start-x', `100vw`);
        el.style.setProperty('--end-x', `-100%`);
      }

      // CA 多行滚动弹幕 (layer >= 0) 也需要轨道分配
      // 非 CA 多行弹幕直接放在顶部
      if (d._layer >= 0 && d._textW === undefined) {
        d._textW = el.offsetWidth;
      }
      const textW = d._textW || el.offsetWidth;
      const winW = window.innerWidth;
      // CA 多行弹幕的轨道需求：按行数计算，但不超过可用轨道数
      const maxAvailableLanes = Math.floor(getMaxLanes());
      const lanesNeeded = Math.min(Math.ceil(lineCount), maxAvailableLanes);

      let lane = d._lane;
      let offsetLevel = (d._offsetLevel !== undefined) ? d._offsetLevel : 0;
      const isMemory = lane !== undefined && lane < getMaxLanes();

      if (isMemory) {
        if (blockForceLane && (d._forced ?? false)) {
          el.remove();
          return;
        }
      } else {
        // CA 弹幕使用碰撞检测分配轨道
        const result = getFreeScrollLane(textW, winW, adjustedDurMs, videoTimeMs, lanesNeeded, d._layer, d._isOwner);
        if (result) {
          lane = result.lane;
          offsetLevel = result.offsetLevel;
          d._lane = lane;
          d._offsetLevel = offsetLevel;
          d._forced = result.forced;

          // 更新轨道占用
          const speed = (winW + textW) / durMs;
          const tailEnterTime = videoTimeMs + (textW / speed) + 100;
          const tailReachOneThirdTime = videoTimeMs + (2 * winW / 3 + textW) / speed;
          occupyLane(lane, offsetLevel, lanesNeeded, 'scroll', { tailEnterTime, tailReachOneThirdTime }, d._layer, d._isOwner);
        } else {
          // CA 弹幕强制放置在 lane 0（因为不同 layer 不碰撞）
          lane = 0;
          offsetLevel = 0;
          d._lane = lane;
          d._offsetLevel = offsetLevel;
          d._forced = true;
        }
      }

      if (lane !== undefined) {
        const pos = getVisualPosition(lane, offsetLevel, 'scroll');
        if (pos.top) el.style.top = pos.top;
      } else {
        el.style.top = '0';
      }

      // 全屏弹幕允许使用全屏宽度
      if (d.full) {
        el.style.maxWidth = '100vw';
      }

      const item = { el, d, type: 'scroll' };
      activeDanmaku.add(item);

      el.addEventListener('animationend', () => {
        el.remove();
        activeDanmaku.delete(item);
      });
      return;
    }

    el.style.left = '50%';
    el.style.transform = 'translateX(-50%)';
    if (isBottom) {
      el.style.bottom = '0';
    } else {
      el.style.top = '0';
    }
    el.style.setProperty('--dur', `${adjustedDurMs}ms`);
    el.style.setProperty('--delay', `-${elapsedMs}ms`);

    const item = { el, d, type: 'fixed' };
    activeDanmaku.add(item);

    el.addEventListener('animationend', () => {
      el.remove();
      activeDanmaku.delete(item);
    });
    return;
  }

  // ========== 单行弹幕（含轨道分配） ==========
  if (d._textW === undefined) d._textW = el.offsetWidth;
  const textW = d._textW;
  const winW = window.innerWidth;
  const lanesNeeded = Math.ceil(effectiveSize / 25);

  // 轨道分配
  let lane = d._lane;
  let offsetLevel = (d._offsetLevel !== undefined) ? d._offsetLevel : 0;
  const isMemory = lane !== undefined && lane < getMaxLanes();

  if (isMemory) {
    if (blockForceLane && (d._forced ?? false)) {
      el.remove();
      return;
    }
  } else {
    let result = null;
    if (isScroll || isReverseScroll) {
      result = getFreeScrollLane(textW, winW, adjustedDurMs, videoTimeMs, lanesNeeded, d._layer, d._isOwner);
    } else if (isTop) {
      result = getFreeFixedLane('top', adjustedDurMs, videoTimeMs, lanesNeeded, d._layer, d._isOwner);
    } else if (isBottom) {
      result = getFreeFixedLane('bottom', adjustedDurMs, videoTimeMs, lanesNeeded, d._layer, d._isOwner);
    }

    if (!result) {
      el.remove();
      return;
    }
    if (blockForceLane && result.forced) {
      el.remove();
      return;
    }

    lane = result.lane;
    offsetLevel = result.offsetLevel;
    d._lane = lane;
    d._offsetLevel = offsetLevel;
    d._forced = result.forced;
  }

  // 更新轨道占用状态
  if (isScroll || isReverseScroll) {
    const speed = (winW + textW) / durMs;
    const tailEnterTime = videoTimeMs + (textW / speed) + 100;
    const tailReachOneThirdTime = videoTimeMs + (2 * winW / 3 + textW) / speed;
    occupyLane(lane, offsetLevel, lanesNeeded, 'scroll', { tailEnterTime, tailReachOneThirdTime }, d._layer, d._isOwner);
  } else if (isTop) {
    const leaveScreenTime = videoTimeMs + durMs;
    occupyLane(lane, offsetLevel, lanesNeeded, 'top', { leaveScreenTime }, d._layer, d._isOwner);
  } else if (isBottom) {
    const leaveScreenTime = videoTimeMs + durMs;
    occupyLane(lane, offsetLevel, lanesNeeded, 'bottom', { leaveScreenTime }, d._layer, d._isOwner);
  }

  // 视觉定位
  const pos = getVisualPosition(lane, offsetLevel, (isScroll || isReverseScroll) ? 'scroll' : isTop ? 'top' : 'bottom');
  if (pos.top) el.style.top = pos.top;
  if (pos.bottom) el.style.bottom = pos.bottom;

  // 固定弹幕：宽度限制
  if ((isTop || isBottom) && d._textW !== undefined) {
    const maxW = window.innerWidth * 0.95;
    if (d._textW > maxW) {
      el.style.transform = `translateX(-50%) scaleX(${maxW / d._textW})`;
    } else {
      el.style.transform = `translateX(-50%)`;
    }
  }

  el.style.setProperty('--dur', `${adjustedDurMs}ms`);
  el.style.setProperty('--delay', `-${elapsedMs}ms`);

  // 滚动方向
  const isReverse = isReverseScroll || isReverseActive(d.t, d._isOwner);

  if (isScroll || isReverseScroll) {
    if (isReverse) {
      el.style.setProperty('--start-x', `-100%`);
      el.style.setProperty('--end-x', `100vw`);
    } else {
      el.style.setProperty('--start-x', `100vw`);
      el.style.setProperty('--end-x', `-100%`);
    }
  } else {
    const maxW = d.full ? winW : winW * 0.95;
    if (textW > maxW) {
      el.style.transform = `translateX(-50%) scaleX(${maxW / textW})`;
    } else {
      el.style.transform = `translateX(-50%)`;
    }
  }

  const item = { el, d, type: (isScroll || isReverseScroll) ? 'scroll' : 'fixed' };
  activeDanmaku.add(item);

  el.addEventListener('animationend', () => {
    el.remove();
    activeDanmaku.delete(item);
  });
};

/**
 * 清空所有活跃弹幕
 */
window.clearAllDanmaku = function () {
  container.innerHTML = '';
  activeDanmaku.clear();
};
