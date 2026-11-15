/* Help popups: every section of the app has a help topic, and every topic belongs to something
   that is still there. Add a section (or change one) -> add (or update) its topic in js/help.js. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const JS = fs.readdirSync(path.join(ROOT, 'js')).filter((f) => f.endsWith('.js')).map((f) => 'js/' + f);

function loadPT() {
  const ctx = { window: {}, navigator: { platform: 'Win32' }, structuredClone, console, performance };
  ctx.window = ctx;
  vm.createContext(ctx);
  for (const f of ['js/util.js', 'js/help.js']) vm.runInContext(read(f), ctx, { filename: f });
  return ctx.PT;
}

/* every section title in the code: Panels.section('Title', …) and section headings drawn by hand */
function sectionTitles() {
  const found = new Map();   // key -> file
  for (const f of JS) {
    const src = read(f);
    for (const m of src.matchAll(/this\.section\(\s*(['`])((?:(?!\1|\$\{).)*)/g)) if (m[2].trim()) found.set('section:' + m[2].split(':')[0].trim(), f);
    for (const m of src.matchAll(/el\('h3', \{\}, (?:el\('span', \{\}, )?'([^']+)'/g)) found.set('section:' + m[1], f);
  }
  return found;
}

test('every section has a help topic', () => {
  const { Help } = loadPT();
  const missing = [...sectionTitles()].filter(([key]) => !Help.has(key)).map(([key, f]) => `${key} (${f})`);
  assert.deepEqual(missing, [], 'Add these topics to js/help.js');
});

test('every help topic for a section belongs to a section that still exists', () => {
  const { Help } = loadPT();
  const titles = sectionTitles();
  const orphans = Object.keys(Help.TOPICS).filter((k) => k.startsWith('section:') && !titles.has(k));
  assert.deepEqual(orphans, [], 'These sections are gone: remove or rename their topics in js/help.js');
});

test('a section heading drawn by hand has its "?" button', () => {
  for (const f of JS.filter((x) => x !== 'js/panels.js')) {
    const src = read(f);
    for (const m of src.matchAll(/el\('h3', \{\}, ([^\n]*)/g)) {
      const title = (m[1].match(/^(?:el\('span', \{\}, )?'([^']+)'/) || [])[1];
      assert.ok(m[1].includes(`PT.Help.button('section:${title}')`), `${f}: the "${title}" heading needs PT.Help.button('section:${title}')`);
    }
  }
  // and Panels.section() puts one on every titled section
  assert.match(read('js/panels.js'), /section\(title, \.\.\.children\) \{\s*const head = title \? el\('h3', \{\}, el\('span', \{\}, title\), PT\.Help \? PT\.Help\.button\(PT\.Help\.sectionKey\(title\), title\)/);
});

test('every tab, and every area of the window, has help', () => {
  const { Help } = loadPT();
  const html = read('index.html');
  const tabs = [...html.matchAll(/data-tab="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(tabs.length >= 7);
  for (const t of tabs) assert.ok(Help.has('tab:' + t), `tab "${t}" needs the topic tab:${t}`);
  assert.match(html, /class="tab-help"[^>]*data-help="tab"/, 'the tabs have a "How this tab works" button');
  for (const area of ['app', 'parts', 'meter']) assert.match(html, new RegExp(`data-help="${area}"`), `index.html has a "?" for ${area}`);
  assert.match(read('js/sheet.js'), /PT\.Help\.button\('sheet'\)/);
  assert.match(read('js/psd.js'), /PT\.Help\.button\('psd'\)/);
  // help.js loads before anything that makes sections
  assert.ok(html.indexOf('js/help.js') > 0 && html.indexOf('js/help.js') < html.indexOf('js/panels.js') && html.indexOf('js/help.js') < html.indexOf('js/sheet.js'));
});

test('every "?" points at a topic that exists', () => {
  const { Help } = loadPT();
  const ids = new Set();
  for (const m of read('index.html').matchAll(/data-help="([^"]+)"/g)) ids.add(m[1]);
  for (const f of JS) for (const m of read(f).matchAll(/PT\.Help\.button\('([^']+)'/g)) ids.add(m[1]);
  ids.delete('tab');   // the tab that is open
  for (const id of ids) assert.ok(Help.has(id), `no help topic "${id}"`);
});

test('every topic has a title, a place and a body in the right shape', () => {
  const { Help } = loadPT();
  for (const [id, t] of Object.entries(Help.TOPICS)) {
    assert.ok(typeof t.title === 'string' && t.title, `${id}: title`);
    assert.ok(typeof t.where === 'string' && t.where, `${id}: where`);
    assert.ok(Array.isArray(t.body) && t.body.length, `${id}: body`);
    for (const b of t.body) {
      const lines = typeof b === 'string' ? [b] : Array.isArray(b) ? b : b && Array.isArray(b.steps) ? b.steps : null;
      assert.ok(lines && lines.length && lines.every((l) => typeof l === 'string' && l.trim()), `${id}: a block is not text, a list or { steps }`);
      for (const l of lines) assert.equal((l.match(/\*\*/g) || []).length % 2, 0, `${id}: unmatched ** in "${l}"`);
    }
  }
});

test('a section title with a detail after a colon uses the topic of its kind', () => {
  const { Help } = loadPT();
  assert.equal(Help.sectionKey('Frame adjust: Open'), 'section:Frame adjust');
  assert.equal(Help.sectionKey('Draw order (top = front)'), 'section:Draw order (top = front)');
  assert.equal(Help.resolve('section:Images'), 'section:Images');
});

test('Esc with help open over a dialog closes only the help', () => {
  // the dialogs listen before the popup does, so they have to step aside while it is open
  assert.match(read('js/sheet.js'), /key\(e\) \{\s*if \(!this\.open \|\| \(PT\.Help && PT\.Help\.isOpen\)\) return;/);
  assert.match(read('js/psd.js'), /e\.key === 'Escape' && !\(PT\.Help && PT\.Help\.isOpen\)/);
  const { Help } = loadPT();
  assert.equal(Help.isOpen, false);
});
