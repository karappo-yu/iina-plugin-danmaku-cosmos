'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const MAIN_JS = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');

test('video display aspect follows output filters, rotation, and metadata fallback', () => {
  const h = createHarness(true);
  h.setMpv('video-out-params/aspect', 4 / 3);
  h.setMpv('video-out-params/rotate', 0);
  assert.equal(h.context.getVideoAspectRatio(), 4 / 3);
  h.setMpv('video-out-params/rotate', 90);
  assert.equal(h.context.getVideoAspectRatio(), 3 / 4);
  h.setMpv('video-out-params/aspect', undefined);
  h.setMpv('video-params/aspect', 16 / 9);
  assert.equal(h.context.getVideoAspectRatio(), 16 / 9);
  h.setMpv('video-params/aspect', NaN);
  assert.equal(h.context.getVideoAspectRatio(), 0);
});

test('overlay receives video aspect on startup and output-parameter changes', () => {
  const h = createHarness(true);
  h.setMpv('video-out-params/aspect', 4 / 3);
  h.readyOverlay();
  assert.equal(h.overlayMessages.findLast(m => m.name === 'set-video-aspect').data.aspect, 4 / 3);
  h.setMpv('video-out-params/aspect', 21 / 9);
  h.emitEvent('mpv.video-out-params.changed', {});
  assert.equal(h.overlayMessages.findLast(m => m.name === 'set-video-aspect').data.aspect, 21 / 9);
  assert.equal(h.context.buildLoadDanmakuPayload('', 'nico-json').videoAspectRatio, 21 / 9);
});

test('fullscreen state is restored on load and relayed after IINA transitions', () => {
  const h = createHarness(true);
  h.setFullscreen(true);
  h.setMpv('video-out-params/aspect', 4 / 3);
  h.readyOverlay();
  const initial = h.overlayMessages.findLast(m => m.name === 'set-video-aspect');
  assert.equal(initial.data.fullscreen, true);
  assert.equal(h.context.buildLoadDanmakuPayload('', 'nico-json').fullscreen, true);
  h.setFullscreen(false);
  h.emitEvent('iina.window-fs.changed', false);
  assert.equal(h.overlayMessages.findLast(m => m.name === 'set-fullscreen').data.fullscreen, false);
  h.setFullscreen(true);
  h.emitEvent('iina.window-fs.changed', true);
  assert.equal(h.overlayMessages.findLast(m => m.name === 'set-fullscreen').data.fullscreen, true);
});

function createHarness(initialEnabled, autoNetwork = false, savedPreferences = {}) {
  const eventHandlers = new Map();
  const overlayHandlers = new Map();
  const sidebarHandlers = new Map();
  const sidebarMessages = [];
  const menuItems = [];
  const fileReads = [];
  const directoryReads = [];
  const osdMessages = [];
  const throwingReads = new Set();
  let chosenFile = null;
  const overlayMessages = [];
  const httpRequests = [];
  const pendingHttp = [];
  const timers = new Map();
  let timerId = 0;
  const mpvValues = { speed: 1, 'time-pos': 0, duration: 0 };
  let execHandler = () => Promise.resolve(null);
  const fileWrites = [];
  const preferences = new Map([
    ['danmakuEnabled', initialEnabled],
    ['dandanplayAutoNetwork', autoNetwork],
    ...Object.entries(savedPreferences),
  ]);
  const comments = {
    '/videos/A.xml': '<i><d p="1,1,25,16777215,0,0,0,0">A comment</d></i>',
    '/videos/B.xml': '<i><d p="1,1,25,16777215,0,0,0,0">B comment</d></i>',
  };

  function register(map, name, handler) {
    if (!map.has(name)) map.set(name, []);
    map.get(name).push(handler);
    return handler;
  }

  const iina = {
    overlay: {
      loadFile() { overlayHandlers.clear(); },
      show() {},
      hide() {},
      postMessage(name, data) { overlayMessages.push({ name, data }); },
      onMessage(name, handler) { overlayHandlers.set(name, [handler]); },
    },
    sidebar: {
      loadFile() {},
      postMessage(name, data) { sidebarMessages.push({ name, data }); },
      onMessage(name, handler) { register(sidebarHandlers, name, handler); },
    },
    event: {
      on(name, handler) { return register(eventHandlers, name, handler); },
      off(name, handler) {
        eventHandlers.set(name, (eventHandlers.get(name) || []).filter((item) => item !== handler));
      },
    },
    console: { log() {} },
    menu: {
      addItem(item) { menuItems.push(item); },
      item(label, callback, options) { return { label, callback, options }; },
      separator() { return {}; },
    },
    core: {
      window: { fullscreen: false },
      status: { idle: false, isNetworkResource: false, paused: false, url: null },
      osd(message) { osdMessages.push(message); },
      seekTo() {},
    },
    file: {
      exists(filePath) { return Object.hasOwn(comments, filePath); },
      list(dir) {
        directoryReads.push(dir);
        return Object.keys(comments)
          .filter((filePath) => path.dirname(filePath) === dir)
          .map((filePath) => ({ filename: path.basename(filePath), isDir: false }));
      },
      read(filePath) {
        fileReads.push(filePath);
        if (throwingReads.has(filePath)) throw new Error('read failed');
        return comments[filePath] || null;
      },
      write(filePath, content) { fileWrites.push({filePath, content}); comments[filePath] = content; },
    },
    preferences: {
      get(key) { return preferences.get(key); },
      set(key, value) { preferences.set(key, value); },
      sync() {},
    },
    mpv: {
      getNumber(name) { return mpvValues[name]; },
      set() {},
    },
    utils: {
      preferredLocalizations() { return ['en']; },
      chooseFile() { return Promise.resolve(chosenFile); },
      resolvePath(value) { return value; },
      exec(...args) { return execHandler(...args); },
    },
    http: {
      get(url) {
        httpRequests.push({ method: 'GET', url });
        return new Promise((resolve, reject) => pendingHttp.push({ resolve, reject }));
      },
      post(url) {
        httpRequests.push({ method: 'POST', url });
        return new Promise((resolve, reject) => pendingHttp.push({ resolve, reject }));
      },
    },
  };

  const context = vm.createContext({
    iina,
    Promise,
    Date,
    JSON,
    Math,
    Object,
    Array,
    String,
    Number,
    RegExp,
    encodeURIComponent,
    decodeURIComponent,
    isFinite,
    isNaN,
    parseFloat,
    parseInt,
    setTimeout(callback, delay) { timers.set(++timerId, { callback, delay }); return timerId; },
    clearTimeout(id) { timers.delete(id); },
  });
  vm.runInContext(MAIN_JS, context, { filename: 'main.js' });
  emit(eventHandlers, 'iina.window-loaded');

  function emit(map, name, data) {
    for (const handler of map.get(name) || []) handler(data);
  }

  return {
    context,
    preferences,
    httpRequests,
    overlayMessages,
    sidebarMessages,
    fileReads,
    directoryReads,
    osdMessages,
    setFile(filePath, content) { comments[filePath] = content; },
    failRead(filePath) { throwingReads.add(filePath); },
    emitSidebar(name, data = {}) { emit(sidebarHandlers, name, data); },
    emitEvent(name, data) { emit(eventHandlers, name, data); },
    loadFromMenu(filePath) {
      chosenFile = filePath;
      menuItems.find((item) => item.label === 'Load Danmaku File…').callback();
      return Promise.resolve();
    },
    addFromSidebar(filePath) {
      chosenFile = filePath;
      emit(sidebarHandlers, 'danmaku-file-add');
      return Promise.resolve();
    },
    resolveNextHttp(response) { pendingHttp.shift().resolve(response); },
    setNetworkResource(value) { iina.core.status.isNetworkResource = value; },
    setVideo(url) {
      iina.core.status.url = url;
      emit(eventHandlers, 'iina.file-loaded', url);
    },
    readyOverlay() {
      emit(eventHandlers, 'iina.plugin-overlay-loaded');
      emit(overlayHandlers, 'overlay-ready', {});
    },
    emitOverlay(name, data = {}) { emit(overlayHandlers, name, data); },
    setPaused(value) { iina.core.status.paused = value; },
    setFullscreen(value) { iina.core.window.fullscreen = value; },
    setMpv(name, value) { mpvValues[name] = value; },
    setExec(handler) { execHandler = handler; },
    fileWrites,
    resolveHttp(index, response) { pendingHttp.splice(index, 1)[0].resolve(response); },
    rejectNextHttp(error) { pendingHttp.shift().reject(error); },
    runTimers(delay) {
      for (const [id, timer] of Array.from(timers)) {
        if (timer.delay === delay) { timers.delete(id); timer.callback(); }
      }
    },
    toggleDanmaku() { context.toggleDanmaku(); },
  };
}

function loadedComments(messages) {
  return messages
    .filter((message) => message.name === 'load-danmaku')
    .map((message) => decodeURIComponent(message.data.xmlContent));
}

async function flushMicrotasks() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

function setPositionSource(harness, fileType, source) {
  const sourcePath = '/videos/positions';
  harness.context.danmakuCache[sourcePath] = encodeURIComponent(source);
  harness.context.danmakuFileList.selectedPaths = [sourcePath];
  harness.context.currentDanmakuStatus.fileType = fileType;
  return sourcePath;
}

const positionFixtures = [
  {
    name: 'Niconico XML', fileType: 'nico-xml',
    source: '<packet><chat vpos="100" mail="ue">top-only</chat><chat vpos="200" mail="shita">bottom-only</chat><chat vpos="300" mail="">scroll-only</chat></packet>',
  },
  {
    name: 'Bilibili XML', fileType: 'bilibili-xml',
    source: '<i><chatserver>chat.bilibili.com</chatserver><d p="1,5,25,16777215,0,0,0,0">top-only</d><d p="2,4,25,16777215,0,0,0,0">bottom-only</d><d p="3,1,25,16777215,0,0,0,0">scroll-only</d></i>',
  },
  {
    name: 'Dandanplay', fileType: 'dandanplay',
    source: JSON.stringify([
      { t: 100, text: 'top-only', _commands: ['ue'] },
      { t: 200, text: 'bottom-only', _commands: ['shita'] },
      { t: 300, text: 'scroll-only', _commands: ['naka'] },
    ]),
  },
  {
    name: 'Niconico V1 JSON', fileType: 'nico-json',
    source: JSON.stringify([{ fork: 'main', comments: [
      { vposMs: 1000, body: 'top-only', commands: ['ue'] },
      { vposMs: 2000, body: 'bottom-only', commands: ['shita'] },
      { vposMs: 3000, body: 'scroll-only', commands: [] },
    ] }]),
  },
  {
    name: 'Niconico legacy JSON', fileType: 'nico-json',
    source: JSON.stringify([
      { vpos: 100, content: 'top-only', mail: 'ue' },
      { vpos: 200, content: 'bottom-only', mail: 'shita' },
      { vpos: 300, content: 'scroll-only', mail: '' },
    ].map(chat => ({chat: {...chat, user_id: 'viewer'}}))),
  },
];

for (const fixture of positionFixtures) {
  test(`${fixture.name}: independent position toggles filter rendering and retain blocked list rows`, () => {
    const harness = createHarness(true);
    harness.readyOverlay();
    const sourcePath = setPositionSource(harness, fixture.fileType, fixture.source);
    harness.emitSidebar('danmaku-browser-watch', { watch: true });
    assert.equal(decodeURIComponent(harness.context.getEffectiveContent(sourcePath)), fixture.source, '默认关闭');
    for (const [top, bottom] of [[true, false], [false, true], [true, true], [false, false]]) {
      harness.emitSidebar('danmaku-position-filter-set', { danmakuBlockTopEnabled: top, danmakuBlockBottomEnabled: bottom });
      const effective = decodeURIComponent(harness.context.getEffectiveContent(sourcePath));
      assert.equal(effective.includes('top-only'), !top);
      assert.equal(effective.includes('bottom-only'), !bottom);
      assert.equal(effective.includes('scroll-only'), true);
      assert.equal(loadedComments(harness.overlayMessages).at(-1), effective, '切换立即更新 overlay');
      const items = Array.from(harness.context.buildDanmakuBrowserList(), (item) => ({ text: item.text, blocked: item.blocked }));
      assert.deepEqual(items, [
        { text: 'top-only', blocked: top },
        { text: 'bottom-only', blocked: bottom },
        { text: 'scroll-only', blocked: false },
      ]);
      const message = harness.sidebarMessages.filter((item) => item.name === 'danmaku-browser-data').at(-1);
      const sentItems = JSON.parse(Buffer.from(message.data.payload, 'base64').toString('utf8'));
      assert.deepEqual(sentItems.map((item) => ({ text: item.text, blocked: item.blocked })), items, '列表收到划线标记');
    }
    assert.equal(harness.context.danmakuCache[sourcePath], encodeURIComponent(fixture.source), '缓存保留原始内容供关闭后恢复');
  });
}

test('position settings default off, persist independently and restore through lazy sidebar snapshots', () => {
  const harness = createHarness(true);
  harness.emitSidebar('request-state');
  let state = harness.sidebarMessages.find((item) => item.name === 'danmaku-state').data;
  assert.equal(state.danmakuBlockTopEnabled, false);
  assert.equal(state.danmakuBlockBottomEnabled, false);
  harness.emitSidebar('danmaku-position-filter-set', { danmakuBlockTopEnabled: true });
  assert.equal(harness.preferences.get('danmakuBlockTopEnabled'), true);
  assert.equal(harness.preferences.get('danmakuBlockBottomEnabled'), false);
  const restarted = createHarness(true, false, Object.fromEntries(harness.preferences));
  restarted.emitSidebar('request-state');
  restarted.emitSidebar('danmaku-position-filter-request');
  for (const name of ['danmaku-state', 'danmaku-position-filter-state']) {
    state = restarted.sidebarMessages.find((item) => item.name === name).data;
    assert.equal(state.danmakuBlockTopEnabled, true);
    assert.equal(state.danmakuBlockBottomEnabled, false);
  }
});

test('position blocking combines with word blocking and keeps blocked fixed comments out of list deduplication', () => {
  const harness = createHarness(true);
  setPositionSource(harness, 'dandanplay', JSON.stringify([
    { t: 100, text: 'same', _commands: ['ue'] },
    { t: 110, text: 'same', _commands: ['ue'] },
    { t: 120, text: 'same', _commands: ['shita'] },
    { t: 130, text: 'blocked-word', _commands: ['naka'] },
    { t: 140, text: 'visible', _commands: ['naka'] },
    { t: 150, text: 'visible', _commands: ['naka'] },
  ]));
  harness.emitSidebar('danmaku-dedupe-set', { enabled: true });
  harness.emitSidebar('danmaku-blocklist-add', { word: 'blocked-word' });
  harness.emitSidebar('danmaku-blocklist-set-enabled', { enabled: true });
  harness.emitSidebar('danmaku-position-filter-set', { danmakuBlockTopEnabled: true });
  const items = Array.from(harness.context.buildDanmakuBrowserList(), (item) => ({ text: item.text, blocked: item.blocked }));
  assert.deepEqual(items, [
    { text: 'same', blocked: true },
    { text: 'same', blocked: true },
    { text: 'same', blocked: false },
    { text: 'blocked-word', blocked: true },
    { text: 'visiblex2', blocked: false },
  ]);
  harness.emitSidebar('danmaku-position-filter-set', { danmakuBlockTopEnabled: false });
  const source = JSON.parse(decodeURIComponent(harness.context.getEffectiveContent('/videos/positions')));
  assert.equal(source.filter((item) => item.text === 'same').length, 3);
  assert.equal(source.some((item) => item.text === 'blocked-word'), false, '关闭位置过滤仍保留屏蔽词过滤');
});

test('position classification follows case insensitive first-command semantics and preserves Niconico owners', () => {
  const harness = createHarness(true);
  const sourcePath = setPositionSource(harness, 'nico-json', JSON.stringify([
    { fork: 'main', comments: [
      { vposMs: 1000, body: 'upper-top', commands: ['UE'] },
      { vposMs: 2000, body: 'scroll-first', commands: ['naka', 'ue'] },
      { vposMs: 3000, body: 'bottom-first', commands: ['shita', 'ue'] },
      { vposMs: 4000, body: 'top-first', commands: ['ue', 'shita'] },
    ] },
    { fork: 'owner', comments: [{ vposMs: 5000, body: 'owner-top', commands: ['ue'] }] },
  ]));
  harness.emitSidebar('danmaku-position-filter-set', { danmakuBlockTopEnabled: true });
  const filtered = JSON.parse(decodeURIComponent(harness.context.getEffectiveContent(sourcePath)));
  assert.deepEqual(filtered.flatMap((thread) => thread.comments.map((item) => item.body)), ['scroll-first', 'bottom-first', 'owner-top']);
  const blocked = Array.from(harness.context.buildDanmakuBrowserList()).filter((item) => item.blocked).map((item) => item.text);
  assert.deepEqual(blocked, ['upper-top', 'top-first']);
});

test('switching videos while disabled clears A and loads B when re-enabled', () => {
  const harness = createHarness(true);
  harness.readyOverlay();
  harness.setVideo('file:///videos/A.mp4');
  assert.deepEqual(loadedComments(harness.overlayMessages), ['<i><d p="1,1,25,16777215,0,0,0,0">A comment</d></i>']);

  harness.toggleDanmaku();
  const switchStart = harness.overlayMessages.length;
  harness.setVideo('file:///videos/B.mp4');

  const duringDisabledSwitch = harness.overlayMessages.slice(switchStart);
  assert.equal(
    duringDisabledSwitch.filter((message) => message.name === 'clear-danmaku').length,
    1,
    'file-loaded must clear the previous video renderer once even while danmaku is disabled',
  );
  assert.deepEqual(loadedComments(duringDisabledSwitch), []);
  assert.equal(harness.context.currentDanmakuStatus.isLoaded, false);
  assert.equal(harness.context.danmakuFileList.selectedPaths.length, 0);

  harness.toggleDanmaku();
  assert.deepEqual(loadedComments(harness.overlayMessages), [
    '<i><d p="1,1,25,16777215,0,0,0,0">A comment</d></i>',
    '<i><d p="1,1,25,16777215,0,0,0,0">B comment</d></i>',
  ]);
});

test('enabling after startup-disabled file load initializes that video', () => {
  const harness = createHarness(false);
  harness.readyOverlay();
  harness.setVideo('file:///videos/B.mp4');
  assert.deepEqual(loadedComments(harness.overlayMessages), []);

  harness.toggleDanmaku();
  assert.deepEqual(loadedComments(harness.overlayMessages), ['<i><d p="1,1,25,16777215,0,0,0,0">B comment</d></i>']);
});

test('startup-disabled network video stays cleared without starting a match', () => {
  const harness = createHarness(false);
  harness.readyOverlay();
  harness.setNetworkResource(true);
  harness.setVideo('https://example.com/video.m3u8');

  assert.ok(harness.overlayMessages.some((message) => message.name === 'clear-danmaku'));
  assert.deepEqual(loadedComments(harness.overlayMessages), []);
  assert.deepEqual(harness.httpRequests, []);
});

test('disabling while a comment download is pending does not re-enable danmaku', async () => {
  const harness = createHarness(true);
  harness.setNetworkResource(true);
  harness.readyOverlay();
  harness.setVideo('https://example.com/video.m3u8');
  harness.context.ddpLoadComments(7, 'A', '1', true);
  assert.equal(harness.httpRequests.length, 1);
  harness.toggleDanmaku();

  harness.resolveNextHttp({
    statusCode: 200,
    data: { comments: [{ p: '1,1,16777215,1', m: 'comment' }] },
  });
  await Promise.resolve();
  assert.equal(harness.context.danmakuEnabled, false);
  assert.equal(harness.context.currentDanmakuStatus.isLoaded, false);
});

test('reloading the same video invalidates the previous auto-match request', async () => {
  const harness = createHarness(true, true);
  harness.setNetworkResource(true);
  harness.readyOverlay();
  harness.setVideo('https://example.com/video.m3u8');
  await Promise.resolve();
  assert.equal(harness.httpRequests.length, 1);

  harness.setVideo('https://example.com/video.m3u8');
  harness.resolveNextHttp({
    statusCode: 200,
    data: { success: true, isMatched: true, matches: [{ episodeId: 7, animeTitle: 'old', episodeTitle: '1' }] },
  });
  await Promise.resolve();
  assert.equal(harness.httpRequests.length, 2);
  assert.equal(harness.context.currentDanmakuStatus.isLoaded, false);
});


test('menu loading selects and lists the source used by later filters', async () => {
  const harness = createHarness(true);
  harness.readyOverlay();
  harness.setVideo('file:///videos/A.mp4');
  const manualPath = '/downloads/manual.xml';
  harness.setFile(manualPath, '<i><d p="2,1,25,16777215,0,0,0,0">manual comment</d></i>');

  await harness.loadFromMenu(manualPath);

  assert.deepEqual(Array.from(harness.context.danmakuFileList.selectedPaths), [manualPath]);
  assert.ok(harness.context.findDanmakuFileByPath(manualPath));
  assert.deepEqual(Array.from(harness.context.buildDanmakuBrowserList(), (item) => item.text), ['manual comment']);
  harness.emitSidebar('danmaku-blocklist-add', { word: 'manual' });
  harness.emitSidebar('danmaku-blocklist-set-enabled', { enabled: true });
  assert.equal(loadedComments(harness.overlayMessages).at(-1), '<i></i>');
});

for (const entry of ['automatic', 'menu', 'sidebar']) {
  test(`${entry} loading normalizes local DDP exports, including reselection`, async () => {
    const harness = createHarness(true);
    const filePath = entry === 'automatic' ? '/videos/C.json' : '/downloads/DDP `source`.json';
    const comments = [{ t: 100, text: 'DDP comment', _commands: ['naka', '#ffffff'] }];
    harness.setFile(filePath, JSON.stringify({ source: 'dandanplay', comments }));
    harness.readyOverlay();
    harness.setVideo('file:///videos/C.mp4');
    if (entry === 'menu') await harness.loadFromMenu(filePath);
    if (entry === 'sidebar') await harness.addFromSidebar(filePath);

    function assertDdpLoaded() {
      const load = harness.overlayMessages.filter((message) => message.name === 'load-danmaku').at(-1);
      assert.equal(load.data.danmakuType, 'dandanplay');
      assert.deepEqual(JSON.parse(decodeURIComponent(load.data.xmlContent)), comments);
      assert.deepEqual(Array.from(harness.context.danmakuFileList.selectedPaths), [filePath]);
      assert.deepEqual(Array.from(harness.context.buildDanmakuBrowserList(), (item) => item.text), ['DDP comment']);
    }
    assertDdpLoaded();
    await harness.loadFromMenu('/videos/A.xml');
    harness.emitSidebar('select-danmaku-file', { path: encodeURIComponent(filePath) });
    assertDdpLoaded();
  });
}

test('request-state only reports current sources without rescanning or replacing session data', async () => {
  const harness = createHarness(true);
  harness.readyOverlay();
  harness.setVideo('file:///videos/A.mp4');
  const manualPath = '/downloads/manual.xml';
  harness.setFile(manualPath, '<i><d p="2,1,25,16777215,0,0,0,0">manual comment</d></i>');
  await harness.addFromSidebar(manualPath);
  harness.context.ddpAddToFileListAndLoad(7, 'Anime', '1', [{ t: 100, text: 'first' }], false, true);
  harness.context.ddpAddToFileListAndLoad(8, 'Anime', '2', [{ t: 200, text: 'second' }], false, true);
  const before = JSON.stringify(harness.context.danmakuFileList);
  const cacheBefore = JSON.stringify(harness.context.danmakuCache);
  const readsBefore = harness.fileReads.length;
  const scansBefore = harness.directoryReads.length;

  harness.emitSidebar('request-state');
  harness.emitSidebar('request-state');

  assert.equal(JSON.stringify(harness.context.danmakuFileList), before);
  assert.equal(JSON.stringify(harness.context.danmakuCache), cacheBefore);
  assert.equal(harness.fileReads.length, readsBefore);
  assert.equal(harness.directoryReads.length, scansBefore);
  const reported = harness.sidebarMessages.filter((message) => message.name === 'danmaku-file-list').at(-1).data;
  assert.deepEqual(Array.from(reported.selectedPaths), [encodeURIComponent(manualPath)]);
  assert.equal(reported.jsonFiles.length, 2);
  assert.ok(reported.xmlFiles.some((item) => item.path === encodeURIComponent(manualPath)));
});

test('manual selection before overlay readiness queues the latest source and enables time updates', async () => {
  const harness = createHarness(false);
  harness.setVideo('file:///videos/A.mp4');
  await harness.addFromSidebar('/videos/B.xml');

  assert.deepEqual(loadedComments(harness.overlayMessages), [], 'do not send data to an unready overlay');
  assert.equal(harness.context.danmakuEnabled, true);
  harness.readyOverlay();
  assert.deepEqual(loadedComments(harness.overlayMessages), ['<i><d p="1,1,25,16777215,0,0,0,0">B comment</d></i>']);
  harness.emitEvent('mpv.time-pos.changed', 12);
  assert.equal(harness.overlayMessages.at(-1).data.time, 12);
});

test('failed or cancelled file choices preserve the active source and renderer', async () => {
  const harness = createHarness(true);
  harness.readyOverlay();
  harness.setVideo('file:///videos/A.mp4');
  const loadsBefore = loadedComments(harness.overlayMessages);

  await harness.addFromSidebar('/downloads/missing.xml');
  await harness.loadFromMenu('/downloads/missing.xml');
  await harness.addFromSidebar(null);
  await harness.loadFromMenu(null);

  assert.deepEqual(Array.from(harness.context.danmakuFileList.selectedPaths), ['/videos/A.xml']);
  assert.equal(harness.context.currentDanmakuStatus.isLoaded, true);
  assert.deepEqual(loadedComments(harness.overlayMessages), loadsBefore);
});

test('reselecting a local file reads current content without duplicating its list entry', async () => {
  const harness = createHarness(true);
  harness.readyOverlay();
  harness.setVideo('file:///videos/A.mp4');
  const updated = '<i><d p="1,1,25,16777215,0,0,0,0">updated comment</d></i>';
  harness.setFile('/videos/A.xml', updated);

  await harness.addFromSidebar('/videos/A.xml');

  assert.equal(loadedComments(harness.overlayMessages).at(-1), updated);
  assert.equal(harness.context.danmakuFileList.xmlFiles.filter((item) => item.path === '/videos/A.xml').length, 1);
});

test('automatic loading handles file.read exceptions as a load failure', () => {
  const harness = createHarness(true);
  const filePath = '/videos/C.xml';
  harness.setFile(filePath, '<i><d p="1,1,25,16777215,0,0,0,0">C comment</d></i>');
  harness.failRead(filePath);
  harness.readyOverlay();

  harness.setVideo('file:///videos/C.mp4');

  assert.deepEqual(Array.from(harness.context.danmakuFileList.selectedPaths), []);
  assert.equal(harness.context.currentDanmakuStatus.isLoaded, false);
  assert.equal(harness.context.pendingDanmaku, null);
  assert.ok(harness.osdMessages.includes('Cannot read danmaku file: C.xml'));
  const errors = harness.sidebarMessages.filter((message) => message.name === 'danmaku-file-error');
  assert.equal(errors.at(-1).data.path, encodeURIComponent(filePath));
});

test('manual loading catches file.read exceptions and preserves the active source', async () => {
  const harness = createHarness(true);
  harness.readyOverlay();
  harness.setVideo('file:///videos/A.mp4');
  const brokenPath = '/downloads/broken.xml';
  harness.setFile(brokenPath, '<i><d p="2,1,25,16777215,0,0,0,0">broken</d></i>');
  harness.failRead(brokenPath);
  const loadsBefore = loadedComments(harness.overlayMessages);

  await harness.addFromSidebar(brokenPath);
  await harness.loadFromMenu(brokenPath);

  assert.deepEqual(Array.from(harness.context.danmakuFileList.selectedPaths), ['/videos/A.xml']);
  assert.equal(harness.context.currentDanmakuStatus.isLoaded, true);
  assert.deepEqual(loadedComments(harness.overlayMessages), loadsBefore);
  assert.equal(harness.osdMessages.filter((message) => message === 'Cannot read danmaku file: broken.xml').length, 2);
  const errors = harness.sidebarMessages.filter((message) => message.name === 'danmaku-file-error');
  assert.equal(errors.length, 2);
  assert.deepEqual(errors.map((message) => message.data.path), [encodeURIComponent(brokenPath), encodeURIComponent(brokenPath)]);
});

test('manual exact match loads network danmaku with auto-network off', async () => {
  const harness = createHarness(true, false);
  harness.readyOverlay();
  harness.setVideo('file:///videos/C.mp4');
  await flushMicrotasks();
  assert.equal(harness.httpRequests.length, 0);

  harness.emitSidebar('dandanplay-trigger-match');
  await flushMicrotasks();
  harness.resolveNextHttp({
    statusCode: 200,
    data: { success: true, isMatched: true, matches: [{ episodeId: 7, animeTitle: 'Anime', episodeTitle: 'EP1' }] },
  });
  await flushMicrotasks();
  assert.ok(harness.httpRequests.some((request) => request.url.includes('/api/v2/comment/7')));

  harness.resolveNextHttp({
    statusCode: 200,
    data: { comments: [{ p: '1,1,16777215,1', m: 'hello' }] },
  });
  await flushMicrotasks();

  const loaded = loadedComments(harness.overlayMessages);
  assert.equal(loaded.length, 1);
  assert.match(loaded[0], /hello/);
  assert.deepEqual(Array.from(harness.context.danmakuFileList.selectedPaths), ['dandanplay://7']);
  assert.ok(harness.osdMessages.some((message) => message.includes('Network danmaku loaded') && message.includes('EP1')));
});

test('manual network load before overlay readiness re-enables and flushes the pending source', async () => {
  const harness = createHarness(false, false);
  harness.setVideo('file:///videos/C.mp4');

  harness.emitSidebar('dandanplay-trigger-match');
  await flushMicrotasks();
  harness.resolveNextHttp({
    statusCode: 200,
    data: { success: true, isMatched: true, matches: [{ episodeId: 7, animeTitle: 'Anime', episodeTitle: 'EP1' }] },
  });
  await flushMicrotasks();
  harness.resolveNextHttp({
    statusCode: 200,
    data: { comments: [{ p: '1,1,16777215,1', m: 'hello' }] },
  });
  await flushMicrotasks();

  assert.notEqual(harness.context.pendingDanmaku, null);
  assert.equal(harness.context.danmakuEnabled, true);
  assert.deepEqual(loadedComments(harness.overlayMessages), []);

  harness.readyOverlay();
  assert.equal(loadedComments(harness.overlayMessages).length, 1);
  assert.ok(harness.osdMessages.some((message) => message.includes('Network danmaku loaded') && message.includes('EP1')));
  harness.emitEvent('mpv.time-pos.changed', 12);
  assert.equal(harness.overlayMessages.at(-1).data.time, 12);
});

test('manual match still loads when the toggle is disabled before the match response', async () => {
  const harness = createHarness(true, false);
  harness.readyOverlay();
  harness.setVideo('file:///videos/C.mp4');
  await flushMicrotasks();

  harness.emitSidebar('dandanplay-trigger-match');
  await flushMicrotasks();
  harness.toggleDanmaku();
  assert.equal(harness.context.danmakuEnabled, false);

  harness.resolveNextHttp({
    statusCode: 200,
    data: { success: true, isMatched: true, matches: [{ episodeId: 7, animeTitle: 'Anime', episodeTitle: 'EP1' }] },
  });
  await flushMicrotasks();
  assert.ok(harness.httpRequests.some((request) => request.url.includes('/api/v2/comment/7')));

  harness.resolveNextHttp({
    statusCode: 200,
    data: { comments: [{ p: '1,1,16777215,1', m: 'hello' }] },
  });
  await flushMicrotasks();

  assert.equal(loadedComments(harness.overlayMessages).length, 1);
  assert.equal(harness.context.danmakuEnabled, true);
});

test('manual match still loads when the toggle is disabled while comments download', async () => {
  const harness = createHarness(true, false);
  harness.readyOverlay();
  harness.setVideo('file:///videos/C.mp4');
  await flushMicrotasks();

  harness.emitSidebar('dandanplay-trigger-match');
  await flushMicrotasks();
  harness.resolveNextHttp({
    statusCode: 200,
    data: { success: true, isMatched: true, matches: [{ episodeId: 7, animeTitle: 'Anime', episodeTitle: 'EP1' }] },
  });
  await flushMicrotasks();
  assert.ok(harness.httpRequests.some((request) => request.url.includes('/api/v2/comment/7')));
  harness.toggleDanmaku();
  assert.equal(harness.context.danmakuEnabled, false);

  harness.resolveNextHttp({
    statusCode: 200,
    data: { comments: [{ p: '1,1,16777215,1', m: 'hello' }] },
  });
  await flushMicrotasks();

  assert.equal(loadedComments(harness.overlayMessages).length, 1);
  assert.equal(harness.context.danmakuEnabled, true);
});

test('manual filename-match selection loads with auto-network off', async () => {
  const harness = createHarness(true, false);
  harness.readyOverlay();
  harness.setVideo('file:///videos/C.mp4');
  await flushMicrotasks();

  harness.emitSidebar('dandanplay-select-match', { match: { episodeId: 7, animeTitle: 'Anime', episodeTitle: 'EP1' } });
  await flushMicrotasks();
  assert.ok(harness.httpRequests.some((request) => request.url.includes('/api/v2/comment/7')));

  harness.resolveNextHttp({
    statusCode: 200,
    data: { comments: [{ p: '1,1,16777215,1', m: 'hello' }] },
  });
  await flushMicrotasks();

  assert.equal(loadedComments(harness.overlayMessages).length, 1);
  assert.deepEqual(Array.from(harness.context.danmakuFileList.selectedPaths), ['dandanplay://7']);
});

test('background match still stops when the toggle is disabled before the match response', async () => {
  const harness = createHarness(true, true);
  harness.setNetworkResource(true);
  harness.readyOverlay();
  harness.setVideo('https://example.com/video.m3u8');
  await flushMicrotasks();
  assert.ok(harness.httpRequests.some((request) => request.url.includes('/api/v2/match')));

  harness.toggleDanmaku();
  harness.resolveNextHttp({
    statusCode: 200,
    data: { success: true, isMatched: true, matches: [{ episodeId: 7, animeTitle: 'Anime', episodeTitle: 'EP1' }] },
  });
  await flushMicrotasks();

  assert.equal(harness.context.danmakuEnabled, false);
  assert.equal(harness.httpRequests.some((request) => request.url.includes('/api/v2/comment/7')), false);
  assert.deepEqual(loadedComments(harness.overlayMessages), []);
});

test('overlay listeners survive loadFile and register only once after navigation', () => {
  const h = createHarness(true);
  h.readyOverlay();
  assert.equal(h.context.overlayReady, true);
  h.readyOverlay();
  h.emitOverlay('seek-disable');
  assert.equal(h.osdMessages.filter(x => x === 'Danmaku: seek disabled').length, 1);
});

test('overlay readiness preserves an in-flight match and sends paused/visibility state', async () => {
  const h = createHarness(true, true);
  h.setPaused(true);
  h.setVideo('file:///videos/A.mp4');
  await flushMicrotasks();
  h.readyOverlay();
  await flushMicrotasks();
  assert.equal(h.httpRequests.length, 1, 'ready must not restart matching or hashing');
  assert.ok(h.overlayMessages.some(x => x.name === 'pause-state' && x.data.paused));
  const disabled = createHarness(false);
  disabled.readyOverlay();
  assert.ok(disabled.overlayMessages.some(x => x.name === 'toggle-danmaku' && !x.data.enabled));
});

test('queued sources use the latest filters and settings when the overlay becomes ready', () => {
  const h = createHarness(true);
  h.setVideo('file:///videos/A.mp4');
  h.emitSidebar('set-fontscale', {scale: 0.5});
  h.emitSidebar('danmaku-blocklist-add', {word: 'A comment'});
  h.emitSidebar('danmaku-blocklist-set-enabled', {enabled: true});
  h.readyOverlay();
  const load = h.overlayMessages.findLast(x => x.name === 'load-danmaku');
  assert.equal(load.data.canvasFontScale, 0.5);
  assert.equal(decodeURIComponent(load.data.xmlContent), '<i></i>');
});

for (const response of [
  {statusCode: 200, data: {success: true, matches: []}},
  {statusCode: 403},
  {statusCode: 500, text: 'bad gateway'},
  {statusCode: 200, data: {success: false}},
]) {
  test(`network matching fallback handles ${JSON.stringify(response)}`, async () => {
    const h = createHarness(true, true);
    h.readyOverlay();
    h.setVideo('file:///videos/A.mp4');
    await flushMicrotasks();
    h.resolveNextHttp(response);
    await flushMicrotasks();
    assert.match(loadedComments(h.overlayMessages).at(-1), /A comment/);
  });
}

test('a network failure after disabling cannot activate local or stale danmaku', async () => {
  const h = createHarness(true, true);
  h.readyOverlay();
  h.setVideo('file:///videos/A.mp4');
  await flushMicrotasks();
  h.toggleDanmaku();
  h.rejectNextHttp(new Error('offline'));
  await flushMicrotasks();
  assert.equal(h.context.danmakuEnabled, false);
  assert.deepEqual(loadedComments(h.overlayMessages), []);
});

test('latest network episode selection wins even when responses arrive in reverse order', async () => {
  const h = createHarness(true);
  h.readyOverlay();
  h.setVideo('file:///videos/C.mp4');
  for (const id of [7, 8]) h.emitSidebar('dandanplay-select-episode', {episodeId: id, animeTitle: 'Anime', episodeTitle: String(id)});
  h.resolveHttp(1, {statusCode: 200, data: {comments: [{p: '1,1,16777215,user', m: 'new'}]}});
  await flushMicrotasks();
  h.resolveNextHttp({statusCode: 200, data: {comments: [{p: '1,1,16777215,user', m: 'old'}]}});
  await flushMicrotasks();
  assert.deepEqual(Array.from(h.context.danmakuFileList.selectedPaths), ['dandanplay://8']);
  assert.equal(loadedComments(h.overlayMessages).length, 1);
  assert.match(loadedComments(h.overlayMessages)[0], /new/);
});

test('manual local selection supersedes a pending automatic match', async () => {
  const h = createHarness(true, true);
  h.readyOverlay();
  h.setVideo('file:///videos/A.mp4');
  await flushMicrotasks();
  await h.addFromSidebar('/videos/A.xml');
  h.resolveNextHttp({statusCode: 200, data: {isMatched: true, matches: [{episodeId: 7}]}});
  await flushMicrotasks();
  assert.equal(h.httpRequests.length, 1);
  assert.deepEqual(Array.from(h.context.danmakuFileList.selectedPaths), ['/videos/A.xml']);
});

test('search replies carry identity and discard an obsolete keyword response', async () => {
  const h = createHarness(true);
  h.emitSidebar('dandanplay-search', {keyword: 'old', searchId: 1});
  h.emitSidebar('dandanplay-search', {keyword: 'new', searchId: 2});
  h.resolveHttp(1, {data: {animes: [{animeId: 2, animeTitle: 'new'}]}});
  await flushMicrotasks();
  h.resolveNextHttp({data: {animes: [{animeId: 1, animeTitle: 'old'}]}});
  await flushMicrotasks();
  const replies = h.sidebarMessages.filter(x => x.name === 'dandanplay-search-result');
  assert.equal(replies.length, 1);
  assert.equal(replies[0].data.searchId, 2);
});

test('the first cache write waits for mkdir and stores the video identity', async () => {
  const h = createHarness(true);
  let finishMkdir;
  h.setExec((command, args) => {
    assert.equal(command, '/bin/mkdir');
    assert.deepEqual(Array.from(args), ['-p', '@data/danmaku-cache/']);
    return new Promise(resolve => { finishMkdir = resolve; });
  });
  const saved = h.context.ddpSaveVideoCache('file:///videos/C.mp4', 7, 'Anime', '1', [{t: 1, text: 'hi'}]);
  assert.equal(h.fileWrites.length, 0);
  finishMkdir({status: 0});
  assert.equal(await saved, true);
  assert.equal(h.fileWrites.length, 1);
  assert.equal(JSON.parse(h.fileWrites[0].content).videoPath, 'file:///videos/C.mp4');
});

test('cache rejects invalid shapes and path collisions, and treats future dates as stale', () => {
  const h = createHarness(true);
  const url = 'file:///videos/C.mp4';
  const file = h.context.ddpCacheFile(url);
  h.setFile(file, JSON.stringify({episodeId: 7, comments: {}, cachedAt: Date.now()}));
  assert.equal(h.context.ddpReadVideoCache(url), null);
  h.setFile(file, JSON.stringify({episodeId: 7, comments: [], videoPath: 'different', cachedAt: Date.now()}));
  assert.equal(h.context.ddpReadVideoCache(url), null);
  h.setFile(file, JSON.stringify({episodeId: 7, comments: [], cachedAt: Date.now() + 60000}));
  assert.equal(h.context.ddpReadVideoCache(url).stale, true);
});

test('XML attributes, CDATA and numeric entities have the same text in filters and lists', () => {
  const h = createHarness(true);
  const source = '<i><d extra="a>b" p=\'1,5,25,16777215,1\'>&amp;lt; &#x8349;<![CDATA[ &lt; ]]></d><d p="2,7,25,16777215,2">unsupported</d></i>';
  const p = setPositionSource(h, 'bilibili-xml', source);
  const items = Array.from(h.context.buildDanmakuBrowserList());
  assert.equal(items.length, 1);
  assert.equal(items[0].text, '&lt; 草 &lt; ');
  h.emitSidebar('danmaku-blocklist-add', {word: '^&lt; 草'});
  h.emitSidebar('danmaku-blocklist-set-enabled', {enabled: true});
  assert.equal(decodeURIComponent(h.context.getEffectiveContent(p)), '<i><d p="2,7,25,16777215,2">unsupported</d></i>');
});

test('simplification operates on decoded text and preserves metadata and literal entity text', () => {
  const h = createHarness(true);
  h.context.danmakuForceSimplified = true;
  h.context.openccSimplifier = text => text.replace(/體/g, '体');
  const source = '<packet><chat user_id="體" mail="font:體" vpos="-10">&#x9ad4; &amp;lt;</chat></packet>';
  const p = setPositionSource(h, 'nico-xml', source);
  const effective = decodeURIComponent(h.context.getEffectiveContent(p));
  assert.match(effective, /user_id="體" mail="font:體"/);
  assert.match(effective, />体 &amp;lt;<\/chat>/);
  assert.equal(h.context.buildDanmakuBrowserList()[0].text, '体 &lt;');
  assert.equal(h.context.buildDanmakuBrowserList()[0].t, -10);
});

test('real legacy JSON density and blocking preserve owners and match the bundled parser', () => {
  const h = createHarness(true);
  const source = [{thread: {resultcode: 0}}, ...Array.from({length: 5}, (_, i) => ({chat: {vpos: i * 100, no: i + 1, content: 'c' + i, user_id: 'u', mail: ''}})), {chat: {vpos: 0, content: 'owner'}}];
  const p = setPositionSource(h, 'nico-json', JSON.stringify(source));
  h.context.danmakuFilterDensity = 1;
  const filtered = JSON.parse(decodeURIComponent(h.context.getEffectiveContent(p)));
  const N = require('../overlay/lib/niconicomments.min.js');
  const parsed = N.internal.inputParser.default(filtered, 'legacy');
  assert.deepEqual(parsed.map(c => c.content).sort(), ['c4', 'owner']);
  assert.deepEqual(Array.from(h.context.buildDanmakuBrowserList(), c => c.text).sort(), ['c4', 'owner']);
  h.emitSidebar('danmaku-blocklist-add', {word: 'owner|c4'});
  h.emitSidebar('danmaku-blocklist-set-enabled', {enabled: true});
  const final = JSON.parse(decodeURIComponent(h.context.getEffectiveContent(p)));
  assert.deepEqual(N.internal.inputParser.default(final, 'legacy').map(c => c.content), ['owner']);
});

test('IPC envelopes prevent template interpolation while preserving the string', () => {
  const h = createHarness(true);
  const text = '${globalThis.injected = true}';
  h.context.sidebarPostMessage('test', {text});
  const data = h.sidebarMessages.at(-1).data;
  const simulatedBridge = vm.createContext({});
  const json = vm.runInContext('String.raw`' + JSON.stringify(data) + '`', simulatedBridge);
  assert.equal(simulatedBridge.injected, undefined);
  assert.equal(JSON.parse(decodeURIComponent(JSON.parse(json).encodedPayload)).text, text);
  h.context.overlayPostMessage('test', {fontFamily: '`' + text});
  assert.equal(JSON.parse(decodeURIComponent(h.overlayMessages.at(-1).data.encodedPayload)).fontFamily, '`' + text);
});

test('automatic local loading prioritizes exact JSON and retries unreadable candidates', () => {
  const h = createHarness(true);
  h.setFile('/videos/A.json', '[{"fork":"main","comments":[]}]');
  h.readyOverlay();
  h.setVideo('file:///videos/A.mp4');
  assert.deepEqual(Array.from(h.context.danmakuFileList.selectedPaths), ['/videos/A.json']);
  h.failRead('/videos/A.json');
  h.setVideo('file:///videos/A.mp4');
  assert.deepEqual(Array.from(h.context.danmakuFileList.selectedPaths), ['/videos/A.xml']);
});

test('episode 1 does not prefix-match episode 10', () => {
  const h = createHarness(true);
  h.setFile('/videos/EP10.xml', '<i/>');
  assert.equal(h.context.findDanmakuByEpisode('file:///videos/EP1.mp4').xmlFiles.length, 0);
});

test('a delayed duration comparison cannot cross video generations', () => {
  const h = createHarness(true);
  h.context.danmakuFileList.selectedPaths = ['/shared.json'];
  h.context.checkNicoJsonDuration(encodeURIComponent(JSON.stringify([{fork: 'main', duration: 100}])));
  h.setVideo('file:///videos/B.mp4');
  h.context.danmakuFileList.selectedPaths = ['/shared.json'];
  h.setMpv('duration', 120);
  h.runTimers(800);
  assert.equal(h.context.danmakuTimeOffsetSec, 0);
});

test('duration availability reaches a lazily opened sidebar independently of duration mismatch', () => {
  for (const videoDuration of [0, 100, 120]) {
    const h = createHarness(true, false, {danmakuAutoOffset: false});
    h.setMpv('duration', videoDuration);
    h.setFile('/videos/with-duration.json', JSON.stringify([{fork: 'main', duration: 100, comments: []}]));
    h.emitSidebar('select-danmaku-file', {path: encodeURIComponent('/videos/with-duration.json')});
    assert.equal(h.sidebarMessages.findLast(m => m.data?.nicoJsonHasDuration !== undefined).data.nicoJsonHasDuration, true);
    h.emitSidebar('request-state');
    const state = h.sidebarMessages.findLast(m => m.name === 'danmaku-state').data;
    assert.equal(state.danmakuLoaded, true);
    assert.equal(state.danmakuFileType, 'nico-json');
    assert.equal(state.nicoJsonHasDuration, true);
    assert.equal(state.nicoJsonDurationDiff, videoDuration === 120 ? 20 : null);
    assert.equal(state.danmakuAutoOffset, false);
  }
});

test('automatic intro offset stays off until the user enables it', () => {
  const h = createHarness(true);
  h.setMpv('duration', 120);
  h.setFile('/videos/with-duration.json', JSON.stringify([{fork: 'main', duration: 100, comments: []}]));
  h.emitSidebar('select-danmaku-file', {path: encodeURIComponent('/videos/with-duration.json')});
  assert.equal(h.context.danmakuTimeOffsetSec, 0);
  assert.equal(h.context.nicoJsonDurationDiff, 20);
  h.emitSidebar('request-state');
  const state = h.sidebarMessages.findLast(m => m.name === 'danmaku-state').data;
  assert.equal(state.danmakuAutoOffset, false);
  assert.equal(state.nicoJsonHasDuration, true);
  h.emitSidebar('set-danmaku-auto-offset', {value: true});
  assert.equal(h.context.danmakuTimeOffsetSec, -20);
});

test('switching sources clears duration availability for unsupported or missing metadata', () => {
  const h = createHarness(true, false, {danmakuAutoOffset: false});
  const sources = [
    ['missing.json', [{fork: 'main', comments: []}]],
    ['owner.json', [{fork: 'owner', duration: 100, comments: []}]],
    ['string.json', [{fork: 'main', duration: '100', comments: []}]],
    ['zero.json', [{fork: 'main', duration: 0, comments: []}]],
    ['negative.json', [{fork: 'main', duration: -1, comments: []}]],
    ['legacy.json', [{chat: {vpos: 100, content: 'legacy'}}]],
    ['nico.xml', '<packet><chat vpos="100">nico</chat></packet>'],
    ['bilibili.xml', '<i><d p="1,1,25,16777215,0,0,0,0">bilibili</d></i>'],
    ['ddp.json', {source: 'dandanplay', comments: [{t: 100, text: 'network'}]}],
  ];
  h.setFile('/videos/with-duration.json', JSON.stringify([{fork: 'main', duration: 100, comments: []}]));
  for (const [name, source] of sources) {
    h.emitSidebar('select-danmaku-file', {path: encodeURIComponent('/videos/with-duration.json')});
    const sourcePath = '/videos/' + name;
    h.setFile(sourcePath, typeof source === 'string' ? source : JSON.stringify(source));
    h.emitSidebar('select-danmaku-file', {path: encodeURIComponent(sourcePath)});
    assert.equal(h.sidebarMessages.findLast(m => m.data?.nicoJsonHasDuration !== undefined).data.nicoJsonHasDuration, false, name);
    h.emitSidebar('request-state');
    assert.equal(h.sidebarMessages.findLast(m => m.name === 'danmaku-state').data.nicoJsonHasDuration, false, name);
  }
  h.emitSidebar('select-danmaku-file', {path: encodeURIComponent('/videos/with-duration.json')});
  h.setVideo('file:///videos/B.mp4');
  h.emitSidebar('request-state');
  const state = h.sidebarMessages.findLast(m => m.name === 'danmaku-state').data;
  assert.equal(state.nicoJsonHasDuration, false);
  assert.equal(state.danmakuAutoOffset, false);
});

test('renderer errors update load status while stale replies cannot alter the new video', () => {
  const h = createHarness(true);
  h.readyOverlay();
  h.setVideo('file:///videos/A.mp4');
  const id = h.overlayMessages.findLast(m => m.name === 'load-danmaku').data.loadId;
  h.emitOverlay('danmaku-load-result',{loadId:id,success:false});
  assert.equal(h.context.currentDanmakuStatus.isLoaded,false);
  assert.ok(h.osdMessages.includes('Cannot render this danmaku file'));
  h.setVideo('file:///videos/B.mp4');
  h.emitOverlay('danmaku-load-result',{loadId:id,success:false});
  assert.equal(h.context.currentDanmakuStatus.isLoaded,true);
  h.toggleDanmaku();
  h.setVideo('file:///videos/C.mp4');
  h.emitOverlay('danmaku-load-result',{loadId:id,success:true});
  assert.equal(h.context.currentDanmakuStatus.isLoaded,false);
});

test('fresh cache bypasses matching and malformed DDP rows do not discard valid comments', async () => {
  const h = createHarness(true,true);
  const url='file:///videos/C.mp4';
  h.setFile(h.context.ddpCacheFile(url),JSON.stringify({episodeId:7,cachedAt:Date.now(),comments:[{t:100,text:'cached'}]}));
  h.readyOverlay();
  h.setVideo(url);
  await flushMicrotasks();
  assert.equal(h.httpRequests.length,0);
  assert.match(loadedComments(h.overlayMessages).at(-1),/cached/);
  const list=h.context.ddpConvertComments([null,{p:4,m:'bad'}, {p:'Infinity,1,16777215,id',m:'bad'}, {p:'1,1,16777215,abc123',m:'ok'}]);
  assert.equal(list.length,1);
  assert.equal(list[0]._userId,'abc123');
});

test('XML scans skip comments and self-closing elements without consuming the next danmaku', () => {
  const h=createHarness(true);
  const source='<packet><!-- <chat vpos="0">fake</chat> --><chat vpos="0"/><chat vpos="200">real<!--hidden--></chat></packet>';
  setPositionSource(h,'nico-xml',source);
  const list=h.context.buildDanmakuBrowserList();
  assert.equal(list.length,1);
  assert.equal(list[0].t,200);
  assert.equal(list[0].text,'real');
});
