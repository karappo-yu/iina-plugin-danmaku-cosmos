'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const {createRequire} = require('node:module');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

// Compose the existing main and overlay harnesses without registering their
// individual test cases a second time. Their renderer remains a stub: these
// cases verify the real two-sided IPC scheduling and identity contract.
function harnessFactory(filename, expression) {
  const file = path.join(__dirname, filename);
  const localRequire = createRequire(file);
  const context = vm.createContext({
    require: name => name === 'node:test' ? () => {} : localRequire(name),
    __dirname, console, Buffer, process, URL, WeakRef,
  });
  vm.runInContext(fs.readFileSync(file, 'utf8'), context, {filename: file});
  return () => vm.runInContext(expression, context);
}

const createMain = harnessFactory('main.video-state.test.js', 'createHarness(true)');
const createOverlay = harnessFactory('overlay.test.js', 'harness()');
const clonePayload = value => JSON.parse(JSON.stringify(value));

function connectedHarness(paused, pausedForCache = false, videoUrl = 'file:///videos/A.mp4', afterSnapshot) {
  const main = createMain(), overlay = createOverlay();
  const toOverlay = [], toMain = [];
  const mainPost = main.context.iina.overlay.postMessage;
  const overlayPost = overlay.context.iina.postMessage;
  main.context.iina.overlay.postMessage = (name, data) => {
    mainPost(name, data);
    const payload = data.__encoded ? JSON.parse(decodeURIComponent(data.__encoded)) : data;
    toOverlay.push({name, data: clonePayload(payload)});
    if (afterSnapshot) afterSnapshot(main, name, payload);
  };
  overlay.context.iina.postMessage = (name, data) => {
    overlayPost(name, data);
    toMain.push({name, data: clonePayload(data)});
  };

  function deliverToOverlay(message) {
    overlay.send(message.name, message.data);
  }

  function deliverReplies() {
    while (toMain.length) {
      const message = toMain.shift();
      main.emitOverlay(message.name, message.data);
    }
  }

  function drainMessages() {
    let iterations = 0;
    while (toOverlay.length || toMain.length) {
      assert.ok(++iterations <= 1000, 'IPC must reach an idle state');
      while (toOverlay.length) deliverToOverlay(toOverlay.shift());
      deliverReplies();
    }
  }

  main.setPaused(paused);
  main.setMpv('paused-for-cache', pausedForCache);
  main.readyOverlay();
  if (videoUrl !== null) main.setVideo(videoUrl);
  drainMessages();
  overlay.flushFrames();
  overlay.flushFrames();
  drainMessages();
  return {main, overlay, toOverlay, deliverToOverlay, deliverReplies, drainMessages};
}

function emitCacheState(h, percent, time) {
  h.main.setMpv('paused-for-cache', percent < 100);
  if (time !== undefined) h.main.setMpv('time-pos', time);
  h.main.emitEvent('mpv.cache-buffering-state.changed', percent);
}

for (const paused of [true, false]) {
  test(`a two-sided seek burst delivers the latest landing on one frame (paused=${paused})`, () => {
    const h = connectedHarness(paused);
    const renderer = h.overlay.instances[0];
    const beforeDraws = renderer.draws.length;
    const beforeClears = renderer.clears || 0;
    for (let index = 1; index <= 600; index++) {
      h.main.emitEvent('mpv.seek');
      h.main.emitEvent('mpv.time-pos.changed', index % 2 ? 60 : 20);
    }
    h.main.setMpv('time-pos', 30.033);
    h.main.emitEvent('mpv.playback-restart');
    h.main.emitEvent('mpv.time-pos.changed', 30.033);

    assert.equal(h.toOverlay.filter(message => message.name === 'time-update').length, 1,
      'only the first time evaluation is in flight before replies are delivered');
    h.drainMessages();
    const updates = h.main.overlayMessages.filter(message => message.name === 'time-update');
    assert.equal(updates.length, 2, 'the reply releases only the latest pending landing');
    assert.equal(updates[1].data.time, 30.033);
    assert.equal(updates[1].data.seek, true);
    assert.equal(renderer.draws.length, beforeDraws, 'IPC delivery itself does not draw');
    assert.equal(renderer.clears || 0, beforeClears, 'IPC delivery itself does not clear');

    h.overlay.flushFrames();
    assert.equal(renderer.draws.length, beforeDraws + 1);
    assert.equal(renderer.draws.at(-1), 3003, 'the CSS renderer uses the latest landing centisecond');
    assert.equal(renderer.clears, beforeClears + 1);
  });
}

test('a delayed A time message and reply cannot affect B or release its pending anchor', () => {
  const h = connectedHarness(true);
  h.main.emitEvent('mpv.seek');
  h.main.emitEvent('mpv.seek');
  h.main.emitEvent('mpv.time-pos.changed', 80);
  const oldMessage = h.toOverlay.shift();
  assert.equal(oldMessage.name, 'time-update');

  // Deliver B's clear/load before the deliberately delayed old message.
  h.main.setVideo('file:///videos/B.mp4');
  h.drainMessages();
  h.overlay.flushFrames();
  h.overlay.flushFrames();
  h.drainMessages();
  const renderer = h.overlay.instances.at(-1);
  h.main.emitEvent('mpv.time-pos.changed', 2);
  h.main.emitEvent('mpv.time-pos.changed', 3);

  h.deliverToOverlay(oldMessage);
  assert.equal(h.overlay.context.getVideoTimeSec(), 0, 'A cannot replace B\'s load snapshot');
  h.deliverReplies();
  assert.equal(h.toOverlay.filter(message => message.name === 'time-update').length, 1,
    'the old acknowledgment cannot release B\'s latest pending time');
  h.drainMessages();
  h.overlay.flushFrames();
  assert.equal(h.overlay.context.getVideoTimeSec(), 3);
  assert.equal(renderer.draws.at(-1), 300);
});

test('cache stalls freeze and recover at native video time without a user pause event', () => {
  const h = connectedHarness(false);
  const renderer = h.overlay.instances[0];
  const beforeDraws = renderer.draws.length, beforeClears = renderer.clears || 0;
  h.overlay.advance(1000);
  assert.equal(h.overlay.context.getVideoTimeSec(), 1);
  emitCacheState(h, 20, 0.5);
  h.drainMessages();
  assert.equal(h.main.context.iina.core.status.paused, false, 'mpv user pause never changes');
  assert.equal(h.overlay.context.getVideoTimeSec(), 0.5, 'cache entry uses the stopped video time');
  h.overlay.advance(5000);
  assert.equal(h.overlay.context.getVideoTimeSec(), 0.5, 'the clock cannot run ahead while buffering');
  assert.equal(renderer.draws.length, beforeDraws, 'cache IPC does not synchronously repaint');
  h.overlay.flushFrames();
  assert.equal(renderer.draws.at(-1), 50);
  assert.equal(renderer.clears, beforeClears + 1);

  const resumeDraws = renderer.draws.length, resumeClears = renderer.clears;
  emitCacheState(h, 100, 0.533333);
  h.main.emitEvent('mpv.time-pos.changed', 0.533333);
  h.drainMessages();
  assert.equal(h.overlay.context.getVideoTimeSec(), 0.533333, 'recovery anchors without pause or seek events');
  assert.equal(renderer.draws.length, resumeDraws);
  assert.equal(h.overlay.frames.size, 1, 'recovery and its progress echo share one frame');
  h.overlay.flushFrames();
  assert.equal(renderer.draws.length, resumeDraws + 1);
  assert.equal(renderer.draws.at(-1), 53);
  assert.equal(renderer.clears, resumeClears + 1);
  h.overlay.advance(1000);
  assert.ok(Math.abs(h.overlay.context.getVideoTimeSec() - 1.533333) < 1e-9);
});

test('queued cache entry and recovery coalesce while repeated cache percentages stay idle', () => {
  const h = connectedHarness(false);
  const renderer = h.overlay.instances[0];
  const beforeDraws = renderer.draws.length, beforeClears = renderer.clears || 0;
  // The native cache has already recovered by the time IINA dispatches these
  // older property callbacks. Their numeric values retain both transitions.
  h.main.setMpv('paused-for-cache', false);
  h.main.setMpv('time-pos', 2);
  h.main.emitEvent('mpv.cache-buffering-state.changed', 20);
  h.main.emitEvent('mpv.cache-buffering-state.changed', 40);
  h.main.emitEvent('mpv.cache-buffering-state.changed', 99);
  emitCacheState(h, 100, 2.033333);
  emitCacheState(h, 100);
  assert.equal(h.toOverlay.filter(message => message.name === 'pause-state').length, 2,
    'only entering and leaving buffering send IPC');
  h.drainMessages();
  assert.equal(h.overlay.context.getVideoTimeSec(), 2.033333, 'the newest cache transition wins');
  assert.equal(renderer.draws.length, beforeDraws);
  assert.equal(h.overlay.frames.size, 1);
  h.overlay.flushFrames();
  assert.equal(renderer.draws.length, beforeDraws + 1);
  assert.equal(renderer.draws.at(-1), 203);
  assert.equal(renderer.clears, beforeClears + 1);
  h.overlay.advance(1000);
  assert.equal(h.overlay.context.getVideoTimeSec(), 3.033333);
});

test('cache recovery preserves a user pause made while buffering', () => {
  const h = connectedHarness(false);
  emitCacheState(h, 25, 1);
  h.drainMessages();
  h.overlay.flushFrames();
  h.main.setPaused(true);
  h.main.emitEvent('mpv.pause.changed');
  h.drainMessages();
  emitCacheState(h, 100, 1.1);
  h.drainMessages();
  h.overlay.flushFrames();
  h.overlay.advance(5000);
  assert.equal(h.overlay.context.getVideoTimeSec(), 1.1, 'cache recovery cannot release the user pause');
  assert.equal(h.overlay.frames.size, 0);
  h.main.setPaused(false);
  h.main.emitEvent('mpv.pause.changed');
  h.drainMessages();
  h.overlay.advance(1000);
  assert.equal(h.overlay.context.getVideoTimeSec(), 2.1, 'user resume starts from the corrected video time');
});

test('loading during an existing cache stall starts paused and observes its recovery', () => {
  const h = connectedHarness(false, true);
  const loadMessage = h.main.overlayMessages.findLast(message => message.name === 'load-danmaku');
  assert.equal(loadMessage.data.playback.paused, true, 'load snapshots include native cache pause');
  h.overlay.advance(5000);
  assert.equal(h.overlay.context.getVideoTimeSec(), 0);
  emitCacheState(h, 20);
  assert.equal(h.toOverlay.length, 0, 'the initial buffering echo does not repeat the snapshot');
  emitCacheState(h, 100, 0.033333);
  h.drainMessages();
  h.overlay.flushFrames();
  assert.equal(h.overlay.context.getVideoTimeSec(), 0.033333);
  h.overlay.advance(1000);
  assert.equal(h.overlay.context.getVideoTimeSec(), 1.033333);
});

test('enabling and releasing a user pause during buffering keep the cache pause', () => {
  const h = connectedHarness(false);
  emitCacheState(h, 20, 1);
  h.drainMessages();
  h.overlay.flushFrames();
  h.main.toggleDanmaku();
  h.drainMessages();
  h.overlay.advance(1000);
  h.main.toggleDanmaku();
  h.drainMessages();
  const enabledMessage = h.main.overlayMessages.findLast(message => message.name === 'toggle-danmaku');
  assert.equal(enabledMessage.data.enabled, true);
  assert.equal(enabledMessage.data.paused, true, 'enabling snapshots include an existing cache pause');
  h.main.setPaused(true);
  h.main.emitEvent('mpv.pause.changed');
  h.drainMessages();
  h.main.setPaused(false);
  h.main.emitEvent('mpv.pause.changed');
  h.drainMessages();
  h.overlay.flushFrames();
  h.overlay.advance(5000);
  assert.equal(h.overlay.context.getVideoTimeSec(), 1, 'user resume cannot release the cache pause');
  assert.equal(h.overlay.frames.size, 0);
  emitCacheState(h, 100, 1.033333);
  h.drainMessages();
  h.overlay.flushFrames();
  h.overlay.advance(1000);
  assert.equal(h.overlay.context.getVideoTimeSec(), 2.033333);
});

test('invalid cache percentages and a no-file unavailable value send no pause transition', () => {
  const h = connectedHarness(false);
  for (const percent of [-1, NaN, 101, '20', null]) {
    h.main.emitEvent('mpv.cache-buffering-state.changed', percent);
  }
  assert.equal(h.toOverlay.length, 0, 'invalid numeric state cannot interrupt active playback');
  h.overlay.advance(1000);
  assert.equal(h.overlay.context.getVideoTimeSec(), 1);

  const noFile = connectedHarness(false, false, null);
  noFile.main.emitEvent('mpv.cache-buffering-state.changed', 0);
  noFile.main.emitEvent('mpv.cache-buffering-state.changed', 100);
  assert.equal(noFile.toOverlay.length, 0, 'IINA\'s unavailable-as-zero value is ignored without a video');
});

for (const initiallyBuffering of [true, false]) {
  test(`cache changes after a load snapshot remain observable (initiallyBuffering=${initiallyBuffering})`, () => {
    const h = connectedHarness(false, initiallyBuffering, 'file:///videos/A.mp4', (main, name) => {
      if (name === 'load-danmaku') main.setMpv('paused-for-cache', !initiallyBuffering);
    });
    const loadMessage = h.main.overlayMessages.findLast(message => message.name === 'load-danmaku');
    assert.equal(loadMessage.data.playback.paused, initiallyBuffering,
      'native state changes after sending the snapshot, before installing observers');
    emitCacheState(h, initiallyBuffering ? 100 : 20, 0.25);
    assert.equal(h.toOverlay.filter(message => message.name === 'pause-state').length, 1);
    h.drainMessages();
    h.overlay.flushFrames();
    assert.equal(h.overlay.context.getVideoTimeSec(), 0.25);
    h.overlay.advance(1000);
    assert.equal(h.overlay.context.getVideoTimeSec(), initiallyBuffering ? 1.25 : 0.25,
      'the first cache callback corrects the stale load snapshot');
  });

  test(`cache changes after an enable snapshot remain observable (initiallyBuffering=${initiallyBuffering})`, () => {
    const h = connectedHarness(false);
    h.main.toggleDanmaku();
    h.drainMessages();
    h.main.setMpv('paused-for-cache', initiallyBuffering);
    const post = h.main.context.iina.overlay.postMessage;
    h.main.context.iina.overlay.postMessage = (name, data) => {
      post(name, data);
      if (name === 'toggle-danmaku' && data.enabled) {
        h.main.setMpv('paused-for-cache', !initiallyBuffering);
      }
    };
    h.main.toggleDanmaku();
    h.drainMessages();
    const enabledMessage = h.main.overlayMessages.findLast(message => message.name === 'toggle-danmaku');
    assert.equal(enabledMessage.data.paused, initiallyBuffering);
    emitCacheState(h, initiallyBuffering ? 100 : 20, 0.25);
    assert.equal(h.toOverlay.filter(message => message.name === 'pause-state').length, 1);
    h.drainMessages();
    h.overlay.flushFrames();
    assert.equal(h.overlay.context.getVideoTimeSec(), 0.25);
    h.overlay.advance(1000);
    assert.equal(h.overlay.context.getVideoTimeSec(), initiallyBuffering ? 1.25 : 0.25,
      'the observer tracks the sent enable snapshot rather than a later getter result');
  });
}

test('filter reload snapshots update the cache state tracked by an existing observer', () => {
  const h = connectedHarness(false);
  const beforeLoad = h.main.overlayMessages.findLast(message => message.name === 'load-danmaku').data.loadId;
  h.main.emitSidebar('danmaku-blocklist-set-enabled', {enabled: true});
  h.main.setMpv('paused-for-cache', true);
  h.main.setMpv('time-pos', 1);
  h.main.emitSidebar('danmaku-blocklist-add', {word: 'A comment'});
  h.drainMessages();
  h.overlay.flushFrames();
  h.overlay.flushFrames();
  h.drainMessages();
  const filteredLoad = h.main.overlayMessages.findLast(message => message.name === 'load-danmaku');
  assert.ok(filteredLoad.data.loadId > beforeLoad, 'filtering sends a replacement projection');
  assert.equal(filteredLoad.data.playback.paused, true);
  h.overlay.advance(1000);
  assert.equal(h.overlay.context.getVideoTimeSec(), 1);
  emitCacheState(h, 100, 1.033333);
  assert.equal(h.toOverlay.filter(message => message.name === 'pause-state').length, 1,
    'recovery is compared with the new snapshot even without replacing the observer');
  h.drainMessages();
  h.overlay.flushFrames();
  assert.equal(h.overlay.context.getVideoTimeSec(), 1.033333);
  h.overlay.advance(1000);
  assert.equal(h.overlay.context.getVideoTimeSec(), 2.033333);
});

for (const paused of [true, false]) {
  test(`a delayed A cache transition cannot pause or reposition B (paused=${paused})`, () => {
    const h = connectedHarness(false);
    emitCacheState(h, 20, 2);
    if (!paused) {
      h.drainMessages();
      h.overlay.flushFrames();
      emitCacheState(h, 100, 2.033333);
    }
    const oldMessage = h.toOverlay.shift();
    assert.equal(oldMessage.name, 'pause-state');
    assert.equal(oldMessage.data.paused, paused);

    h.main.setMpv('paused-for-cache', false);
    h.main.setMpv('time-pos', 10);
    h.main.setVideo('file:///videos/B.mp4');
    h.drainMessages();
    h.overlay.flushFrames();
    h.overlay.flushFrames();
    h.drainMessages();
    const renderer = h.overlay.instances.at(-1);
    const beforeDraws = renderer.draws.length, beforeClears = renderer.clears || 0;
    h.deliverToOverlay(oldMessage);
    assert.equal(h.overlay.context.getVideoTimeSec(), 10, 'A cannot overwrite B\'s video anchor');
    h.overlay.advance(1000);
    assert.equal(h.overlay.context.getVideoTimeSec(), 11, 'A cannot stop B\'s playing clock');
    h.overlay.flushFrames();
    assert.equal(renderer.draws.length, beforeDraws + 1, 'only B\'s ordinary playback frame draws');
    assert.equal(renderer.clears || 0, beforeClears, 'old cache state does not schedule a clear');
  });
}
