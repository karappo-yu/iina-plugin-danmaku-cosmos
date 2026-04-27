/**
 * renderer.js — 弹幕创建与 DOM 渲染（对象池优化版）
 *
 * 将解析后的弹幕数据渲染为 DOM 元素，处理各种模式（滚动/固定/定位）的布局逻辑。
 * 引入了 DOM 对象池，大幅减少频繁 createElement 和 remove 带来的 GC 压力。
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

// ========== DOM 对象池 (DOM Pool) 优化 ==========
const danmakuPool = [];
const MAX_POOL_SIZE = 800; // 防止池子无限膨胀占用过多内存

/**
 * 从对象池中获取一个可用的弹幕 DOM 元素，如果池为空则创建新的。
 * 并且会重置该元素的所有遗留状态。
 */
function getDanmakuElement() {
  let el;
  if (danmakuPool.length > 0) {
    el = danmakuPool.pop();
  } else {
    el = document.createElement('div');
  }

  // 彻底清理上一轮使用的遗留状态
  el.className = 'dm-item';
  el.style.cssText = ''; // 清空所有内联样式及 CSS 变量
  el.innerHTML = '';
  if (el.dataset.size) delete el.dataset.size;
  el.onanimationend = null;

  return el;
}

/**
 * 回收弹幕 DOM 元素到对象池中
 */
function recycleDanmakuElement(el) {
  if (el.parentNode) {
    el.parentNode.removeChild(el);
  }
  el.onanimationend = null; // 取消事件监听
  
  if (danmakuPool.length < MAX_POOL_SIZE) {
    danmakuPool.push(el);
  }
}
// ===============================================

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
    // 注意：假设外部有 getSpeedMultiplier，这里正常调用
    const currentSpeedMult = typeof getSpeedMultiplier === 'function' ? getSpeedMultiplier(lastTime, d._isOwner) : 1;
    const adjustedDurMs = durMs / currentSpeedMult;
    const elapsedMs = (lastTime - d.t) * 10;
    const remainingMs = adjustedDurMs - elapsedMs;

    const rect = el.getBoundingClientRect();
    const currentX = rect.left;
    const elW = rect.width;

    el.style.animation = 'none';
    el.offsetHeight; // 强制重绘

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
  if (typeof resetLaneData === 'function') resetLaneData();
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
  // 假设外部有 isBanActive 函数
  if (typeof isBanActive === 'function' && isBanActive(d.t)) return;

  // 获取默认命令覆盖（假设外部有 getDefaultCommand 函数）
  const defCmd = typeof getDefaultCommand === 'function' ? getDefaultCommand(d.t) : {};
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
  const speedMult = typeof getSpeedMultiplier === 'function' ? getSpeedMultiplier(d.t, d._isOwner) : 1;
  const adjustedDurMs = durMs / speedMult;
  const videoTimeMs = d.t * 10;
  const elapsedMs = currentTime !== null ? (currentTime - d.t) * 10 : 0;

  if (elapsedMs >= adjustedDurMs || elapsedMs < 0) return;

  // 创建 DOM 元素（从对象池获取）
  const el = getDanmakuElement();

  // 文本内容处理
  let posX = null, posY = null;
  let displayText = d.text || '';
  // 所有弹幕：Tab 替换为全角空格×2
  displayText = displayText.replace(/\t/g, '\u2003');
  
  if (d._isFlash) {
    const processed = typeof preprocessFlashTextWithRuby === 'function' 
        ? preprocessFlashTextWithRuby(displayText) 
        : { hasRuby: false, html: displayText };
    if (processed.hasRuby) {
      el.innerHTML = processed.html;
    } else {
      el.textContent = typeof preprocessFlashText === 'function' ? preprocessFlashText(displayText) : displayText;
    }
  } else if (isPositioned) {
    const parsed = typeof parsePositionedContent === 'function' ? parsePositionedContent(displayText) : null;
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

  // 字号处理
  const isStandardSize = effectiveSize === 15 || effectiveSize === 25 || effectiveSize === 36;
  const sizeKey = typeof getSizeKey === 'function' ? getSizeKey(effectiveSize) : 'medium';
  const resolvedFs = isStandardSize && typeof resolveFontSize === 'function' ? resolveFontSize(effectiveSize, d._isFlash) : effectiveSize;
  const lineCount = (displayText.match(/\n/g) || []).length + 1;
  const isMultiLine = lineCount > 1;
  
  const effectiveFontScale = (d._layer === -1) ? fontScale : 1.0;
  let danmakuFs;
  // 假设外部有 NICO_LINE_HEIGHT 常量
  const lineHeight = (typeof NICO_LINE_HEIGHT !== 'undefined' && NICO_LINE_HEIGHT[sizeKey]) ? NICO_LINE_HEIGHT[sizeKey] : 1.2;

  if (isMultiLine && d?.patissier) {
    danmakuFs = (100 / (lineCount * lineHeight) * effectiveFontScale).toFixed(4) + 'vh';
  } else {
    danmakuFs = (resolvedFs / 27 * (100 / 15) * effectiveFontScale).toFixed(4) + 'vh';
  }
  el.style.fontSize = danmakuFs;
  el.style.lineHeight = lineHeight;

  // 字体族
  if (effectiveFont && typeof NICO_FONTS !== 'undefined' && NICO_FONTS[effectiveFont]) {
    el.classList.add(`dm-${effectiveFont}`);
    el.style.fontFamily = NICO_FONTS[effectiveFont];
  }

  // 描边
  if (d.strokeColor) {
    el.style.webkitTextStroke = (0.16 * effectiveFontScale).toFixed(3) + 'vh ' + d.strokeColor;
  } else if (d.c === '#000000' || d.c === 'black' || d.c === 'rgb(0,0,0)') {
    el.style.webkitTextStroke = (0.03 * effectiveFontScale).toFixed(3) + 'vh rgba(255,255,255,0.7)';
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

  // 先添加到 DOM 以获取正确的渲染宽度
  container.appendChild(el);

  // 固定弹幕：后半段降级优先级
  if ((isBottom || isTop) && !d.ender) {
    setTimeout(() => {
      // 检查元素是否还在DOM树中，防止定时器触发时已被回收
      if (el.parentNode) el.classList.add('priority-low');
    }, adjustedDurMs / 2);
  }

  // 通用的动画结束清理逻辑
  const handleAnimationEnd = (item) => {
    recycleDanmakuElement(el);
    activeDanmaku.delete(item);
  };

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

    el.onanimationend = () => handleAnimationEnd(item);
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

      const isReverse = isReverseScroll || (typeof isReverseActive === 'function' && isReverseActive(d.t, d._isOwner));
      if (isReverse) {
        el.style.setProperty('--start-x', `-100%`);
        el.style.setProperty('--end-x', `100vw`);
      } else {
        el.style.setProperty('--start-x', `100vw`);
        el.style.setProperty('--end-x', `-100%`);
      }

      if (d._layer >= 0 && d._textW === undefined) {
        d._textW = el.offsetWidth;
      }
      const textW = d._textW || el.offsetWidth;
      const winW = window.innerWidth;
      
      const maxAvailableLanes = Math.floor(typeof getMaxLanes === 'function' ? getMaxLanes() : 10);
      const lanesNeeded = Math.min(Math.ceil(lineCount), maxAvailableLanes);

      let lane = d._lane;
      let offsetLevel = (d._offsetLevel !== undefined) ? d._offsetLevel : 0;
      const isMemory = lane !== undefined && typeof getMaxLanes === 'function' && lane < getMaxLanes();

      if (isMemory) {
        if (blockForceLane && (d._forced ?? false)) {
          recycleDanmakuElement(el);
          return;
        }
      } else {
        // 分配轨道
        const result = typeof getFreeScrollLane === 'function' 
          ? getFreeScrollLane(textW, winW, adjustedDurMs, videoTimeMs, lanesNeeded, d._layer, d._isOwner)
          : null;

        if (result) {
          lane = result.lane;
          offsetLevel = result.offsetLevel;
          d._lane = lane;
          d._offsetLevel = offsetLevel;
          d._forced = result.forced;

          const speed = (winW + textW) / durMs;
          const tailEnterTime = videoTimeMs + (textW / speed) + 100;
          const tailReachOneThirdTime = videoTimeMs + (2 * winW / 3 + textW) / speed;
          if (typeof occupyLane === 'function') occupyLane(lane, offsetLevel, lanesNeeded, 'scroll', { tailEnterTime, tailReachOneThirdTime }, d._layer, d._isOwner);
        } else {
          lane = 0;
          offsetLevel = 0;
          d._lane = lane;
          d._offsetLevel = offsetLevel;
          d._forced = true;
        }
      }

      if (lane !== undefined && typeof getVisualPosition === 'function') {
        const pos = getVisualPosition(lane, offsetLevel, 'scroll');
        if (pos.top) el.style.top = pos.top;
      } else {
        el.style.top = '0';
      }

      if (d.full) {
        el.style.maxWidth = '100vw';
      }

      const item = { el, d, type: 'scroll' };
      activeDanmaku.add(item);
      el.onanimationend = () => handleAnimationEnd(item);
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
    el.onanimationend = () => handleAnimationEnd(item);
    return;
  }

  // ========== 单行弹幕（含轨道分配） ==========
  if (d._textW === undefined) d._textW = el.offsetWidth;
  const textW = d._textW;
  const winW = window.innerWidth;
  const lanesNeeded = Math.ceil(effectiveSize / 25);

  let lane = d._lane;
  let offsetLevel = (d._offsetLevel !== undefined) ? d._offsetLevel : 0;
  const isMemory = lane !== undefined && typeof getMaxLanes === 'function' && lane < getMaxLanes();

  if (isMemory) {
    if (blockForceLane && (d._forced ?? false)) {
      recycleDanmakuElement(el);
      return;
    }
  } else {
    let result = null;
    if (typeof getFreeScrollLane === 'function' && (isScroll || isReverseScroll)) {
      result = getFreeScrollLane(textW, winW, adjustedDurMs, videoTimeMs, lanesNeeded, d._layer, d._isOwner);
    } else if (typeof getFreeFixedLane === 'function' && isTop) {
      result = getFreeFixedLane('top', adjustedDurMs, videoTimeMs, lanesNeeded, d._layer, d._isOwner);
    } else if (typeof getFreeFixedLane === 'function' && isBottom) {
      result = getFreeFixedLane('bottom', adjustedDurMs, videoTimeMs, lanesNeeded, d._layer, d._isOwner);
    }

    if (!result) {
      recycleDanmakuElement(el);
      return;
    }
    if (blockForceLane && result.forced) {
      recycleDanmakuElement(el);
      return;
    }

    lane = result.lane;
    offsetLevel = result.offsetLevel;
    d._lane = lane;
    d._offsetLevel = offsetLevel;
    d._forced = result.forced;
  }

  // 更新轨道占用状态
  if (typeof occupyLane === 'function') {
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
  }

  // 视觉定位
  if (typeof getVisualPosition === 'function') {
    const pos = getVisualPosition(lane, offsetLevel, (isScroll || isReverseScroll) ? 'scroll' : isTop ? 'top' : 'bottom');
    if (pos.top) el.style.top = pos.top;
    if (pos.bottom) el.style.bottom = pos.bottom;
  }

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
  const isReverse = isReverseScroll || (typeof isReverseActive === 'function' && isReverseActive(d.t, d._isOwner));

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
  el.onanimationend = () => handleAnimationEnd(item);
};

/**
 * 清空所有活跃弹幕，并将它们归还给对象池
 */
window.clearAllDanmaku = function () {
  // 将所有活跃 DOM 元素回收到池中，而非简单粗暴清空 innerHTML
  activeDanmaku.forEach(item => {
    recycleDanmakuElement(item.el);
  });
  activeDanmaku.clear();
};