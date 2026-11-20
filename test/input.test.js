'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const {parseDanmakuSource} = require('../danmaku-document.js');
const parse = source => parseDanmakuSource(source).comments;
const build = (p, text) => parse('<i><d p="' + p + '">' + text + '</d></i>')[0] || null;

test('Bilibili fallback handles reordered attributes, single quotes, CDATA and numeric entities', () => {
  const list=parse('<i><d extra="a>b" p=\'1,1,25,16777215,0,0,uid\'>&amp;lt; &#x8349;<![CDATA[&lt;]]></d></i>');
  assert.equal(list.length,1);
  assert.equal(list[0].text,'&lt; 草&lt;');
  assert.equal(list[0].userId,'uid');
});

test('Bilibili conversion skips malformed time/mode and preserves 24-bit colors', () => {
  assert.equal(build('Infinity,1,25,0','bad'),null);
  assert.equal(build('1,1.5,25,0','bad'),null);
  assert.equal(build('1,7,25,0','advanced'),null);
  assert.ok(build('1,1,25,-1','white').commands.includes('#ffffff'));
});

test('XML comments and self-closing placeholders do not hide or invent fallback comments', () => {
  const list=parse('<i><!-- <d p="0,1,25,0">fake</d> --><d p="0,1,25,0"/><d p="2,1,25,0">real<!--hidden--></d></i>');
  assert.equal(list.length,1);
  assert.equal(list[0].text,'real');
  assert.equal(list[0].vpos,200);
});

test('IINA package modules initialize without Node exports, WebView paths, or callback-time require', () => {
  const native = vm.createContext({});
  const load = file => vm.runInContext('(function () { const module = {};\n' + fs.readFileSync(path.join(__dirname, '..', file), 'utf8') + '\nreturn module.exports; })()', native);
  const parser = load('danmaku-document.js');
  assert.equal(parser.parseDanmakuSource('<packet><chat vpos="1">&AMP;</chat></packet>').comments[0].text, '&');
  const ipc = load('ipc-transport.js');
  assert.equal(ipc.needsIPCEnvelope('${x}'), true);
  assert.equal(ipc.needsIPCEnvelope('plain'), false);
  const i18n = load('plugin-i18n.js');
  assert.equal(i18n.createTranslator('en')('danmaku_on'), 'Danmaku enabled');
  const matcher = load('episode-matcher.js');
  assert.equal(matcher.extractNumberFromName('Show S01E07.mkv'), 7);
  const ddp = load('ddp-client.js');
  assert.equal(typeof ddp.createDdpClient, 'function');
  const exported = load('lib/opencc.min.js');
  const opencc = exported || native.OpenCC;
  assert.equal(opencc.Converter({from: 'tw', to: 'cn'})('繁體著急'), '繁体着急');
});

test('XML format detection reads the root after the prolog, never comment body markup', () => {
  const prolog = '\uFEFF \n<?xml version="1.0"?>\n<!-- <packet><chat>fake</chat></packet> -->\n';
  for (const body of ['literal <chat', '<![CDATA[<packet><chat>literal</chat></packet>]]>', '<!-- <chat>ignored</chat> -->real']) {
    const doc = parseDanmakuSource(prolog + '<i><d p="1,1,25,16777215">' + body + '</d></i>');
    assert.equal(doc.sourceType, 'bilibili-xml');
    assert.equal(doc.comments.length, 1);
    assert.ok(!doc.comments[0].text.includes('fake'));
  }
  for (const root of ['<d p="1,1,25,0">bili</d>', '<chat vpos="100">nico</chat>', '<packet><chat vpos="100">nico</chat></packet>']) {
    const doc = parseDanmakuSource(prolog + root);
    assert.equal(doc.sourceType, root.startsWith('<d ') ? 'bilibili-xml' : 'nico-xml');
    assert.equal(doc.comments.length, 1);
  }
});

test('processing instructions and DOCTYPE declarations do not create source comments', () => {
  const fake = '<d p="0,1,25,0">fake</d>';
  const raw = '<?parser ' + fake + '?>\n<!DOCTYPE i [<!ENTITY sample "<chat>"><!-- ]> ' + fake + ' -->]><i><d p="1,1,25,0">real</d></i>';
  assert.deepEqual(parse(raw).map(c => c.text), ['real']);
  assert.throws(() => parse('<!-- unclosed <i><d p="1,1,25,0">bad</d></i>'));
  assert.throws(() => parse('<wrapper><i><d p="1,1,25,0">bad</d></i></wrapper>'));
});

test('Nico XML premium is opt-in and governs native hex colors; Bilibili and DDP retain color support', () => {
  const {projectDanmaku} = require('../danmaku-document.js');
  const Engine = require('../overlay/lib/niconicomments.min.js');
  const {contexts, definition, utils} = Engine.internal;
  definition.initConfig.initConfig();
  const ctx = {config: definition.config.defaultConfig, options: definition.config.defaultOptions,
    nicoScripts: contexts.createNicoScripts(), rangeCache: new utils.RangeCacheContext()};
  const doc = parseDanmakuSource('<packet>' + ['', ' premium="0"', ' premium="1"'].map(p =>
    '<chat vpos="100" date="1767196800" mail="#ff0000"' + p + '>color</chat>').join('') + '</packet>');
  assert.deepEqual(doc.comments.map(c => c.premium), [false, false, true]);
  assert.deepEqual(projectDanmaku(doc).formatted.map(c => utils.parseCommandAndNicoScript(c, ctx).color.toLowerCase()), ['#ffffff', '#ffffff', '#ff0000']);
  const bili = parseDanmakuSource('<i><d p="1,1,25,16711680">bili</d></i>');
  const ddp = parseDanmakuSource([{p: '1,1,16711680,u', m: 'ddp'}], '', 'dandanplay');
  for (const source of [bili, ddp]) {
    assert.equal(source.comments[0].premium, true);
    assert.equal(utils.parseCommandAndNicoScript(projectDanmaku(source).formatted[0], ctx).color.toLowerCase(), '#ff0000');
  }
});

test('Bilibili XML decouples real p[4] date slicing (UTC+8) from synthetic HTML5 render date', () => {
  const {projectDanmaku} = require('../danmaku-document.js');
  // 2015-06-01 00:30:00+08:00 (pre-2017 Flash threshold) and 2024-03-02 23:30:00+08:00
  const ts2015 = Math.floor(Date.parse('2015-06-01T00:30:00+08:00') / 1000);
  const ts2024 = Math.floor(Date.parse('2024-03-02T23:30:00+08:00') / 1000);
  const day2015 = Date.UTC(2015, 5, 1) / 86400000;
  const day2024 = Date.UTC(2024, 2, 2) / 86400000;
  const xml = `<i>
    <d p="1,1,25,16777215,${ts2015},0,u1,1">old-bili</d>
    <d p="2,1,25,16777215,${ts2024},0,u2,2">new-bili</d>
    <d p="3,1,25,16777215,0,0,u3,3">undated-bili</d>
  </i>`;
  const doc = parseDanmakuSource(xml);
  assert.equal(doc.dateInfo.firstDay, day2015);
  assert.equal(doc.dateInfo.lastDay, day2024);
  assert.equal(doc.dateInfo.undatedCount, 1);
  assert.deepEqual(Array.from(doc.dateInfo.dayCounts, p => Array.from(p)), [[day2015, 1], [day2024, 1]]);
  // Synthetic 2026 render date is retained so niconicomments keeps HTML5 layout even for 2015 Bilibili comments.
  assert.equal(doc.comments[0].dateSec, 1767196800);
  const sliced = projectDanmaku(doc, {startDay: day2024, endDay: day2024});
  assert.deepEqual(sliced.formatted.map(c => c.content), ['new-bili', 'undated-bili']);
  assert.equal(sliced.formatted[0].date, 1767196800);
});
