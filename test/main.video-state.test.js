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
      postMessage() {},
      onMessage() {},
    },
    event: {
      on(name, handler) { return register(eventHandlers, name, handler); },
      off() {},
    },
    console: { log() {} },
    menu: {
      addItem() {},
      item(label, callback, options) { return { label, callback, options }; },
      separator() { return {}; },
    },
    core: {
      status: { idle: false, isNetworkResource: false, paused: false, url: null },
      osd() {},
      seekTo() {},
    },
    file: {
      exists() { return false; },
      list(dir) {
        const base = path.basename(iina.core.status.url || '', path.extname(iina.core.status.url || ''));
        const commentPath = path.join(dir, base + '.xml');
        return comments[commentPath] ? [{ filename: base + '.xml', isDir: false }] : [];
      },
      read(filePath) { return comments[filePath] || null; },
      write() {},
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
      chooseFile() { return Promise.resolve(null); },
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

  function emit(map, name, data) {
    for (const handler of map.get(name) || []) handler(data);
  }

  return {
    context,
    httpRequests,
    overlayMessages,
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
