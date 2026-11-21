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
    const node = {
      children: [], parentNode: null,
      get childNodes() { return this.children; },
      tagName, attributes, style: {}, dataset: {}, value: attributes.value || '', textContent: '',
      classList: {
        contains: name => classes.has(name),
        add: name => classes.add(name),
        remove: name => classes.delete(name),
        toggle(name, force) {
          const on = force === undefined ? !classes.has(name) : !!force;
          if (on) classes.add(name); else classes.delete(name);
          return on;
        },
      },
      closest() { return this; }, querySelectorAll() { return []; }, querySelector(selector) { return this.children.find(child => child.tagName.toLowerCase() === selector) || null; },
      appendChild(child) { this.children.push(child); child.parentNode = this; return child; },
      remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(child => child !== this); this.parentNode = null; },
      getAttribute(name) { return attributes[name]; },
      setAttribute(name, value) { attributes[name] = String(value); },
      getBoundingClientRect() { return { left: 0, width: 400 }; },
      addEventListener(name, callback) {
        if (!events.has(name)) events.set(name, []);
        events.get(name).push(callback);
      },
      fire(name, data = {}) {
        const event = { target: this, clientX: 0, preventDefault() {}, stopPropagation() {}, ...data };
        for (const callback of events.get(name) || []) callback.call(this, event);
      },
      focus() { document.activeElement = this; },
    };
    Object.defineProperty(node, 'innerHTML', {get() {return '';}, set() {
      this.children.forEach(child => {child.parentNode = null;}); this.children = [];
    }});
    return node;
  }
  function queryAll(root, pred, out = []) {
    for (const child of root.children) {
      if (pred(child)) out.push(child);
      queryAll(child, pred, out);
    }
    return out;
  }
  const rootStack = [];
  for (const token of html.matchAll(/<(\/?)([a-z]+)\b([^>]*)>/gi)) {
    const [, closing, tag, attrText] = token;
    if (closing) {
      if (rootStack.length) rootStack.pop();
      continue;
    }
    const attrs = Object.fromEntries(Array.from(attrText.matchAll(/([\w-]+)="([^"]*)"/g), m => [m[1], m[2]]));
    const el = element(tag.toUpperCase(), attrs);
    for (const [k, v] of Object.entries(attrs)) {
      if (k.startsWith('data-')) el.dataset[k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = v;
    }
    if (rootStack.length) rootStack.at(-1).appendChild(el);
    if (attrs.id) elements.set(attrs.id, el);
    if (!/\/\s*$/.test(attrText) && !/^(input|meta|link|br|hr)$/i.test(tag)) rootStack.push(el);
  }
  const segmented = elements.get('style-preset-segmented');
  if (segmented) {
    segmented.querySelectorAll = selector => selector === '.seg-item'
      ? queryAll(segmented, n => n.classList.contains('seg-item')) : [];
  }
  const document = Object.assign(element(), {
    documentElement: element('HTML'),
    getElementById: id => elements.get(id) || null,
    createElement: tag => element(tag.toUpperCase()),
    createTextNode: text => ({ nodeType: 3, textContent: String(text), remove() {} }),
    querySelectorAll(selector) {
      const attr = /^\[([\w-]+)\]$/.exec(selector);
      return attr ? [...elements.values()].filter(el => Object.hasOwn(el.attributes, attr[1])) : [];
    },
  });
  const window = Object.assign(element(), {location: {href: 'file:///plugin/sidebar/index.html'}});
  const context = vm.createContext({
    document, navigator: { language: 'zh-CN' }, console,
    window,
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
    elements, context, document, window, messages, emit, filterInfo,
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
  speed.fire('pointerdown', {button: 0});
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

test('compositionend commits a final composing-only input once and preserves it through delayed echoes and blur', () => {
  const h = createSidebar();
  const input = h.elements.get('danmaku-font-custom');
  const select = h.elements.get('danmaku-font-select');
  select.value = 'custom'; select.fire('change');
  input.fire('compositionstart');
  input.value = '游ゴシック体';
  input.fire('input', {isComposing: true});
  assert.equal(h.messages.filter(m => m.name === 'set-danmaku-font').length, 0);
  h.document.activeElement = null;
  input.fire('blur');
  input.fire('compositionend');
  let sends = h.messages.filter(m => m.name === 'set-danmaku-font');
  assert.equal(sends.length, 1);
  assert.equal(sends[0].data.fontFamily, '游ゴシック体');
  h.emit('danmaku-state', {danmakuFontFamily: ''});
  assert.equal(input.value, '游ゴシック体', 'an older echo cannot roll back a submitted draft');
  input.fire('input', {isComposing: false});
  input.fire('blur');
  assert.equal(h.messages.filter(m => m.name === 'set-danmaku-font').length, 1, 'optional trailing input/blur is deduplicated');
  h.emit('danmaku-state', {danmakuFontFamily: '游ゴシック体'});
  assert.equal(input.value, '游ゴシック体');
});

test('empty Custom mode survives blur and a font-weight echo until a different family is selected', () => {
  const h = createSidebar();
  h.emit('danmaku-state', {danmakuFontFamily: '', danmakuFontWeight: '400'});
  const input = h.elements.get('danmaku-font-custom');
  const select = h.elements.get('danmaku-font-select');
  const slider = h.elements.get('danmaku-font-weight-slider');
  select.value = 'custom'; select.fire('change');
  slider.focus(); input.fire('blur');
  slider.value = '600'; slider.fire('input'); slider.fire('change');
  h.emit('danmaku-state', {danmakuFontFamily: '', danmakuFontWeight: '600'});
  assert.equal(select.value, 'custom');
  assert.equal(input.value, '');
  assert.equal(h.elements.get('danmaku-font-custom-row').style.display, '');
  select.value = ''; select.fire('change');
  h.emit('danmaku-state', {danmakuFontFamily: ''});
  assert.equal(h.elements.get('danmaku-font-custom-row').style.display, 'none');
});

for (const finish of ['Enter', 'Escape']) test('external blocklist updates preserve the editor until ' + finish, () => {
  const h = createSidebar();
  h.emit('danmaku-state', {blocklist: {enabled: true, words: ['original']}});
  const list = h.elements.get('danmaku-blocklist-list');
  const add = list.children.at(-1);
  add.fire('click');
  const input = add.children[0];
  input.value = 'draft word'; input.selectionStart = 3;
  h.emit('danmaku-state', {blocklist: {enabled: false, words: ['external']}});
  assert.equal(list.children.at(-1), add);
  assert.equal(input.parentNode, add);
  assert.equal(h.document.activeElement, input);
  assert.equal(input.selectionStart, 3);
  assert.equal(h.elements.get('danmaku-blocklist-panel').style.display, '');
  assert.equal(h.messages.filter(m => m.name === 'danmaku-blocklist-add').length, 0);
  input.fire('keydown', {key: finish});
  const sent = h.messages.filter(m => m.name === 'danmaku-blocklist-add');
  assert.equal(sent.length, finish === 'Enter' ? 1 : 0);
  if (sent.length) assert.equal(sent[0].data.word, 'draft word');
  assert.equal(list.children[0].children[0].textContent, 'external', 'queued list state appears after editing ends');
  assert.equal(h.elements.get('danmaku-blocklist-panel').style.display, 'none');
});

test('blocklist IME Enter does not submit; an intentional blur waits for compositionend', () => {
  const h = createSidebar();
  h.emit('danmaku-state', {blocklist: {enabled: true, words: []}});
  const add = h.elements.get('danmaku-blocklist-list').children.at(-1);
  add.fire('click');
  const input = add.children[0];
  input.fire('compositionstart'); input.value = '途中';
  input.fire('keydown', {key: 'Enter', isComposing: true});
  input.fire('blur');
  assert.equal(h.messages.filter(m => m.name === 'danmaku-blocklist-add').length, 0);
  input.value = '完成'; input.fire('compositionend'); input.fire('blur');
  assert.deepEqual(h.messages.filter(m => m.name === 'danmaku-blocklist-add').map(m => m.data.word), ['完成']);
});

test('pending rendering does not hide date controls for a selected parsed source', () => {
  const h = createSidebar();
  h.emit('danmaku-file-list', {xmlFiles: [], jsonFiles: [{path: '/source.json', filename: 'source.json'}], selectedPaths: ['/source.json']});
  h.emit('danmaku-state', {danmakuLoaded: false});
  assert.equal(h.elements.get('danmaku-filter-section').style.display, '');
  h.emit('danmaku-file-list', {xmlFiles: [], jsonFiles: [], selectedPaths: []});
  assert.equal(h.elements.get('danmaku-filter-section').style.display, 'none');
});

test('a preset click sends one named intent, without separate appearance messages', () => {
  const h = createSidebar();
  const preset = {dataset: {preset: 'nico'}};
  h.elements.get('style-preset-segmented').fire('click', {target: {closest() {return preset;}}});
  assert.deepEqual(h.messages.filter(m => m.name.startsWith('set-')).map(m => [m.name, m.data.preset]), [['set-style-preset', 'nico']]);
});

test('CSS shadow slider follows mode and state without overwriting an active drag', () => {
  const h = createSidebar();
  const slider = h.elements.get('css-text-shadow-blur-slider');
  const label = h.elements.get('css-text-shadow-blur-value');
  h.emit('danmaku-state', {canvasMode: 'css', cssTextShadowBlur: 2});
  assert.equal(slider.disabled, false);
  assert.equal(h.elements.get('css-text-shadow-control').style.display, '');
  assert.equal(label.textContent, '2px');
  slider.fire('pointerdown', {button: 0});
  slider.value = '3.5'; slider.fire('input');
  assert.equal(h.messages.findLast(m => m.name === 'set-css-text-shadow-blur').data.blur, 3.5);
  h.emit('danmaku-state', {cssTextShadowBlur: 2});
  assert.equal(slider.value, '3.5');
  assert.equal(label.textContent, '3.5px');
  h.document.fire('pointerup'); slider.fire('change');
  h.emit('danmaku-state', {cssTextShadowBlur: 3.5});
  assert.equal(String(slider.value), '3.5');
  h.emit('danmaku-state', {canvasMode: 'default'});
  assert.equal(slider.disabled, true);
  assert.equal(h.elements.get('css-text-shadow-control').style.display, 'none');
  const before = h.messages.length;
  slider.fire('input');
  assert.equal(h.messages.length, before);
  h.emit('danmaku-state', {canvasMode: 'css'});
  assert.equal(slider.disabled, false);
  assert.equal(h.elements.get('css-text-shadow-control').style.display, '');
  assert.equal(label.textContent, '3.5px');
  slider.focus();
  h.emit('danmaku-state', {cssTextShadowBlur: 0});
  assert.equal(label.textContent, '0px', 'keyboard focus alone does not block echoes');
});

const gestureSliders = [
  {id: 'speed-slider', label: 'speed-value', draft: '75', next: '40', text: '40%', message: 'set-scroll-speed'},
  {id: 'danmaku-font-weight-slider', label: 'danmaku-font-weight-value', draft: '800', next: '200', text: '200', message: 'set-danmaku-font'},
];

for (const control of gestureSliders) test(control.id + ' accepts preset echoes after release even if it keeps keyboard focus', () => {
  const h = createSidebar();
  h.emit('danmaku-state', {scrollSpeed: 1, danmakuFontFamily: 'Helvetica Neue', danmakuFontWeight: '400'});
  const slider = h.elements.get(control.id);
  slider.focus(); slider.fire('mousedown', {button: 0});
  slider.value = control.draft; slider.fire('input');
  h.emit('danmaku-state', {scrollSpeed: 0.5, danmakuFontWeight: '500'});
  assert.equal(slider.value, control.draft, 'a held pointer keeps its preview');
  assert.equal(h.messages.filter(m => m.name === control.message).length, 0);
  slider.fire('change');
  const preset = {dataset: {preset: 'bilibili'}};
  h.elements.get('style-preset-segmented').fire('click', {target: {closest() {return preset;}}});
  assert.equal(h.document.activeElement, slider, 'simulate the WebKit button focus behavior');
  h.emit('danmaku-state', {stylePreset: 'bilibili', scrollSpeed: 0.4, danmakuFontWeight: '200'});
  assert.equal(String(slider.value), control.next);
  assert.equal(h.elements.get(control.label).textContent, control.text);
  assert.equal(h.messages.filter(m => m.name === control.message).length, 1);
});

test('range drag protection ends on release outside the control, cancellation, capture loss or blur', () => {
  for (const control of gestureSliders) for (const event of ['pointerup', 'mouseup', 'pointercancel', 'lostpointercapture', 'window-blur']) {
    const h = createSidebar();
    const slider = h.elements.get(control.id);
    slider.focus(); slider.fire('pointerdown', {button: 0});
    slider.value = control.draft; slider.fire('input');
    h.emit('danmaku-state', {scrollSpeed: 1, danmakuFontWeight: '400'});
    assert.equal(slider.value, control.draft);
    const target = event === 'window-blur' ? h.window : event === 'lostpointercapture' ? slider : h.document;
    target.fire(event === 'window-blur' ? 'blur' : event);
    h.emit('danmaku-state', {scrollSpeed: 0.4, danmakuFontWeight: '200'});
    assert.equal(String(slider.value), control.next, control.id + ': ' + event);
    assert.equal(h.elements.get(control.label).textContent, control.text);
  }
});

test('font-weight input previews locally and change submits only the final weight', () => {
  const h = createSidebar();
  h.emit('danmaku-state', {danmakuFontFamily: 'Helvetica Neue', danmakuFontWeight: '400'});
  const slider = h.elements.get('danmaku-font-weight-slider');
  slider.fire('pointerdown', {button: 0});
  for (const value of ['450', '550', '650', '800']) { slider.value = value; slider.fire('input'); }
  assert.equal(h.elements.get('danmaku-font-weight-value').textContent, '800');
  assert.equal(h.messages.filter(m => m.name === 'set-danmaku-font').length, 0);
  h.document.fire('pointerup');
  assert.equal(slider.value, '800', 'pointerup must not overwrite the draft before change');
  slider.fire('change');
  assert.deepEqual(h.messages.filter(m => m.name === 'set-danmaku-font').map(m => JSON.parse(JSON.stringify(m.data))), [{fontWeight: '800'}]);
});

test('keyboard range changes and secondary clicks do not leave drag protection active', () => {
  const h = createSidebar();
  const slider = h.elements.get('speed-slider');
  slider.focus(); slider.value = '95'; slider.fire('input'); slider.fire('change');
  assert.equal(h.messages.filter(m => m.name === 'set-scroll-speed').at(-1).data.speed, 0.95);
  slider.fire('mousedown', {button: 2});
  h.emit('danmaku-state', {scrollSpeed: 0.5});
  assert.equal(slider.value, 50);
  assert.equal(h.elements.get('speed-value').textContent, '50%');
});

test('WebKit element blur during a held range drag does not unlock its preview', () => {
  for (const control of gestureSliders) {
    const h = createSidebar();
    const slider = h.elements.get(control.id);
    slider.focus(); slider.fire('pointerdown', {button: 0});
    slider.value = control.draft; slider.fire('input');
    h.document.activeElement = null; slider.fire('blur');
    h.emit('danmaku-state', {scrollSpeed: 0.4, danmakuFontWeight: '200'});
    assert.equal(slider.value, control.draft);
    h.document.fire('pointerup');
    h.emit('danmaku-state', {scrollSpeed: 0.4, danmakuFontWeight: '200'});
    assert.equal(String(slider.value), control.next);
  }
});

test('font controls submit only the field changed, even before prior state echoes return', () => {
  const h = createSidebar();
  h.emit('danmaku-state', {danmakuFontFamily: 'old', danmakuFontWeight: '400'});
  const slider = h.elements.get('danmaku-font-weight-slider');
  slider.value = '800'; slider.fire('change');
  const select = h.elements.get('danmaku-font-select');
  select.value = 'sans'; select.fire('change');
  const patches = h.messages.filter(m => m.name === 'set-danmaku-font').map(m => JSON.parse(JSON.stringify(m.data)));
  assert.deepEqual(patches, [{fontWeight: '800'}, {fontFamily: 'sans-serif'}]);
  const input = h.elements.get('danmaku-font-custom');
  select.value = 'custom'; input.value = ''; select.fire('change');
  input.value = 'Custom Face'; input.fire('input');
  assert.deepEqual(JSON.parse(JSON.stringify(h.messages.at(-1).data)), {fontFamily: 'Custom Face'});
});

test('A/D shortcuts adjust offset by fixed 0.5s steps, clamp within [-30, 30], and ignore Shift+D or inputs', () => {
  const h = createSidebar();
  const offsetInput = h.elements.get('danmaku-offset-input');
  h.emit('danmaku-state', {danmakuTimeOffsetSec: 0});
  for (const expected of [0.5, 1, 1.5, 2]) {
    h.document.fire('keydown', {key: 'd'});
    assert.equal(offsetInput.value, expected);
    assert.equal(h.messages.findLast(m => m.name === 'set-danmaku-offset').data.offset, expected);
  }
  for (const expected of [1.5, 1, 0.5, 0, -0.5]) {
    h.document.fire('keydown', {key: 'a'});
    assert.equal(offsetInput.value, expected);
    assert.equal(h.messages.findLast(m => m.name === 'set-danmaku-offset').data.offset, expected);
  }
  const before = h.messages.filter(m => m.name === 'set-danmaku-offset').length;
  h.document.fire('keydown', {key: 'D', shiftKey: true});
  h.document.fire('keydown', {key: 'd', ctrlKey: true});
  h.document.fire('keydown', {key: 'a', target: {tagName: 'INPUT'}});
  assert.equal(h.messages.filter(m => m.name === 'set-danmaku-offset').length, before);
  assert.equal(offsetInput.value, -0.5);

  offsetInput.value = 30;
  h.document.fire('keydown', {key: 'd'});
  assert.equal(offsetInput.value, 30);
  offsetInput.value = -30;
  h.document.fire('keydown', {key: 'a'});
  assert.equal(offsetInput.value, -30);

  offsetInput.value = '99';
  offsetInput.fire('change');
  assert.equal(offsetInput.value, 30);
  assert.equal(h.messages.findLast(m => m.name === 'set-danmaku-offset').data.offset, 30);
});

test('browserRenderTextWithLinks validates minute/second bounds (< 60) and ignores score-like numbers', () => {
  const h = createSidebar();
  const container = h.document.createElement('SPAN');
  h.context.browserRenderTextWithLinks('比分 12:99 和 60:00 以及 1:75:00 不是时间', container);
  assert.equal(container.children.length, 0);
  assert.equal(container.textContent, '比分 12:99 和 60:00 以及 1:75:00 不是时间');

  const mixed = h.document.createElement('SPAN');
  h.context.browserRenderTextWithLinks('99:88 前跳 12:34 和 1:05:59', mixed);
  const links = mixed.children.filter(c => c.className === 'danmaku-time-link');
  assert.deepEqual(links.map(l => l.textContent), ['12:34', '1:05:59']);
  assert.equal(mixed.children[0].textContent, '99:88 前跳 ');
  links[0].fire('click');
  assert.equal(h.messages.findLast(m => m.name === 'danmaku-seek').data.vpos, (12 * 60 + 34) * 100);
  links[1].fire('click');
  assert.equal(h.messages.findLast(m => m.name === 'danmaku-seek').data.vpos, (3600 + 5 * 60 + 59) * 100);
});

test('style preset buttons unhighlight when stylePreset becomes custom', () => {
  const h = createSidebar();
  const items = h.elements.get('style-preset-segmented').querySelectorAll('.seg-item');
  assert.equal(items.length, 3);
  h.emit('danmaku-state', {stylePreset: 'nico'});
  assert.deepEqual(items.map(i => i.classList.contains('active')), [true, false, false]);
  h.emit('danmaku-state', {stylePreset: 'custom'});
  assert.deepEqual(items.map(i => i.classList.contains('active')), [false, false, false]);
});

test('ddpSearchInput ignores Enter during IME composition and searches on regular Enter', () => {
  const h = createSidebar();
  const input = h.elements.get('dandanplay-search-input');
  input.value = '鬼滅の刃';
  input.fire('compositionstart');
  input.fire('keydown', {key: 'Enter'});
  h.flush();
  assert.equal(h.messages.filter(m => m.name === 'dandanplay-search').length, 0);

  input.fire('keydown', {key: 'Enter', isComposing: true});
  input.fire('keydown', {key: 'Enter', keyCode: 229});
  h.flush();
  assert.equal(h.messages.filter(m => m.name === 'dandanplay-search').length, 0);

  input.fire('compositionend');
  input.fire('keydown', {key: 'Enter'});
  h.flush();
  const sent = h.messages.filter(m => m.name === 'dandanplay-search');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].data.keyword, '鬼滅の刃');
});

test('browserRenderTextWithLinks ignores digit/colon-adjacent tokens while matching separated pairs', () => {
  const h = createSidebar();
  const invalid = h.document.createElement('SPAN');
  h.context.browserRenderTextWithLinks('编号 123:45 和 01:23:456 与 1:02:03:04 不跳转', invalid);
  assert.equal(invalid.children.length, 0);

  const pair = h.document.createElement('SPAN');
  h.context.browserRenderTextWithLinks('01:39~02:05', pair);
  const links = pair.children.filter(c => c.className === 'danmaku-time-link');
  assert.deepEqual(links.map(l => l.textContent), ['01:39', '02:05']);
});

test('opacity, fontsize, stroke-opacity and stroke-width sliders protect active drags from state echoes', () => {
  const h = createSidebar();
  const cases = [
    ['opacity-slider', '0.5', {canvasOpacity: 0.9}, '0.9'],
    ['fontsize-slider', '60', {canvasFontScale: 1.0}, '100'],
    ['stroke-opacity-slider', '40', {strokeOpacity: 0.8}, '80'],
    ['stroke-width-slider', '3', {strokeWidth: 0}, '0'],
  ];
  for (const [id, dragVal, echo, settledVal] of cases) {
    const slider = h.elements.get(id);
    slider.fire('pointerdown', {button: 0});
    slider.value = dragVal;
    slider.fire('input');
    h.emit('danmaku-state', echo);
    assert.equal(String(slider.value), dragVal, `${id} keeps dragged value during echo`);
    h.document.fire('pointerup');
    h.emit('danmaku-state', echo);
    assert.equal(String(slider.value), settledVal, `${id} accepts echo after release`);
  }
});

test('a date drag released outside the sidebar ends on the next buttonless move or window blur', () => {
  for (const finish of ['buttonless-move', 'blur']) {
    const h = createSidebar();
    h.elements.get('filter-handle-left').fire('mousedown', {clientX: 0});
    h.document.fire('mousemove', {clientX: 200, buttons: 1});
    if (finish === 'blur') h.window.fire('blur');
    else h.document.fire('mousemove', {clientX: 0, buttons: 0});
    assert.equal(h.filterMessages().length, 1, finish + ': the drag result is committed');
    const start = h.elements.get('danmaku-filter-date-start').textContent;
    h.document.fire('mousemove', {clientX: 0});
    assert.equal(h.elements.get('danmaku-filter-date-start').textContent, start, finish + ': no drag continues after release');
  }
});

test('font scale and stroke sliders preview while dragging and commit once on release', () => {
  const cases = [
    ['fontsize-slider', 'fontsize-value', '50', '50%', 'set-fontscale', {scale: 0.5}],
    ['stroke-opacity-slider', 'stroke-opacity-value', '40', '40%', 'set-stroke-opacity', {opacity: 0.4}],
    ['stroke-width-slider', 'stroke-width-value', '3', '3px', 'set-stroke-width', {width: 3}],
  ];
  for (const [id, label, value, text, message, payload] of cases) {
    const h = createSidebar();
    const slider = h.elements.get(id);
    slider.fire('pointerdown', {button: 0});
    for (const step of ['10', value]) { slider.value = step; slider.fire('input'); }
    assert.equal(h.elements.get(label).textContent, text, id);
    assert.equal(h.messages.filter(m => m.name === message).length, 0, id + ' sends nothing while dragging');
    slider.fire('change');
    assert.deepEqual(h.messages.filter(m => m.name === message).map(m => JSON.parse(JSON.stringify(m.data))), [payload], id);
  }
});

test('stroke color pickers send only the latest color', () => {
  const h = createSidebar();
  const input = h.elements.get('stroke-color');
  for (const color of ['#111111', '#222222', '#333333']) { input.value = color; input.fire('input'); }
  assert.equal(h.messages.filter(m => m.name === 'set-stroke-color').length, 0);
  h.flush();
  assert.deepEqual(h.messages.filter(m => m.name === 'set-stroke-color').map(m => m.data.color), ['#333333']);
});

test('a sent color stays protected until main echoes it back', () => {
  for (const [id, key, message] of [['stroke-color', 'strokeColor', 'set-stroke-color'],
    ['stroke-inversion-color', 'strokeInversionColor', 'set-stroke-inversion-color']]) {
    const h = createSidebar();
    h.emit('danmaku-state', {[key]: '#000000'});
    const input = h.elements.get(id);
    // two sends in a row: main will echo #111111, then #222222
    input.value = '#111111'; input.fire('input'); input.fire('change');
    input.value = '#222222'; input.fire('input'); input.fire('change');
    assert.deepEqual(h.messages.filter(m => m.name === message).map(m => m.data.color), ['#111111', '#222222']);
    h.emit('danmaku-state', {[key]: '#111111'});
    assert.equal(input.value, '#222222', id + ': the echo of an earlier send does not flicker back');
    h.emit('danmaku-state', {canvasOpacity: 0.3, [key]: '#000000'});
    assert.equal(input.value, '#222222', id + ': an older snapshot does not replace the awaited value');
    h.emit('danmaku-state', {[key]: '#222222'});
    assert.equal(input.value, '#222222');
    h.emit('danmaku-state', {stylePreset: 'bilibili', [key]: '#ffffff'});
    assert.equal(input.value, '#ffffff', id + ': after the echo, later external changes apply again');
  }
});

test('sending the color main already holds does not wait for an echo that never comes', () => {
  const h = createSidebar();
  h.emit('danmaku-state', {strokeColor: '#000000'});
  const input = h.elements.get('stroke-color');
  input.value = '#000000'; input.fire('input'); input.fire('change');
  h.emit('danmaku-state', {stylePreset: 'bilibili', strokeColor: '#ffffff'});
  assert.equal(input.value, '#ffffff');
  // A -> back to the original: main still echoes the original after A
  input.value = '#333333'; input.fire('input'); input.fire('change');
  input.value = '#ffffff'; input.fire('input'); input.fire('change');
  h.emit('danmaku-state', {strokeColor: '#333333'});
  assert.equal(input.value, '#ffffff');
  h.emit('danmaku-state', {strokeColor: '#ffffff'});
  h.emit('danmaku-state', {strokeColor: '#444444'});
  assert.equal(input.value, '#444444', 'protection was released by the final echo');
});

test('a state echo during the color debounce cannot replace the last picked color', () => {
  for (const [id, key, message] of [['stroke-color', 'strokeColor', 'set-stroke-color'],
    ['stroke-inversion-color', 'strokeInversionColor', 'set-stroke-inversion-color']]) {
    const h = createSidebar();
    h.emit('danmaku-state', {[key]: '#000000'});
    const input = h.elements.get(id);
    input.value = '#123456'; input.fire('input');
    h.emit('danmaku-state', {canvasOpacity: 0.5, [key]: '#000000'});
    assert.equal(input.value, '#123456', id + ': the pending value stays in the picker');
    h.flush();
    assert.deepEqual(h.messages.filter(m => m.name === message).map(m => m.data.color), ['#123456'], id);
    input.value = '#abcdef'; input.fire('input');
    h.emit('danmaku-state', {[key]: '#000000'});
    input.fire('change');
    assert.deepEqual(h.messages.filter(m => m.name === message).map(m => m.data.color), ['#123456', '#abcdef'], id + ': change sends the last input');
    h.emit('danmaku-state', {[key]: '#abcdef'});
    assert.equal(input.value, '#abcdef');
  }
});

test('the danmaku switch stays usable when the video has no source', () => {
  const h = createSidebar();
  h.emit('danmaku-file-list', {xmlFiles: [], jsonFiles: [], selectedPaths: []});
  h.emit('danmaku-state', {enabled: false, danmakuLoaded: false});
  const toggle = h.elements.get('toggle-danmaku');
  assert.equal(toggle.disabled, false);
  assert.equal(toggle.checked, false);
  toggle.checked = true;
  toggle.fire('change');
  assert.equal(h.messages.filter(m => m.name === 'toggle-danmaku').length, 1);
  h.emit('danmaku-state', {enabled: true});
  assert.equal(toggle.checked, true, 'the switch shows the setting even before a source loads');
});

test('clicking another search result releases a bangumi row whose reply main discarded', () => {
  const h = createSidebar();
  h.elements.get('dandanplay-search-input').value = 'show';
  h.elements.get('dandanplay-search-go-btn').fire('click');
  h.flush();
  const searchId = h.messages.findLast(m => m.name === 'dandanplay-search').data.searchId;
  h.emit('dandanplay-search-result', {searchId, animes: [{animeId: 1, animeTitle: 'A'}, {animeId: 2, animeTitle: 'B'}], error: null});
  const [first, second] = h.elements.get('dandanplay-search-results-list').children;
  first.fire('click');
  assert.equal(first.children[1].textContent, h.context.t('loading_episodes'));
  second.fire('click');
  assert.equal(first.children[1].textContent, h.context.t('click_load_episodes'));
  first.fire('click');
  assert.deepEqual(h.messages.filter(m => m.name === 'dandanplay-get-bangumi').map(m => m.data.bangumiId), ['1', '2', '1']);
});

test('blocklist entries reported invalid by main are marked in the list', () => {
  const h = createSidebar();
  h.emit('danmaku-state', {blocklist: {enabled: true, words: ['ok', '/(a+)+/'], invalid: ['/(a+)+/']}});
  let rows = h.elements.get('danmaku-blocklist-list').children;
  assert.equal(rows[0].className.includes('invalid'), false);
  assert.equal(rows[1].className.includes('invalid'), true);
  assert.equal(rows[1].children[0].title, h.context.t('blocklist_invalid'));
  h.emit('danmaku-state', {blocklist: {enabled: true, words: ['ok', '/(a+)+/']}});
  rows = h.elements.get('danmaku-blocklist-list').children;
  assert.equal(rows[1].className.includes('invalid'), false);
});

test('comment limit and density sliders keep their preview while held', () => {
  const h = createSidebar();
  const limit = h.elements.get('comment-limit-slider');
  limit.fire('pointerdown', {button: 0});
  limit.value = '50'; limit.fire('input');
  h.emit('danmaku-state', {commentLimit: 100});
  assert.equal(limit.value, '50');
  h.document.fire('pointerup');
  limit.fire('change');
  assert.equal(h.messages.findLast(m => m.name === 'set-comment-limit').data.limit, 50);
  const density = h.elements.get('density-slider');
  density.fire('pointerdown', {button: 0});
  density.value = '100'; density.fire('input');
  h.filterInfo({filterDensity: 300});
  assert.equal(density.value, '100');
});

test('the sidebar follows the plugin language reported by main', () => {
  const h = createSidebar();
  assert.equal(h.context.t('unlimited'), '\u65e0\u9650\u5236');
  h.emit('danmaku-state', {uiLang: 'en'});
  assert.equal(h.context.t('unlimited'), 'Unlimited');
});
