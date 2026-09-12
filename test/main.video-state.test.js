'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const MAIN_JS = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');

function createHarness(initialEnabled, autoNetwork = false) {
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
  const preferences = new Map([
    ['danmakuEnabled', initialEnabled],
    ['dandanplayAutoNetwork', autoNetwork],
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
      loadFile() {},
      show() {},
      hide() {},
      postMessage(name, data) { overlayMessages.push({ name, data }); },
      onMessage(name, handler) { register(overlayHandlers, name, handler); },
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
      write(filePath, content) { comments[filePath] = content; },
    },
    preferences: {
      get(key) { return preferences.get(key); },
      set(key, value) { preferences.set(key, value); },
      sync() {},
    },
    mpv: {
      getNumber(name) { return name === 'speed' ? 1 : 0; },
      set() {},
    },
    utils: {
      preferredLocalizations() { return ['en']; },
      chooseFile() { return Promise.resolve(chosenFile); },
      resolvePath(value) { return value; },
      exec() { return Promise.resolve(null); },
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
    setTimeout() { return 1; },
    clearTimeout() {},
  });
  vm.runInContext(MAIN_JS, context, { filename: 'main.js' });
  emit(eventHandlers, 'iina.window-loaded');

  function emit(map, name, data) {
    for (const handler of map.get(name) || []) handler(data);
  }

  return {
    context,
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
    readyOverlay() { emit(overlayHandlers, 'overlay-ready', {}); },
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

test('manual trigger match loads network danmaku with auto-network off', async () => {
  const harness = createHarness(true, false);
  harness.readyOverlay();
  harness.setVideo('file:///videos/C.mp4');
  await flushMicrotasks();
  assert.equal(harness.context.currentDanmakuStatus.isLoaded, false);
  assert.equal(harness.httpRequests.length, 0);

  harness.emitSidebar('dandanplay-trigger-match');
  await flushMicrotasks();
  assert.ok(harness.httpRequests.some((request) => request.url.includes('/api/v2/match')));

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
  const list = harness.sidebarMessages.filter((message) => message.name === 'danmaku-file-list').at(-1);
  assert.equal(list.data.jsonFiles.at(-1).path, encodeURIComponent('dandanplay://7'));
  assert.deepEqual(Array.from(harness.context.danmakuFileList.selectedPaths), ['dandanplay://7']);
  assert.ok(harness.osdMessages.some((message) => message.includes('EP1')));
});

test('manual trigger match with the danmaku toggle off still loads and re-enables danmaku', async () => {
  const harness = createHarness(false, false);
  harness.readyOverlay();
  harness.setVideo('file:///videos/C.mp4');
  await flushMicrotasks();
  assert.equal(harness.context.danmakuEnabled, false);

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

  assert.equal(loadedComments(harness.overlayMessages).length, 1);
  assert.equal(harness.context.danmakuEnabled, true);
});

test('selecting a filename-match candidate loads it with auto-network off', async () => {
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

test('manual trigger match completes when the toggle is turned off while matching', async () => {
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
