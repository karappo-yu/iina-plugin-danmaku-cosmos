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

function connectedHarness(paused) {
  const main = createMain(), overlay = createOverlay();
  const toOverlay = [], toMain = [];
  const mainPost = main.context.iina.overlay.postMessage;
  const overlayPost = overlay.context.iina.postMessage;
  main.context.iina.overlay.postMessage = (name, data) => {
    mainPost(name, data);
    const payload = data.__encoded ? JSON.parse(decodeURIComponent(data.__encoded)) : data;
    toOverlay.push({name, data: clonePayload(payload)});
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
  main.readyOverlay();
  main.setVideo('file:///videos/A.mp4');
  drainMessages();
  overlay.flushFrames();
  overlay.flushFrames();
  drainMessages();
  return {main, overlay, toOverlay, deliverToOverlay, deliverReplies, drainMessages};
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
