require('./load-typescript.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const realData = require('../src/lib/data.ts');
const lesson = require('../src/lib/lesson.ts');
const srs = require('../src/lib/srs.ts');

function endpoint() {
  const source = { id: 'lesson1', userId: 'user1', dayIndex: 1, date: realData.dayKey(), payload: lesson.FALLBACK_LESSON };
  const state = { source, next: null, task: null, acquired: 0, generated: 0, pending: [] };
  const data = {
    ...realData,
    ensureUser: async () => ({ id: 'user1' }), getCurrentLesson: async () => state.source,
    getNextLesson: async () => state.next, canGenerateNextLesson: async () => true,
    getTask: async () => state.task,
    acquireTask: async () => {
      if (state.task?.status === 'running') return { acquired: false };
      state.task = { status: 'running' }; state.acquired++; return { acquired: true };
    },
    buildTomorrowLesson: async () => { state.generated++; return lesson.FALLBACK_LESSON; },
    regenerateTomorrowLesson: async () => {
      state.generated++;
      state.next = { ...state.next, payload: { ...lesson.FALLBACK_LESSON, scene: '机场托运行李' } };
    },
    completeTask: async () => { state.task = { status: 'done' }; },
    failTask: async () => { state.task = { status: 'failed' }; },
  };
  const modules = {
    'next/server': { after: (fn) => state.pending.push(fn) },
    'next/headers': { cookies: async () => ({ get: () => ({ value: 'groot' }) }) },
    '@/lib/users': { SESSION_COOKIE: 'english_user', isUserKey: () => true },
    '@/lib/data': data, '@/lib/srs': srs, '@/lib/lesson': lesson,
    '@/lib/db': { isDatabaseConfigured: () => true, getPrisma: () => ({ dailyLesson: { findUnique: async ({ where }) => where.id === source.id ? source : null } }) },
  };
  const routeModule = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync('src/app/api/next-preview/route.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function('require', 'module', 'exports', code)((name) => {
    if (!modules[name]) throw new Error('Unexpected import: ' + name);
    return modules[name];
  }, routeModule, routeModule.exports);
  const request = (method, body) => new Request('https://example.test/api/next-preview', {
    method, body: body ? JSON.stringify(body) : undefined,
  });
  return { api: routeModule.exports, state, request };
}

test('duplicate POSTs return saved Day 2 without acquiring a lock or calling a model', async () => {
  const { api, state, request } = endpoint();
  state.next = { ...state.source, id: 'lesson2', dayIndex: 2, date: srs.addDays(state.source.date, 1) };
  for (let i = 0; i < 2; i++) {
    const response = await api.POST(request('POST', { sourceLessonId: state.source.id }));
    assert.equal((await response.json()).tomorrow.dayIndex, 2);
  }
  assert.equal(state.acquired, 0); assert.equal(state.generated, 0);
});

test('simultaneous POSTs share one source-lesson lock and start one generation', async () => {
  const { api, state, request } = endpoint();
  const responses = await Promise.all([1, 2].map(() => api.POST(request('POST', { sourceLessonId: state.source.id }))));
  assert.ok(responses.every((response) => response.status === 202));
  assert.equal(state.pending.length, 1);
  await state.pending[0]();
  assert.equal(state.generated, 1);
});

test('regeneration retains Day 2, exposes running state, and replaying the old revision is idempotent', async () => {
  const { api, state, request } = endpoint();
  state.next = { ...state.source, id: 'lesson2', dayIndex: 2, date: srs.addDays(state.source.date, 1) };
  const body = { sourceLessonId: state.source.id, revision: realData.previewLesson(state.next).revision, prompt: '机场托运行李' };
  await Promise.all([api.PATCH(request('PATCH', body)), api.PATCH(request('PATCH', body))]);
  assert.equal(state.pending.length, 1);
  assert.equal((await (await api.GET(request('GET'))).json()).status, 'running');
  await state.pending[0]();
  const result = await (await api.PATCH(request('PATCH', body))).json();
  assert.equal(result.tomorrow.dayIndex, 2);
  assert.equal(result.tomorrow.scene, '机场托运行李');
  assert.equal(state.generated, 1);
});

test('invalid prompts and another users lesson cannot start regeneration', async () => {
  const { api, state, request } = endpoint();
  assert.equal((await api.PATCH(request('PATCH', { prompt: '' }))).status, 400);
  assert.equal((await api.POST(request('POST', { sourceLessonId: 'otheruserlesson' }))).status, 409);
  assert.equal((await api.POST(request('POST', {}))).status, 409);
  assert.equal(state.pending.length, 0);
});
