// 验证任务锁：并发触发两次，只应有一个任务真正在跑
const BASE = process.env.BASE_URL || 'https://english.lulunote.top';

const session = await fetch(BASE + '/api/session', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ user: 'teefs' })
});
const cookie = (session.headers.get('set-cookie') || '').split(';')[0];
console.log('session cookie: ' + (cookie ? 'ok' : 'missing'));

const page = await fetch(BASE + '/', { headers: { cookie } });
const html = await page.text();
const lessonId = (html.match(/lessonId\\?":\\?"([a-z0-9]+)/i) || [])[1] || '';
console.log('当前课程 id: ' + (lessonId || '(未取到)'));

// 先提交今天的反馈（业务规则：完成并反馈后才生成明天的课）
const fb = await fetch(BASE + '/api/feedback', {
  method: 'POST',
  headers: { cookie, 'Content-Type': 'application/json' },
  body: JSON.stringify({ shadowing: 68, reading: 62, note: '锁验证：记不住 asking for the bill', sourceLessonId: lessonId })
});
console.log('提交反馈 -> HTTP ' + fb.status + ' ' + (await fb.text()).slice(0, 120));

const t0 = Date.now();
const [a, b] = await Promise.all([
  fetch(BASE + '/api/next-preview', { method: 'POST', headers: { cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ sourceLessonId: lessonId }) }),
  fetch(BASE + '/api/next-preview', { method: 'POST', headers: { cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ sourceLessonId: lessonId }) })
]);
const ja = await a.json().catch(() => ({}));
const jb = await b.json().catch(() => ({}));
console.log('并发触发 A -> HTTP ' + a.status + ' ' + JSON.stringify(ja).slice(0, 120));
console.log('并发触发 B -> HTTP ' + b.status + ' ' + JSON.stringify(jb).slice(0, 120));
console.log('任务键一致（说明锁生效）: ' + (ja.task && jb.task ? ja.task === jb.task : '需检查'));

const task = ja.task || jb.task;
if (!task) process.exit(0);

let state = 'running';
let result = null;
while (Date.now() - t0 < 220000) {
  await new Promise((r) => setTimeout(r, 4000));
  const poll = await fetch(BASE + '/api/next-preview?task=' + encodeURIComponent(task), { headers: { cookie } });
  const data = await poll.json().catch(() => ({}));
  state = data.status;
  if (state !== 'running') { result = data; break; }
  console.log('  生成中… ' + Math.round((Date.now() - t0) / 1000) + 's');
}
console.log('最终状态: ' + state + '（耗时 ' + Math.round((Date.now() - t0) / 1000) + 's）');
if (result) {
  console.log('结果: ' + JSON.stringify(result.tomorrow || result.error || result).slice(0, 300));
}


