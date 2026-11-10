'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const context = vm.createContext({window:{}});
vm.runInContext(fs.readFileSync(path.join(__dirname,'../overlay/input.js'),'utf8'),context);

test('Bilibili fallback handles reordered attributes, single quotes, CDATA and numeric entities', () => {
  const list=context.parseBilibiliXml('<i><d extra="a>b" p=\'1,1,25,16777215,0,0,uid\'>&amp;lt; &#x8349;<![CDATA[&lt;]]></d></i>');
  assert.equal(list.length,1);
  assert.equal(list[0].text,'&lt; 草&lt;');
  assert.equal(list[0]._userId,'uid');
});

test('Bilibili conversion skips malformed time/mode and preserves 24-bit colors', () => {
  assert.equal(context.buildBilibiliComment('Infinity,1,25,0','bad'),null);
  assert.equal(context.buildBilibiliComment('1,1.5,25,0','bad'),null);
  assert.equal(context.buildBilibiliComment('1,7,25,0','advanced'),null);
  assert.ok(context.buildBilibiliComment('1,1,25,-1','white')._commands.includes('#ffffff'));
});

test('XML comments and self-closing placeholders do not hide or invent fallback comments', () => {
  const list=context.parseBilibiliXml('<i><!-- <d p="0,1,25,0">fake</d> --><d p="0,1,25,0"/><d p="2,1,25,0">real<!--hidden--></d></i>');
  assert.equal(list.length,1);
  assert.equal(list[0].text,'real');
  assert.equal(list[0].t,200);
});
