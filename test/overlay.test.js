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
  const handlers = new Map(), timers = new Map(), instances = [], messages = [];
  let id = 0, now = 1000;
  const canvas = {style: {}}, viewport = {style: {}};
  class Renderer {
    constructor(canvas, data, options) { this.data = data; this.options = options; this.draws = []; instances.push(this); }
    addEventListener() {} removeEventListener() {} clear() {this.clears = (this.clears || 0) + 1;} destroy() {}
    pauseCSS() {} resumeCSS() {} setPlaybackSpeed() {} setScrollSpeed(speed) {if (this.scrollSpeed === speed) return false; this.scrollSpeed = speed; return true;}
    drawCanvas(vpos) { this.draws.push(vpos); }
    resize(width, height) { this.size = {width, height}; return true; }
  }
  const context = vm.createContext({
    iina: {onMessage(name, callback) { handlers.set(name, callback); }, postMessage(name, data) {messages.push({name, data});}},
    document: {getElementById(id) { return id === 'danmaku-viewport' ? viewport : canvas; }, querySelector() { return null; }},
    window: {location: {href: 'file:///plugin/overlay/index.html'}, innerWidth: 1280, innerHeight: 720}, URL, console,
    performance: {now() {return now;}}, NiconiComments: Renderer,
    setTimeout(callback) {timers.set(++id, callback); return id;}, clearTimeout(id) {timers.delete(id);},
    requestAnimationFrame() {return ++id;}, cancelAnimationFrame() {},
  });
  vm.runInContext(source, context);
  return {advance(ms) {now += ms;}, context, instances, messages, canvas, viewport, send(name, data) {handlers.get(name)(data);},
    read(expr) {return vm.runInContext(expr, context);},
    flush() {for (const [id, callback] of Array.from(timers)) {timers.delete(id); callback();}}};
}

const comment = (text, commands, owner = false, user = 'u') => ({t: 100, text, _commands: commands, _isOwner: owner, _dateSec: 1767196800, _userId: user});
const load = (h, data) => h.send('load-danmaku', {danmakuType: 'dandanplay', comments: formatted(data), canvasMode: 'css'});

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

test('4:3 video uses full height and keeps its bounds in a wide window', () => {
  const h = harness();
  h.send('load-danmaku', {loadId: 1, danmakuType: 'dandanplay', comments: formatted([comment('test', [])]), videoAspectRatio: 4 / 3});
  assert.equal(h.canvas.width, 1440);
  assert.equal(h.canvas.height, 1080);
  assert.deepEqual(h.viewport.style, {left: '160px', top: '0px', width: '960px', height: '720px'});
  h.context.window.innerWidth = 960;
  h.send('resize', {});
  assert.equal(h.viewport.style.left, '0px');
  assert.equal(h.viewport.style.height, '720px');
  assert.equal(h.instances.length, 1, 'window resizing does not parse/rebuild CA');
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
  assert.equal(h.canvas.width, 1920);
  h.context.window.innerWidth = 1680;
  h.send('resize', {});
  assert.deepEqual(h.instances[0].size, {width: 2520, height: 1080});
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
  assert.equal(h.instances[0].draws.at(-1), 4175);
});

test('small forward seeks correct CSS position while ordinary high-speed progress stays smooth', () => {
  const h = harness(); load(h, [comment('test', [])]);
  h.send('toggle-danmaku', {enabled: true, time: 10, paused: false, speed: 1});
  const renderer = h.instances[0]; const before = renderer.clears || 0;
  h.advance(100); h.send('time-update', {time: 10.6});
  assert.equal(renderer.clears, before + 1);
  assert.equal(renderer.draws.at(-1), 1060);
  h.advance(100); h.send('time-update', {time: 10.75, seek: true});
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

test('overlay keeps CA layers but disables the engine duplicate-removal pass', () => {
  const h = harness(); load(h, [comment('test', [])]);
  assert.equal(h.instances[0].options.keepCA, true);
  assert.equal(h.instances[0].options.dedupeCA, false);
  assert.equal(h.instances[0].options.config.fixedCombo, false);
  assert.equal(h.instances[0].options.config.nakaDedupeWindow, 0);
});
