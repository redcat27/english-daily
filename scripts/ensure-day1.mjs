// 为每个用户确保「今天的 Day 1 课程」就绪，并让页面把新词写入复习池
const BASE = 'https://english.lulunote.top';

async function ensureDay1(user) {
  const session = await fetch(BASE + '/api/session', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user })
  });
  const cookie = (session.headers.get('set-cookie') || '').split(';')[0];
  console.log(`[${user}] session ok`);

  const start = await fetch(BASE + '/api/next-preview?day=today', {
    method: 'POST', headers: { cookie }
  });
  const s = await start.json();
  console.log(`[${user}] 触发: ${s.status} ${s.task || ''}`);

  if (s.status === 'running' && s.task) {
    const deadline = Date.now() + 150000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 5000));
      const poll = await fetch(`${BASE}/api/next-preview?task=${encodeURIComponent(s.task)}`, { headers: { cookie } });
      const p = await poll.json();
      if (p.status !== 'running') {
        console.log(`[${user}] ${p.status} ${p.lesson ? `Day ${p.lesson.dayIndex} | ${p.lesson.scene} | ${p.lesson.words}词/${p.lesson.lines}句/${p.lesson.paras}段` : p.error || ''}`);
        break;
      }
    }
  } else if (s.lesson) {
    console.log(`[${user}] 已有课程 Day ${s.lesson.dayIndex} | ${s.lesson.scene}`);
  }

  // 访问页面触发 getTodayData：把今天的新词写入复习池
  const page = await fetch(BASE + '/', { headers: { cookie } });
  console.log(`[${user}] 页面 HTTP ${page.status}`);
}

(async () => {
  for (const u of ['teefs', 'groot']) await ensureDay1(u);
})().catch((e) => { console.error('ERR ' + e.message); process.exit(1); });
