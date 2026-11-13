'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'sidebar/index.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'sidebar/index.html'), 'utf8');
const firstDay = Date.UTC(2024, 1, 27) / 86400000;

function createSidebar() {
  const elements = new Map();
  const messages = [];
  const handlers = new Map();
  const timers = new Map();
  let timerId = 0;
  function element(tagName = 'DIV', attributes = {}) {
    const events = new Map();
    const classes = new Set((attributes.class || '').split(' '));
    return {
      tagName, attributes, style: {}, dataset: {}, value: attributes.value || '', textContent: '',
      classList: { contains: name => classes.has(name), add: name => classes.add(name), remove: name => classes.delete(name), toggle() {} },
      closest() { return this; }, querySelectorAll() { return []; }, querySelector() { return element(); }, appendChild() {},
      getAttribute(name) { return attributes[name]; },
      setAttribute(name, value) { attributes[name] = String(value); },
      getBoundingClientRect() { return { left: 0, width: 400 }; },
      addEventListener(name, callback) {
        if (!events.has(name)) events.set(name, []);
        events.get(name).push(callback);
      },
      fire(name, data = {}) {
        const event = { target: this, clientX: 0, preventDefault() {}, stopPropagation() {}, ...data };
        for (const callback of events.get(name) || []) callback(event);
      },
      focus() { document.activeElement = this; },
    };
  }
  for (const match of html.matchAll(/<([a-z]+)\b([^>]*\bid="[^"]+"[^>]*)>/gi)) {
    const attrs = Object.fromEntries(Array.from(match[2].matchAll(/([\w-]+)="([^"]*)"/g), m => [m[1], m[2]]));
    elements.set(attrs.id, element(match[1].toUpperCase(), attrs));
  }
  const document = Object.assign(element(), {
    documentElement: element('HTML'),
    getElementById: id => elements.get(id) || null,
    createElement: tag => element(tag.toUpperCase()),
    querySelectorAll(selector) {
      const attr = /^\[([\w-]+)\]$/.exec(selector);
      return attr ? [...elements.values()].filter(el => Object.hasOwn(el.attributes, attr[1])) : [];
    },
  });
  const context = vm.createContext({
    document, navigator: { language: 'zh-CN' }, console,
    window: { location: { href: 'file:///plugin/sidebar/index.html' } },
    iina: { onMessage: (name, handler) => handlers.set(name, handler), postMessage: (name, data) => messages.push({ name, data }) },
    setTimeout(callback) { timers.set(++timerId, callback); return timerId; },
    clearTimeout(id) { timers.delete(id); },
  });
  vm.runInContext(source, context, { filename: 'sidebar/index.js' });
  const dateInfo = {
    firstDay, lastDay: firstDay + 3, undatedCount: 1,
    dayCounts: [[firstDay, 90], [firstDay + 1, 1], [firstDay + 3, 5]],
  };
  function emit(name, data) { handlers.get(name)(data); }
  function filterInfo(extra = {}) {
    emit('danmaku-filter-info', { fileType: 'nico-json', totalCount: 97, dateInfo, filterStartDay: null, filterEndDay: null, ...extra });
  }
  emit('danmaku-state', { enabled: true, danmakuLoaded: true, danmakuFileType: 'nico-json' });
  filterInfo();
  return {
    elements, document, messages, emit, filterInfo,
    flush() { for (const [id, callback] of Array.from(timers)) { timers.delete(id); callback(); } },
    filterMessages() { return messages.filter(message => message.name === 'set-danmaku-filter'); },
  };
}

test('date slider allocates width by comment count and still snaps to whole dates while dragging', () => {
  const h = createSidebar();
  const left = h.elements.get('filter-handle-left');
  const coverage = h.elements.get('filter-coverage');
  assert.equal(h.elements.get('danmaku-filter-section').style.display, '', 'fewer than 100 comments still have a date selector');
  assert.equal(h.elements.get('filter-count').textContent, '97');
  left.fire('mousedown', { clientX: 0 });
  h.document.fire('mousemove', { clientX: 49 });
  assert.equal(h.elements.get('danmaku-filter-date-start').textContent, '2024-02-27');
  h.document.fire('mousemove', { clientX: 100 });
  assert.equal(h.elements.get('danmaku-filter-date-start').textContent, '2024-02-27', 'the busy first day occupies most of the track');
  h.document.fire('mousemove', { clientX: 200 });
  assert.equal(coverage.style.left, '93.75%');
  assert.equal(coverage.style.width, '6.25%');
  assert.equal(h.elements.get('filter-count').textContent, '7');
  assert.equal(h.elements.get('danmaku-filter-date-start').textContent, '2024-02-28');
  assert.equal(h.filterMessages().length, 0, 'preview does not immediately rebuild the renderer');
  h.filterInfo();
  assert.equal(h.elements.get('danmaku-filter-date-start').textContent, '2024-02-28', 'a previous reply does not move the active drag');
  h.document.fire('mouseup');
  assert.deepEqual(JSON.parse(JSON.stringify(h.filterMessages().at(-1).data)), { startDay: firstDay + 1, endDay: firstDay + 3 });
});

test('keyboard steps skip empty days in both directions and preserve the one-date minimum', () => {
  const h = createSidebar();
  const left = h.elements.get('filter-handle-left');
  const right = h.elements.get('filter-handle-right');
  left.fire('keydown', { key: 'ArrowRight' });
  assert.equal(left.attributes['aria-valuetext'], '2024-02-28');
  left.fire('keydown', { key: 'ArrowRight' });
  assert.equal(left.attributes['aria-valuetext'], '2024-03-01', 'skip the empty leap day');
  assert.equal(h.elements.get('filter-count').textContent, '6');
  left.fire('keydown', { key: 'ArrowRight' });
  right.fire('keydown', { key: 'ArrowLeft' });
  assert.equal(left.attributes['aria-valuetext'], '2024-03-01', 'handles cannot cross');
  assert.equal(right.attributes['aria-valuetext'], '2024-03-01');
  left.fire('keydown', { key: 'ArrowLeft' });
  right.fire('keydown', { key: 'ArrowLeft' });
  assert.equal(left.attributes['aria-valuetext'], '2024-02-28');
  assert.equal(right.attributes['aria-valuetext'], '2024-02-28', 'reverse steps skip the same empty date');
  assert.equal(h.elements.get('filter-count').textContent, '2');
  right.fire('keydown', { key: 'ArrowRight' });
  assert.equal(right.attributes['aria-valuetext'], '2024-03-01');
  assert.equal(left.attributes['aria-label'], '开始日期');
  h.flush();
  assert.equal(h.filterMessages().length, 1);
  assert.equal(h.filterMessages()[0].data.startDay, firstDay + 1);
  assert.equal(h.filterMessages()[0].data.endDay, firstDay + 3);
});

test('dragging the range body does not change dates or submit a filter', () => {
  const h = createSidebar();
  h.filterInfo({ filterStartDay: firstDay + 1, filterEndDay: firstDay + 3 });
  const coverage = h.elements.get('filter-coverage');
  coverage.fire('mousedown', { clientX: 100 });
  h.document.fire('mousemove', { clientX: -1000 });
  h.document.fire('mouseup');
  h.flush();
  assert.equal(parseFloat(coverage.style.left), 90 / 96 * 100);
  assert.equal(parseFloat(coverage.style.width), 6 / 96 * 100);
  assert.equal(h.elements.get('danmaku-filter-date-start').textContent, '2024-02-28');
  assert.equal(h.elements.get('danmaku-filter-date-end').textContent, '2024-03-01');
  assert.equal(h.filterMessages().length, 0);
});

test('source changes cancel pending day edits; a one-day source works and undated sources hide the control', () => {
  const h = createSidebar();
  h.elements.get('filter-handle-left').fire('keydown', { key: 'ArrowRight' });
  h.emit('danmaku-file-list', { selectedPaths: ['/new.json'], jsonFiles: [], xmlFiles: [] });
  h.flush();
  assert.equal(h.filterMessages().length, 0);
  h.filterInfo({ totalCount: 1, dateInfo: { firstDay, lastDay: firstDay, dayCounts: [[firstDay, 1]], undatedCount: 0 } });
  assert.equal(h.elements.get('filter-coverage').style.width, '100%');
  assert.equal(h.elements.get('filter-count').textContent, '1');
  h.filterInfo({ totalCount: 1, dateInfo: { firstDay: null, lastDay: null, dayCounts: [], undatedCount: 1 } });
  assert.equal(h.elements.get('danmaku-filter-section').style.display, 'none');
});

test('right handle uses the cumulative count after an inclusive end date', () => {
  const h = createSidebar();
  const right = h.elements.get('filter-handle-right');
  right.fire('mousedown', { clientX: 400 });
  h.document.fire('mousemove', { clientX: 380 });
  assert.equal(h.elements.get('danmaku-filter-date-end').textContent, '2024-02-28');
  assert.equal(h.elements.get('filter-count').textContent, '92');
  assert.equal(parseFloat(h.elements.get('filter-coverage').style.width), 91 / 96 * 100);
  h.document.fire('mouseup');
  assert.equal(h.filterMessages().at(-1).data.endDay, firstDay + 1);
});

test('density count displays the date-sliced input total and resets with the date range', () => {
  const h = createSidebar();
  h.filterInfo({ filterStartDay: firstDay + 1, filterEndDay: firstDay + 3,
    sourceTotalCount: 7, filteredCount: 3, filterDensity: 50 });
  assert.equal(h.elements.get('density-count').textContent, '3/7');
  assert.equal(h.elements.get('filter-count').textContent, '7');
  h.filterInfo({ filterStartDay: firstDay + 1, filterEndDay: firstDay + 3,
    sourceTotalCount: 7, filteredCount: 7, filterDensity: 0 });
  assert.equal(h.elements.get('density-count').textContent, '7/7');
  h.filterInfo({ sourceTotalCount: 97, filteredCount: 97, filterDensity: 0 });
  assert.equal(h.elements.get('density-count').textContent, '97/97');
});

test('font state echoes preserve the focused draft, spaces, caret and empty custom field', () => {
  const h = createSidebar();
  const input = h.elements.get('danmaku-font-custom');
  const row = h.elements.get('danmaku-font-custom-row');
  const select = h.elements.get('danmaku-font-select');
  select.value = 'custom';
  row.style.display = '';
  input.focus();
  input.value = 'Helvetica ';
  input.selectionStart = input.selectionEnd = 10;
  input.fire('input');
  assert.equal(h.messages.at(-1).data.fontFamily, 'Helvetica');
  h.emit('danmaku-state', {danmakuFontFamily: 'Helvetica'});
  assert.equal(input.value, 'Helvetica ');
  assert.equal(input.selectionStart, 10);
  assert.equal(select.value, 'custom');
  input.value = 'Helvetica Neue';
  input.selectionStart = input.selectionEnd = 4;
  input.fire('input');
  h.emit('danmaku-state', {danmakuFontFamily: 'Helvetica Neue'});
  assert.equal(input.value, 'Helvetica Neue');
  assert.equal(input.selectionStart, 4);
  input.value = '';
  input.fire('input');
  h.emit('danmaku-state', {danmakuFontFamily: ''});
  assert.equal(row.style.display, '');
  assert.equal(select.value, 'custom');
  const sent = h.messages.length;
  input.fire('input', {isComposing: true});
  assert.equal(h.messages.length, sent, 'intermediate IME composition is not submitted');
  h.document.activeElement = null;
  input.fire('blur');
  assert.equal(row.style.display, 'none');
});

test('speed dragging previews locally and commits one intent on change', () => {
  const h = createSidebar();
  const speed = h.elements.get('speed-slider');
  for (const value of ['90', '75', '50', '25']) {speed.value = value; speed.fire('input');}
  assert.equal(h.elements.get('speed-value').textContent, '25%');
  speed.focus();
  h.emit('danmaku-state', {scrollSpeed: 1});
  assert.equal(speed.value, '25', 'an unrelated state echo does not overwrite the active drag');
  assert.equal(h.messages.filter(m => m.name === 'set-scroll-speed').length, 0);
  speed.fire('change');
  const messages = h.messages.filter(m => m.name === 'set-scroll-speed');
  assert.equal(messages.length, 1);
  assert.equal(messages[0].data.speed, 0.25);
});
