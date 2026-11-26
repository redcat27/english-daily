require('./load-typescript.cjs');
const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { mock } = require('node:test');

process.env.SENSENOVA_API_KEY = 'test-sensenova-key';
process.env.MINIMAX_API_KEY = 'test-minimax-key';
process.env.AI_PRIMARY_PROVIDER = 'sensenova';
afterEach(() => mock.restoreAll());

const completion = (content, finish_reason = 'stop') => Response.json({
  choices: [{ message: { content }, finish_reason }],
});
const validate = (value) => {
  assert.equal(value.ok, true);
  return value;
};

test('uses SenseNova deepseek-flash first with reasoning disabled and JSON output', async () => {
  const { generateJson } = require('../src/lib/ai.ts');
  const calls = [];
  mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, options });
    return completion('{"ok":true}');
  });
  assert.deepEqual(await generateJson('JSON only', 'Return ok', validate), { ok: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://token.sensenova.cn/v1/chat/completions');
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.model, 'deepseek-flash');
  assert.equal(body.reasoning_effort, 'none');
  assert.equal(body.thinking.type, 'disabled');
  assert.equal(body.response_format.type, 'json_object');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer test-sensenova-key');
  assert.ok(calls[0].options.signal);
});

for (const failure of ['rate limit', 'timeout', 'empty', 'invalid shape', 'truncated']) {
  test(`falls back to MiniMax once after SenseNova ${failure}`, async () => {
    const { generateJson } = require('../src/lib/ai.ts');
    let calls = 0;
    mock.method(globalThis, 'fetch', async () => {
      calls++;
      if (calls === 1) {
        if (failure === 'rate limit') return Response.json({ error: { code: 'RateLimit' } }, { status: 429 });
        if (failure === 'timeout') throw new DOMException('timed out', 'TimeoutError');
        if (failure === 'empty') return completion('');
        if (failure === 'invalid shape') return completion('{"ok":false}');
        return completion('{"ok":true}', 'length');
      }
      return completion('{"ok":true}');
    });
    assert.deepEqual(await generateJson('JSON only', 'Return ok', validate), { ok: true });
    assert.equal(calls, 2);
  });
}

test('rejects MiniMax business errors even when HTTP status is 200', async () => {
  const { chatCompletion } = require('../src/lib/minimax.ts');
  mock.method(globalThis, 'fetch', async () => Response.json({
    base_resp: { status_code: 2056, status_msg: 'quota exhausted' },
  }));
  await assert.rejects(chatCompletion('JSON only', 'Return ok'), /2056/);
});

test('reports total provider failure instead of returning empty or sample content', async () => {
  const { generateJson } = require('../src/lib/ai.ts');
  let calls = 0;
  mock.method(globalThis, 'fetch', async () => {
    calls++;
    return calls === 1
      ? Response.json({ error: { code: 'RateLimit' } }, { status: 429 })
      : Response.json({ base_resp: { status_code: 2056, status_msg: 'quota exhausted' } });
  });
  await assert.rejects(generateJson('JSON only', 'Return ok', validate), /暂时不可用/);
  assert.equal(calls, 2);
});
