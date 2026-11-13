'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const {parseDanmakuSource, projectDanmaku} = require('../danmaku-document.js');
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

function createHarness(initialEnabled, autoNetwork = false, savedPreferences = {}, weakMessageCallbacks = false) {
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
    ...Object.entries(require('../Info.json').preferenceDefaults),
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

  function registerMessage(map, name, handler) {
    map.set(name, [weakMessageCallbacks ? new WeakRef(handler) : handler]);
  }

  const iina = {
    overlay: {
      loadFile() { overlayHandlers.clear(); },
      show() {},
      hide() {},
      postMessage(name, data) { overlayMessages.push({ name, wire: data, data: JSON.parse(data.__encoded ? decodeURIComponent(data.__encoded) : JSON.stringify(data)) }); },
      onMessage(name, handler) { registerMessage(overlayHandlers, name, handler); },
    },
    sidebar: {
      loadFile() { sidebarHandlers.clear(); },
      postMessage(name, data) { sidebarMessages.push({ name, wire: data, data: JSON.parse(data.__encoded ? decodeURIComponent(data.__encoded) : JSON.stringify(data)) }); },
      onMessage(name, handler) { registerMessage(sidebarHandlers, name, handler); },
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
    require: name => require(path.join(__dirname, '..', name)),
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
    for (const handler of map.get(name) || []) {
      const callback = handler instanceof WeakRef ? handler.deref() : handler;
      assert.equal(typeof callback, 'function', `Message callback was collected: ${name}`);
      callback(data);
    }
  }

  return {
    context,
    preferences,
    httpRequests,
    overlayMessages,
    sidebarMessages,
    sidebarHandlers,
    overlayHandlers,
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
    ackLoad(success = true) {
      const last = overlayMessages.findLast(message => message.name === 'load-danmaku');
      assert.ok(last, 'a source was dispatched');
      emit(overlayHandlers, 'danmaku-load-result', {loadId: last.data.loadId, success});
    },
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

test('WebView callbacks survive garbage collection and reloads', async () => {
  // Run with real GC and weak native registrations; the default harness would
  // otherwise keep callbacks alive and hide the IINA JSManagedValue failure.
  if (typeof global.gc !== 'function') {
    const child = spawnSync(process.execPath, [
      '--expose-gc', '--test',
      '--test-name-pattern=^WebView callbacks survive garbage collection and reloads$',
      __filename,
    ], { encoding: 'utf8', timeout: 30000 });
    assert.equal(child.status, 0, child.error?.message || child.stdout + child.stderr);
    return;
  }

  const h = createHarness(true, false, {}, true);
  h.readyOverlay();

  async function collectGarbage() {
    // WeakRef targets remain alive until the current job ends.
    for (let i = 0; i < 5; i++) {
      await new Promise(resolve => setImmediate(resolve));
      global.gc();
    }
  }

  for (let reload = 0; reload < 3; reload++) {
    await collectGarbage();
    for (const handlers of [h.sidebarHandlers, h.overlayHandlers]) {
      for (const [name, [weak]] of handlers) {
        assert.equal(typeof weak.deref(), 'function', `Message callback was collected: ${name}`);
      }
    }
    h.emitSidebar('set-fontscale', { scale: 0.5 });
    assert.equal(h.preferences.get('niconicommentsFontScale'), 0.5);
    const osdCount = h.osdMessages.length;
    h.emitOverlay('seek-disable');
    assert.equal(h.osdMessages.length, osdCount + 1);

    const previousSidebar = h.sidebarHandlers.get('set-fontscale')[0];
    const previousOverlay = h.overlayHandlers.get('overlay-ready')[0];
    h.emitEvent('iina.window-loaded');
    h.readyOverlay();
    await collectGarbage();
    assert.equal(previousSidebar.deref(), undefined, 'Replaced sidebar callbacks can be collected');
    assert.equal(previousOverlay.deref(), undefined, 'Replaced overlay callbacks can be collected');
  }
});

function loadedComments(messages) {
  return messages
    .filter((message) => message.name === 'load-danmaku')
    .map((message) => JSON.stringify(message.data.comments));
}

async function flushMicrotasks() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

function setPositionSource(harness, fileType, source) {
  const sourcePath = '/videos/positions';
  harness.context.danmakuCache[sourcePath] = parseDanmakuSource(source, sourcePath, fileType);
  harness.context.pluginState.danmakuFileList.selectedPaths = [sourcePath];
  harness.context.pluginState.currentDanmakuStatus.fileType = fileType;
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
    assert.equal(harness.context.getEffectiveContent(sourcePath).length, 3, '默认关闭');
    for (const [top, bottom] of [[true, false], [false, true], [true, true], [false, false]]) {
      harness.emitSidebar('danmaku-position-filter-set', { danmakuBlockTopEnabled: top, danmakuBlockBottomEnabled: bottom });
      const effective = JSON.stringify(harness.context.getEffectiveContent(sourcePath));
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
      const sentItems = message.data.items;
      assert.deepEqual(sentItems.map((item) => ({ text: item.text, blocked: item.blocked })), items, '列表收到划线标记');
    }
    assert.equal(harness.context.danmakuCache[sourcePath].comments.length, 3, '过滤不修改 IR');
  });
}

test('CSS shadow blur persists, restores to lazy views, and rejects invalid values', () => {
  const h = createHarness(true);
  h.readyOverlay();
  h.emitSidebar('request-state');
  assert.equal(h.sidebarMessages.findLast(m => m.name === 'danmaku-state').data.cssTextShadowBlur, 0);
  h.emitSidebar('set-css-text-shadow-blur', {blur: 3.5});
  assert.equal(h.preferences.get('cssTextShadowBlur'), 3.5);
  assert.equal(h.overlayMessages.findLast(m => m.name === 'set-css-text-shadow-blur').data.blur, 3.5);
  assert.equal(h.context.buildLoadDanmakuPayload([], 'nico-json').cssTextShadowBlur, 3.5);
  for (const blur of [-1, 10.5, NaN, Infinity, '2', null]) h.emitSidebar('set-css-text-shadow-blur', {blur});
  assert.equal(h.preferences.get('cssTextShadowBlur'), 3.5);
  h.emitSidebar('set-style-preset', {preset: 'bilibili'});
  h.emitSidebar('set-canvas-mode', {mode: 'default'});
  assert.equal(h.preferences.get('cssTextShadowBlur'), 3.5, 'presets and Canvas keep the CSS-only preference');
  const restored = createHarness(true, false, Object.fromEntries(h.preferences));
  restored.emitSidebar('request-state');
  assert.equal(restored.sidebarMessages.findLast(m => m.name === 'danmaku-state').data.cssTextShadowBlur, 3.5);
  assert.equal(restored.context.buildLoadDanmakuPayload([], 'nico-json').cssTextShadowBlur, 3.5);
  restored.emitSidebar('set-css-text-shadow-blur', {blur: 0});
  assert.equal(restored.preferences.get('cssTextShadowBlur'), 0);
  const invalid = createHarness(true, false, {cssTextShadowBlur: -1});
  assert.equal(invalid.context.buildLoadDanmakuPayload([], 'nico-json').cssTextShadowBlur, 0);
});

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
  for (const name of ['danmaku-state']) {
    state = restarted.sidebarMessages.find((item) => item.name === name).data;
    assert.equal(state.danmakuBlockTopEnabled, true);
    assert.equal(state.danmakuBlockBottomEnabled, false);
  }
});

const densityXmlFixture = '<i>' + Array.from({ length: 400 }, (_, index) =>
  `<d p="1,1,25,16777215,0,0,user${index},${index}">comment ${index}</d>`
).join('') + '</i>';

test('density defaults to unlimited and leaves the first video unfiltered before the sidebar opens', () => {
  const harness = createHarness(true);
  harness.setFile('/videos/A.xml', densityXmlFixture);
  harness.readyOverlay();
  harness.setVideo('file:///videos/A.mp4');
  assert.equal(JSON.parse(loadedComments(harness.overlayMessages).at(-1)).length, 400);
  harness.emitSidebar('request-state');
  assert.equal(harness.sidebarMessages.findLast(m => m.name === 'danmaku-state').data.danmakuFilterDensity, 0);
  const info = harness.sidebarMessages.findLast(m => m.name === 'danmaku-filter-info').data;
  assert.equal(info.filteredCount, 400);
  assert.equal(info.sourceTotalCount, 400);
});

for (const density of [300, 0]) {
  test(`density ${density || 'unlimited'} persists through restart, source selection and video changes`, () => {
    const harness = createHarness(true);
    let syncCount = 0;
    harness.context.iina.preferences.sync = () => { syncCount += 1; };
    harness.emitSidebar('set-danmaku-filter-density', { density });
    assert.equal(harness.preferences.get('danmakuFilterDensity'), density);
    assert.equal(syncCount, 0);
    harness.runTimers(250);
    assert.equal(syncCount, density === 0 ? 0 : 1);

    const restarted = createHarness(true, false, Object.fromEntries(harness.preferences));
    restarted.setFile('/videos/A.xml', densityXmlFixture);
    restarted.setFile('/videos/B.xml', densityXmlFixture);
    restarted.readyOverlay();
    restarted.setVideo('file:///videos/A.mp4');
    restarted.emitSidebar('request-state');
    assert.equal(restarted.sidebarMessages.findLast(m => m.name === 'danmaku-state').data.danmakuFilterDensity, density);
    assert.equal(JSON.parse(loadedComments(restarted.overlayMessages).at(-1)).length, density || 400);

    restarted.emitSidebar('select-danmaku-file', { path: '/videos/B.xml' });
    assert.equal(JSON.parse(loadedComments(restarted.overlayMessages).at(-1)).length, density || 400);
    restarted.setVideo('file:///videos/B.mp4');
    const info = restarted.sidebarMessages.findLast(m => m.name === 'danmaku-filter-info').data;
    assert.equal(info.filterDensity, density);
    assert.equal(info.filteredCount, density || 400);
    assert.equal(info.sourceTotalCount, 400);
    assert.equal(JSON.parse(loadedComments(restarted.overlayMessages).at(-1)).length, density || 400);
  });
}

test('V1 density counts use the date-sliced input total and include protected threads', () => {
  const harness = createHarness(true, false, { danmakuFilterDensity: 5 });
  harness.readyOverlay();
  harness.setFile('/videos/counts.json', JSON.stringify([
    { fork: 'main', comments: Array.from({ length: 20 }, (_, index) =>
      ({ no: index + 1, vposMs: 1000, body: `comment ${index}`, commands: [],
        postedAt: index < 3 ? '2026-01-01T12:00:00+09:00' : '2026-01-02T12:00:00+09:00' })) },
    { fork: 'owner', comments: [{ vposMs: 1000, body: 'owner', commands: [] }] },
    { fork: 'easy', comments: [{ vposMs: 1000, body: 'easy', commands: [] }] },
  ]));
  harness.emitSidebar('select-danmaku-file', { path: '/videos/counts.json' });
  function assertCounts(kept, inputCount = 22) {
    harness.emitSidebar('request-state');
    const info = harness.sidebarMessages.findLast(m => m.name === 'danmaku-filter-info').data;
    assert.equal(info.sourceTotalCount, inputCount);
    assert.equal(info.filteredCount, kept);
    assert.equal(info.totalCount, 20, 'date selector keeps its own main-thread count');
  }
  assertCounts(7);
  const firstDay = Date.UTC(2026, 0, 1) / 86400000;
  harness.emitSidebar('set-danmaku-filter', { startDay: firstDay, endDay: firstDay });
  assertCounts(5, 5);
  harness.emitSidebar('set-danmaku-filter-density', { density: 1 });
  assertCounts(3, 5);
  harness.emitSidebar('set-danmaku-filter-density', { density: 0 });
  assertCounts(5, 5);
  harness.emitSidebar('set-danmaku-filter', { startDay: null, endDay: null });
  assertCounts(22);
});

test('legacy density counts include owner comments and exclude metadata records', () => {
  const harness = createHarness(true, false, { danmakuFilterDensity: 5 });
  harness.readyOverlay();
  harness.setFile('/videos/legacy-counts.json', JSON.stringify([
    { thread: { resultcode: 0 } },
    { chat: { vpos: 100, content: 'owner' } },
    ...Array.from({ length: 20 }, (_, index) =>
      ({ chat: { no: index + 1, vpos: 100, content: `comment ${index}`, user_id: 'viewer' } })),
  ]));
  harness.emitSidebar('select-danmaku-file', { path: '/videos/legacy-counts.json' });
  let info = harness.sidebarMessages.findLast(m => m.name === 'danmaku-filter-info').data;
  assert.equal(info.sourceTotalCount, 21);
  assert.equal(info.filteredCount, 6);
  harness.emitSidebar('set-danmaku-filter-density', { density: 0 });
  info = harness.sidebarMessages.findLast(m => m.name === 'danmaku-filter-info').data;
  assert.equal(info.sourceTotalCount, 21);
  assert.equal(info.filteredCount, 21);
});

test('position blocking and shared static deduplication produce identical screen and list groups', () => {
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
    { text: 'samex2', blocked: true },
    { text: 'same', blocked: false },
    { text: 'blocked-word', blocked: true },
    { text: 'visiblex2', blocked: false },
  ]);
  harness.emitSidebar('danmaku-position-filter-set', { danmakuBlockTopEnabled: false });
  const source = harness.context.getEffectiveContent('/videos/positions');
  assert.deepEqual(Array.from(source, item => item.content), ['samex2', 'same', 'visiblex2']);
  assert.equal(source.some((item) => item.content === 'blocked-word'), false, '关闭位置过滤仍保留屏蔽词过滤');
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
  const filtered = JSON.parse(JSON.stringify(harness.context.getEffectiveContent(sourcePath)));
  assert.deepEqual(filtered.map(item => item.content), ['scroll-first', 'bottom-first', 'owner-top']);
  const blocked = Array.from(harness.context.buildDanmakuBrowserList()).filter((item) => item.blocked).map((item) => item.text);
  assert.deepEqual(blocked, ['upper-top', 'top-first']);
});

test('switching videos while disabled clears A and loads B when re-enabled', () => {
  const harness = createHarness(true);
  harness.readyOverlay();
  harness.setVideo('file:///videos/A.mp4');
  assert.deepEqual(loadedComments(harness.overlayMessages).map(s => JSON.parse(s).map(c => c.content).join()), ['A comment']);

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
  assert.equal(harness.context.pluginState.currentDanmakuStatus.isLoaded, false);
  assert.equal(harness.context.pluginState.danmakuFileList.selectedPaths.length, 0);

  harness.toggleDanmaku();
  assert.deepEqual(loadedComments(harness.overlayMessages).map(s => JSON.parse(s).map(c => c.content).join()), ['A comment', 'B comment']);
});

test('enabling after startup-disabled file load initializes that video', () => {
  const harness = createHarness(false);
  harness.readyOverlay();
  harness.setVideo('file:///videos/B.mp4');
  assert.deepEqual(loadedComments(harness.overlayMessages), []);

  harness.toggleDanmaku();
  assert.deepEqual(loadedComments(harness.overlayMessages).map(s => JSON.parse(s).map(c => c.content).join()), ['B comment']);
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
  assert.equal(harness.context.pluginState.danmakuEnabled, false);
  assert.equal(harness.context.pluginState.currentDanmakuStatus.isLoaded, false);
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
  assert.equal(harness.context.pluginState.currentDanmakuStatus.isLoaded, false);
});


test('menu loading selects and lists the source used by later filters', async () => {
  const harness = createHarness(true);
  harness.readyOverlay();
  harness.setVideo('file:///videos/A.mp4');
  const manualPath = '/downloads/manual.xml';
  harness.setFile(manualPath, '<i><d p="2,1,25,16777215,0,0,0,0">manual comment</d></i>');

  await harness.loadFromMenu(manualPath);

  assert.deepEqual(Array.from(harness.context.pluginState.danmakuFileList.selectedPaths), [manualPath]);
  assert.ok(harness.context.findDanmakuFileByPath(manualPath));
  assert.deepEqual(Array.from(harness.context.buildDanmakuBrowserList(), (item) => item.text), ['manual comment']);
  harness.emitSidebar('danmaku-blocklist-add', { word: 'manual' });
  harness.emitSidebar('danmaku-blocklist-set-enabled', { enabled: true });
  assert.equal(loadedComments(harness.overlayMessages).at(-1), '[]');
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
      assert.deepEqual(load.data.comments.map(c => c.content), ['DDP comment']);
      assert.deepEqual(Array.from(harness.context.pluginState.danmakuFileList.selectedPaths), [filePath]);
      assert.deepEqual(Array.from(harness.context.buildDanmakuBrowserList(), (item) => item.text), ['DDP comment']);
    }
    assertDdpLoaded();
    await harness.loadFromMenu('/videos/A.xml');
    harness.emitSidebar('select-danmaku-file', { path: filePath });
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
  const before = JSON.stringify(harness.context.pluginState.danmakuFileList);
  const cacheBefore = JSON.stringify(harness.context.danmakuCache);
  const readsBefore = harness.fileReads.length;
  const scansBefore = harness.directoryReads.length;

  harness.emitSidebar('request-state');
  harness.emitSidebar('request-state');

  assert.equal(JSON.stringify(harness.context.pluginState.danmakuFileList), before);
  assert.equal(JSON.stringify(harness.context.danmakuCache), cacheBefore);
  assert.equal(harness.fileReads.length, readsBefore);
  assert.equal(harness.directoryReads.length, scansBefore);
  const reported = harness.sidebarMessages.filter((message) => message.name === 'danmaku-file-list').at(-1).data;
  assert.deepEqual(Array.from(reported.selectedPaths), [manualPath]);
  assert.equal(reported.jsonFiles.length, 2);
  assert.ok(reported.xmlFiles.some((item) => item.path === manualPath));
});

test('manual selection before overlay readiness queues the latest source and enables time updates', async () => {
  const harness = createHarness(false);
  harness.setVideo('file:///videos/A.mp4');
  await harness.addFromSidebar('/videos/B.xml');

  assert.deepEqual(loadedComments(harness.overlayMessages), [], 'do not send data to an unready overlay');
  assert.equal(harness.context.pluginState.danmakuEnabled, true);
  harness.readyOverlay();
  assert.deepEqual(loadedComments(harness.overlayMessages).map(s => JSON.parse(s).map(c => c.content).join()), ['B comment']);
  harness.emitEvent('mpv.time-pos.changed', 12);
  assert.equal(harness.overlayMessages.at(-1).data.time, 12);
});

test('failed or cancelled file choices preserve the active source and renderer', async () => {
  const harness = createHarness(true);
  harness.readyOverlay();
  harness.setVideo('file:///videos/A.mp4');
  harness.ackLoad();
  const loadsBefore = loadedComments(harness.overlayMessages);

  await harness.addFromSidebar('/downloads/missing.xml');
  await harness.loadFromMenu('/downloads/missing.xml');
  await harness.addFromSidebar(null);
  await harness.loadFromMenu(null);

  assert.deepEqual(Array.from(harness.context.pluginState.danmakuFileList.selectedPaths), ['/videos/A.xml']);
  assert.equal(harness.context.pluginState.currentDanmakuStatus.isLoaded, true);
  assert.deepEqual(loadedComments(harness.overlayMessages), loadsBefore);
});

test('reselecting a local file reuses its IR without rereading disk or duplicating its list entry', async () => {
  const harness = createHarness(true);
  harness.readyOverlay();
  harness.setVideo('file:///videos/A.mp4');
  const updated = '<i><d p="1,1,25,16777215,0,0,0,0">updated comment</d></i>';
  harness.setFile('/videos/A.xml', updated);

  harness.emitSidebar('select-danmaku-file', {path: '/videos/A.xml'});

  assert.equal(JSON.parse(loadedComments(harness.overlayMessages).at(-1))[0].content, 'A comment');
  assert.equal(harness.fileReads.filter(p => p === '/videos/A.xml').length, 1);
  await harness.loadFromMenu('/videos/A.xml');
  assert.equal(JSON.parse(loadedComments(harness.overlayMessages).at(-1))[0].content, 'updated comment');
  assert.equal(harness.fileReads.filter(p => p === '/videos/A.xml').length, 2);
  assert.equal(harness.context.pluginState.danmakuFileList.xmlFiles.filter((item) => item.path === '/videos/A.xml').length, 1);
});

test('automatic loading handles file.read exceptions as a load failure', () => {
  const harness = createHarness(true);
  const filePath = '/videos/C.xml';
  harness.setFile(filePath, '<i><d p="1,1,25,16777215,0,0,0,0">C comment</d></i>');
  harness.failRead(filePath);
  harness.readyOverlay();

  harness.setVideo('file:///videos/C.mp4');

  assert.deepEqual(Array.from(harness.context.pluginState.danmakuFileList.selectedPaths), []);
  assert.equal(harness.context.pluginState.currentDanmakuStatus.isLoaded, false);
  assert.equal(harness.context.pendingDanmaku, null);
  assert.ok(harness.osdMessages.includes('Cannot read danmaku file: C.xml'));
  const errors = harness.sidebarMessages.filter((message) => message.name === 'danmaku-file-error');
  assert.equal(errors.at(-1).data.path, filePath);
});

test('manual loading catches file.read exceptions and preserves the active source', async () => {
  const harness = createHarness(true);
  harness.readyOverlay();
  harness.setVideo('file:///videos/A.mp4');
  harness.ackLoad();
  const brokenPath = '/downloads/broken.xml';
  harness.setFile(brokenPath, '<i><d p="2,1,25,16777215,0,0,0,0">broken</d></i>');
  harness.failRead(brokenPath);
  const loadsBefore = loadedComments(harness.overlayMessages);

  await harness.addFromSidebar(brokenPath);
  await harness.loadFromMenu(brokenPath);

  assert.deepEqual(Array.from(harness.context.pluginState.danmakuFileList.selectedPaths), ['/videos/A.xml']);
  assert.equal(harness.context.pluginState.currentDanmakuStatus.isLoaded, true);
  assert.deepEqual(loadedComments(harness.overlayMessages), loadsBefore);
  assert.equal(harness.osdMessages.filter((message) => message === 'Cannot read danmaku file: broken.xml').length, 2);
  const errors = harness.sidebarMessages.filter((message) => message.name === 'danmaku-file-error');
  assert.equal(errors.length, 2);
  assert.deepEqual(errors.map((message) => message.data.path), [brokenPath, brokenPath]);
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
  assert.deepEqual(Array.from(harness.context.pluginState.danmakuFileList.selectedPaths), ['dandanplay://7']);
  harness.ackLoad();
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
  assert.equal(harness.context.pluginState.danmakuEnabled, true);
  assert.deepEqual(loadedComments(harness.overlayMessages), []);

  harness.readyOverlay();
  assert.equal(loadedComments(harness.overlayMessages).length, 1);
  harness.ackLoad();
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
  assert.equal(harness.context.pluginState.danmakuEnabled, false);

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
  assert.equal(harness.context.pluginState.danmakuEnabled, true);
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
  assert.equal(harness.context.pluginState.danmakuEnabled, false);

  harness.resolveNextHttp({
    statusCode: 200,
    data: { comments: [{ p: '1,1,16777215,1', m: 'hello' }] },
  });
  await flushMicrotasks();

  assert.equal(loadedComments(harness.overlayMessages).length, 1);
  assert.equal(harness.context.pluginState.danmakuEnabled, true);
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
  assert.deepEqual(Array.from(harness.context.pluginState.danmakuFileList.selectedPaths), ['dandanplay://7']);
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

  assert.equal(harness.context.pluginState.danmakuEnabled, false);
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
  assert.ok(h.overlayMessages.some(x => x.name === 'toggle-danmaku' && x.data.paused));
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
  assert.equal(JSON.stringify(load.data.comments), '[]');
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
  assert.equal(h.context.pluginState.danmakuEnabled, false);
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
  assert.deepEqual(Array.from(h.context.pluginState.danmakuFileList.selectedPaths), ['dandanplay://8']);
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
  assert.deepEqual(Array.from(h.context.pluginState.danmakuFileList.selectedPaths), ['/videos/A.xml']);
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
  await flushMicrotasks();
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
  assert.equal(h.context.getEffectiveContent(p).length, 0);
});

test('simplification operates on decoded text and preserves metadata and literal entity text', () => {
  const h = createHarness(true);
  h.context.pluginState.danmakuForceSimplified = true;
  h.context.openccSimplifier = text => text.replace(/體/g, '体');
  const source = '<packet><chat user_id="體" mail="font:體" vpos="-10">&#x9ad4; &amp;lt;</chat></packet>';
  const p = setPositionSource(h, 'nico-xml', source);
  const effective = h.context.getEffectiveContent(p);
  assert.equal(h.context.danmakuCache[p].comments[0].userId, '體');
  assert.deepEqual(Array.from(effective[0].mail), ['font:體']);
  assert.equal(effective[0].content, '体 &lt;');
  assert.equal(h.context.buildDanmakuBrowserList()[0].text, '体 &lt;');
  assert.equal(h.context.buildDanmakuBrowserList()[0].t, -10);
});

test('real legacy JSON density and blocking preserve owners and match the bundled parser', () => {
  const h = createHarness(true);
  const source = [{thread: {resultcode: 0}}, ...Array.from({length: 5}, (_, i) => ({chat: {vpos: i * 100, no: i + 1, content: 'c' + i, user_id: 'u', mail: ''}})), {chat: {vpos: 0, content: 'owner'}}];
  const p = setPositionSource(h, 'nico-json', JSON.stringify(source));
  h.context.pluginState.danmakuFilterDensity = 1;
  const filtered = h.context.getEffectiveContent(p);
  const N = require('../overlay/lib/niconicomments.min.js');
  const parsed = N.internal.inputParser.default(filtered, 'formatted');
  assert.deepEqual(parsed.map(c => c.content).sort(), ['c4', 'owner']);
  assert.deepEqual(Array.from(h.context.buildDanmakuBrowserList(), c => c.text).sort(), ['c4', 'owner']);
  h.emitSidebar('danmaku-blocklist-add', {word: 'owner|c4'});
  h.emitSidebar('danmaku-blocklist-set-enabled', {enabled: true});
  const final = h.context.getEffectiveContent(p);
  assert.deepEqual(N.internal.inputParser.default(final, 'formatted').map(c => c.content), ['owner']);
});

test('IPC envelopes prevent template interpolation while preserving the string', () => {
  const h = createHarness(true);
  const text = '${globalThis.injected = true}';
  h.context.sidebarPostMessage('test', {text});
  const data = h.sidebarMessages.at(-1).wire;
  const simulatedBridge = vm.createContext({});
  const json = vm.runInContext('String.raw`' + JSON.stringify(data) + '`', simulatedBridge);
  assert.equal(simulatedBridge.injected, undefined);
  assert.equal(JSON.parse(decodeURIComponent(JSON.parse(json).__encoded)).text, text);
  h.context.overlayPostMessage('test', {fontFamily: '`' + text});
  assert.equal(JSON.parse(decodeURIComponent(h.overlayMessages.at(-1).wire.__encoded)).fontFamily, '`' + text);
});

test('IPC preserves paths, regexes, quotes, backslashes and Unicode through the real template boundary', () => {
  const h = createHarness(true);
  const word = '`‘’“”\\w+${text} 😀';
  const payload = {path: '/videos/' + word + '.xml', words: [word], selectedPaths: ['%20']};
  for (const send of [h.context.sidebarPostMessage, h.context.overlayPostMessage]) {
    send('test', payload);
    const message = send === h.context.sidebarPostMessage ? h.sidebarMessages.at(-1) : h.overlayMessages.at(-1);
    const bridge = vm.runInNewContext('String.raw`' + JSON.stringify(message.wire) + '`');
    assert.deepEqual(JSON.parse(decodeURIComponent(JSON.parse(bridge).__encoded)), payload);
  }
  h.emitSidebar('danmaku-blocklist-add', {word});
  assert.deepEqual(JSON.parse(h.preferences.get('danmakuBlocklist')), [word]);
  h.emitSidebar('danmaku-blocklist-remove', {word});
  assert.deepEqual(JSON.parse(h.preferences.get('danmakuBlocklist')), []);
});

test('automatic local loading prioritizes exact JSON and retries unreadable candidates', () => {
  const h = createHarness(true);
  h.setFile('/videos/A.json', '[{"fork":"main","comments":[]}]');
  h.readyOverlay();
  h.setVideo('file:///videos/A.mp4');
  assert.deepEqual(Array.from(h.context.pluginState.danmakuFileList.selectedPaths), ['/videos/A.json']);
  h.failRead('/videos/A.json');
  h.setVideo('file:///videos/A.mp4');
  assert.deepEqual(Array.from(h.context.pluginState.danmakuFileList.selectedPaths), ['/videos/A.xml']);
});

test('episode 1 does not prefix-match episode 10', () => {
  const h = createHarness(true);
  h.setFile('/videos/EP10.xml', '<i/>');
  assert.equal(h.context.findDanmakuByEpisode('file:///videos/EP1.mp4').xmlFiles.length, 0);
});

test('a delayed duration comparison cannot cross video generations', () => {
  const h = createHarness(true);
  h.context.pluginState.danmakuFileList.selectedPaths = ['/shared.json'];
  h.context.checkNicoJsonDuration(parseDanmakuSource([{fork: 'main', duration: 100, comments: []}]));
  h.setVideo('file:///videos/B.mp4');
  h.context.pluginState.danmakuFileList.selectedPaths = ['/shared.json'];
  h.setMpv('duration', 120);
  h.runTimers(800);
  assert.equal(h.context.pluginState.danmakuTimeOffsetSec, 0);
});

test('duration availability reaches a lazily opened sidebar independently of duration mismatch', () => {
  for (const videoDuration of [0, 100, 120]) {
    const h = createHarness(true, false, {danmakuAutoOffset: false});
    h.setMpv('duration', videoDuration);
    h.setFile('/videos/with-duration.json', JSON.stringify([{fork: 'main', duration: 100, comments: []}]));
    h.emitSidebar('select-danmaku-file', {path: '/videos/with-duration.json'});
    assert.equal(h.sidebarMessages.findLast(m => m.data?.nicoJsonHasDuration !== undefined).data.nicoJsonHasDuration, true);
    h.readyOverlay();
    h.ackLoad();
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
  h.emitSidebar('select-danmaku-file', {path: '/videos/with-duration.json'});
  assert.equal(h.context.pluginState.danmakuTimeOffsetSec, 0);
  assert.equal(h.context.pluginState.nicoJsonDurationDiff, 20);
  h.emitSidebar('request-state');
  const state = h.sidebarMessages.findLast(m => m.name === 'danmaku-state').data;
  assert.equal(state.danmakuAutoOffset, false);
  assert.equal(state.nicoJsonHasDuration, true);
  h.emitSidebar('set-danmaku-auto-offset', {value: true});
  assert.equal(h.context.pluginState.danmakuTimeOffsetSec, -20);
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
    h.emitSidebar('select-danmaku-file', {path: '/videos/with-duration.json'});
    const sourcePath = '/videos/' + name;
    h.setFile(sourcePath, typeof source === 'string' ? source : JSON.stringify(source));
    h.emitSidebar('select-danmaku-file', {path: sourcePath});
    assert.equal(h.sidebarMessages.findLast(m => m.data?.nicoJsonHasDuration !== undefined).data.nicoJsonHasDuration, false, name);
    h.emitSidebar('request-state');
    assert.equal(h.sidebarMessages.findLast(m => m.name === 'danmaku-state').data.nicoJsonHasDuration, false, name);
  }
  h.emitSidebar('select-danmaku-file', {path: '/videos/with-duration.json'});
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
  assert.equal(h.context.pluginState.currentDanmakuStatus.isLoaded,false);
  assert.ok(h.osdMessages.includes('Cannot render this danmaku file'));
  h.setVideo('file:///videos/B.mp4');
  h.ackLoad();
  h.emitOverlay('danmaku-load-result',{loadId:id,success:false});
  assert.equal(h.context.pluginState.currentDanmakuStatus.isLoaded,true);
  h.toggleDanmaku();
  h.setVideo('file:///videos/C.mp4');
  h.emitOverlay('danmaku-load-result',{loadId:id,success:true});
  assert.equal(h.context.pluginState.currentDanmakuStatus.isLoaded,false);
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
  assert.equal(list.comments.length,1);
  assert.equal(list.comments[0].userId,'abc123');
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

function calendarDay(date) {
  return Date.parse(date + 'T00:00:00Z') / 86400000;
}

function loadDateFixture(harness, data, filePath = '/videos/dates.json') {
  harness.setFile(filePath, JSON.stringify(data));
  harness.emitSidebar('select-danmaku-file', { path: filePath });
}

function latestFilterInfo(harness) {
  return harness.sidebarMessages.findLast(m => m.name === 'danmaku-filter-info').data;
}

test('date slicing uses inclusive Japan calendar days across all V1 threads, independent of comment numbers', () => {
  const h = createHarness(true);
  h.readyOverlay();
  const comment = (body, no, postedAt) => ({ body, no, postedAt, vposMs: 1000, commands: [] });
  const data = [
    { fork: 'main', comments: [
      comment('late number, old date', 999, '2026-01-01T23:59:59+09:00'),
      comment('start midnight', 3, '2026-01-01T15:00:00Z'),
      comment('end midnight minus 1ms', 1, '2026-01-02T23:59:59.999+09:00'),
      comment('next day', 2, '2026-01-03T00:00:00+09:00'),
      comment('undated', 4, undefined),
      comment('bad date', 5, 'invalid'),
    ] },
    { fork: 'main', id: 2, comments: [
      comment('second thread', 800, '2026-01-02T01:00:00+09:00'),
      comment('last source day', 100, '2026-01-05T01:00:00+09:00'),
    ] },
    { fork: 'owner', comments: [comment('owner', 1, '2010-01-01T00:00:00+09:00')] },
    { fork: 'easy', comments: [comment('easy', 1, '2030-01-01T00:00:00+09:00')] },
  ];
  loadDateFixture(h, data);
  const day = calendarDay('2026-01-02');
  const originalInfo = latestFilterInfo(h);
  assert.equal(originalInfo.dateInfo.firstDay, day - 1);
  assert.equal(originalInfo.dateInfo.lastDay, day + 3, 'bounds include every eligible thread');
  assert.equal(originalInfo.dateInfo.undatedCount, 2);
  assert.deepEqual(Array.from(originalInfo.dateInfo.dayCounts, pair => Array.from(pair)), [
    [day - 1, 1], [day, 3], [day + 1, 1], [day + 3, 1],
  ]);
  h.emitSidebar('set-danmaku-filter', { startDay: day, endDay: day });
  const filtered = JSON.parse(loadedComments(h.overlayMessages).at(-1));
  assert.deepEqual(filtered.map(c => c.content), ['start midnight', 'end midnight minus 1ms', 'undated', 'bad date', 'second thread', 'owner', 'easy']);
  assert.deepEqual(Array.from(h.context.buildDanmakuBrowserList(), item => item.text).sort(), filtered.map(c => c.content).sort());
  assert.equal(latestFilterInfo(h).sourceTotalCount, 7);
  assert.equal(latestFilterInfo(h).filteredCount, 7);
  assert.equal(latestFilterInfo(h).dateInfo.lastDay, day + 3, 'filtering does not shrink the slider domain');

  h.emitSidebar('set-danmaku-filter', { startDay: day + 2, endDay: day + 2 });
  const gap = JSON.parse(loadedComments(h.overlayMessages).at(-1));
  assert.deepEqual(gap.map(c => c.content), ['undated', 'bad date', 'last source day', 'owner', 'easy']);
  assert.equal(latestFilterInfo(h).filterStartDay, day + 3);
  assert.equal(latestFilterInfo(h).filterEndDay, day + 3);
  h.emitSidebar('set-danmaku-filter', { startDay: day - 1, endDay: day + 3 });
  assert.deepEqual(JSON.parse(loadedComments(h.overlayMessages).at(-1)).map(c => c.content), data.flatMap(th => th.comments.map(c => c.body)), 'full range restores source order');
  assert.equal(latestFilterInfo(h).filterStartDay, null);
});

test('date filters restore on sidebar pull and reset on source/video changes, including before overlay readiness', () => {
  const h = createHarness(true);
  const data = [{ fork: 'main', comments: [
    { no: 1, vposMs: 1000, body: 'first', commands: [], postedAt: '2024-02-28' },
    { no: 2, vposMs: 1000, body: 'leap day', commands: [], postedAt: '2024-02-29' },
    { no: 3, vposMs: 1000, body: 'third', commands: [], postedAt: '2024-03-01' },
  ] }];
  loadDateFixture(h, data);
  const day = calendarDay('2024-02-29');
  h.emitSidebar('set-danmaku-filter', { startDay: day, endDay: day });
  h.emitSidebar('request-state');
  assert.equal(latestFilterInfo(h).filterStartDay, day);
  assert.equal(latestFilterInfo(h).filterEndDay, day);
  assert.equal(latestFilterInfo(h).filteredCount, 1);
  h.readyOverlay();
  assert.deepEqual(JSON.parse(loadedComments(h.overlayMessages).at(-1)).map(c => c.content), ['leap day']);
  for (const range of [{ startDay: day + 1, endDay: day - 1 }, { startDay: day + 0.5, endDay: day + 1 }, {}]) {
    h.emitSidebar('set-danmaku-filter', range);
    h.emitSidebar('request-state');
    assert.equal(latestFilterInfo(h).filterStartDay, day);
  }
  loadDateFixture(h, data, '/videos/other-dates.json');
  assert.equal(latestFilterInfo(h).filterStartDay, null);
  assert.equal(latestFilterInfo(h).filteredCount, 3);
  h.setVideo('file:///videos/A.mp4');
  assert.equal(latestFilterInfo(h).dateInfo.firstDay, null);
  assert.equal(latestFilterInfo(h).filterEndDay, null);
});

test('legacy date slicing precedes density and preserves owners, undated comments and metadata', () => {
  const h = createHarness(true);
  h.readyOverlay();
  const chat = (content, no, date, extra = {}) => ({ chat: { content, no, date, user_id: 'viewer', vpos: 100, ...extra } });
  const seconds = stamp => Date.parse(stamp) / 1000;
  const data = [
    { thread: { resultcode: 0 } },
    chat('old with largest number', 1000, seconds('2026-01-01T14:59:59Z')),
    chat('first selected', 1, seconds('2026-01-01T15:00:00Z')),
    chat('last selected', 2, seconds('2026-01-02T14:59:59Z')),
    chat('next day', 3, seconds('2026-01-02T15:00:00Z')),
    chat('undated', 0, undefined, { nicoru: 3 }),
    chat('owner', 0, seconds('2010-01-01T00:00:00Z'), { user_id: undefined }),
  ];
  loadDateFixture(h, data);
  const day = calendarDay('2026-01-02');
  assert.equal(latestFilterInfo(h).dateInfo.firstDay, day - 1);
  assert.equal(latestFilterInfo(h).dateInfo.lastDay, day + 1);
  h.emitSidebar('set-danmaku-filter', { startDay: day, endDay: day });
  h.emitSidebar('set-danmaku-filter-density', { density: 1 });
  const filtered = JSON.parse(loadedComments(h.overlayMessages).at(-1));
  assert.deepEqual(filtered.map(e => e.content), ['last selected', 'undated', 'owner']);
  assert.equal(latestFilterInfo(h).sourceTotalCount, 4);
  assert.equal(latestFilterInfo(h).filteredCount, 3);
  assert.deepEqual(Array.from(h.context.buildDanmakuBrowserList(), item => item.text).sort(), ['last selected', 'owner', 'undated']);
});

test('only the ready handshake can flush the latest pending IR source', async () => {
  const h = createHarness(true);
  h.emitEvent('iina.plugin-overlay-loaded');
  await h.addFromSidebar('/videos/A.xml');
  await h.addFromSidebar('/videos/B.xml');
  h.runTimers(2000);
  assert.equal(h.context.overlayReady, false);
  assert.equal(loadedComments(h.overlayMessages).length, 0);
  h.setMpv('time-pos', 47);
  h.setMpv('speed', 3);
  h.setPaused(true);
  h.emitOverlay('overlay-ready');
  const load = h.overlayMessages.findLast(m => m.name === 'load-danmaku').data;
  assert.deepEqual(load.playback, {enabled: true, time: 47, paused: true, speed: 3});
  assert.deepEqual(load.comments.map(c => c.content), ['B comment']);
});

test('bangumi responses cannot replace a newer selection or search', async () => {
  const h = createHarness(true);
  h.emitSidebar('dandanplay-get-bangumi', {bangumiId: 1, searchId: 1});
  h.emitSidebar('dandanplay-get-bangumi', {bangumiId: 2, searchId: 1});
  h.resolveHttp(1, {statusCode: 200, data: {bangumi: {episodes: [{episodeId: 2}]}}});
  await flushMicrotasks();
  h.resolveHttp(0, {statusCode: 200, data: {bangumi: {episodes: [{episodeId: 1}]}}});
  await flushMicrotasks();
  assert.deepEqual(h.sidebarMessages.filter(m => m.name === 'dandanplay-bangumi-result').map(m => m.data.bangumiId), [2]);
  h.emitSidebar('dandanplay-get-bangumi', {bangumiId: 3, searchId: 1});
  h.emitSidebar('dandanplay-search', {keyword: 'new', searchId: 2});
  h.rejectNextHttp(new Error('old bangumi failed'));
  await flushMicrotasks();
  assert.equal(h.sidebarMessages.filter(m => m.name === 'dandanplay-bangumi-result').length, 1);
});

test('cache writes stay ordered and recover after a write failure', async () => {
  const h = createHarness(true);
  h.setExec(() => Promise.resolve({status: 0}));
  let writes = 0;
  h.context.iina.file.write = (filePath, content) => {
    writes++;
    if (writes === 1) throw new Error('disk full');
    h.fileWrites.push({filePath, content});
  };
  const first = h.context.ddpSaveVideoCache('same-video', 1, 'old', '', []);
  const second = h.context.ddpSaveVideoCache('same-video', 2, 'new', '', []);
  assert.equal(await first, false);
  assert.equal(await second, true);
  assert.equal(JSON.parse(h.fileWrites[0].content).episodeId, 2);
});

test('all state settings restore from one sidebar request without document serialization', () => {
  const h = createHarness(true, false, {danmakuBlocklist: '["`literal`"]', danmakuBlocklistEnabled: true, danmakuDedupeEnabled: true, danmakuBlockTopEnabled: true});
  h.emitSidebar('request-state');
  const state = h.sidebarMessages.findLast(m => m.name === 'danmaku-state').data;
  assert.deepEqual(state.blocklist, {enabled: true, words: ['`literal`']});
  assert.deepEqual(state.dedupe, {enabled: true, window: 2});
  assert.equal(state.danmakuBlockTopEnabled, true);
  assert.equal('danmakuCache' in state, false);
  assert.equal(h.sidebarHandlers.has('danmaku-position-filter-request'), false);
  assert.equal(h.sidebarHandlers.has('danmaku-blocklist-request'), false);
  assert.equal(h.sidebarHandlers.has('danmaku-dedupe-request'), false);
});

test('each settings action emits one state patch and no retired state messages', () => {
  const h = createHarness(true);
  h.readyOverlay();
  const cases = [
    ['set-danmaku-offset', {offset: 2}], ['set-danmaku-font', {fontFamily: 'Helvetica Neue', fontWeight: '500'}],
    ['danmaku-blocklist-add', {word: 'foo'}], ['danmaku-blocklist-set-enabled', {enabled: true}],
    ['danmaku-blocklist-remove', {word: 'foo'}], ['danmaku-position-filter-set', {danmakuBlockTopEnabled: true, danmakuBlockBottomEnabled: true}],
    ['danmaku-dedupe-set', {enabled: true, window: 4}], ['danmaku-browser-vis-set', {visible: false}],
  ];
  for (const [name, data] of cases) {
    h.sidebarMessages.length = 0;
    h.emitSidebar(name, data);
    assert.deepEqual(h.sidebarMessages.map(m => m.name), ['danmaku-state'], name);
  }
  h.sidebarMessages.length = 0;
  h.context.setNicoJsonDurationAvailability(true);
  assert.equal(h.sidebarMessages.length, 1);
  h.sidebarMessages.length = 0;
  h.context.setNicoJsonDurationDiff(20);
  assert.equal(h.sidebarMessages.length, 1);
  h.context.commitState({danmakuFilterStartDay: 1, danmakuFilterEndDay: 2});
  h.sidebarMessages.length = 0;
  h.context.resetNicoJsonFilterState();
  assert.equal(h.sidebarMessages.length, 1);
  assert.equal(h.sidebarMessages[0].data.nicoJsonHasDuration, false);
  assert.equal(h.sidebarMessages[0].data.nicoJsonDurationDiff, null);
  assert.equal(h.sidebarMessages[0].data.danmakuFilterStartDay, null);
  assert.equal(h.sidebarMessages[0].data.danmakuFilterEndDay, null);
});

test('enable toggles send one playback update; disabled manual loads start enabled without a toggle replay', async () => {
  const h = createHarness(true);
  h.readyOverlay(); h.setVideo('file:///videos/A.mp4');
  h.overlayMessages.length = 0; h.sidebarMessages.length = 0;
  h.toggleDanmaku();
  assert.equal(h.overlayMessages.filter(m => m.name === 'toggle-danmaku').length, 1);
  assert.equal(h.sidebarMessages.filter(m => m.name === 'danmaku-state').length, 1);
  h.overlayMessages.length = 0; h.sidebarMessages.length = 0;
  h.toggleDanmaku();
  assert.equal(h.overlayMessages.filter(m => m.name === 'toggle-danmaku').length, 1);
  assert.equal(h.sidebarMessages.filter(m => m.name === 'danmaku-state').length, 1);
  h.toggleDanmaku(); h.overlayMessages.length = 0;
  await h.loadFromMenu('/videos/B.xml');
  const load = h.overlayMessages.find(m => m.name === 'load-danmaku');
  assert.equal(load.data.playback.enabled, true);
  assert.equal(h.overlayMessages.filter(m => m.name === 'load-danmaku').length, 1);
  assert.equal(h.overlayMessages.filter(m => m.name === 'toggle-danmaku').length, 0);
  h.emitEvent('mpv.time-pos.changed', 4);
  assert.equal(h.overlayMessages.at(-1).data.time, 4, 'subscriptions are still installed');
});

test('ordinary quotes, newlines and backslashes do not encode a full comment payload', () => {
  const h = createHarness(true);
  const data = {comments: Array.from({length: 1000}, (_, i) => ({content: i + ' "quoted"\nC:\\font\\path'}))};
  h.context.overlayPostMessage('test', data);
  const wire = h.overlayMessages.at(-1).wire;
  assert.equal(wire, data);
  const bridge = vm.runInNewContext('String.raw`' + JSON.stringify(wire) + '`');
  assert.deepEqual(JSON.parse(bridge), data);
});

test('IPC preserves isolated surrogate code units even with a legacy JSON stringifier', () => {
  const h = createHarness(true);
  const data = {text: '\uD800 a \uDC00 😀 `${literal}'};
  const stringify = JSON.stringify;
  h.context.JSON = {stringify(value) {return stringify(value).replace(/\\u(d[89ab][0-9a-f]{2}|d[cdef][0-9a-f]{2})/gi, (_, code) => String.fromCharCode(parseInt(code, 16)));}};
  assert.doesNotThrow(() => h.context.sidebarPostMessage('test', data));
  const wire = h.sidebarMessages.at(-1).wire;
  const bridge = vm.runInNewContext('String.raw`' + stringify(wire) + '`');
  assert.deepEqual(JSON.parse(decodeURIComponent(JSON.parse(bridge).__encoded)), data);
});

test('a missing enabled preference defaults to enabled', () => {
  const h = createHarness(undefined);
  assert.equal(h.context.pluginState.danmakuEnabled, true);
});

test('unchanged projections skip renderer loads, but a failed renderer can retry', () => {
  const h = createHarness(true);
  h.readyOverlay(); h.setVideo('file:///videos/A.mp4');
  const before = h.overlayMessages.filter(m => m.name === 'load-danmaku').length;
  h.emitSidebar('danmaku-blocklist-add', {word: 'unmatched'});
  h.emitSidebar('danmaku-blocklist-set-enabled', {enabled: true});
  h.emitSidebar('set-danmaku-filter-density', {density: 100});
  assert.equal(h.overlayMessages.filter(m => m.name === 'load-danmaku').length, before);
  const id = h.overlayMessages.findLast(m => m.name === 'load-danmaku').data.loadId;
  h.emitOverlay('danmaku-load-result', {loadId: id, success: false});
  assert.equal(h.context.pluginState.danmakuFileList.selectedPaths.length, 0);
  h.emitSidebar('select-danmaku-file', {path: '/videos/A.xml'});
  assert.equal(h.overlayMessages.filter(m => m.name === 'load-danmaku').length, before + 1);
  h.emitSidebar('danmaku-blocklist-add', {word: 'A comment'});
  assert.equal(h.overlayMessages.findLast(m => m.name === 'load-danmaku').data.comments.length, 0);
});

test('a failed explicit file refresh keeps the cached active document', async () => {
  const h = createHarness(true); h.readyOverlay(); h.setVideo('file:///videos/A.mp4');
  const doc = h.context.danmakuCache['/videos/A.xml'];
  const loads = loadedComments(h.overlayMessages).length;
  h.failRead('/videos/A.xml');
  await h.loadFromMenu('/videos/A.xml');
  assert.equal(h.context.danmakuCache['/videos/A.xml'], doc);
  assert.equal(loadedComments(h.overlayMessages).length, loads);
});

test('completed mpv seeks explicitly synchronize even sub-threshold forward movement', () => {
  const h = createHarness(true); h.readyOverlay();
  h.overlayMessages.length = 0;
  h.emitEvent('mpv.seeking.changed', false);
  assert.equal(h.overlayMessages.length, 0);
  h.emitEvent('mpv.seeking.changed', true);
  h.setMpv('time-pos', 10.05);
  h.emitEvent('mpv.seeking.changed', false);
  assert.deepEqual(h.overlayMessages.at(-1).data, {time: 10.05, seek: true});
});

test('an unchanged renderer status does not echo a second UI update', () => {
  const h = createHarness(true); h.readyOverlay(); h.setVideo('file:///videos/A.mp4');
  h.ackLoad();
  const id = h.overlayMessages.findLast(m => m.name === 'load-danmaku').data.loadId;
  h.sidebarMessages.length = 0;
  h.emitOverlay('danmaku-load-result', {loadId: id, success: true});
  assert.equal(h.sidebarMessages.filter(m => m.name === 'danmaku-state').length, 0);
});

test('disabled filter edits defer the renderer load and apply the latest projection once on enable', () => {
  const h = createHarness(true); h.readyOverlay(); h.setVideo('file:///videos/A.mp4'); h.ackLoad();
  h.toggleDanmaku(); h.overlayMessages.length = 0;
  h.emitSidebar('danmaku-blocklist-add', {word: 'A comment'});
  h.emitSidebar('danmaku-blocklist-set-enabled', {enabled: true});
  h.emitSidebar('danmaku-dedupe-set', {enabled: true, window: 3});
  h.emitSidebar('set-danmaku-force-simplified', {value: true});
  h.emitSidebar('set-danmaku-filter-density', {density: 10});
  assert.equal(h.overlayMessages.filter(m => m.name === 'load-danmaku').length, 0);
  h.toggleDanmaku();
  const loads = h.overlayMessages.filter(m => m.name === 'load-danmaku');
  assert.equal(loads.length, 1);
  assert.deepEqual(loads[0].data.comments, []);
  assert.equal(loads[0].data.playback.enabled, true);
  assert.equal(h.overlayMessages.filter(m => m.name === 'toggle-danmaku').length, 0);
  assert.equal(h.context.pluginState.currentDanmakuStatus.isLoaded, false);
  h.ackLoad();
  assert.equal(h.context.pluginState.currentDanmakuStatus.isLoaded, true);
  h.toggleDanmaku(); h.overlayMessages.length = 0;
  h.emitSidebar('danmaku-blocklist-add', {word: 'unmatched'});
  h.toggleDanmaku();
  assert.equal(h.overlayMessages.filter(m => m.name === 'load-danmaku').length, 0, 'equivalent projection reuses the renderer');
  assert.equal(h.overlayMessages.filter(m => m.name === 'toggle-danmaku').length, 1);
});

test('disabling a pending source before readiness preserves the choice for the next enable', async () => {
  const h = createHarness(false); h.setVideo('file:///videos/A.mp4');
  await h.loadFromMenu('/videos/B.xml');
  h.toggleDanmaku(); h.readyOverlay();
  assert.equal(loadedComments(h.overlayMessages).length, 0);
  assert.equal(h.context.pluginState.currentDanmakuStatus.isLoaded, false);
  h.toggleDanmaku();
  assert.equal(loadedComments(h.overlayMessages).length, 1);
  assert.deepEqual(h.overlayMessages.findLast(m => m.name === 'load-danmaku').data.comments.map(c => c.content), ['B comment']);
  assert.equal(h.context.pluginState.currentDanmakuStatus.isLoaded, false);
  h.ackLoad();
  assert.equal(h.context.pluginState.currentDanmakuStatus.isLoaded, true);
});

test('source success and its OSD wait for acknowledgment without repeating the file list', async () => {
  const h = createHarness(true); h.readyOverlay();
  h.sidebarMessages.length = 0;
  await h.loadFromMenu('/videos/B.xml');
  assert.equal(h.context.pluginState.currentDanmakuStatus.isLoaded, false);
  assert.equal(h.sidebarMessages.filter(m => m.name === 'danmaku-file-list').length, 1);
  assert.equal(h.osdMessages.filter(m => m.startsWith('Danmaku loaded:')).length, 0);
  h.ackLoad();
  assert.equal(h.context.pluginState.currentDanmakuStatus.isLoaded, true);
  assert.equal(h.sidebarMessages.filter(m => m.name === 'danmaku-file-list').length, 1);
  assert.equal(h.osdMessages.filter(m => m.startsWith('Danmaku loaded:')).length, 1);
  h.ackLoad();
  assert.equal(h.sidebarMessages.filter(m => m.name === 'danmaku-file-list').length, 1);
  assert.equal(h.osdMessages.filter(m => m.startsWith('Danmaku loaded:')).length, 1);
});

test('failed rendering clears selection and ignores late success while retaining a retryable file', async () => {
  const h = createHarness(true); h.readyOverlay(); await h.loadFromMenu('/videos/B.xml');
  const id = h.overlayMessages.findLast(m => m.name === 'load-danmaku').data.loadId;
  h.ackLoad(false);
  assert.equal(h.context.pluginState.currentDanmakuStatus.isLoaded, false);
  assert.deepEqual(Array.from(h.context.pluginState.danmakuFileList.selectedPaths), []);
  assert.ok(h.context.findDanmakuFileByPath('/videos/B.xml'));
  assert.equal(h.overlayMessages.at(-1).name, 'clear-danmaku');
  h.emitOverlay('danmaku-load-result', {loadId: id, success: true});
  assert.equal(h.context.pluginState.currentDanmakuStatus.isLoaded, false);
  assert.equal(h.osdMessages.filter(m => m.startsWith('Danmaku loaded:')).length, 0);
  h.emitSidebar('select-danmaku-file', {path: '/videos/B.xml'}); h.ackLoad();
  assert.equal(h.context.pluginState.currentDanmakuStatus.isLoaded, true);
});

test('WebView navigation invalidates old render acknowledgments before the next handshake', () => {
  const h = createHarness(true); h.readyOverlay(); h.setVideo('file:///videos/A.mp4'); h.ackLoad();
  const oldId = h.overlayMessages.findLast(m => m.name === 'load-danmaku').data.loadId;
  h.emitEvent('iina.window-loaded');
  h.emitEvent('iina.plugin-overlay-loaded');
  h.emitOverlay('danmaku-load-result', {loadId: oldId, success: true});
  assert.equal(h.context.pluginState.currentDanmakuStatus.isLoaded, false);
  h.emitOverlay('overlay-ready');
  h.ackLoad();
  assert.equal(h.context.pluginState.currentDanmakuStatus.isLoaded, true);
});

test('presets commit and transmit complete appearance tuples atomically', () => {
  const h = createHarness(true, false, {danmakuFontFamily: 'Helvetica Neue'});
  h.readyOverlay();
  for (const [preset, scale, weight, strokeWidth, speed] of [
    ['balanced', 0.5, '400', 3, 0.5], ['nico', 1, '400', 2.8, 1], ['bilibili', 0.35, '200', 2.5, 0.4]
  ]) {
    h.overlayMessages.length = 0; h.sidebarMessages.length = 0;
    h.emitSidebar('set-style-preset', {preset});
    assert.deepEqual(h.overlayMessages.map(m => m.name), ['set-danmaku-style']);
    assert.deepEqual(h.overlayMessages[0].data, {
      canvasFontScale: scale, danmakuFontFamily: 'Helvetica Neue', danmakuFontWeight: weight, strokeWidth, scrollSpeed: speed
    });
    assert.deepEqual(h.sidebarMessages.map(m => m.name), ['danmaku-state']);
    assert.equal(h.sidebarMessages[0].data.stylePreset, preset);
    assert.equal(h.preferences.get('stylePreset'), preset);
    assert.equal(h.preferences.get('niconicommentsFontScale'), scale);
    assert.equal(h.preferences.get('danmakuFontWeight'), weight);
    assert.equal(h.preferences.get('strokeWidth'), strokeWidth);
    assert.equal(h.preferences.get('scrollSpeed'), speed);
  }
});

test('reapplying a preset restores manual tweaks, and rejects unknown preset names', () => {
  const h = createHarness(true); h.readyOverlay();
  h.emitSidebar('set-fontscale', {scale: 0.35});
  h.emitSidebar('set-scroll-speed', {speed: 0.25});
  h.overlayMessages.length = 0;
  h.emitSidebar('set-style-preset', {preset: 'nico'});
  assert.equal(h.overlayMessages.length, 1);
  assert.equal(h.overlayMessages[0].name, 'set-danmaku-style');
  assert.equal(h.overlayMessages[0].data.canvasFontScale, 1);
  assert.equal(h.overlayMessages[0].data.scrollSpeed, 1);
  h.emitSidebar('set-style-preset', {preset: 'nico'});
  for (const preset of ['missing', '__proto__', 'constructor']) h.emitSidebar('set-style-preset', {preset});
  assert.equal(h.overlayMessages.length, 1, 'unchanged and invalid choices do not rebuild');
});

test('a preset chosen before readiness is included in the first source load', () => {
  const h = createHarness(true); h.setVideo('file:///videos/A.mp4');
  h.emitSidebar('set-style-preset', {preset: 'balanced'});
  assert.equal(h.overlayMessages.length, 0);
  h.readyOverlay();
  const load = h.overlayMessages.find(m => m.name === 'load-danmaku').data;
  assert.equal(load.canvasFontScale, 0.5);
  assert.equal(load.scrollSpeed, 0.5);
  assert.equal(load.strokeWidth, 3);
});

test('font family and weight patches preserve the other field without waiting for sidebar echoes', () => {
  const h = createHarness(true, false, {danmakuFontFamily: 'old', danmakuFontWeight: '400'}); h.readyOverlay();
  h.emitSidebar('set-danmaku-font', {fontWeight: '800'});
  h.emitSidebar('set-danmaku-font', {fontFamily: 'new'});
  assert.equal(h.preferences.get('danmakuFontWeight'), '800');
  assert.equal(h.preferences.get('danmakuFontFamily'), 'new');
  assert.deepEqual(h.overlayMessages.findLast(m => m.name === 'set-danmaku-font').data, {fontFamily: 'new', fontWeight: '800'});
  h.emitSidebar('set-danmaku-font', {fontFamily: 'newer'});
  h.emitSidebar('set-danmaku-font', {fontWeight: '600'});
  assert.deepEqual(h.overlayMessages.findLast(m => m.name === 'set-danmaku-font').data, {fontFamily: 'newer', fontWeight: '600'});
  h.emitSidebar('set-danmaku-font', {fontFamily: ''});
  assert.equal(h.preferences.get('danmakuFontFamily'), '');
  assert.equal(h.preferences.get('danmakuFontWeight'), '600');
  const sent = h.overlayMessages.length;
  h.emitSidebar('set-danmaku-font', {});
  assert.equal(h.overlayMessages.length, sent);
});

test('reselecting the active source preserves filters, loaded state and pending notice without reloading', () => {
  const h = createHarness(true); h.readyOverlay();
  loadDateFixture(h, [{fork: 'main', comments: [
    {body: 'first', vposMs: 1000, postedAt: '2026-01-01'}, {body: 'second', vposMs: 2000, postedAt: '2026-01-02'}
  ]}]);
  const day = calendarDay('2026-01-01');
  h.emitSidebar('set-danmaku-filter', {startDay: day, endDay: day}); h.ackLoad();
  const id = h.overlayMessages.findLast(m => m.name === 'load-danmaku').data.loadId;
  const reads = h.fileReads.length, osds = h.osdMessages.length;
  h.overlayMessages.length = 0; h.sidebarMessages.length = 0;
  h.emitSidebar('select-danmaku-file', {path: '/videos/dates.json'});
  assert.equal(h.overlayMessages.length, 0);
  assert.equal(h.fileReads.length, reads);
  assert.equal(h.context.pluginState.currentDanmakuStatus.isLoaded, true);
  assert.equal(h.context.pluginState.danmakuFilterStartDay, day);
  assert.equal(h.sidebarMessages.filter(m => m.name === 'danmaku-file-list').length, 0);
  h.emitOverlay('danmaku-load-result', {loadId: id, success: true});
  assert.equal(h.osdMessages.length, osds, 'no orphan success notice');
});

test('reselecting the disabled cached source enables it without resetting successful load state', () => {
  const h = createHarness(true); h.readyOverlay(); h.setVideo('file:///videos/A.mp4'); h.ackLoad();
  h.toggleDanmaku(); h.overlayMessages.length = 0;
  h.emitSidebar('select-danmaku-file', {path: '/videos/A.xml'});
  assert.equal(h.context.pluginState.danmakuEnabled, true);
  assert.equal(h.context.pluginState.currentDanmakuStatus.isLoaded, true);
  assert.deepEqual(h.overlayMessages.map(m => m.name), ['toggle-danmaku']);
  h.emitEvent('mpv.time-pos.changed', 7);
  assert.equal(h.overlayMessages.at(-1).data.time, 7);
});

test('reselection preserves a pending acknowledgment and reloads a changed hidden projection', () => {
  const h = createHarness(true); h.readyOverlay(); h.setVideo('file:///videos/A.mp4');
  const loads = loadedComments(h.overlayMessages).length;
  h.emitSidebar('select-danmaku-file', {path: '/videos/A.xml'});
  assert.equal(loadedComments(h.overlayMessages).length, loads);
  assert.equal(h.context.pluginState.currentDanmakuStatus.isLoaded, false);
  h.ackLoad();
  h.toggleDanmaku();
  h.emitSidebar('danmaku-blocklist-add', {word: 'A comment'});
  h.emitSidebar('danmaku-blocklist-set-enabled', {enabled: true});
  h.emitSidebar('select-danmaku-file', {path: '/videos/A.xml'});
  assert.equal(loadedComments(h.overlayMessages).length, loads + 1);
  assert.deepEqual(h.overlayMessages.findLast(m => m.name === 'load-danmaku').data.comments, []);
  assert.equal(h.context.pluginState.currentDanmakuStatus.isLoaded, false);
  h.ackLoad();
  assert.equal(h.context.pluginState.currentDanmakuStatus.isLoaded, true);
});
