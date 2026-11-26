// 用 Prisma 校验 english schema（与线上运行时同一条连接链路）
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { readFileSync } = require('fs');

function loadEnv(file) {
  const out = {};
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq < 0) continue;
    const key = t.slice(0, eq).trim();
    let rest = t.slice(eq + 1).trim();
    let value;
    if (rest.startsWith('"') || rest.startsWith("'")) {
      const q = rest[0];
      const end = rest.indexOf(q, 1);
      value = end > 0 ? rest.slice(1, end) : rest.slice(1);
    } else {
      const hash = rest.indexOf(' #');
      value = hash >= 0 ? rest.slice(0, hash).trim() : rest;
    }
    if (value) out[key] = value;
  }
  return out;
}

const env = loadEnv('.env');
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: env.DATABASE_URL }) });

async function main() {
  const users = await prisma.user.findMany({ select: { key: true, name: true, level: true } });
  const lessons = await prisma.dailyLesson.count();
  const words = await prisma.wordProgress.count();
  const reviews = await prisma.reviewEvent.count();
  const feedbacks = await prisma.feedback.count();
  console.log('users: ' + JSON.stringify(users));
  console.log('daily_lessons: ' + lessons + ' | word_progress: ' + words + ' | review_events: ' + reviews + ' | feedbacks: ' + feedbacks);
  if (lessons) {
    const row = await prisma.dailyLesson.findFirst({ orderBy: { createdAt: 'desc' } });
    console.log('最近一课: ' + row.date.toISOString().slice(0, 10) + ' | ' + row.scene + ' | ' + row.title);
    const payload = row.payload;
    console.log('  单词 ' + payload.words.length + ' | 对话 ' + payload.dialogue.lines.length + ' 句 | 短文 ' + payload.article.paras.length + ' 段 | 整句 ' + payload.reviewSentences.length);
    console.log('  首词: ' + payload.words[0].word + ' ' + payload.words[0].phonetic + ' ' + payload.words[0].meaning);
  }
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error('校验失败：' + error.message);
  process.exit(1);
});
