require('./load-typescript.cjs');
const { test, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
process.env.SENSENOVA_API_KEY = 'test-key';
delete process.env.MINIMAX_API_KEY;
const { generateLesson, FALLBACK_LESSON } = require('../src/lib/lesson.ts');
const input = { learner: { name: 'learner', level: 'A2' }, feedback: [], dueWords: [], recentScenes: [], difficulty: 'base' };
afterEach(() => mock.restoreAll());
const respond = (value) => Response.json({ choices: [{ message: { content: JSON.stringify(value) }, finish_reason: 'stop' }] });

test('generates one complete lesson in one call with a shared scene and all required counts', async () => {
  let calls = 0;
  mock.method(globalThis, 'fetch', async () => { calls++; return respond(FALLBACK_LESSON); });
  const lesson = await generateLesson(input);
  assert.equal(calls, 1);
  assert.equal(lesson.scene, FALLBACK_LESSON.scene);
  assert.equal(lesson.article.questions.length, 3);
  assert.equal(lesson.reviewSentences.length, 3);
});

test('rejects incomplete JSON instead of filling missing sections with sample lessons', async () => {
  mock.method(globalThis, 'fetch', async () => respond({ scene: 'unrelated', words: [{ word: 'x' }] }));
  await assert.rejects(generateLesson(input), /暂时不可用/);
});

test('rejects text that cannot fit the database columns', async () => {
  const lesson = structuredClone(FALLBACK_LESSON);
  lesson.reviewSentences[0].en = 'a'.repeat(81);
  mock.method(globalThis, 'fetch', async () => respond(lesson));
  await assert.rejects(generateLesson(input), /暂时不可用/);
});

test('uses the newest feedback rather than the oldest entries', async () => {
  let prompt = '';
  mock.method(globalThis, 'fetch', async (url, options) => {
    prompt = JSON.parse(options.body).messages[1].content;
    return respond(FALLBACK_LESSON);
  });
  const feedback = Array.from({ length: 10 }, (_, i) => ({ date: `2026-11-${26-i}`, shadowing: 70, reading: 70, note: `feedback_${i}_marker` }));
  await generateLesson({ ...input, feedback });
  assert.ok(prompt.includes('feedback_0_marker'));
  assert.ok(!prompt.includes('feedback_9_marker'));
});
