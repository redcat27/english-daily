// 端到端自检：选用户 -> 生成今日课程 -> 复习打分 -> 提交反馈 -> 生成明日课程 -> TTS
const BASE = process.env.BASE_URL || 'http://127.0.0.1:3000';

async function main() {
  const session = await fetch(BASE + '/api/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user: 'teefs' })
  });
  const cookie = (session.headers.get('set-cookie') || '').split(';')[0];
  console.log('1) 选用户 teefs -> HTTP ' + session.status + ' cookie=' + (cookie ? 'ok' : 'none'));

  const page = await fetch(BASE + '/', { headers: { cookie } });
  const html = await page.text();
  const scene = (html.match(/场景：([^<]{0,20})/) || [])[1] || '?';
  console.log('2) 首页 -> HTTP ' + page.status + ' | 今日场景: ' + scene.trim());
  const words = (html.match(/class="word-en"/g) || []).length;
  const lines = (html.match(/class="line"/g) || []).length;
  const paras = (html.match(/class="para"/g) || []).length;
  console.log('   单词 ' + words + ' | 对话 ' + lines + ' 句 | 短文 ' + paras + ' 段');

  const firstWord = (html.match(/class="word-en">([^<]+)/) || [])[1] || '';
  const clean = firstWord.replace(/<[^>]*>/g, '').trim().split(' ')[0];
  console.log('3) 复习打分：' + clean);
  const review = await fetch(BASE + '/api/review', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({ word: clean, result: 'know' })
  });
  const reviewData = await review.json().catch(() => ({}));
  console.log('   -> HTTP ' + review.status + ' ' + JSON.stringify(reviewData.next || reviewData));

  const feedback = await fetch(BASE + '/api/feedback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({ shadowing: 68, reading: 62, note: '自检：记不住 asking for the bill' })
  });
  const feedbackData = await feedback.json().catch(() => ({}));
  console.log('4) 提交反馈 -> HTTP ' + feedback.status + ' | 明日课程: ' + JSON.stringify(feedbackData.tomorrow));

  const tts = await fetch(BASE + '/api/tts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'Good morning, could I have the bill, please?' })
  });
  const audio = await tts.arrayBuffer();
  console.log('5) TTS -> HTTP ' + tts.status + ' ' + tts.headers.get('content-type') + ' ' + audio.byteLength + ' bytes');
}

main().catch((error) => {
  console.error('自检失败：' + error.message);
  process.exit(1);
});
