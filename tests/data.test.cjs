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
    feedback: { findMany: async () => [] },
    wordProgress: { findMany: async () => [] },
    dailyLesson: { findUnique: async () => null, findMany: async () => [], findFirst: async () => ({ dayIndex: 1 }), ...overrides },
  };
  mock.method(db, 'isDatabaseConfigured', () => true);
  mock.method(db, 'getPrisma', () => prisma);
  return prisma;
}

test('reuses tomorrow lesson without another paid generation', async () => {
  database({ findUnique: async () => ({ payload: lessonModule.FALLBACK_LESSON }) });
  mock.method(lessonModule, 'generateLesson', async () => { throw new Error('must not call AI'); });
  assert.deepEqual(await data.buildTomorrowLesson('teefs'), lessonModule.FALLBACK_LESSON);
});

test('does not persist fallback lessons when every AI provider fails', async () => {
  let persisted = false;
  database({ upsert: async () => { persisted = true; } });
  mock.method(lessonModule, 'generateLesson', async () => { throw new Error('quota exhausted'); });
  await assert.rejects(data.buildTomorrowLesson('teefs'), /quota exhausted/);
  assert.equal(persisted, false);
});

test('does not reuse incomplete lessons saved by older deployments', async () => {
  const incomplete = structuredClone(lessonModule.FALLBACK_LESSON);
  incomplete.article.paras = incomplete.article.paras.slice(0, 2);
  database({ findUnique: async () => ({ payload: incomplete }) });
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
