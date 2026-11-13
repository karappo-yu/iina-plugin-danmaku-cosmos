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
  const exported = load('overlay/lib/opencc.min.js');
  const opencc = exported || native.OpenCC;
  assert.equal(opencc.Converter({from: 'hk', to: 'cn'})('繁體'), '繁体');
});
