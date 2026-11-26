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
    dailyLesson: { findUnique: async () => null, findMany: async () => [], ...overrides },
  };
  mock.method(db, 'isDatabaseConfigured', () => true);
  mock.method(db, 'getPrisma', () => prisma);
  return prisma;
}

test('reuses tomorrow lesson without another paid generation', async () => {
  database({
    findMany: async () => [{ date: new Date('2026-01-01'), dayIndex: 1, payload: lessonModule.FALLBACK_LESSON }],
    findUnique: async () => ({ dayIndex: 2, payload: lessonModule.FALLBACK_LESSON }),
  });
  mock.method(lessonModule, 'generateLesson', async () => { throw new Error('must not call AI'); });
  assert.deepEqual(await data.buildTomorrowLesson('teefs'), lessonModule.FALLBACK_LESSON);
});

test('does not persist fallback lessons when every AI provider fails', async () => {
  let persisted = false;
  database({
    findMany: async () => [{ date: new Date('2026-01-01'), dayIndex: 1, payload: lessonModule.FALLBACK_LESSON }],
    upsert: async () => { persisted = true; },
  });
  mock.method(lessonModule, 'generateLesson', async () => { throw new Error('quota exhausted'); });
  await assert.rejects(data.buildTomorrowLesson('teefs'), /quota exhausted/);
  assert.equal(persisted, false);
});

test('does not reuse incomplete lessons saved by older deployments', async () => {
  const incomplete = structuredClone(lessonModule.FALLBACK_LESSON);
  incomplete.article.paras = incomplete.article.paras.slice(0, 2);
  database({
    findMany: async () => [{ date: new Date('2026-01-01'), dayIndex: 1, payload: lessonModule.FALLBACK_LESSON }],
    findUnique: async () => ({ dayIndex: 2, payload: incomplete }),
  });
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
    findMany: async ({ where }) => rows.filter((row) => (!where.date || row.date <= where.date.lte) && (!where.dayIndex || row.dayIndex > where.dayIndex.gt)).sort((a, b) => b.date - a.date),
    findUnique: async ({ where }) => rows.find((row) => row.date.getTime() === where.userId_date.date.getTime()) || null,
    upsert: async ({ create }) => { rows.push(create); return create; },
  });
  prisma.feedback = {
    findMany: async () => feedbacks,
    findFirst: async ({ where }) => feedbacks.find((row) => row.date >= where.date.gte && row.date <= where.date.lte) || null,
  };
  prisma.wordProgress.upsert = async () => ({});
  prisma.$transaction = async (fn) => fn(prisma);
  return prisma;
}

test('unsubmitted Day 1 remains the same lesson after several calendar days', async (context) => {
  context.mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-29T12:00:00Z').getTime() });
  const rows = [{ date: new Date('2026-11-26'), dayIndex: 1, payload: lessonModule.FALLBACK_LESSON }];
  progressDatabase(rows);
  mock.method(lessonModule, 'generateLesson', async () => { throw new Error('must retain current lesson'); });
  const result = await data.getTodayData('teefs');
  assert.equal(result.dayIndex, 1);
  assert.equal(result.lessonPending, false);
  assert.deepEqual(result.lesson, rows[0].payload);
  assert.equal(rows.length, 1);
  assert.deepEqual(await data.buildTodayLesson('teefs'), rows[0].payload);
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
  rows.push({ date: new Date('2026-01-02'), dayIndex: 1, payload: lessonModule.FALLBACK_LESSON });
  await assert.rejects(data.buildTomorrowLesson('teefs'), /反馈/);
});

test('feedback alone and failed generation keep Day 1; success schedules Day 2 exactly once', async (context) => {
  context.mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-29T12:00:00Z').getTime() });
  const rows = [{ date: new Date('2026-11-26'), dayIndex: 1, payload: lessonModule.FALLBACK_LESSON }];
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
  context.mock.timers.tick(86400000 * 2);
  const later = await data.getTodayData('teefs');
  assert.equal(later.dayIndex, 2, 'the prepared lesson is current on return, with no calendar-based skips');
  assert.equal(later.lessonPending, false);
  await assert.rejects(data.buildTomorrowLesson('teefs'), /反馈/, 'the previous lesson feedback cannot unlock Day 3');
});

test('legacy unsubmitted preview content never advances the active lesson', async (context) => {
  context.mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-30T12:00:00Z').getTime() });
  progressDatabase([
    { date: new Date('2026-11-26'), dayIndex: 1, payload: lessonModule.FALLBACK_LESSON },
    { date: new Date('2026-11-27'), dayIndex: 0, payload: lessonModule.FALLBACK_LESSON },
  ]);
  const result = await data.getTodayData('teefs');
  assert.equal(result.dayIndex, 1);
  assert.equal(result.lessonPending, false);
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
