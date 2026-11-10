'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const Engine = require('../overlay/lib/niconicomments.min.js');
const source = fs.readFileSync(path.join(__dirname, '../overlay/main.js'), 'utf8');

function harness() {
  const handlers = new Map(), timers = new Map(), instances = [], messages = [];
  let id = 0;
  const canvas = {style: {}};
  class Renderer {
    constructor(canvas, data, options) { this.data = data; this.options = options; this.draws = []; instances.push(this); }
    addEventListener() {} removeEventListener() {} clear() {} destroy() {}
    pauseCSS() {} resumeCSS() {} setPlaybackSpeed() {}
    drawCanvas(vpos) { this.draws.push(vpos); }
  }
  const context = vm.createContext({
    iina: {onMessage(name, callback) { handlers.set(name, callback); }, postMessage(name, data) {messages.push({name, data});}},
    document: {getElementById() { return canvas; }, querySelector() { return null; }},
    window: {location: {href: 'file:///plugin/overlay/index.html'}}, URL, console,
    performance: {now() {return 1000;}}, NiconiComments: Renderer,
    setTimeout(callback) {timers.set(++id, callback); return id;}, clearTimeout(id) {timers.delete(id);},
    requestAnimationFrame() {return ++id;}, cancelAnimationFrame() {},
  });
  vm.runInContext(source, context);
  return {context, instances, messages, send(name, data) {handlers.get(name)(data);},
    read(expr) {return vm.runInContext(expr, context);},
    flush() {for (const [id, callback] of Array.from(timers)) {timers.delete(id); callback();}}};
}

const comment = (text, commands, owner = false, user = 'u') => ({t: 100, text, _commands: commands, _isOwner: owner, _dateSec: 1767196800, _userId: user});
const load = (h, data) => h.send('load-danmaku', {danmakuType: 'dandanplay', xmlContent: encodeURIComponent(JSON.stringify(data)), canvasMode: 'css'});

test('formatted IDs handle prototype names and do not collide with numeric user IDs', () => {
  const h = harness();
  const input = ['1', 'other', '__proto__', 'constructor', '_nextId', '1'].map(user => comment(user, [], false, user));
  const data = h.context.buildFormattedCanvasData(input, 'nico-xml');
  assert.equal(new Set(data.slice(0, 5).map(c => c.user_id)).size, 5);
  assert.equal(data[0].user_id, data[5].user_id);
  assert.equal(Engine.internal.inputParser.default(data, 'formatted').length, 6);
});

test('scroll speed follows first position, command limit, owner and explicit duration semantics', () => {
  const h = harness();
  load(h, [comment('scroll', ['naka','ue']), comment('fixed', ['UE','naka']), comment('custom', ['@4']), comment('owner', [], true), comment('late command', [...Array(64).fill('184'), 'ue'])]);
  h.send('set-scroll-speed', {speed: 0.5});
  h.flush();
  const data = h.read('nicoRawData');
  assert.deepEqual(Array.from(data, c => c.mail.includes('@7')), [true, false, false, false, true]);
  h.send('set-scroll-speed', {speed: 1});
  assert.equal(h.read('nicoRawData').some(c => c.mail.includes('@7')), false, 'restoring speed keeps pristine source');
});

test('official legacy records with missing mail receive speed control and preserve owner records', () => {
  const h = harness();
  const data = [{thread:{}}, {chat:{vpos:100,content:'viewer',user_id:'u'}}, {chat:{vpos:100,content:'owner'}}];
  h.send('load-danmaku', {danmakuType:'nico-json',xmlContent:encodeURIComponent(JSON.stringify(data)),scrollSpeed:0.5});
  const working = h.read('nicoRawData');
  assert.equal(working[1].chat.mail, '@7');
  assert.equal(working[2].chat.mail, undefined);
  assert.equal(Engine.internal.inputParser.default(working, 'legacy').length, 2);
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
  assert.equal(h.context.canvasGetCurrentTime(), 8.25);
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

test('invalid JSON reports a correlated load error instead of escaping the message handler', () => {
  const h = harness();
  assert.doesNotThrow(() => h.send('load-danmaku', {loadId:7,danmakuType:'nico-json',xmlContent:encodeURIComponent('[invalid')}));
  const result = h.messages.findLast(m => m.name === 'danmaku-load-result').data;
  assert.equal(result.loadId,7);
  assert.equal(result.success,false);
});
