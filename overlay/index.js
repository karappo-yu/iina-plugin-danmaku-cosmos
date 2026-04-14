const container = document.getElementById('danmaku-container');

// --- 引擎状态 ---
let allDanmaku = [];
let activeDanmaku = new Set();
let currentIndex = 0;
let lastTime = 0;
let isPaused = false;

// --- 动态参数 ---
let danmakuVisible = true;
let currentOpacity = 0.8;
let scrollDuration = 4000; // Nico 经典滚动基准时间为 4s
let fixedDuration = 4000;
let fontScale = 1.0;
let maxPerSec = 20; // 限流：每秒最大弹幕数
const _refWidth = 1920; 

// --- Nico 专属颜色映射表 (Niconico Color Dict) ---
const NICO_COLORS = {
  red: '#FF0000', pink: '#FF8080', orange: '#FFC000', yellow: '#FFFF00',
  green: '#00FF00', cyan: '#00FFFF', blue: '#0000FF', purple: '#C000FF',
  black: '#000000', white: '#FFFFFF', white2: '#CCCC99', niconicowhite: '#CCCC99',
  red2: '#CC0033', truered: '#CC0033', pink2: '#FF33CC', orange2: '#FF6600',
  passionorange: '#FF6600', yellow2: '#999900', mikan: '#999900',
  green2: '#00CC66', cyan2: '#00CCCC', blue2: '#3399FF', marineblue: '#3399FF',
  purple2: '#6633CC', black2: '#666666'
};

// --- 动态轨道控制 ---
let maxLanes = 0;
let scrollLanes = []; 
let topLanes = [];
let bottomLanes = [];

function resetLaneData() {
  // 核心更改：将轨道数据结构从单一数字改为对象
  // tailEnterTime: 用于判断入口是否空闲
  // tailReachOneSixthTime: 尾部到达左侧 1/6 处的时间，用于判断追尾
  // leaveScreenTime: (用于固定弹幕) 完全消失时间
  scrollLanes = Array.from({ length: maxLanes }, () => ({ tailEnterTime: 0, tailReachOneSixthTime: 0 }));
  topLanes = Array.from({ length: maxLanes }, () => ({ leaveScreenTime: 0 }));
  bottomLanes = Array.from({ length: maxLanes }, () => ({ leaveScreenTime: 0 }));
}

// 新增：清除弹幕的布局与轨道缓存
function clearDanmakuCaches() {
  allDanmaku.forEach(d => {
    d._lane = undefined;
    d._textW = undefined;
  });
}

function updateLanes() {
  const winH = window.innerHeight;
  const winW = window.innerWidth;
  const refScale = winW / _refWidth;
  const baseSize = 25 * fontScale;
  // Nico 弹幕通常排列非常紧密，行距极小
  const laneHeight = baseSize * refScale * 1.1; 

  const newMaxLanes = Math.max(1, Math.floor(winH / laneHeight));

  if (newMaxLanes !== maxLanes) {
    maxLanes = newMaxLanes;
    resetLaneData();
  }
}

/**
 * 获取空闲的滚动轨道 (应用左侧1/6防追尾算法)
 */
function getFreeScrollLane(lanesArr, textW, winW, durMs, currentTime, lanesNeeded) {
  const speed = (winW + textW) / durMs;
  const tailEnterTime = currentTime + (textW / speed) + 100; // 100ms 安全缓冲
  
  // 新弹幕头部到达 1/6 处的时间 = 行驶 5/6 屏幕宽度的耗时
  const headReachOneSixthTime = currentTime + (5 * winW / 6) / speed;
  // 当前弹幕尾部到达 1/6 处的时间 = 行驶 5/6 屏幕宽 + 弹幕宽度的耗时
  const tailReachOneSixthTime = currentTime + (5 * winW / 6 + textW) / speed;

  const validLaneCount = Math.max(1, maxLanes - lanesNeeded + 1);

  // 1. 尝试寻找完全符合条件的空闲轨道
  for (let i = 0; i < validLaneCount; i++) {
    let enoughSpace = true;
    for (let k = 0; k < lanesNeeded; k++) {
      if (i + k >= maxLanes) {
        enoughSpace = false;
        break;
      }
      const lane = lanesArr[i + k];
      
      // 条件 A: 尾部已入屏，入口空闲
      const isEntranceFree = currentTime >= lane.tailEnterTime;
      // 条件 B: 新弹幕头部到达 1/6 处时，老弹幕尾部已经越过 1/6 处（允许在 1/6 区域内追尾相撞）
      const isNoCatchUpBeforeOneSixth = headReachOneSixthTime >= lane.tailReachOneSixthTime;

      if (!isEntranceFree || !isNoCatchUpBeforeOneSixth) {
        enoughSpace = false;
        break;
      }
    }
    
    if (enoughSpace) {
      for (let k = 0; k < lanesNeeded; k++) {
        if (i + k < maxLanes) {
          lanesArr[i + k] = { tailEnterTime, tailReachOneSixthTime };
        }
      }
      return i;
    }
  }

  // 2. 如果找不到完全符合条件的，寻找最先释放入口的轨道 (强制覆盖)
  let earliestLane = 0;
  let earliestTime = Infinity;
  for (let i = 0; i < validLaneCount; i++) {
    let maxTailEnter = 0;
    for (let k = 0; k < lanesNeeded; k++) {
      if (i + k < maxLanes) {
        maxTailEnter = Math.max(maxTailEnter, lanesArr[i + k].tailEnterTime);
      }
    }
    if (maxTailEnter < earliestTime) {
      earliestTime = maxTailEnter;
      earliestLane = i;
    }
  }

  // 更新占用的轨道状态
  for (let k = 0; k < lanesNeeded; k++) {
    if (earliestLane + k < maxLanes) {
      lanesArr[earliestLane + k] = { tailEnterTime, tailReachOneSixthTime };
    }
  }
  return earliestLane;
}

/**
 * 获取空闲的固定轨道 (顶部/底部弹幕)
 */
function getFreeFixedLane(lanesArr, durMs, currentTime, lanesNeeded) {
  const leaveScreenTime = currentTime + durMs;
  const validLaneCount = Math.max(1, maxLanes - lanesNeeded + 1);

  for (let i = 0; i < validLaneCount; i++) {
    let enoughSpace = true;
    for (let k = 0; k < lanesNeeded; k++) {
      if (i + k >= maxLanes || currentTime < lanesArr[i + k].leaveScreenTime) {
        enoughSpace = false;
        break;
      }
    }
    if (enoughSpace) {
      for (let k = 0; k < lanesNeeded; k++) {
        if (i + k < maxLanes) lanesArr[i + k] = { leaveScreenTime };
      }
      return i;
    }
  }

  let earliestLane = 0;
  let earliestTime = Infinity;
  for (let i = 0; i < validLaneCount; i++) {
    let maxLeave = 0;
    for (let k = 0; k < lanesNeeded; k++) {
      if (i + k < maxLanes) {
        maxLeave = Math.max(maxLeave, lanesArr[i + k].leaveScreenTime);
      }
    }
    if (maxLeave < earliestTime) {
      earliestTime = maxLeave;
      earliestLane = i;
    }
  }

  for (let k = 0; k < lanesNeeded; k++) {
    if (earliestLane + k < maxLanes) lanesArr[earliestLane + k] = { leaveScreenTime };
  }
  return earliestLane;
}

// --- 数据端限流：按时间窗口过滤 ---
function applyRateLimit(danmakuList, maxPerSecond) {
  if (maxPerSecond <= 0) return danmakuList;

  var result = [];
  // 按整秒分组
  var buckets = {};
  for (var i = 0; i < danmakuList.length; i++) {
    var sec = Math.floor(danmakuList[i].t);
    if (!buckets[sec]) buckets[sec] = [];
    buckets[sec].push(danmakuList[i]);
  }

  var keys = Object.keys(buckets).map(Number).sort(function(a, b) { return a - b; });
  for (var k = 0; k < keys.length; k++) {
    var bucket = buckets[keys[k]];
    if (bucket.length <= maxPerSecond) {
      result = result.concat(bucket);
    } else {
      // 超限：Fisher-Yates 随机采样，保证均匀分布而非只取前N条
      var sampled = bucket.slice();
      for (var j = sampled.length - 1; j > 0; j--) {
        var pick = Math.floor(Math.random() * (j + 1));
        var tmp = sampled[j];
        sampled[j] = sampled[pick];
        sampled[pick] = tmp;
      }
      result = result.concat(sampled.slice(0, maxPerSecond));
    }
  }

  // 重新排序
  result.sort(function(a, b) { return a.t - b.t; });
  return result;
}

function createDanmaku(d, currentTime = null) {
  if (!danmakuVisible) return;

  const isScroll = d.m >= 1 && d.m <= 3;
  const isBottom = d.m === 4;
  const isTop = d.m === 5;
  
  if (isScroll && window._blockScroll) return;
  if (isTop && window._blockTop) return;
  if (isBottom && window._blockBottom) return;
  const durMs = isScroll ? scrollDuration : fixedDuration;

  const videoTimeMs = d.t * 1000;
  // 统一时间流：修正偏移误差
  const elapsedMs = currentTime !== null ? (currentTime - d.t) * 1000 : 0;
  
  if (elapsedMs >= durMs || elapsedMs < 0) return;

  const el = document.createElement('div');
  el.className = 'dm-item';
  el.textContent = d.text;
  el.style.color = d.c;
  el.style.opacity = currentOpacity;
  el.dataset.size = d.size;
  const danmakuFs = (d.size * fontScale / _refWidth * 100).toFixed(4) + 'vw';
  el.style.fontSize = danmakuFs;

  if (isScroll) el.classList.add('dm-scroll');
  else if (isBottom) el.classList.add('dm-bottom');
  else if (isTop) el.classList.add('dm-top');

  container.appendChild(el);

  // 利用缓存跳过耗时的 layout reflow
  if (d._textW === undefined) {
    d._textW = el.offsetWidth;
  }
  const textW = d._textW;
  const winW = window.innerWidth;
  const lanesNeeded = Math.ceil(d.size / 25);
  let lane = d._lane;
  
  // 核心分配逻辑分流，带有轨道记忆
  if (lane !== undefined && lane < maxLanes) {
    // 如果有记忆的轨道，则直接使用，但依然要更新全局轨道占用状态
    if (isScroll) {
      const speed = (winW + textW) / durMs;
      const tailEnterTime = videoTimeMs + (textW / speed) + 100;
      const tailReachOneSixthTime = videoTimeMs + (5 * winW / 6 + textW) / speed;
      for (let k = 0; k < lanesNeeded; k++) {
        if (lane + k < maxLanes) {
          scrollLanes[lane + k] = { tailEnterTime, tailReachOneSixthTime };
        }
      }
    } else if (isTop) {
      for (let k = 0; k < lanesNeeded; k++) {
        if (lane + k < maxLanes) topLanes[lane + k] = { leaveScreenTime: videoTimeMs + durMs };
      }
    } else if (isBottom) {
      for (let k = 0; k < lanesNeeded; k++) {
        if (lane + k < maxLanes) bottomLanes[lane + k] = { leaveScreenTime: videoTimeMs + durMs };
      }
    }
  } else {
    // 如果没有记忆，则重新计算并缓存
    if (isScroll) {
      lane = getFreeScrollLane(scrollLanes, textW, winW, durMs, videoTimeMs, lanesNeeded);
    } else if (isTop) {
      lane = getFreeFixedLane(topLanes, durMs, videoTimeMs, lanesNeeded);
    } else if (isBottom) {
      lane = getFreeFixedLane(bottomLanes, durMs, videoTimeMs, lanesNeeded);
    }
    d._lane = lane;
  }
  
  const laneHeightVh = (100 / maxLanes);

  if (isScroll || isTop) {
    el.style.top = `${lane * laneHeightVh}vh`;
  } else if (isBottom) {
    el.style.bottom = `${lane * laneHeightVh + 1}vh`;
  }

  el.style.setProperty('--dur', `${durMs}ms`);
  el.style.setProperty('--delay', `-${elapsedMs}ms`);

  if (isScroll) {
    el.style.setProperty('--start-x', `100vw`);
    el.style.setProperty('--end-x', `-100%`);
  } else {
    const maxW = winW * 0.95;
    if (textW > maxW) {
      el.style.transform = `translateX(-50%) scaleX(${maxW / textW})`;
    } else {
      el.style.transform = `translateX(-50%)`;
    }
  }

  const item = { el, d, type: isScroll ? 'scroll' : 'fixed' };
  activeDanmaku.add(item);

  el.addEventListener('animationend', () => {
    el.remove();
    activeDanmaku.delete(item);
  });
}

function handleSeek(timeSec) {
  container.innerHTML = '';
  activeDanmaku.clear();
  
  resetLaneData();
  updateLanes(); 
  
  const durSec = Math.max(scrollDuration, fixedDuration) / 1000;
  currentIndex = allDanmaku.findIndex(d => d.t >= timeSec - durSec);
  if (currentIndex === -1) currentIndex = allDanmaku.length;

  let tempIndex = currentIndex;
  while (tempIndex < allDanmaku.length && allDanmaku[tempIndex].t <= timeSec) {
    const d = allDanmaku[tempIndex];
    const typeDur = (d.m >= 1 && d.m <= 3) ? scrollDuration : fixedDuration;
    if (timeSec - d.t < typeDur / 1000) {
      createDanmaku(d, timeSec); 
    }
    tempIndex++;
  }
  currentIndex = tempIndex;
}

iina.onMessage("time-update", (data) => {
  let t = data.time;
  if (Math.abs(t - lastTime) > 1.5) {
    handleSeek(t);
  } else if (!isPaused) {
    while (currentIndex < allDanmaku.length && allDanmaku[currentIndex].t <= t) {
      createDanmaku(allDanmaku[currentIndex], t); // 补充关键代码：正常播放也要传入精准时间戳
      currentIndex++;
    }
  }
  lastTime = t;
});

iina.onMessage("load-danmaku", (data) => {
  if (data.fontScale) fontScale = data.fontScale;
  if (data.scrollDuration) scrollDuration = data.scrollDuration;
  if (data.opacity) currentOpacity = data.opacity;
  if (data.maxPerSec !== undefined) maxPerSec = data.maxPerSec;
  updateLanes();
  
  const encodedStr = data.xmlContent.replace(/(..)/g, '%$1');
  const xmlStr = decodeURIComponent(encodedStr);
  
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(xmlStr, "text/xml");
  const chats = xmlDoc.getElementsByTagName('chat');
  let list = [];

  if (chats.length > 0) {
    for (let i = 0; i < chats.length; i++) {
      const el = chats[i];
      const text = el.textContent;
      if (!text) continue;

      const vpos = parseInt(el.getAttribute('vpos') || "0", 10);
      const mail = el.getAttribute('mail') || "";
      const commands = mail.toLowerCase().split(/\s+/);

      let mode = 1; 
      if (commands.includes('shita')) mode = 4;
      else if (commands.includes('ue')) mode = 5;

      let size = 25; 
      if (commands.includes('big')) size = 36;
      else if (commands.includes('small')) size = 15;

      let color = '#FFFFFF';
      for (const cmd of commands) {
        if (NICO_COLORS[cmd]) {
          color = NICO_COLORS[cmd];
          break;
        }
        if (cmd.startsWith('#') && (cmd.length === 7 || cmd.length === 4)) {
          color = cmd;
          break;
        }
      }

      list.push({
        t: vpos / 100,
        m: mode,
        c: color,
        text: text,
        size: size
      });
    }
  } else {
    const regex = /<d p="([^"]+)">([\s\S]*?)<\/d>/g;
    let match;
    while ((match = regex.exec(xmlStr)) !== null) {
      let p = match[1].split(",");
      let colorVal = parseInt(p[3]);
      if (colorVal < 0) colorVal = (colorVal >>> 0) & 0xFFFFFF;
      let danmakuSize = parseInt(p[2]) || 25;
      list.push({
        t: parseFloat(p[0]),
        m: parseInt(p[1]),
        c: "#" + colorVal.toString(16).padStart(6, '0'),
        text: match[2].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/<\/d/, ''),
        size: danmakuSize
      });
    }
  }

  allDanmaku = list.sort((a, b) => a.t - b.t);

  if (maxPerSec > 0) {
    var beforeCount = allDanmaku.length;
    allDanmaku = applyRateLimit(allDanmaku, maxPerSec);
    var filtered = beforeCount - allDanmaku.length;
    if (filtered > 0) {
      console.log('[Danmaku Cosmos] Rate limit: ' + beforeCount + ' → ' + allDanmaku.length + ' (filtered ' + filtered + ')');
    }
  }

  handleSeek(0);
});

iina.onMessage("resize", () => {
  updateLanes();
  clearDanmakuCaches(); // 清除过期的布局缓存

  activeDanmaku.forEach(item => {
    if (item.type === 'fixed') {
      const winW = window.innerWidth;
      const textW = item.el.offsetWidth;
      const maxW = winW * 0.95;
      if (textW > maxW) {
        item.el.style.transform = `translateX(-50%) scaleX(${maxW / textW})`;
      } else {
        item.el.style.transform = `translateX(-50%)`;
      }
    }
  });
});

iina.onMessage("pause-state", (data) => {
  isPaused = data.paused;
  document.body.classList.toggle('is-paused', isPaused);
});

iina.onMessage("toggle-danmaku", (data) => {
  danmakuVisible = data.enabled;
  container.style.display = danmakuVisible ? '' : 'none';
  if (!danmakuVisible) {
    container.innerHTML = '';
    activeDanmaku.clear();
  }
});

iina.onMessage("set-opacity", (data) => {
  currentOpacity = data.opacity;
  activeDanmaku.forEach(item => {
    item.el.style.opacity = currentOpacity;
  });
});

iina.onMessage("set-fontscale", (data) => {
  fontScale = data.scale;
  updateLanes();
  clearDanmakuCaches(); // 清除过期的布局缓存
  handleSeek(lastTime);
});

iina.onMessage("set-scroll-duration", (data) => {
  scrollDuration = data.duration;
});

iina.onMessage("set-max-per-sec", (data) => {
  maxPerSec = data.maxPerSec;
});

iina.onMessage("clear-danmaku", () => {
  container.innerHTML = '';
  activeDanmaku.clear();
  allDanmaku = [];
  currentIndex = 0;
});

iina.onMessage("apply-settings", (data) => {
  if (data.opacity !== undefined) currentOpacity = data.opacity;
  if (data.fontScale !== undefined) fontScale = data.fontScale;
  if (data.scrollDuration !== undefined) scrollDuration = data.scrollDuration;
  if (data.maxPerSec !== undefined) maxPerSec = data.maxPerSec;
  updateLanes();
});

iina.onMessage("block-type", (data) => {
  window._blockScroll = data.blockScroll;
  window._blockTop = data.blockTop;
  window._blockBottom = data.blockBottom;
});

updateLanes();

window.addEventListener("resize", () => {
  updateLanes();
  iina.postMessage("resize", {});
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && lastTime > 0) {
    handleSeek(lastTime);
  }
});

setTimeout(() => iina.postMessage("overlay-ready", {}), 300);