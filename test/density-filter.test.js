'use strict';

// 密度过滤扩展到所有格式的行为约定。
// nico-json 走原有 densityFilterNicoJsonComments(本文件只验证它不被新路径介入);
// nico-xml、bilibili-xml 与 dandanplay 共用 selectDensityKeep。

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const MAIN_JS = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');

// 只装出 main.js 加载所需的最小 IINA 环境: 本文件只测纯函数, 不做播放流程。
function loadPlugin() {
  const iina = {
    overlay: { loadFile() {}, show() {}, hide() {}, postMessage() {}, onMessage() {} },
    sidebar: { loadFile() {}, postMessage() {}, onMessage() {} },
    event: { on(name, handler) { return handler; }, off() {} },
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
    file: { exists() { return false; }, list() { return []; }, read() { return null; }, write() {} },
    preferences: { get() {}, set() {}, sync() {} },
    mpv: { getNumber() { return 0; }, set() {} },
    utils: {
      preferredLocalizations() { return ['en']; },
      chooseFile() { return Promise.resolve(null); },
      resolvePath(value) { return value; },
      exec() { return Promise.resolve(null); },
    },
    http: {
      get() { return new Promise(() => {}); },
      post() { return new Promise(() => {}); },
    },
  };
  const context = vm.createContext({
    iina,
    Promise, Date, JSON, Math, Object, Array, String, Number, RegExp,
    encodeURIComponent, decodeURIComponent,
    isFinite, isNaN, parseFloat, parseInt,
    setTimeout() { return 1; },
    clearTimeout() {},
  });
  vm.runInContext(MAIN_JS, context, { filename: 'main.js' });
  return context;
}

const plugin = loadPlugin();

// nico XML: vpos 与 no 都以厘秒/序号给出。默认 120 条挤在同一个 60s 窗口内。
function nicoXml(count, startVpos = 0, stepCs = 10) {
  let s = '<?xml version="1.0" encoding="UTF-8"?><packet>';
  for (let i = 1; i <= count; i++) {
    const vpos = startVpos + i * stepCs;
    s += `<chat vpos="${vpos}" no="${i}" date="1600000000" mail="184" user_id="1">c${i}</chat>`;
  }
  return s + '</packet>';
}

// bilibili XML: p = 秒,模式,字号,颜色,发送时间戳,pool,uid,rowid
function biliXml(count, timestampOf = (i) => 1600000000 + i) {
  let s = '<?xml version="1.0" encoding="UTF-8"?><i><chatserver>chat.bilibili.com</chatserver>';
  for (let i = 1; i <= count; i++) {
    s += `<d p="${(i * 0.1).toFixed(2)},1,25,16777215,${timestampOf(i)},0,uid${i},row${i}">c${i}</d>`;
  }
  return s + '</i>';
}

function ddpList(count) {
  const list = [];
  for (let i = 1; i <= count; i++) {
    list.push({ t: i * 10, text: 'c' + i, _isOwner: false, _commands: ['naka'], _userId: i, _dateSec: 1767196800 });
  }
  return list;
}

function textsOf(raw) {
  const out = [];
  const re = /<(?:d|chat)\b[^>]*>([^<]*)<\/(?:d|chat)>/g;
  let m;
  while ((m = re.exec(raw)) !== null) out.push(m[1]);
  return out;
}

function biliSecondsOf(raw) {
  const out = [];
  const re = /<d\s+p="([^"]*)"/g;
  let m;
  while ((m = re.exec(raw)) !== null) out.push(parseFloat(m[1].split(',')[0]));
  return out;
}

test('nico-xml 编号完整时: 同一窗口按 no 后发优先保留', () => {
  const encoded = encodeURIComponent(nicoXml(120));
  const filtered = plugin.applyDensityFilter(encoded, 'nico-xml', 10);
  assert.ok(filtered, '应当发生过滤');
  const kept = textsOf(decodeURIComponent(filtered));
  assert.equal(kept.length, 10);
  assert.deepEqual(kept, ['c111', 'c112', 'c113', 'c114', 'c115', 'c116', 'c117', 'c118', 'c119', 'c120']);
  // 结构与 XML 头必须原样保留
  assert.ok(decodeURIComponent(filtered).startsWith('<?xml version="1.0" encoding="UTF-8"?><packet>'));
});

for (const [name, noAttribute] of [
  ['全部缺少 no', () => ''],
  ['部分缺少 no', (i) => i === 300 ? '' : ` no="${i + 1}"`],
  ['部分 no 为 0', (i) => ` no="${i === 300 ? 0 : i + 1}"`],
]) {
  test(`nico-xml ${name}时均匀采样, 列表与计数使用相同保留集合`, () => {
    const context = loadPlugin();
    let xml = '<?xml version="1.0" encoding="UTF-8"?><packet>';
    for (let i = 0; i < 600; i++) {
      xml += `<chat vpos="${i * 10}"${noAttribute(i)}>c${i}</chat>`;
    }
    xml += '</packet>';
    const encoded = encodeURIComponent(xml);
    const filtered = context.applyDensityFilter(encoded, 'nico-xml', 50);
    const raw = decodeURIComponent(filtered);
    const times = Array.from(raw.matchAll(/vpos="(\d+)"/g), (m) => Number(m[1]));
    assert.equal(times.length, 50);
    assert.ok(times.at(-1) - times[0] > 5500, '保留弹幕应分布在整分钟内');
    assert.ok(raw.startsWith('<?xml version="1.0" encoding="UTF-8"?><packet>'));
    assert.ok(raw.endsWith('</packet>'));
    const counts = context.countDensityItems(encoded, 'nico-xml', 50);
    assert.equal(counts.total, 600);
    assert.equal(counts.kept, 50);
    context.danmakuCache['/videos/sample.xml'] = encoded;
    context.danmakuFileList.selectedPaths = ['/videos/sample.xml'];
    context.currentDanmakuStatus.fileType = 'nico-xml';
    context.danmakuFilterDensity = 50;
    assert.deepEqual(Array.from(context.buildDanmakuBrowserList(), (item) => item.text), textsOf(raw));
  });
}

test('bilibili-xml 有发送时间戳时按时间戳后发优先', () => {
  const encoded = encodeURIComponent(biliXml(120));
  const filtered = plugin.applyDensityFilter(encoded, 'bilibili-xml', 10);
  assert.ok(filtered);
  const kept = textsOf(decodeURIComponent(filtered));
  assert.deepEqual(kept, ['c111', 'c112', 'c113', 'c114', 'c115', 'c116', 'c117', 'c118', 'c119', 'c120']);
});

test('bilibili-xml 时间戳为 0 时退化为等间隔取样, 且不在 burst 处留头删尾', () => {
  const encoded = encodeURIComponent(biliXml(120, () => 0));
  const filtered = plugin.applyDensityFilter(encoded, 'bilibili-xml', 10);
  assert.ok(filtered);
  const kept = textsOf(decodeURIComponent(filtered));
  assert.equal(kept.length, 10);
  // 不能退化成"保留前 10 条"
  assert.notDeepEqual(kept, ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8', 'c9', 'c10']);
  // 也不能退化成"保留末尾 10 条"
  assert.notDeepEqual(kept, ['c111', 'c112', 'c113', 'c114', 'c115', 'c116', 'c117', 'c118', 'c119', 'c120']);
  const seconds = biliSecondsOf(decodeURIComponent(filtered));
  assert.ok(seconds[seconds.length - 1] - seconds[0] > 8, '取样应覆盖整个 12s 窗口');
});

test('dandanplay 无发送时间信号, 走等间隔取样且不碰 _dateSec 常量', () => {
  const list = ddpList(120);
  const encoded = encodeURIComponent(JSON.stringify(list));
  const filtered = plugin.applyDensityFilter(encoded, 'dandanplay', 10);
  assert.ok(filtered);
  const kept = JSON.parse(decodeURIComponent(filtered));
  assert.equal(kept.length, 10);
  assert.notDeepEqual(kept.map((d) => d.text), list.slice(-10).map((d) => d.text));
  assert.notDeepEqual(kept.map((d) => d.text), list.slice(0, 10).map((d) => d.text));
  assert.ok(kept[kept.length - 1].t - kept[0].t > 800, '取样应覆盖整个 12s 窗口');
  assert.equal(kept[0]._dateSec, 1767196800, '字段原样保留');
});

test('dandanplay owner 弹幕不占配额', () => {
  const list = ddpList(120);
  list[0]._isOwner = true; // 时间最早、会被普通取样丢掉的那条
  const encoded = encodeURIComponent(JSON.stringify(list));
  const kept = JSON.parse(decodeURIComponent(plugin.applyDensityFilter(encoded, 'dandanplay', 10)));
  assert.equal(kept.length, 11);
  assert.ok(kept.some((d) => d._isOwner === true));
});

test('分窗独立计算: 两个 60s 窗口各保留 N 条', () => {
  const first = nicoXml(120, 0, 10);           // vpos 10..1200 → 窗口 0
  const second = nicoXml(120, 6000, 10);       // vpos 6010..7200 → 窗口 1
  const merged = first.replace('</packet>', '') + second.replace(/^.*?<packet>/, '');
  const filtered = plugin.applyDensityFilter(encodeURIComponent(merged), 'nico-xml', 10);
  assert.equal(textsOf(decodeURIComponent(filtered)).length, 20);
});

test('密度未设置或条目本就少于配额时不做任何改写', () => {
  const encoded = encodeURIComponent(nicoXml(5));
  assert.equal(plugin.applyDensityFilter(encoded, 'nico-xml', 0), null);
  assert.equal(plugin.applyDensityFilter(encoded, 'nico-xml', 50), null);
  assert.equal(plugin.applyDensityFilter(encoded, 'bilibili-xml', 0), null);
  assert.equal(plugin.applyDensityFilter(encodeURIComponent(JSON.stringify(ddpList(5))), 'dandanplay', 50), null);
  for (const [type, content] of [
    ['nico-xml', nicoXml(5)],
    ['bilibili-xml', biliXml(5)],
    ['dandanplay', JSON.stringify(ddpList(5))],
  ]) {
    const counts = plugin.countDensityItems(encodeURIComponent(content), type, 0);
    assert.equal(counts.total, 5, `${type} still reports the file total when density is unlimited`);
    assert.equal(counts.kept, 5);
  }
});

test('nico-json 完全不受新路径介入', () => {
  const nicoJson = [{
    fork: 'main',
    comments: [
      { no: 1, vposMs: 1000, body: 'a' },
      { no: 2, vposMs: 2000, body: 'b' },
      { no: 3, vposMs: 3000, body: 'c' },
    ],
  }];
  const encoded = encodeURIComponent(JSON.stringify(nicoJson));
  assert.equal(plugin.applyDensityFilter(encoded, 'nico-json', 1), null);
});

test('nico-json 既有语义不变: nicoru 保护 + 后发优先', () => {
  const comments = [];
  for (let no = 1; no <= 20; no++) comments.push({ no, vposMs: no * 1000, nicoruCount: 0 });
  comments.push({ no: 1, vposMs: 500, nicoruCount: 5 });
  comments.push({ no: 2, vposMs: 600, nicoruCount: 9 });
  const kept = plugin.densityFilterNicoJsonComments(comments, 2);
  // 两条 nicoru 保护不占配额, 另加 no 最大的两条
  assert.equal(kept.length, 4);
  assert.ok(kept.some((c) => c.nicoruCount === 5));
  assert.ok(kept.some((c) => c.nicoruCount === 9));
  assert.ok(kept.some((c) => c.no === 20));
  assert.ok(kept.some((c) => c.no === 19));
});
