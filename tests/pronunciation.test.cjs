require('./load-typescript.cjs');
const { test, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
let player;
const previousWindow = global.window;
afterEach(() => {
  player?.stopPronunciation();
  mock.restoreAll();
  if (previousWindow === undefined) delete global.window; else global.window = previousWindow;
});

function browser(userAgent = 'Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 Version/18.0 Mobile Safari/604.1') {
  const spoken = [];
  const synthesis = { cancel() {}, resume() {}, getVoices: () => [], speak: (utterance) => spoken.push(utterance) };
  global.window = {
    navigator: { userAgent, platform: 'iPhone', maxTouchPoints: 5 },
    speechSynthesis: synthesis,
    SpeechSynthesisUtterance: class { constructor(text) { this.text = text; } },
  };
  player = require('../src/lib/pronunciation.ts');
  return { synthesis, spoken };
}

test('iPhone speaks during the original click, before any cache or network await', () => {
  const { spoken } = browser();
  const cache = { read: () => { throw new Error('must not wait for IndexedDB on iOS'); } };
  mock.method(globalThis, 'fetch', () => { throw new Error('must not wait for TTS on iOS'); });
  const states = [];
  player.startPronunciation('Could I have the bill, please?', { cache, onState: (state) => states.push(state) });
  assert.equal(spoken.length, 1, 'speech must be queued synchronously before the click handler returns');
  assert.equal(spoken[0].lang, 'en-US');
  assert.equal(spoken[0].volume, 1);
  spoken[0].onstart();
  assert.equal(states.at(-1), 'playing');
  spoken[0].onend();
  assert.equal(states.at(-1), 'idle');
});

test('works while the native voice list is still empty, and resumes paused speech', () => {
  const { synthesis, spoken } = browser();
  const resume = mock.method(synthesis, 'resume');
  player.startPronunciation('Hello.', { onState() {} });
  assert.equal(resume.mock.callCount(), 1);
  assert.equal(spoken[0].voice, undefined);
  assert.equal(spoken[0].text, 'Hello.');
});

test('native speech errors become visible errors instead of silent success', () => {
  const { spoken } = browser();
  const states = [];
  player.startPronunciation('Hello.', { onState: (state, error) => states.push({ state, error }) });
  spoken[0].onerror({ error: 'not-allowed' });
  assert.equal(states.at(-1).state, 'error');
  assert.ok(states.at(-1).error);
});

test('starting another phrase stops the previous one and resets its button', () => {
  const { spoken } = browser();
  const first = [];
  player.startPronunciation('First.', { onState: (state) => first.push(state) });
  player.startPronunciation('Second.', { onState() {} });
  assert.equal(spoken.length, 2);
  assert.equal(first.at(-1), 'idle');
});

test('iPad desktop mode and Safari use the direct native path', () => {
  browser('Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15');
  window.navigator.platform = 'MacIntel';
  assert.equal(player.prefersDeviceSpeech(), true);
  window.navigator.userAgent = 'Mozilla/5.0 Chrome/140.0.0.0 Safari/537.36';
  window.navigator.platform = 'Win32';
  window.navigator.maxTouchPoints = 0;
  assert.equal(player.prefersDeviceSpeech(), false);
});

test('HTML audio play rejection is surfaced so the user can retry from a new gesture', async () => {
  browser('Mozilla/5.0 (Windows NT 10.0) Chrome/140.0.0.0 Safari/537.36');
  window.navigator.platform = 'Win32';
  window.navigator.maxTouchPoints = 0;
  window.Audio = class {
    pause() {}
    play() { return Promise.reject(new DOMException('blocked', 'NotAllowedError')); }
  };
  const blob = new Blob(['test'], { type: 'audio/mpeg' });
  const result = new Promise((resolve) => player.startPronunciation('Hello.', {
    cache: { read: async () => blob },
    onState: (state, error) => { if (state === 'error') resolve(error); },
  }));
  assert.match(await result, /点击/);
});

test('a direct system-speech retry never fetches the failed cloud endpoint again', () => {
  const { spoken } = browser('Mozilla/5.0 (Windows NT 10.0) Chrome/140.0.0.0 Safari/537.36');
  window.navigator.platform = 'Win32';
  window.navigator.maxTouchPoints = 0;
  mock.method(globalThis, 'fetch', () => { throw new Error('do not fetch during retry'); });
  player.startPronunciation('Hello.', { forceSystem: true, onState() {} });
  assert.equal(spoken.length, 1);
});

test('full articles are not truncated at the cloud API 600 character limit on iPhone', () => {
  const { spoken } = browser();
  const text = 'This is a long article. '.repeat(50);
  player.startPronunciation(text, { onState() {} });
  assert.equal(spoken[0].text, text.trim());
  assert.ok(spoken[0].text.length > 600);
});

test('a native engine that never starts shows an error instead of keeping a false playing state', (context) => {
  browser();
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const states = [];
  player.startPronunciation('Hello.', { onState: (state) => states.push(state) });
  context.mock.timers.tick(8000);
  assert.equal(states.at(-1), 'error');
  context.mock.timers.reset();
});
