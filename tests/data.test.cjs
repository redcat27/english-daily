require('./load-typescript.cjs');
const { test, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/lib/db.ts');
const lessonModule = require('../src/lib/lesson.ts');
const data = require('../src/lib/data.ts');
afterEach(() => mock.restoreAll());

function database(overrides = {}) {
  const prisma = {
    user: { upsert: async () => ({ id: 'user-1' }) },
    feedback: { findMany: async () => [], findFirst: async () => ({ id: 'feedback-1' }) },
    wordProgress: { findMany: async () => [] },
    dailyLesson: { findUnique: async () => null, findMany: async () => [], findFirst: async () => null, ...overrides },
  };
  mock.method(db, 'isDatabaseConfigured', () => true);
  mock.method(db, 'getPrisma', () => prisma);
  return prisma;
}

test('reuses tomorrow lesson without another paid generation', async (context) => {
  context.mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-26T12:00:00Z').getTime() });
  progressDatabase([
    { id: 'lesson-1', userId: 'user-1', date: new Date('2026-11-26'), dayIndex: 1, payload: lessonModule.FALLBACK_LESSON },
    { id: 'lesson-2', userId: 'user-1', date: new Date('2026-11-27'), dayIndex: 2, payload: lessonModule.FALLBACK_LESSON },
  ], [{ date: new Date('2026-11-26') }]);
  mock.method(lessonModule, 'generateLesson', async () => { throw new Error('must not call AI'); });
  assert.deepEqual(await data.buildTomorrowLesson('teefs'), lessonModule.FALLBACK_LESSON);
});

test('does not persist fallback lessons when every AI provider fails', async (context) => {
  context.mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-26T12:00:00Z').getTime() });
  const rows = [{ id: 'lesson-1', date: new Date('2026-11-26'), dayIndex: 1, payload: lessonModule.FALLBACK_LESSON }];
  progressDatabase(rows, [{ date: new Date('2026-11-26') }]);
  mock.method(lessonModule, 'generateLesson', async () => { throw new Error('quota exhausted'); });
  await assert.rejects(data.buildTomorrowLesson('teefs'), /quota exhausted/);
  assert.equal(rows.length, 1);
});

test('does not reuse incomplete lessons saved by older deployments', async (context) => {
  context.mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-26T12:00:00Z').getTime() });
  const incomplete = structuredClone(lessonModule.FALLBACK_LESSON);
  incomplete.article.paras = incomplete.article.paras.slice(0, 2);
  progressDatabase([
    { id: 'lesson-1', date: new Date('2026-11-26'), dayIndex: 1, payload: lessonModule.FALLBACK_LESSON },
    { id: 'lesson-2', date: new Date('2026-11-27'), dayIndex: 2, payload: incomplete },
  ], [{ date: new Date('2026-11-26') }]);
  mock.method(lessonModule, 'generateLesson', async () => { throw new Error('regenerate incomplete lesson'); });
  await assert.rejects(data.buildTomorrowLesson('teefs'), /regenerate incomplete lesson/);
});

test('first page load returns immediately without waiting for an AI provider', async () => {
  database();
  let called = false;
  mock.method(lessonModule, 'generateLesson', async () => { called = true; throw new Error('should run in background'); });
  const result = await data.getTodayData('teefs');
  assert.equal(called, false);
  assert.equal(result.lessonPending, true);
  assert.equal(result.dayIndex, 1);
});

function progressDatabase(rows = [], feedbacks = []) {
  const prisma = database({
    findMany: async ({ where }) => rows.filter((row) => (!where.date || row.date <= where.date.lte) && (!where.dayIndex || (typeof where.dayIndex === 'number' ? row.dayIndex === where.dayIndex : row.dayIndex > where.dayIndex.gt))).sort((a, b) => b.date - a.date),
    findUnique: async ({ where }) => rows.find((row) => where.id ? row.id === where.id : row.date.getTime() === where.userId_date.date.getTime()) || null,
    findFirst: async () => rows.filter((row) => row.dayIndex > 0 && row.date < data.dayKey()).sort((a, b) => b.date - a.date)[0] || null,
    upsert: async ({ create, update }) => { const row = rows.find((row) => row.date.getTime() === create.date.getTime()); if (row) { const revision = (row.revision ?? 1) + 1; Object.assign(row, update, { revision }); return row; } const saved = { id: 'lesson-' + (rows.length + 1), revision: 1, ...create }; rows.push(saved); return saved; },
  });
  prisma.feedback = {
    findMany: async () => feedbacks,
    findFirst: async ({ where }) => feedbacks.find((row) => row.date >= where.date.gte && row.date <= where.date.lte) || null,
  };
  prisma.wordProgress.upsert = async () => ({});
  prisma.$transaction = async (fn) => fn(prisma);
  return prisma;
}

test('an unsubmitted learner stays Day 1 but receives content for the current date only', async (context) => {
  context.mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-29T12:00:00Z').getTime() });
  const rows = [{ id: 'lesson-1', date: new Date('2026-11-26'), dayIndex: 1, payload: lessonModule.FALLBACK_LESSON }];
  progressDatabase(rows);
  const result = await data.getTodayData('teefs');
  assert.equal(result.dayIndex, 1);
  assert.equal(result.lessonPending, true);
  mock.method(lessonModule, 'generateLesson', async () => lessonModule.FALLBACK_LESSON);
  await data.buildTodayLesson('teefs');
  assert.equal(rows.at(-1).dayIndex, 1);
  assert.equal(rows.at(-1).date.toISOString().slice(0, 10), '2026-11-29');
});

test('a first lesson created on any calendar date starts at Day 1', async () => {
  const rows = [];
  progressDatabase(rows);
  mock.method(lessonModule, 'generateLesson', async () => lessonModule.FALLBACK_LESSON);
  await data.buildTodayLesson('teefs');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].dayIndex, 1);
});

test('next lesson requires feedback for the current lesson and cannot skip Day 1', async () => {
  const rows = [];
  progressDatabase(rows, [{ date: new Date('2026-01-01') }]);
  mock.method(lessonModule, 'generateLesson', async () => { throw new Error('AI must not be called'); });
  await assert.rejects(data.buildTomorrowLesson('teefs'), /反馈/);
  rows.push({ date: data.dayKey(), dayIndex: 1, payload: lessonModule.FALLBACK_LESSON });
  await assert.rejects(data.buildTomorrowLesson('teefs'), /反馈/);
});

test('feedback alone and failed generation keep Day 1; success schedules Day 2 exactly once', async (context) => {
  context.mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-29T12:00:00Z').getTime() });
  const rows = [{ date: new Date('2026-11-29'), dayIndex: 1, payload: lessonModule.FALLBACK_LESSON }];
  progressDatabase(rows, [{ date: new Date('2026-11-29'), shadowing: 70, reading: 65, note: '' }]);
  let fail = true;
  mock.method(lessonModule, 'generateLesson', async () => {
    if (fail) throw new Error('quota exhausted');
    return lessonModule.FALLBACK_LESSON;
  });
  await assert.rejects(data.buildTomorrowLesson('teefs'), /quota exhausted/);
  assert.equal((await data.getTodayData('teefs')).dayIndex, 1);
  assert.equal(rows.length, 1);
  fail = false;
  await data.buildTomorrowLesson('teefs');
  await data.buildTomorrowLesson('teefs');
  assert.deepEqual(rows.map((row) => row.dayIndex), [1, 2]);
  assert.equal((await data.getTodayData('teefs')).dayIndex, 1, 'today stays on the current lesson');
  context.mock.timers.tick(86400000);
  await data.buildTomorrowLesson('teefs', new Date('2026-11-30'));
  assert.equal(rows.length, 2, 'a retry crossing midnight still uses the original source lesson');
  assert.equal((await data.getTodayData('teefs')).dayIndex, 2);
  context.mock.timers.tick(86400000 * 2);
  const later = await data.getTodayData('teefs');
  assert.equal(later.dayIndex, 2, 'the prepared lesson is current on return, with no calendar-based skips');
  assert.equal(later.lessonPending, true, 'older content is not used as today content');
  await assert.rejects(data.buildTomorrowLesson('teefs'), /反馈/, 'the previous lesson feedback cannot unlock Day 3');
});

test('legacy unsubmitted preview content never advances the active lesson', async (context) => {
  context.mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-26T12:00:00Z').getTime() });
  progressDatabase([
    { date: new Date('2026-11-26'), dayIndex: 1, payload: lessonModule.FALLBACK_LESSON },
    { date: new Date('2026-11-27'), dayIndex: 0, payload: lessonModule.FALLBACK_LESSON },
  ]);
  const result = await data.getTodayData('teefs');
  assert.equal(result.dayIndex, 1);
  assert.equal(result.lessonPending, false);
});

test('saved Day 2 summary is restored on reload while Day 1 remains current', async (context) => {
  context.mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-26T12:00:00Z').getTime() });
  const rows = [
    { id: 'lesson-1', date: new Date('2026-11-26'), dayIndex: 1, payload: lessonModule.FALLBACK_LESSON },
    { id: 'lesson-2', date: new Date('2026-11-27'), dayIndex: 2, payload: lessonModule.FALLBACK_LESSON },
  ];
  progressDatabase(rows);
  for (let i = 0; i < 2; i++) {
    const result = await data.getTodayData('teefs');
    assert.equal(result.lessonId, 'lesson-1');
    assert.equal(result.dayIndex, 1);
    assert.equal(result.nextLesson.dayIndex, 2);
    assert.equal(result.nextLesson.scene, rows[1].payload.scene);
  }
});

test('a stale source lesson cannot generate Day 3 after midnight', async (context) => {
  context.mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-28T12:00:00Z').getTime() });
  progressDatabase([
    { id: 'lesson-1', date: new Date('2026-11-26'), dayIndex: 1, payload: lessonModule.FALLBACK_LESSON },
    { id: 'lesson-2', date: new Date('2026-11-27'), dayIndex: 2, payload: lessonModule.FALLBACK_LESSON },
  ], [{ date: new Date('2026-11-28') }]);
  mock.method(lessonModule, 'generateLesson', async () => { throw new Error('must not generate Day 3'); });
  await assert.rejects(data.buildTomorrowLesson('teefs', new Date('2026-11-29'), 'lesson-1'), /刷新/);
});

test('prompt regeneration replaces only Day 2 and repeated revision does not call AI again', async (context) => {
  context.mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-26T12:00:00Z').getTime() });
  const rows = [
    { id: 'lesson-1', date: new Date('2026-11-26'), dayIndex: 1, payload: lessonModule.FALLBACK_LESSON },
    { id: 'lesson-2', date: new Date('2026-11-27'), dayIndex: 2, payload: lessonModule.FALLBACK_LESSON },
  ];
  progressDatabase(rows);
  const revision = data.previewLesson(rows[1]).revision;
  let calls = 0;
  mock.method(lessonModule, 'generateLesson', async (input) => {
    calls++;
    assert.equal(input.instruction, '机场托运行李');
    return { ...lessonModule.FALLBACK_LESSON, scene: '机场托运行李' };
  });
  await data.regenerateTomorrowLesson('teefs', 'lesson-1', revision, '机场托运行李');
  assert.equal(rows.length, 2);
  assert.equal(rows[1].dayIndex, 2);
  assert.equal(rows[1].payload.scene, '机场托运行李');
  assert.notEqual(rows[0].payload.scene, '机场托运行李');
  await data.regenerateTomorrowLesson('teefs', 'lesson-1', revision, '机场托运行李');
  assert.equal(calls, 1);
  context.mock.timers.tick(86400000);
  await assert.rejects(data.regenerateTomorrowLesson('teefs', 'lesson-1', revision, '再次改写'), /刷新/);
});

test('failed regeneration keeps the saved tomorrow lesson intact and does not seed review words', async (context) => {
  context.mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-26T12:00:00Z').getTime() });
  const rows = [
    { id: 'lesson-1', date: new Date('2026-11-26'), dayIndex: 1, payload: lessonModule.FALLBACK_LESSON },
    { id: 'lesson-2', date: new Date('2026-11-27'), dayIndex: 2, payload: lessonModule.FALLBACK_LESSON },
  ];
  const prisma = progressDatabase(rows);
  let seeded = 0;
  prisma.wordProgress.upsert = async () => { seeded++; };
  mock.method(lessonModule, 'generateLesson', async () => { throw new Error('quota exhausted'); });
  const before = JSON.stringify(rows);
  await assert.rejects(data.regenerateTomorrowLesson('teefs', 'lesson-1', data.previewLesson(rows[1]).revision, '机场'), /quota exhausted/);
  assert.equal(JSON.stringify(rows), before);
  assert.equal(seeded, 0);
});

test('regeneration revision advances even when a model returns identical content', async (context) => {
  context.mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-26T12:00:00Z').getTime() });
  const rows = [
    { id: 'lesson-1', date: new Date('2026-11-26'), dayIndex: 1, revision: 1, payload: lessonModule.FALLBACK_LESSON },
    { id: 'lesson-2', date: new Date('2026-11-27'), dayIndex: 2, revision: 1, payload: lessonModule.FALLBACK_LESSON },
  ];
  progressDatabase(rows);
  const revision = data.previewLesson(rows[1]).revision;
  let calls = 0;
  mock.method(lessonModule, 'generateLesson', async () => { calls++; return lessonModule.FALLBACK_LESSON; });
  await data.regenerateTomorrowLesson('teefs', 'lesson-1', revision, '场景不变');
  await data.regenerateTomorrowLesson('teefs', 'lesson-1', revision, '场景不变');
  assert.notEqual(data.previewLesson(rows[1]).revision, revision);
  assert.equal(calls, 1);
});

test('learning dates switch at midnight in Asia/Shanghai', () => {
  assert.equal(data.dayKey(new Date('2026-11-26T15:59:59Z')).toISOString().slice(0, 10), '2026-11-26');
  assert.equal(data.dayKey(new Date('2026-11-26T16:00:00Z')).toISOString().slice(0, 10), '2026-11-27');
});

test('new lesson sentences enter review tomorrow and are returned only when due', async (context) => {
  context.mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-26T12:00:00Z').getTime() });
  const rows = [{ id: 'lesson-1', userId: 'user-1', date: new Date('2026-11-26'), dayIndex: 1, payload: lessonModule.FALLBACK_LESSON }];
  const prisma = progressDatabase(rows);
  const pool = [];
  prisma.wordProgress.upsert = async ({ create }) => {
    if (!pool.some((row) => row.word === create.word)) pool.push(create);
  };
  prisma.wordProgress.findMany = async ({ where, take }) => pool.filter((row) => !where.dueDate || row.dueDate <= where.dueDate.lte).slice(0, take);
  const first = await data.getTodayData('teefs');
  assert.equal(first.review.length, 0);
  assert.equal(pool.filter((row) => row.pos === '句子').length, 3);
  context.mock.timers.tick(86400000);
  const due = await data.getDueWords('teefs');
  assert.equal(due.filter((row) => row.pos === '句子').length, 3);
  assert.equal(due.filter((row) => row.pos !== '句子').length, 8);
  assert.equal(due.find((row) => row.pos === '句子').word, rows[0].payload.reviewSentences[0].en);
});

test('only one concurrent request can reclaim a failed generation task', async () => {
  const prisma = database();
  const old = { id: 'task-1', status: 'failed', startedAt: new Date(0), summary: '', error: '' };
  let claimed = false;
  prisma.generationTask = {
    findUnique: async () => ({ ...old }),
    update: async () => ({}),
    updateMany: async () => {
      if (claimed) return { count: 0 };
      claimed = true;
      return { count: 1 };
    },
  };
  const results = await Promise.all([data.acquireTask('user-1', 'next:date'), data.acquireTask('user-1', 'next:date')]);
  assert.equal(results.filter((result) => result.acquired).length, 1);
});

test('expired running tasks are reported as retryable failures', async () => {
  const prisma = database();
  prisma.generationTask = { findUnique: async () => ({ status: 'running', startedAt: new Date(0), summary: '', error: '' }) };
  assert.equal((await data.getTask('user-1', 'next:date')).status, 'failed');
});

test('production requests reuse the Prisma client instead of opening a pool per query', async () => {
  const oldMode = process.env.NODE_ENV;
  const oldUrl = process.env.DATABASE_URL;
  process.env.NODE_ENV = 'production';
  process.env.DATABASE_URL = 'postgresql://test:test@127.0.0.1:1/test';
  const first = db.getPrisma();
  const second = db.getPrisma();
  try {
    assert.ok(first === second, 'Prisma client should be cached in production');
  } finally {
    await first.$disconnect();
    if (first !== second) await second.$disconnect();
    if (oldMode === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = oldMode;
    if (oldUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = oldUrl;
  }
});
