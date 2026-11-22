'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const Engine = require('../overlay/lib/niconicomments.min.js');
const {parseDanmakuSource, projectDanmaku} = require('../danmaku-document.js');
const formatted = data => projectDanmaku(parseDanmakuSource(data, '', 'dandanplay')).formatted;
const source = fs.readFileSync(path.join(__dirname, '../overlay/main.js'), 'utf8');

function harness() {
  const handlers = new Map(), timers = new Map(), frames = new Map(), windowHandlers = new Map();
  const instances = [], messages = [], events = [], logs = [];
  let id = 0, now = 1000;
  let cssContainer = null, canvasWidth = 300, canvasHeight = 150;
  const canvas = {style: {}}, viewport = {style: {}};
  Object.defineProperties(canvas, {
    width: {get() {return canvasWidth;}, set(value) {canvasWidth = value; canvas.pixels = null; events.push('canvas-reset');}},
    height: {get() {return canvasHeight;}, set(value) {canvasHeight = value; canvas.pixels = null; events.push('canvas-reset');}},
  });
  class Renderer {
    constructor(canvas, data, options) {
      this.data = data; this.options = options; this.size = options.viewportSize; this.draws = []; instances.push(this);
      if (options.mode === 'css') {
        cssContainer = this.container = {style: {}, remove() {this.removed = true; events.push('css-remove'); cssContainer = null;}};
      }
    }
    addEventListener() {} removeEventListener() {}
    clear() {this.clears = (this.clears || 0) + 1; canvas.pixels = null; events.push('renderer-clear');}
    destroy() {this.destroyed = true; events.push('renderer-destroy'); if (this.container) this.container.remove();}
    pauseCSS() {} resumeCSS() {} setPlaybackSpeed() {} setScrollSpeed(speed) {if (this.scrollSpeed === speed) return false; this.scrollSpeed = speed; return true;}
    drawCanvas(vpos) { this.draws.push(vpos); canvas.pixels = this.data; }
    resize(width, height) { this.size = {width, height}; return true; }
  }
  const context = vm.createContext({
    iina: {onMessage(name, callback) { handlers.set(name, callback); }, postMessage(name, data) {messages.push({name, data}); events.push(name);}},
    document: {getElementById(id) { return id === 'danmaku-viewport' ? viewport : canvas; }, querySelector() { return cssContainer; }},
    window: {location: {href: 'file:///plugin/overlay/index.html'}, innerWidth: 1280, innerHeight: 720,
      addEventListener(name, callback) {windowHandlers.set(name, callback);}}, URL, console: {log(message) {logs.push(message);}},
    performance: {now() {return now;}}, NiconiComments: Renderer,
    setTimeout(callback) {timers.set(++id, callback); return id;}, clearTimeout(id) {timers.delete(id);},
    requestAnimationFrame(callback) {frames.set(++id, callback); return id;}, cancelAnimationFrame(id) {frames.delete(id);},
  });
  vm.runInContext(source, context);
  return {advance(ms) {now += ms;}, context, instances, messages, events, logs, timers, frames, canvas, viewport,
    send(name, data) {handlers.get(name)(data);}, emitWindow(name) {windowHandlers.get(name)();},
    read(expr) {return vm.runInContext(expr, context);},
    flush() {for (const [id, callback] of Array.from(timers)) {timers.delete(id); callback();}},
    flushFrames() {for (const [id, callback] of Array.from(frames)) {frames.delete(id); callback();}}};
}

const comment = (text, commands, owner = false, user = 'u') => ({t: 100, text, _commands: commands, _isOwner: owner, _dateSec: 1767196800, _userId: user});
const load = (h, data) => h.send('load-danmaku', {danmakuType: 'dandanplay', comments: formatted(data), canvasMode: 'css'});
const loadResults = h => h.messages.filter(message => message.name === 'danmaku-load-result');
const successes = h => loadResults(h).filter(message => message.data.success);

for (const mode of ['css', 'default']) for (const paused of [false, true]) {
  test(`load success waits for two frame callbacks after drawing (${mode}, paused=${paused})`, () => {
    const h = harness();
    h.send('load-danmaku', {loadId: 1, comments: formatted([comment('new video', [])]), canvasMode: mode,
      playback: {enabled: true, time: 2, paused, speed: 1}});
    assert.deepEqual(h.instances[0].draws, [200], 'initial draw completes synchronously');
    assert.equal(successes(h).length, 0, 'drawing does not synchronously report success');
    assert.equal(h.frames.size, paused ? 1 : 2, 'notifier does not depend on the playback loop');
    h.flushFrames();
    assert.equal(successes(h).length, 0, 'the first frame callback only schedules the second');
    h.flushFrames();
    assert.deepEqual(successes(h).map(message => ({...message.data})), [{loadId: 1, success: true}]);
    assert.equal(h.read('loadSuccessFrame'), null);
    if (paused) assert.deepEqual(h.instances[0].draws, [200], 'paused success requires no playback draw');
  });
}

for (const completedFrames of [0, 1]) {
  test(`new load invalidates an older success even when frame cancellation fails (stage ${completedFrames + 1})`, () => {
    const h = harness();
    const data = {comments: formatted([comment('video', [])]), playback: {enabled: true, time: 1, paused: true, speed: 1}};
    h.send('load-danmaku', {...data, loadId: 1});
    if (completedFrames) h.flushFrames();
    const staleCallback = h.frames.get(h.read('loadSuccessFrame'));
    h.context.cancelAnimationFrame = () => {};
    h.send('load-danmaku', {...data, loadId: 2});
    h.flushFrames();
    assert.equal(successes(h).length, 0);
    h.flushFrames();
    assert.deepEqual(successes(h).map(message => message.data.loadId), [2]);
    staleCallback();
    assert.deepEqual(successes(h).map(message => message.data.loadId), [2], 'obsolete callbacks cannot revive a completed load');
  });
}

test('clear and renderer failure cancel pending success and reject callbacks that were already queued', () => {
  const h = harness();
  const data = {comments: formatted([comment('video', [])]), playback: {enabled: true, time: 1, paused: true, speed: 1}};
  h.send('load-danmaku', {...data, loadId: 1}); h.flushFrames();
  const clearedCallback = h.frames.get(h.read('loadSuccessFrame'));
  h.send('clear-danmaku', {clearId: 2});
  assert.equal(h.frames.size, 0);
  assert.equal(h.read('loadSuccessFrame'), null);
  clearedCallback();
  assert.equal(successes(h).length, 0);
  h.send('load-danmaku', {...data, loadId: 3}); h.flushFrames();
  const failedCallback = h.frames.get(h.read('loadSuccessFrame'));
  h.context.reportCanvasError(new Error('render failed'));
  assert.equal(h.frames.size, 0);
  assert.equal(h.read('loadSuccessFrame'), null);
  failedCallback();
  assert.deepEqual(loadResults(h).map(message => ({...message.data})), [{loadId: 3, success: false}]);
  h.send('load-danmaku', {...data, loadId: 4}); h.flushFrames(); h.flushFrames();
  assert.deepEqual(successes(h).map(message => message.data.loadId), [4], 'a later renderer can settle normally');
});

test('a playing draw failure during the two-frame window reports failure and cancels success', () => {
  const h = harness();
  h.send('load-danmaku', {loadId: 1, comments: formatted([comment('video', [])]),
    playback: {enabled: true, time: 1, paused: false, speed: 1}});
  h.instances[0].drawCanvas = () => {throw new Error('frame failed');};
  assert.doesNotThrow(() => h.flushFrames());
  h.flushFrames();
  assert.deepEqual(loadResults(h).map(message => ({...message.data})), [{loadId: 1, success: false}]);
  assert.equal(h.frames.size, 0);
  assert.equal(h.read('niconiComments'), null);
});

test('a pending style rebuild invalidates the old success despite retaining its load ID', () => {
  const h = harness();
  h.send('load-danmaku', {loadId: 1, comments: formatted([comment('video', [])]),
    playback: {enabled: true, time: 1, paused: true, speed: 1}});
  h.flushFrames();
  const staleCallback = h.frames.get(h.read('loadSuccessFrame'));
  h.send('set-fontscale', {scale: 0.5});
  assert.equal(h.frames.size, 0, 'scheduling replacement cancels the old success');
  staleCallback();
  assert.equal(successes(h).length, 0);
  h.flush();
  assert.equal(h.instances.length, 2);
  staleCallback(); h.flushFrames();
  assert.equal(successes(h).length, 0, 'old identity cannot acknowledge the replacement');
  h.flushFrames();
  assert.deepEqual(successes(h).map(message => message.data.loadId), [1]);
});

test('bundled CSS measurement renderer keeps pixels small while resizing its logical viewport', () => {
  const previousDocument = global.document;
  const canvases = [];
  global.document = {
    createElement() {
      const canvas = {
        width: 300, height: 150,
        getContext() { return {scale() {}, measureText(text) { return {width: text.length * 10}; }}; },
      };
      canvases.push(canvas);
      return canvas;
    },
  };
  try {
    const renderer = new Engine.internal.renderer.CSSMeasurementRenderer({width: 2520, height: 1080});
    assert.deepEqual(renderer.getSize(), {width: 2520, height: 1080});
    for (const width of [1440, 1920, 2520]) {
      renderer.setSize(width, 1080);
      assert.deepEqual(renderer.getSize(), {width, height: 1080});
      assert.equal(renderer.canvas.width, 1);
      assert.equal(renderer.canvas.height, 1);
    }
    assert.equal(canvases.length, 1);
    renderer.destroy();
    assert.equal(renderer.canvas.width, 0);
    assert.equal(renderer.canvas.height, 0);
  } finally {
    if (previousDocument === undefined) delete global.document;
    else global.document = previousDocument;
  }
});

test('repeated emoji tiles preserve whole graphemes and leave mixed text and text presentation alone', () => {
  const h = harness();
  for (const glyph of ['🌀', '🔥', '👩🏽‍💻', '🇯🇵', '❤️', '1️⃣', '⌚']) {
    const result = h.context.getRepeatedEmoji(glyph.repeat(8));
    assert.equal(result.glyph, glyph);
    assert.equal(result.count, 8);
  }
  for (const text of ['🌀'.repeat(7), '渦'.repeat(68), '🌀🔥'.repeat(8), '前文' + '🌀'.repeat(68),
    '🌀'.repeat(68) + 'x2', '🌀'.repeat(8) + '\n', '❤'.repeat(8), '⌚\uFE0E'.repeat(8)]) {
    assert.equal(h.context.getRepeatedEmoji(text), null);
  }
});

test('formatted IDs handle prototype names and do not collide with numeric user IDs', () => {
  const h = harness();
  const input = ['1', 'other', '__proto__', 'constructor', '_nextId', '1'].map(user => comment(user, [], false, user));
  const data = formatted(input);
  assert.equal(new Set(data.slice(0, 5).map(c => c.user_id)).size, 5);
  assert.equal(data[0].user_id, data[5].user_id);
  assert.equal(Engine.internal.inputParser.default(data, 'formatted').length, 6);
});

test('bundled CSS engine follows Canvas Auto dates and overrides after overlay rebuilds', () => {
  const h = harness();
  const input = [
    {...comment('old', []), _dateSec: 1499871599},
    {...comment('threshold', []), _dateSec: 1499871600},
    comment('network', ['naka']),
    {...comment('old gothic', ['gothic']), _dateSec: 1499871599},
    comment('forced Flash', ['nico:flash']),
    comment('font override', ['nico:flash', 'mincho']),
  ];
  load(h, input);
  h.send('set-scroll-speed', {speed: 0.5});
  h.send('set-fontscale', {scale: 0.35});
  h.flush();
  const data = h.read('formattedComments');
  assert.deepEqual(Array.from(data, c => c.date), input.map(c => c._dateSec));
  for (const mode of ['css', 'default']) {
    assert.deepEqual(Array.from(data, c => Engine.FlashComment.condition(c,
      {flashThreshold: 1499871600}, {mode})), [true, false, false, false, true, false]);
  }
  assert.equal(h.instances.at(-1).options.mode, 'css');
  h.send('set-canvas-mode', {mode: 'default'});
  h.flush();
  assert.equal(h.instances.at(-1).options.mode, 'default');
});

test('scroll speed changes preserve commands and renderer instances', () => {
  const h = harness();
  load(h, [comment('scroll', ['naka']), comment('fixed', ['ue']), comment('custom', ['@4']), comment('owner', [], true)]);
  const before = JSON.stringify(h.read('formattedComments'));
  h.send('set-scroll-speed', {speed: 0.5});
  h.flush();
  assert.equal(h.instances.length, 1);
  assert.equal(h.instances[0].scrollSpeed, 0.5);
  assert.equal(JSON.stringify(h.read('formattedComments')), before);
  h.send('set-scroll-speed', {speed: 1});
  assert.equal(h.instances.length, 1);
});

test('small seeks while paused repaint at the offset-adjusted position without accumulating offsets', () => {
  const h = harness();
  h.send('pause-state',{paused:true});
  h.send('time-update',{time:10});
  load(h, [comment('test', [])]);
  h.send('set-danmaku-offset',{offset:-2});
  h.send('pause-state',{paused:true});
  h.send('time-update',{time:10.25});
  h.flushFrames();
  assert.equal(h.instances.at(-1).draws.at(-1), 825);
  h.send('time-update',{time:NaN});
  assert.equal(h.context.getVideoTimeSec(), 10.25);
});

test('rapid style updates rebuild once and clear cancels a pending rebuild', () => {
  const h = harness();
  load(h, [comment('test', [])]);
  for (const [name,data] of [['set-fontscale',{scale:0.5}], ['set-stroke-width',{width:3}], ['set-danmaku-font',{fontFamily:'',fontWeight:'200'}], ['set-scroll-speed',{speed:0.5}]]) h.send(name,data);
  assert.equal(h.instances.length,1);
  h.flush();
  assert.equal(h.instances.length,2);
  assert.equal(h.instances[1].options.scale,0.5);
  h.send('set-stroke-width',{width:4});
  h.send('clear-danmaku',{});
  h.flush();
  assert.equal(h.instances.length,2);
});

for (const mode of ['css', 'default']) {
  test(`video clear tears down visible content and cancels pending work (${mode})`, () => {
    const h = harness();
    h.send('load-danmaku', {loadId: 4, comments: formatted([comment('old video', [])]), canvasMode: mode,
      playback: {enabled: true, time: 10, paused: false, speed: 1}});
    const old = h.instances[0], container = old.container;
    h.send('set-fontscale', {scale: 0.5});
    h.emitWindow('resize');
    assert.equal(h.timers.size, 1);
    assert.equal(h.frames.size, 2, 'playing loop and viewport update are queued');
    const size = {width: h.canvas.width, height: h.canvas.height};
    const messageCount = h.messages.length;
    h.events.length = 0;
    h.send('clear-danmaku', {clearId: 5});
    assert.equal(old.destroyed, true);
    if (container) assert.equal(container.removed, true);
    assert.equal(h.canvas.pixels, null);
    assert.deepEqual({width: h.canvas.width, height: h.canvas.height}, size);
    assert.equal(h.messages.length, messageCount, 'clear needs no response IPC');
    assert.equal(h.timers.size, 0);
    assert.equal(h.frames.size, 0);
    for (const name of ['niconiComments', 'formattedComments', 'canvasRebuildTimer', 'canvasRafId', 'canvasViewportFrame', 'lastTime']) {
      assert.equal(h.read(name), null, name + ' cleared');
    }
    assert.equal(h.read('canvasRebuildPending'), false);
    assert.equal(h.read('canvasIsPlaying'), false);
    assert.equal(h.context.getVideoTimeSec(), 0);
    h.flush(); h.flushFrames();
    assert.equal(h.instances.length, 1, 'old source cannot rebuild after clear');
  });
}

test('tagged clears and loads reject stale IPC without changing a newer source', () => {
  const h = harness();
  const data = {comments: formatted([comment('old video', [])]), canvasMode: 'css'};
  h.send('load-danmaku', {...data, loadId: 10});
  h.send('clear-danmaku', {clearId: 11});
  h.send('load-danmaku', {...data, loadId: 10, canvasFontScale: 0.25});
  h.send('load-danmaku', {...data, loadId: 11, canvasFontScale: 0.25});
  assert.equal(h.instances.length, 1, 'loads at or before the clear cannot restore old comments');
  assert.equal(h.read('canvasFontScale'), 1, 'stale load settings are ignored too');
  const eventCount = h.events.length;
  h.send('clear-danmaku', {clearId: 11});
  assert.equal(h.events.length, eventCount, 'repeat clear IDs do not repeat cleanup');
  h.send('load-danmaku', {...data, loadId: 12});
  const current = h.instances.at(-1), messageCount = h.messages.length;
  h.send('clear-danmaku', {clearId: 11});
  h.send('clear-danmaku', {clearId: 12});
  h.send('load-danmaku', {...data, loadId: 12});
  assert.equal(current.destroyed, undefined);
  assert.equal(h.instances.length, 2);
  assert.equal(h.messages.length, messageCount, 'stale requests produce no success reply');
  h.send('clear-danmaku', {});
  h.send('load-danmaku', {...data, loadId: 11});
  assert.equal(h.instances.length, 2, 'legacy clear does not reset the ID boundary');
});

for (const mode of ['css', 'default']) for (const nextMode of ['css', 'default']) {
  test(`independent cleanup survives failures and the next load recovers (${mode} to ${nextMode})`, () => {
    const h = harness();
    h.send('load-danmaku', {loadId: 1, comments: formatted([comment('old video', [])]), canvasMode: mode,
      playback: {enabled: true, time: 10, paused: false, speed: 1}});
    const old = h.instances[0], container = old.container;
    const steps = [];
    h.context.failingEmoji = {destroy() {steps.push('emoji'); throw new Error('emoji failed');}};
    h.read('domEmojiRenderer = failingEmoji');
    old.removeEventListener = () => {steps.push('unbind'); throw new Error('unbind failed');};
    old.clear = () => {steps.push('clear'); throw new Error('clear failed');};
    old.destroy = () => {steps.push('destroy'); throw new Error('destroy failed');};
    h.send('set-fontscale', {scale: 0.5});
    assert.doesNotThrow(() => h.send('clear-danmaku', {clearId: 2}));
    assert.deepEqual(steps, ['emoji', 'unbind', 'clear', 'destroy'], 'one failure does not skip later cleanup');
    if (container) assert.equal(container.removed, true);
    assert.equal(h.canvas.pixels, null, 'independent surface reset survives an engine failure');
    assert.equal(h.read('niconiComments'), null);
    assert.equal(h.read('formattedComments'), null);
    assert.equal(h.read('canvasRebuildPending'), false);
    assert.equal(h.context.getVideoTimeSec(), 0);
    assert.equal(h.timers.size, 0);
    assert.equal(h.frames.size, 0);
    for (const step of ['emoji destroy', 'unbind', 'renderer clear', 'renderer destroy']) {
      assert.ok(h.logs.some(line => line.includes('[overlay] ' + step + ' failed:')));
    }
    h.send('clear-danmaku', {clearId: 2});
    assert.equal(steps.length, 4, 'a repeated clear does not retry the old renderer');
    h.flush(); h.flushFrames();
    assert.equal(h.instances.length, 1);
    h.send('load-danmaku', {loadId: 3, comments: formatted([comment('new video', [])]), canvasMode: nextMode,
      playback: {enabled: true, time: 2, paused: true, speed: 1}});
    assert.equal(h.instances.length, 2);
    assert.deepEqual(h.instances[1].draws, [200]);
    assert.equal(h.read('formattedComments')[0].content, 'new video');
    assert.equal(successes(h).length, 0);
    h.flushFrames(); h.flushFrames();
    assert.equal(h.messages.at(-1).data.loadId, 3);
    assert.equal(h.messages.at(-1).data.success, true);
    assert.equal(h.canvas.width, nextMode === 'css' ? 1 : 1920);
    assert.equal(h.canvas.height, nextMode === 'css' ? 1 : 1080);
  });
}

test('CSS shadow edits coalesce, preserve disabled state, and are deferred in Canvas mode', () => {
  const h = harness();
  h.send('load-danmaku', {comments: formatted([comment('shadow', [])]), canvasMode: 'css', cssTextShadowBlur: 2});
  assert.equal(h.instances[0].options.config.cssTextShadowBlur, 2);
  h.send('set-css-text-shadow-blur', {blur: 3});
  h.send('set-css-text-shadow-blur', {blur: 4});
  assert.equal(h.instances[0].options.config.cssTextShadowBlur, 2, 'old renderer stays unchanged until rebuild');
  h.flush();
  assert.equal(h.instances.length, 2);
  assert.equal(h.instances[1].options.config.cssTextShadowBlur, 4);
  h.send('set-css-text-shadow-blur', {blur: 4});
  h.send('set-css-text-shadow-blur', {blur: NaN});
  h.flush();
  assert.equal(h.instances.length, 2);
  h.send('toggle-danmaku', {enabled: false});
  h.send('set-css-text-shadow-blur', {blur: 6});
  h.flush();
  assert.equal(h.instances.length, 2, 'hidden comments do not rebuild');
  h.send('toggle-danmaku', {enabled: true, paused: true, time: 1});
  assert.equal(h.instances.length, 3);
  assert.equal(h.instances[2].options.config.cssTextShadowBlur, 6);
  h.send('set-canvas-mode', {mode: 'default'}); h.flush();
  h.send('set-css-text-shadow-blur', {blur: 1}); h.flush();
  assert.equal(h.instances.length, 4, 'Canvas does not rebuild for a CSS-only edit');
  h.send('set-canvas-mode', {mode: 'css'}); h.flush();
  assert.equal(h.instances[4].options.config.cssTextShadowBlur, 1);
  h.send('set-css-text-shadow-blur', {blur: 0}); h.flush();
  assert.equal(h.instances[5].options.config.cssTextShadowBlur, 0);
});

test('invalid formatted input reports a correlated load error instead of escaping the message handler', () => {
  const h = harness();
  assert.doesNotThrow(() => h.send('load-danmaku', {loadId:7,danmakuType:'nico-json',comments: 'invalid'}));
  const result = h.messages.findLast(m => m.name === 'danmaku-load-result').data;
  assert.equal(result.loadId,7);
  assert.equal(result.success,false);
});

test('4:3 video uses full height and keeps hidden CSS canvas at 1x1 while allocating Canvas mode buffer', () => {
  const h = harness();
  h.send('load-danmaku', {loadId: 1, danmakuType: 'dandanplay', comments: formatted([comment('test', [])]), videoAspectRatio: 4 / 3});
  assert.equal(h.canvas.width, 1);
  assert.equal(h.canvas.height, 1);
  assert.deepEqual({...h.instances[0].options.viewportSize}, {width: 1440, height: 1080});
  assert.deepEqual(h.instances[0].size, {width: 1440, height: 1080});
  assert.deepEqual(h.viewport.style, {left: '160px', top: '0px', width: '960px', height: '720px'});
  h.context.window.innerWidth = 960;
  h.send('resize', {});
  assert.equal(h.viewport.style.left, '0px');
  assert.equal(h.viewport.style.height, '720px');
  assert.equal(h.canvas.width, 1);
  assert.equal(h.canvas.height, 1);
  assert.equal(h.instances.length, 1, 'window resizing does not parse/rebuild CA');
  h.send('set-canvas-mode', {mode: 'default'});
  h.flush();
  assert.equal(h.canvas.width, 1440);
  assert.equal(h.canvas.height, 1080);
  h.context.window.innerWidth = 1280;
  h.send('set-video-aspect', {aspect: 4 / 3});
  assert.deepEqual(h.instances[1].size, {width: 1440, height: 1080});
  h.send('set-canvas-mode', {mode: 'css'});
  h.flush();
  assert.equal(h.canvas.width, 1);
  assert.equal(h.canvas.height, 1);
  assert.deepEqual(h.instances[2].size, {width: 1440, height: 1080});
});

test('video aspect changes resize the existing renderer while paused', () => {
  const h = harness();
  h.send('pause-state', {paused: true});
  h.send('time-update', {time: 12});
  load(h, [comment('test', [])]);
  const renderer = h.instances[0];
  h.send('set-video-aspect', {aspect: 4 / 3});
  assert.deepEqual(renderer.size, {width: 1440, height: 1080});
  assert.equal(renderer.draws.at(-1), 1200);
  h.send('set-video-aspect', {aspect: 21 / 9});
  assert.deepEqual(renderer.size, {width: 2520, height: 1080});
  assert.equal(h.instances.length, 1);
  assert.ok(parseFloat(h.viewport.style.top) > 0, 'wide video is letterboxed vertically');
  h.send('set-video-aspect', {aspect: NaN});
  assert.deepEqual(renderer.size, {width: 1920, height: 1080});
});

test('fullscreen expands 4:3 output across pillarboxes without changing video height', () => {
  const h = harness();
  h.send('pause-state', {paused: true});
  h.send('time-update', {time: 12});
  h.send('set-video-aspect', {aspect: 4 / 3, fullscreen: false});
  load(h, [comment('test', [])]);
  const renderer = h.instances[0];
  const videoHeight = h.viewport.style.height;
  h.send('set-fullscreen', {fullscreen: true});
  assert.deepEqual(h.viewport.style, {left: '0px', top: '0px', width: '1280px', height: videoHeight});
  assert.deepEqual(renderer.size, {width: 1920, height: 1080});
  assert.equal(renderer.draws.at(-1), 1200);
  assert.equal(h.instances.length, 1);
  h.send('set-fullscreen', {fullscreen: false});
  assert.deepEqual(h.viewport.style, {left: '160px', top: '0px', width: '960px', height: videoHeight});
  assert.deepEqual(renderer.size, {width: 1440, height: 1080});
});

test('fullscreen startup and resize use the full width, including ultrawide displays', () => {
  const h = harness();
  h.send('load-danmaku', {danmakuType: 'dandanplay', comments: formatted([comment('test', [])]), videoAspectRatio: 4 / 3, fullscreen: true});
  assert.equal(h.canvas.width, 1);
  assert.deepEqual(h.instances[0].size, {width: 1920, height: 1080});
  h.context.window.innerWidth = 1680;
  h.send('resize', {});
  assert.deepEqual(h.instances[0].size, {width: 2520, height: 1080});
  assert.equal(h.canvas.width, 1);
  assert.equal(h.viewport.style.width, '1680px');
  assert.equal(h.viewport.style.height, '720px');
  h.send('set-video-aspect', {aspect: 21 / 9});
  assert.equal(h.viewport.style.width, '1680px');
  assert.equal(h.viewport.style.top, '0px');
});

test('high playback speed follows expected clock drift without clearing active comments', () => {
  const h = harness();
  load(h, [comment('test', [])]);
  h.send('toggle-danmaku', {enabled: true, time: 10, paused: false, speed: 8});
  const renderer = h.instances[0], clears = renderer.clears || 0;
  h.advance(1000);
  h.send('time-update', {time: 18});
  assert.equal(renderer.clears || 0, clears);
  h.send('time-update', {time: 17.8});
  h.flushFrames();
  assert.equal(renderer.clears, clears + 1, 'backward seek below the old 1.5s threshold clears');
});

test('atomic enabling and repeated pause/speed changes keep offset out of the video anchor', () => {
  const h = harness();
  load(h, [comment('test', [])]);
  h.send('set-danmaku-offset', {offset: -3});
  h.send('toggle-danmaku', {enabled: false, time: 10, paused: false, speed: 1});
  h.advance(20000);
  h.send('toggle-danmaku', {enabled: true, time: 45, paused: true, speed: 4});
  assert.equal(h.instances[0].draws.at(-1), 4200);
  for (let i = 0; i < 3; i++) {
    h.send('pause-state', {paused: true});
    h.send('playback-speed', {speed: 2});
  }
  assert.equal(h.context.getVideoTimeSec(), 45);
  assert.equal(h.read('canvasVideoAnchorTime'), 45);
  h.send('time-update', {time: 44.75});
  h.flushFrames();
  assert.equal(h.instances[0].draws.at(-1), 4175);
});

test('small forward seeks correct CSS position while ordinary high-speed progress stays smooth', () => {
  const h = harness(); load(h, [comment('test', [])]);
  h.send('toggle-danmaku', {enabled: true, time: 10, paused: false, speed: 1});
  const renderer = h.instances[0]; const before = renderer.clears || 0;
  h.advance(100); h.send('time-update', {time: 10.6});
  h.flushFrames();
  assert.equal(renderer.clears, before + 1);
  assert.equal(renderer.draws.at(-1), 1060);
  h.advance(100); h.send('time-update', {time: 10.75, seek: true});
  h.flushFrames();
  assert.equal(renderer.clears, before + 2);
  assert.equal(renderer.draws.at(-1), 1075);
  h.send('playback-speed', {speed: 8});
  h.advance(500); h.send('time-update', {time: 14.75});
  assert.equal(renderer.clears, before + 2);
});

test('an enabled load restores a Canvas surface hidden by the previous toggle', () => {
  const h = harness();
  h.send('toggle-danmaku', {enabled: false, time: 1, paused: true, speed: 1});
  assert.equal(h.canvas.style.display, 'none');
  h.send('load-danmaku', {comments: formatted([comment('test', [])]), canvasMode: 'default',
    playback: {enabled: true, time: 2, paused: true, speed: 1}});
  assert.equal(h.canvas.style.display, '');
  assert.equal(h.instances.length, 1);
  assert.equal(h.instances[0].clears || 0, 0, 'no post-construction clear');
  assert.deepEqual(h.instances[0].draws, [200]);
});

test('speed updates use the playing loop and draw once immediately when paused', () => {
  const h = harness();
  load(h, [comment('test', [])]);
  const renderer = h.instances[0];
  const count = renderer.draws.length;
  h.send('set-scroll-speed', {speed: 0.5});
  assert.equal(renderer.draws.length, count, 'playing waits for the next frame');
  h.send('pause-state', {paused: true});
  h.send('set-scroll-speed', {speed: 0.25});
  assert.equal(renderer.draws.length, count + 1);
  h.send('set-scroll-speed', {speed: 0.25});
  assert.equal(renderer.draws.length, count + 1, 'unchanged speed does not draw');
});

test('hidden paused comments do not draw for offset, speed or seek updates', () => {
  const h = harness();
  load(h, [comment('test', [])]);
  h.send('toggle-danmaku', {enabled: false, time: 2, paused: true, speed: 1});
  const renderer = h.instances[0], draws = renderer.draws.length, clears = renderer.clears;
  h.send('set-danmaku-offset', {offset: 3});
  h.send('set-scroll-speed', {speed: 0.25});
  h.send('time-update', {time: 5, seek: true});
  h.flush();
  assert.equal(h.instances.length, 1);
  assert.equal(renderer.draws.length, draws);
  assert.equal(renderer.clears, clears);
  h.send('toggle-danmaku', {enabled: true, time: 5, paused: true, speed: 1});
  assert.equal(h.instances.length, 1);
  assert.equal(renderer.draws.length, draws + 1);
  assert.equal(renderer.draws.at(-1), 800);
  assert.equal(renderer.scrollSpeed, 0.25);
});

test('style rebuilds queued before or during disable collapse into one build on enable', () => {
  const h = harness();
  load(h, [comment('test', [])]);
  h.send('set-fontscale', {scale: 0.5});
  h.send('toggle-danmaku', {enabled: false, time: 2, paused: true, speed: 1});
  h.send('set-danmaku-font', {fontFamily: 'Helvetica Neue', fontWeight: '500'});
  h.send('set-stroke-width', {width: 4});
  h.send('set-scroll-speed', {speed: 0.5});
  h.flush();
  assert.equal(h.instances.length, 1);
  h.send('toggle-danmaku', {enabled: true, time: 7, paused: true, speed: 1});
  h.flush();
  assert.equal(h.instances.length, 2);
  assert.equal(h.instances[1].options.scale, 0.5);
  assert.equal(h.instances[1].options.config.fonts.html5.gothic.font, 'Helvetica Neue');
  assert.equal(h.instances[1].options.config.scrollSpeed, 0.5);
  assert.deepEqual(h.instances[1].draws, [700]);
});

test('a hidden load retains its data and reports success only when enabled and constructed', () => {
  const h = harness();
  h.send('load-danmaku', {loadId: 7, comments: formatted([comment('test', [])]),
    playback: {enabled: false, time: 2, paused: true, speed: 1}});
  assert.equal(h.instances.length, 0);
  assert.equal(h.messages.filter(m => m.name === 'danmaku-load-result').length, 0);
  h.send('toggle-danmaku', {enabled: true, time: 3, paused: true, speed: 1});
  assert.equal(h.instances.length, 1);
  assert.deepEqual(h.instances[0].draws, [300]);
  assert.equal(loadResults(h).length, 0);
  h.flushFrames();
  assert.equal(loadResults(h).length, 0);
  h.flushFrames();
  assert.equal(h.messages.filter(m => m.name === 'danmaku-load-result').length, 1);
  assert.equal(h.messages.at(-1).data.loadId, 7);
  assert.equal(h.messages.at(-1).data.success, true);
});

const nicoStyle = {canvasFontScale: 1, danmakuFontFamily: '', danmakuFontWeight: '500', strokeWidth: 0, scrollSpeed: 1,
  strokeOpacity: 1, strokeColor: '#000000', strokeInversionColor: '#ffffff', cssTextShadowBlur: 2};
const balancedStyle = {...nicoStyle, canvasFontScale: 0.5, scrollSpeed: 0.5};
for (const mode of ['css', 'default']) for (const paused of [true, false]) {
  test(`balanced to Nico keeps the old renderer unchanged until one complete replacement (${mode}, paused=${paused})`, () => {
    const h = harness();
    h.send('load-danmaku', {comments: formatted([comment('test', [])]), canvasMode: mode, ...balancedStyle,
      playback: {enabled: true, time: 20, paused, speed: 1}});
    const old = h.instances[0];
    h.send('set-danmaku-style', nicoStyle);
    assert.equal(h.instances.length, 1);
    assert.equal(old.options.scale, 0.5);
    assert.equal(old.options.config.scrollSpeed, 0.5);
    assert.equal(old.scrollSpeed, undefined, 'native setScrollSpeed never remaps the old renderer');
    h.flush();
    assert.equal(h.instances.length, 2);
    const next = h.instances[1];
    assert.equal(next.options.scale, 1);
    assert.equal(next.options.config.scrollSpeed, 1);
    assert.equal(next.options.config.contextLineWidth.html5, 0);
    assert.equal(next.options.config.cssTextShadowBlur, 2);
    assert.equal(next.options.config.contextStrokeOpacity, 1);
    assert.equal(next.options.config.fonts.html5.defont.weight, 500);
    assert.deepEqual(next.draws, [2000]);
  });
}

test('rapid preset changes and a speed override build only the final complete style', () => {
  const h = harness();
  h.send('load-danmaku', {comments: formatted([comment('test', [])]), ...balancedStyle,
    playback: {enabled: true, time: 20, paused: true, speed: 1}});
  h.send('set-danmaku-style', nicoStyle);
  h.send('set-danmaku-style', {...balancedStyle, canvasFontScale: 0.35, danmakuFontWeight: '200'});
  h.send('set-scroll-speed', {speed: 0.75});
  assert.equal(h.instances[0].scrollSpeed, undefined);
  h.flush();
  assert.equal(h.instances.length, 2);
  assert.equal(h.instances[1].options.scale, 0.35);
  assert.equal(h.instances[1].options.config.scrollSpeed, 0.75);
  assert.equal(h.instances[1].options.config.fonts.html5.gothic.weight, 200);
});

test('an atomic preset remains deferred while hidden and applies once on enable', () => {
  const h = harness();
  h.send('load-danmaku', {comments: formatted([comment('test', [])]), ...balancedStyle,
    playback: {enabled: true, time: 20, paused: true, speed: 1}});
  h.send('toggle-danmaku', {enabled: false, time: 20, paused: true, speed: 1});
  h.send('set-danmaku-style', nicoStyle);
  h.flush();
  assert.equal(h.instances.length, 1);
  assert.equal(h.instances[0].scrollSpeed, undefined);
  h.send('toggle-danmaku', {enabled: true, time: 20, paused: true, speed: 1});
  h.flush();
  assert.equal(h.instances.length, 2);
  assert.equal(h.instances[1].options.scale, 1);
  assert.equal(h.instances[1].options.config.scrollSpeed, 1);
});

test('overlay keeps CA layers and passes the fixedCombo flag through to the engine', () => {
  const h = harness(); load(h, [comment('test', [])]);
  assert.equal(h.instances[0].options.keepCA, true);
  assert.equal(h.instances[0].options.dedupeCA, false);
  assert.equal(h.instances[0].options.config.fixedCombo, false);
  assert.equal(h.instances[0].options.config.nakaDedupeWindow, 0);
  h.send('load-danmaku', {danmakuType: 'dandanplay', comments: formatted([comment('fixed', ['ue'])]), canvasMode: 'css', fixedCombo: true});
  assert.equal(h.instances[1].options.config.fixedCombo, true);
});

test('repeated-emoji tiles add vertical padding for stroke and shadow without altering layout height', () => {
  let observerCb = null;
  const tileCanvases = [];
  const replaced = [];
  const textNode = {nodeType: 3, textContent: '🌀'.repeat(8)};
  const commentEl = {
    nodeType: 1,
    hasAttribute(name) { return name === 'data-dm-comment'; },
    closest() { throw new Error('emoji scanning must not match style-synchronizing selectors'); },
    replaceChild(next, prev) { replaced.push({next, prev}); next.parentElement = this; prev.parentElement = null; },
  };
  textNode.parentElement = commentEl;
  const container = {
    contains(el) { for (let current = el; current; current = current.parentElement) if (current === this) return true; return false; },
  };
  commentEl.parentElement = container;
  const ctxCalls = [];
  const sandbox = vm.createContext({
    iina: {onMessage() {}, postMessage() {}},
    document: {
      getElementById() { return {style: {}}; },
      querySelector() { return null; },
      createElement(tag) {
        if (tag === 'canvas') {
          const c = {
            width: 0, height: 0,
            getContext() {
              return {
                scale() {},
                measureText(s) { return s === 'Ag' ? {fontBoundingBoxAscent: 90, fontBoundingBoxDescent: 10} : {width: 100}; },
                strokeText(text, x, y) { ctxCalls.push({op: 'stroke', y, h: c.height}); },
                fillText(text, x, y) { ctxCalls.push({op: 'fill', y, h: c.height}); },
              };
            },
            toDataURL() { return 'data:image/png;base64,test'; },
          };
          tileCanvases.push(c);
          return c;
        }
        return {nodeType: 1, attrs: {}, style: {}, setAttribute(k, v) { this.attrs[k] = v; },
          hasAttribute(k) { return Object.hasOwn(this.attrs, k); }, closest() { throw new Error('selectors must not run'); }};
      },
    },
    window: {location: {href: 'file:///plugin/overlay/index.html'}, innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1},
    MutationObserver: class { constructor(cb) { observerCb = cb; } observe() {} disconnect() {} },
    getComputedStyle() {
      return {
        fontSize: '50px',
        lineHeight: '60px',
        fontFamily: 'sans-serif',
        fontWeight: '500',
        color: '#ffffff',
        webkitTextStrokeWidth: '3px',
        webkitTextStrokeColor: '#000000',
        textShadow: '0px 1px 4px rgb(0, 0, 0)',
      };
    },
    URL, console, performance: {now() {return 1000;}}, setTimeout, clearTimeout, requestAnimationFrame() {return 1;}, cancelAnimationFrame() {},
  });
  vm.runInContext(source, sandbox);
  const renderer = sandbox.createDomEmojiRenderer(container);
  assert.ok(renderer);
  observerCb([{addedNodes: [textNode]}]);
  assert.equal(replaced.length, 1);
  const span = replaced[0].next;
  // ratio = 100 / 50 = 2; padY = ceil(3*2 + (|1| + 4)*2) = 16 -> padEm = 0.16
  assert.equal(span.style.paddingTop, '0.16em');
  assert.equal(span.style.paddingBottom, '0.16em');
  assert.equal(span.style.marginTop, '-0.16em');
  assert.equal(span.style.marginBottom, '-0.16em');
  assert.equal(span.style.backgroundSize, '12.5% 1.52em');
  assert.equal(ctxCalls[0].op, 'stroke');
  assert.equal(ctxCalls[0].h, 152);
  assert.equal(ctxCalls[0].y, 116);
  const existingTileText = {nodeType: 3, textContent: textNode.textContent, parentElement: span};
  const detachedText = {nodeType: 3, textContent: textNode.textContent, parentElement: null};
  const outsideComment = {parentElement: container, hasAttribute() { return false; }, closest() { throw new Error('selectors must not run'); }};
  const outsideText = {nodeType: 3, textContent: textNode.textContent, parentElement: outsideComment};
  observerCb([{addedNodes: [span, existingTileText, detachedText, outsideText]}]);
  assert.equal(replaced.length, 1, 'tiles, detached text and text outside comments are not transformed');
});

for (const mode of ['css', 'default']) for (const paused of [false, true]) {
  test(`seek bursts draw only the latest anchor on one frame (${mode}, paused=${paused})`, () => {
    const h = harness();
    h.send('load-danmaku', {loadId: 1, comments: formatted([comment('test', [])]), canvasMode: mode,
      playback: {enabled: true, time: 10, paused, speed: 1}});
    h.flushFrames(); h.flushFrames();
    h.send('set-danmaku-offset', {offset: -2});
    const renderer = h.instances[0], initialDraws = renderer.draws.length, initialClears = renderer.clears || 0;
    for (let id = 1; id <= 600; id++) h.send('time-update', {
      time: id % 2 ? 60 : 20, seek: true, sourceId: 1, timeId: id,
    });
    assert.equal(renderer.draws.length, initialDraws, 'IPC callbacks do not draw');
    assert.equal(renderer.clears || 0, initialClears, 'IPC callbacks do not remove DOM');
    assert.equal(h.frames.size, 1, 'playing and paused updates share the same pending frame');
    assert.equal(h.messages.filter(m => m.name === 'time-update-ack').length, 600);
    h.flushFrames();
    assert.equal(renderer.draws.length, initialDraws + 1);
    assert.equal(renderer.draws.at(-1), 1800, 'the latest video anchor receives the offset once');
    assert.equal(renderer.clears, initialClears + 1);
    assert.equal(h.frames.size, paused ? 0 : 1);
  });
}

test('explicit progress does not turn native receipt delay into seeks', () => {
  const h = harness();
  h.send('load-danmaku', {loadId: 1, comments: formatted([comment('test', [])]),
    playback: {enabled: true, time: 10, paused: false, speed: 1}});
  const renderer = h.instances[0], clears = renderer.clears || 0;
  for (let id = 1; id <= 100; id++) {
    h.advance(400);
    h.send('time-update', {time: 10 + id / 30, seek: false, sourceId: 1, timeId: id});
    h.flushFrames();
  }
  assert.equal(renderer.clears || 0, clears);
  assert.equal(h.messages.filter(m => m.name === 'time-update-ack').length, 100);
});

test('stale source and duplicate time updates are acknowledged without changing the anchor', () => {
  const h = harness();
  h.send('load-danmaku', {loadId: 3, comments: formatted([comment('new', [])]),
    playback: {enabled: true, time: 10, paused: true, speed: 1}});
  h.send('time-update', {time: 50, seek: true, sourceId: 2, timeId: 1});
  assert.equal(h.context.getVideoTimeSec(), 10);
  h.send('time-update', {time: 12, seek: true, sourceId: 3, timeId: 2});
  h.send('time-update', {time: 80, seek: true, sourceId: 3, timeId: 2});
  assert.equal(h.context.getVideoTimeSec(), 12);
  h.flushFrames();
  assert.equal(h.instances[0].draws.at(-1), 1200);
  assert.deepEqual(h.messages.filter(m => m.name === 'time-update-ack').map(m => ({...m.data})), [
    {timeId: 1, sourceId: 2}, {timeId: 2, sourceId: 3}, {timeId: 2, sourceId: 3},
  ]);
});

test('paused landing and its repeated progress echo require only one draw', () => {
  const h = harness();
  h.send('load-danmaku', {loadId: 1, comments: formatted([comment('test', [])]),
    playback: {enabled: true, time: 10, paused: true, speed: 1}});
  const renderer = h.instances[0], before = renderer.draws.length;
  h.send('time-update', {time: 30.033, seek: true, sourceId: 1, timeId: 1});
  h.send('pause-state', {paused: true});
  h.send('time-update', {time: 30.033, seek: false, sourceId: 1, timeId: 2});
  assert.equal(renderer.draws.length, before);
  h.flushFrames();
  assert.equal(renderer.draws.length, before + 1);
  h.send('time-update', {time: 30.033, seek: false, sourceId: 1, timeId: 3});
  h.flushFrames();
  assert.equal(renderer.draws.length, before + 1, 'unchanged paused echoes remain idle');
});

for (const action of ['clear', 'disable', 'replacement', 'failure']) {
  test(`pending seek frame cannot survive ${action}, even if native cancellation fails`, () => {
    const h = harness();
    h.send('load-danmaku', {loadId: 1, comments: formatted([comment('old', [])]),
      playback: {enabled: true, time: 10, paused: true, speed: 1}});
    h.flushFrames(); h.flushFrames();
    const old = h.instances[0];
    h.send('time-update', {time: 30, seek: true, sourceId: 1, timeId: 1});
    const queued = h.frames.get(h.read('canvasRafId'));
    h.context.cancelAnimationFrame = () => {};
    if (action === 'clear') h.send('clear-danmaku', {clearId: 2});
    else if (action === 'disable') h.send('toggle-danmaku', {enabled: false, time: 30, paused: true, speed: 1});
    else if (action === 'replacement') h.send('load-danmaku', {loadId: 2, comments: formatted([comment('new', [])]),
      playback: {enabled: true, time: 4, paused: true, speed: 1}});
    else h.context.reportCanvasError(new Error('failed'));
    const draws = old.draws.length, replacement = h.instances.at(-1), replacementDraws = replacement.draws.length;
    queued();
    assert.equal(old.draws.length, draws);
    assert.equal(replacement.draws.length, replacementDraws);
    assert.equal(h.read('canvasForceDrawPending'), false);
  });
}
