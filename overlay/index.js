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
  scrollLanes = new Array(maxLanes).fill(0);
  topLanes = new Array(maxLanes).fill(0);
  bottomLanes = new Array(maxLanes).fill(0);
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

function getFreeLane(lanesArr, textW, winW, durMs, videoTimeMs, danmakuSize) {
  const lanesNeeded = danmakuSize / 25;
  const startLane = Math.floor(Math.random() * Math.min(maxLanes, 8));

  for (let j = 0; j < maxLanes; j++) {
    let i = (startLane + j) % maxLanes;
    let enoughSpace = true;
    for (let k = 0; k < Math.ceil(lanesNeeded); k++) {
      if (i + k >= maxLanes || lanesArr[i + k] > videoTimeMs) {
        enoughSpace = false;
        break;
      }
    }
    if (enoughSpace) {
      const speed = (winW + textW) / durMs;
      // 碰撞计算：确保当前弹幕的尾部离开屏幕右侧边缘的时间
      const clearTime = textW > 0 ? (textW / speed) : durMs;
      for (let k = 0; k < Math.ceil(lanesNeeded); k++) {
        lanesArr[i + k] = videoTimeMs + clearTime + 100; // Nico 的拥挤度允许更近的尾随
      }
      return i;
    }
  }

  // 完美还原 Nico 特性：如果屏幕满了，强制覆盖存在时间最久的轨道，制造弹幕厚度
  let earliestLane = 0;
  for (let i = 1; i < maxLanes; i++) {
    if (lanesArr[i] < lanesArr[earliestLane]) earliestLane = i;
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

function createDanmaku(d, seekTime = null) {
  if (!danmakuVisible) return;

  const isScroll = d.m >= 1 && d.m <= 3;
  const isBottom = d.m === 4;
  const isTop = d.m === 5;
  
  if (isScroll && window._blockScroll) return;
  if (isTop && window._blockTop) return;
  if (isBottom && window._blockBottom) return;
  const durMs = isScroll ? scrollDuration : fixedDuration;

  const videoTimeMs = d.t * 1000;
  const elapsedMs = seekTime !== null ? (seekTime - d.t) * 1000 : 0;
  
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

  const textW = el.offsetWidth;
  const winW = window.innerWidth;
  
  const lanesRef = isScroll ? scrollLanes : (isTop ? topLanes : bottomLanes);
  const lane = getFreeLane(lanesRef, textW, winW, durMs, videoTimeMs, d.size);
  
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
  if (currentIndex === -1) currentIndex = 0;

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
      createDanmaku(allDanmaku[currentIndex]);
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
  
  // 性能极度优化：使用正则替换替代 split/join，防止超大 XML 导致内存溢出
  const encodedStr = data.xmlContent.replace(/(..)/g, '%$1');
  const xmlStr = decodeURIComponent(encodedStr);
  
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(xmlStr, "text/xml");
  const chats = xmlDoc.getElementsByTagName('chat');
  let list = [];

  // --- 核心：Niconico <chat> 解析逻辑 ---
  if (chats.length > 0) {
    for (let i = 0; i < chats.length; i++) {
      const el = chats[i];
      const text = el.textContent;
      if (!text) continue;

      // 解析 10ms 精度的 vpos
      const vpos = parseInt(el.getAttribute('vpos') || "0", 10);
      const mail = el.getAttribute('mail') || "";
      const commands = mail.toLowerCase().split(/\s+/);

      // 解析指令：位置
      let mode = 1; 
      if (commands.includes('shita')) mode = 4;
      else if (commands.includes('ue')) mode = 5;

      // 解析指令：字号
      let size = 25; 
      if (commands.includes('big')) size = 36;
      else if (commands.includes('small')) size = 15;

      // 解析指令：颜色
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
        t: vpos / 100, // 转换为秒
        m: mode,
        c: color,
        text: text,
        size: size
      });
    }
  } else {
    // --- 优雅降级：如果用户丢进来的是 Bilibili 的 <d> 标签文件 ---
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
        text: match[2].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'),
        size: danmakuSize
      });
    }
  }

  // 严格按时间重排
  allDanmaku = list.sort((a, b) => a.t - b.t);

  // 数据端限流：在渲染前直接过滤掉超限弹幕
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
  handleSeek(lastTime);
});

iina.onMessage("set-scroll-duration", (data) => {
  scrollDuration = data.duration;
});

iina.onMessage("set-max-per-sec", (data) => {
  maxPerSec = data.maxPerSec;
  // 限流参数变更后需要重新加载弹幕才能生效
  // 因为过滤是在数据端完成的，已过滤掉的弹幕无法恢复
  // 所以这里只更新参数，下次加载弹幕时自动应用
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

// IPC 通讯只需确认一次即可
setTimeout(() => iina.postMessage("overlay-ready", {}), 300);