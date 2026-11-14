/* Vowel mouth shapes: guessing the vowel from the sound, the optional mouth images, and which
   image the mouth shows. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadPT() {
  const ctx = { window: {}, navigator: { platform: 'Win32' }, structuredClone, console };
  ctx.window = ctx;
  vm.createContext(ctx);
  for (const f of ['util.js', 'defs.js', 'assets.js', 'audio.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'), ctx, { filename: f });
  return ctx.PT;
}
const PT = loadPT();

/* A made-up voice spectrum in dB, as an analyser gives it: a quiet floor and a peak at each
   formant [Hz, level in dB relative to the strongest]. 48 kHz, 1024-point FFT. */
const RATE = 48000, FFT = 1024;
function spectrum(formants) {
  const db = new Float32Array(FFT / 2);
  for (let i = 0; i < db.length; i++) {
    const hz = (i * RATE) / FFT;
    let v = -110;
    for (const [f, level] of formants) v = Math.max(v, -30 + level - Math.pow((hz - f) / 100, 2) * 6);
    db[i] = v;
  }
  return db;
}
const guess = (formants) => PT.vowelFromBands(...PT.bandPowers(spectrum(formants), RATE, FFT));

test('the vowel is guessed from where the sound has its energy', () => {
  // typical formants, the higher ones weaker as in a real voice
  assert.equal(guess([[750, 0], [1200, -6], [2500, -25]]), 'a');     // "ah"
  assert.equal(guess([[850, 0], [1250, -4], [2800, -28]]), 'a');     // a higher voice
  assert.equal(guess([[300, 0], [2300, -15], [3000, -20]]), 'e');    // "ee"
  assert.equal(guess([[550, 0], [1900, -12], [2600, -22]]), 'e');    // "eh"
  assert.equal(guess([[320, 0], [800, -12], [2300, -40]]), 'o');     // "oo"
  assert.equal(guess([[480, 0], [850, -8], [2500, -35]]), 'o');      // "oh"
});

test('the guess is steady across loudness, and silent gives nothing', () => {
  const ah = spectrum([[750, 0], [1200, -6], [2500, -25]]);
  for (const louder of [-20, 0, 25]) {
    const s = ah.map((v) => v + louder);
    assert.equal(PT.vowelFromBands(...PT.bandPowers(s, RATE, FFT)), 'a', String(louder));
  }
  assert.equal(PT.vowelFromBands(0, 0, 0), '');
  assert.equal(PT.vowelFromBands(NaN, 1, 1), '');
  assert.equal(PT.vowelFromBands(1, 0, 0), 'o');
  assert.equal(PT.vowelFromBands(1, 2, 0), 'a');
  assert.equal(PT.vowelFromBands(1, 0.5, 0.001), 'o');               // a trace up high is not an "ee"
  assert.equal(PT.vowelFromBands(1, 0.2, 0.5), 'e');
  // the bands are the right bins: all the power at 1000 Hz is "mid"
  const tone = new Float32Array(FFT / 2).fill(-200);
  tone[Math.round(1000 / (RATE / FFT))] = 0;
  const [low, mid, high] = PT.bandPowers(tone, RATE, FFT);
  assert.ok(mid > 0.99 && low < 1e-9 && high < 1e-9);
  // the microphone being off is not a vowel
  assert.equal(PT.Audio.vowel(), '');
});

test('the mouth has three optional vowel images beside closed, half and open', () => {
  assert.equal(PT.PART.mouth.states.join(), 'closed,half,open');     // the cropper and the counts still see three
  assert.equal(PT.PART.mouth.extra.join(), 'a,o,e');
  assert.equal(PT.PART.mouth.stateLabels.a, 'Ah');
  assert.equal(PT.PART.eyes.extra, undefined);
  const route = (n) => { const r = PT.routeFilename(n); return r.part + ':' + r.state; };
  assert.equal(route('mouth_a.png'), 'mouth:a');
  assert.equal(route('mouth-ah.png'), 'mouth:a');
  assert.equal(route('mouth_oh.png'), 'mouth:o');
  assert.equal(route('Mouth OO.png'), 'mouth:o');
  assert.equal(route('mouth_ee.png'), 'mouth:e');
  assert.equal(route('mouth_e.png'), 'mouth:e');
  assert.equal(route('mouth_open.png'), 'mouth:open');               // as before
  assert.equal(route('mouth_half.png'), 'mouth:half');
  assert.equal(route('mouth.png'), 'mouth:closed');
});

test('a vowel image is used when there is one, else the usual open mouth', () => {
  const A = PT.Assets, e = (name) => ({ name });
  const got = (r) => r && [r.entry.name, r.state];
  A.user = { mouth: { closed: e('closed'), half: e('half'), open: e('open'), a: e('ah'), 'e@happy': e('happy-ee') } };
  assert.equal(A.hasExtra('mouth'), true);
  assert.deepEqual(got(A.exact('mouth', 'a')), ['ah', 'a']);
  assert.equal(A.exact('mouth', 'o'), null);                         // no picture for "oh": the caller uses half / open
  assert.equal(A.exact('mouth', 'e'), null);
  assert.deepEqual(got(A.exact('mouth', 'e', 'happy')), ['happy-ee', 'e@happy']);   // an expression's own
  assert.deepEqual(got(A.exact('mouth', 'a', 'happy')), ['ah', 'a']);               // … else the normal one
  // asked for by name (the Part tab's preview): the picture, or the open mouth
  assert.deepEqual(got(A.resolve('mouth', 'a', false)), ['ah', 'a']);
  assert.deepEqual(got(A.resolve('mouth', 'o', false)), ['open', 'open']);
  // the usual three are untouched
  assert.deepEqual(got(A.resolve('mouth', 'half', false)), ['half', 'half']);
  assert.deepEqual(got(A.resolve('mouth', 'closed', false)), ['closed', 'closed']);
  assert.equal(A.primary('mouth', false).name, 'closed');

  A.user = { mouth: { closed: e('closed'), open: e('open') }, eyes: { open: e('eyes') } };
  assert.equal(A.hasExtra('mouth'), false);                          // nothing to listen for
  assert.equal(A.hasExtra('eyes'), false);
  A.user = { mouth: { 'o@happy': e('x') } };
  assert.equal(A.hasExtra('mouth'), true);
  A.user = {};
  assert.equal(A.hasExtra('mouth'), false);
  assert.equal(A.exact('mouth', 'a'), null);
});
