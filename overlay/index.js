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
let scrollDuration = 8000;
let fixedDuration = 4000;
let currentFontSize = 25; 
const _refWidth = 1920; 

// --- 动态轨道控制 ---
let maxLanes = 0;
let scrollLanes = []; 
let topLanes = [];
let bottomLanes = [];

// 彻底重置轨道状态，防止跳转进度后的时间戳污染
function resetLaneData() {
  scrollLanes = new Array(maxLanes).fill(0);
  topLanes = new Array(maxLanes).fill(0);
  bottomLanes = new Array(maxLanes).fill(0);
}

function updateLanes() {
  const winH = window.innerHeight;
  const winW = window.innerWidth;
  const refScale = winW / _refWidth;
  const laneHeight = currentFontSize * refScale * 1.15;
  
  const newMaxLanes = Math.max(1, Math.floor((winH * 0.95) / laneHeight));
  
  if (newMaxLanes !== maxLanes) {
    maxLanes = newMaxLanes;
    resetLaneData();
  }
}

function updateGlobalFontSize() {
  const winW = window.innerWidth;
  const fontSizeVw = (currentFontSize / _refWidth * 100).toFixed(4);
  document.documentElement.style.setProperty('--global-fs', `${fontSizeVw}vw`);
}

function getFreeLane(lanesArr, textW, winW, durMs, videoTimeMs) {
  // 增加随机起始偏移，让弹幕分布更散更自然
  const startLane = Math.floor(Math.random() * Math.min(maxLanes, 8));
  
  for (let j = 0; j < maxLanes; j++) {
    let i = (startLane + j) % maxLanes;
    // 只有当轨道空闲时间小于当前视频时间，才分配此轨道
    if (lanesArr[i] <= videoTimeMs) {
      const speed = (winW + textW) / durMs;
      const clearTime = textW > 0 ? (textW / speed) : durMs;
      // 这里的 300ms 缓冲非常关键
      lanesArr[i] = videoTimeMs + clearTime + 300; 
      return i;
    }
  }
  // 全满时的保底逻辑
  let earliestLane = 0;
  for (let i = 1; i < maxLanes; i++) {
    if (lanesArr[i] < lanesArr[earliestLane]) earliestLane = i;
  }
  return earliestLane;
}

function createDanmaku(d, seekTime = null) {
  if (!danmakuVisible) return;

  const isScroll = d.m >= 1 && d.m <= 3;
  const isBottom = d.m === 4;
  const isTop = d.m === 5;
  
  // 检查屏蔽类型
  if (isScroll && window._blockScroll) return;
  if (isTop && window._blockTop) return;
  if (isBottom && window._blockBottom) return;
  const durMs = isScroll ? scrollDuration : fixedDuration;

  // 使用传入的当前时间或弹幕自身时间戳
  const videoTimeMs = d.t * 1000;
  const elapsedMs = seekTime !== null ? (seekTime - d.t) * 1000 : 0;
  
  if (elapsedMs >= durMs || elapsedMs < 0) return;

  const el = document.createElement('div');
  el.className = 'dm-item';
  el.textContent = d.text;
  el.style.color = d.c;
  el.style.opacity = currentOpacity;
  el.style.fontSize = 'var(--global-fs)';

  if (isScroll) el.classList.add('dm-scroll');
  else if (isBottom) el.classList.add('dm-bottom');
  else if (isTop) el.classList.add('dm-top');

  container.appendChild(el);

  const textW = el.offsetWidth;
  const winW = window.innerWidth;
  
  const lanesRef = isScroll ? scrollLanes : (isTop ? topLanes : bottomLanes);
  const lane = getFreeLane(lanesRef, textW, winW, durMs, videoTimeMs);
  
  const laneHeightVh = (95 / maxLanes); 
  const jitter = (Math.random() - 0.5) * (laneHeightVh * 0.25);

  if (isScroll || isTop) {
    el.style.top = `${lane * laneHeightVh + jitter}vh`;
  } else if (isBottom) {
    el.style.bottom = `${lane * laneHeightVh + jitter + 2}vh`; 
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
  
  // 修复核心：每次 Seek 必须重置所有轨道的时间戳，否则会发生堆叠
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
  // 正常播放时，如果时间跳跃超过 1.5 秒，视为手动调整进度
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
  if (data.fontSize) currentFontSize = data.fontSize;
  if (data.scrollDuration) scrollDuration = data.scrollDuration;
  if (data.opacity) currentOpacity = data.opacity;
  updateGlobalFontSize();
  updateLanes();
  
  let xmlStr = decodeURIComponent("%" + data.xmlContent.match(/.{1,2}/g).join("%"));
  const regex = /<d p="([^"]+)">([\s\S]*?)<\/d>/g;
  let list = [];
  let match;
  while ((match = regex.exec(xmlStr)) !== null) {
    let p = match[1].split(",");
    let colorVal = parseInt(p[3]);
    if (colorVal < 0) colorVal = (colorVal >>> 0) & 0xFFFFFF;
    list.push({
      t: parseFloat(p[0]),
      m: parseInt(p[1]),
      c: "#" + colorVal.toString(16).padStart(6, '0'),
      text: match[2].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    });
  }
  allDanmaku = list.sort((a, b) => a.t - b.t);
  handleSeek(0);
  iina.postMessage("danmaku-loaded", { count: allDanmaku.length });
});

iina.onMessage("resize", () => {
  updateGlobalFontSize();
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

iina.onMessage("set-fontsize", (data) => {
  currentFontSize = data.size;
  updateGlobalFontSize();
  updateLanes();
});

iina.onMessage("set-scroll-duration", (data) => {
  scrollDuration = data.duration;
});

iina.onMessage("clear-danmaku", () => {
  container.innerHTML = '';
  activeDanmaku.clear();
  allDanmaku = [];
  currentIndex = 0;
});

iina.onMessage("block-type", (data) => {
  // 简单实现：在 createDanmaku 中检查
  window._blockScroll = data.blockScroll;
  window._blockTop = data.blockTop;
  window._blockBottom = data.blockBottom;
});

updateGlobalFontSize();
updateLanes();

window.addEventListener("resize", () => {
  updateGlobalFontSize();
  iina.postMessage("resize", {});
});
setInterval(() => iina.postMessage("overlay-ready", {}), 300);