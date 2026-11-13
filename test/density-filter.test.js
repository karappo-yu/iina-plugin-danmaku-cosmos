'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const {parseDanmakuSource: parse, projectDanmaku: project} = require('../danmaku-document.js');
const Engine = require('../overlay/lib/niconicomments.min.js');

const nico = (count, no = i => i + 1) => '<packet>' + Array.from({length: count}, (_, i) =>
  `<chat vpos="${i * 10}" no="${no(i)}">c${i}</chat>`).join('') + '</packet>';
const bodies = result => result.formatted.map(c => c.content);

for (const [name, order, expected] of [
  ['complete sequence numbers', i => i + 1, ['c8', 'c9']],
  ['missing sequence numbers', () => '', ['c0', 'c5']],
  ['partially missing sequence numbers', i => i === 5 ? '' : i + 1, ['c0', 'c5']],
  ['zero sequence numbers', () => 0, ['c0', 'c5']],
]) test('IR density uses ' + name, () => {
  const doc = parse(nico(10, order));
  const result = project(doc, {density: 2});
  assert.deepEqual(bodies(result), expected);
  assert.equal(result.sourceTotalCount, 10);
  assert.equal(result.filteredCount, 2);
  assert.deepEqual(result.items.map(c => c.text), expected);
  assert.equal(doc.comments.length, 10);
  assert.equal(Engine.internal.inputParser.default(result.formatted, 'formatted').length, 2);
});

test('Bilibili timestamps choose recent comments; zero timestamps choose evenly', () => {
  for (const withDate of [true, false]) {
    const xml = '<i>' + Array.from({length: 10}, (_, i) => `<d p="1,1,25,16777215,${withDate ? i + 1 : 0}">c${i}</d>`).join('') + '</i>';
    assert.deepEqual(bodies(project(parse(xml), {density: 2})), withDate ? ['c8', 'c9'] : ['c0', 'c5']);
  }
});

test('DDP synthetic render dates do not become density ordering signals', () => {
  const rows = Array.from({length: 10}, (_, i) => ({p: '1,1,16777215,user', m: 'c' + i}));
  assert.deepEqual(bodies(project(parse(rows, '', 'dandanplay'), {density: 2})), ['c0', 'c5']);
});

test('density windows are independent and owners/easy/nicoru do not consume quota', () => {
  const comments = Array.from({length: 20}, (_, i) => ({body: 'c' + i, no: i + 1, vposMs: i * 6000}));
  comments.push({body: 'liked', no: 0, vposMs: 1000, nicoruCount: 3});
  const doc = parse([{fork: 'main', comments}, {fork: 'owner', comments: [{body: 'owner', vposMs: 1000}]}, {fork: 'easy', comments: [{body: 'easy', vposMs: 1000}]}]);
  assert.deepEqual(bodies(project(doc, {density: 1})), ['c9', 'c19', 'liked', 'owner', 'easy']);
  assert.equal(project(doc, {density: 0}).filteredCount, 23);
});

test('invalid and empty comments are rejected before quotas and every count', () => {
  const doc = parse('<packet><chat vpos="1" no="1">valid</chat><chat vpos="NaN" no="9">bad</chat><chat vpos="2" no="10"></chat><chat>no time</chat></packet>');
  const result = project(doc, {density: 1});
  assert.equal(result.totalCount, 1);
  assert.equal(result.sourceTotalCount, 1);
  assert.equal(result.filteredCount, 1);
  assert.deepEqual(bodies(result), ['valid']);
});

test('entity decoding is case insensitive, single pass, and leaves CDATA literal', () => {
  const doc = parse('<packet><chat vpos="100">&AMP;&LT;&GT;&QUOT;&APOS; &amp;lt; <![CDATA[&AMP;]]></chat></packet>');
  assert.equal(doc.comments[0].text, '&<>"\' &lt; &AMP;');
});

test('projection caches conversion only and matches blocking after conversion', () => {
  const doc = parse(nico(2));
  let conversions = 0;
  const settings = {forceSimplified: true, simplify(text) {conversions++; return text.toUpperCase();}, isBlocked: text => text === 'C0'};
  const first = project(doc, settings), second = project(doc, settings);
  assert.equal(conversions, 2);
  assert.deepEqual(first, second);
  assert.deepEqual(bodies(first), ['C1']);
  assert.deepEqual(first.items.map(c => c.blocked), [true, false]);
  assert.deepEqual(doc.comments.map(c => c.text), ['c0', 'c1']);
  assert.throws(() => {doc.comments[0].text = 'changed';}, TypeError);
  assert.deepEqual(bodies(project(doc)), ['c0', 'c1']);
});

test('screen merges scrolling comments statically while fixed comments stay individual for engine fixedCombo', () => {
  const rows = [0, 200, 201, 300].map(t => ({t, text: 'same', _commands: ['ue']}));
  rows.push({t: 0, text: 'same', _commands: ['naka']}, {t: 0, text: 'same', _commands: ['ue'], _isOwner: true});
  const result = project(parse(rows, '', 'dandanplay'), {dedupeWindow: 200});
  // Screen feed: fixed comments pass through unmerged (the overlay engine chains
  // them progressively); scrolling and owner comments are unaffected singletons.
  assert.deepEqual(bodies(result), ['same', 'same', 'same', 'same', 'same', 'same']);
  assert.equal(result.formatted.every(c => c.comboSuffix === undefined), true);
  // The list keeps the static greedy merge for every position.
  assert.deepEqual(result.items.filter(c => !c.blocked).map(c => c.text), ['samex2', 'same', 'same', 'samex2']);
});

test('OpenCC preserves owner control text while converting ordinary owner text', () => {
  const doc = parse([{fork: 'owner', comments: [
    {vposMs: 1000, body: '/command 繁體', commands: []},
    {vposMs: 2000, body: '繁體字幕', commands: []},
    {vposMs: 3000, body: '@置換 繁體', commands: []},
  ]}]);
  const converted = [];
  const result = project(doc, {forceSimplified: true, simplify(text) {converted.push(text); return text.replace(/體/g, '体');}});
  assert.deepEqual(converted, ['繁體字幕']);
  assert.deepEqual(bodies(result), ['/command 繁體', '繁体字幕', '@置換 繁體']);
  assert.equal(result.formatted[0].mail.includes('invisible'), true);
  assert.equal(doc.comments[0].simplifiedText, null);
});
