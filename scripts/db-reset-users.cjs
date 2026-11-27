// 重置所有学习者数据：课程、单词进度、复习记录、反馈、生成任务
// 保留 users 本身（登录用），level 归零为 A2
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
    if (rest.startsWith('"') || rest.startsWith("'")) { const q = rest[0]; const end = rest.indexOf(q, 1); value = end > 0 ? rest.slice(1, end) : rest.slice(1); }
    else { const hash = rest.indexOf(' #'); value = hash >= 0 ? rest.slice(0, hash).trim() : rest; }
    if (value) out[key] = value;
  }
  return out;
}
const env = loadEnv('.env');
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: env.DATABASE_URL }) });
(async () => {
  const users = await prisma.user.findMany({ select: { id: true, key: true } });
  console.log('重置前：');
  for (const u of users) {
    const lessons = await prisma.dailyLesson.count({ where: { userId: u.id } });
    const words = await prisma.wordProgress.count({ where: { userId: u.id } });
    const reviews = await prisma.reviewEvent.count({ where: { userId: u.id } });
    const feedbacks = await prisma.feedback.count({ where: { userId: u.id } });
    const tasks = await prisma.generationTask.count({ where: { userId: u.id } });
    console.log(`  ${u.key}: 课程 ${lessons} | 单词 ${words} | 复习 ${reviews} | 反馈 ${feedbacks} | 任务 ${tasks}`);
  }

  for (const u of users) {
    await prisma.reviewEvent.deleteMany({ where: { userId: u.id } });
    await prisma.feedback.deleteMany({ where: { userId: u.id } });
    await prisma.wordProgress.deleteMany({ where: { userId: u.id } });
    await prisma.dailyLesson.deleteMany({ where: { userId: u.id } });
    await prisma.generationTask.deleteMany({ where: { userId: u.id } });
    await prisma.user.update({ where: { id: u.id }, data: { level: 'A2' } });
  }

  console.log('重置后：');
  for (const u of users) {
    const lessons = await prisma.dailyLesson.count({ where: { userId: u.id } });
    const words = await prisma.wordProgress.count({ where: { userId: u.id } });
    const reviews = await prisma.reviewEvent.count({ where: { userId: u.id } });
    const feedbacks = await prisma.feedback.count({ where: { userId: u.id } });
    const tasks = await prisma.generationTask.count({ where: { userId: u.id } });
    console.log(`  ${u.key}: 课程 ${lessons} | 单词 ${words} | 复习 ${reviews} | 反馈 ${feedbacks} | 任务 ${tasks}`);
  }
  await prisma.$disconnect();
})().catch((e) => { console.error('ERR ' + (e && e.message)); process.exit(1); });
