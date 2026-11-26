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
  const users = await prisma.user.findMany({ select: { key: true } });
  const lessons = await prisma.dailyLesson.findMany({ orderBy: { date: 'asc' }, select: { date: true, scene: true, dayIndex: true, userId: true } });
  const tasks = await prisma.generationTask.findMany({ orderBy: { updatedAt: 'desc' }, take: 5, select: { taskKey: true, status: true, startedAt: true, finishedAt: true, error: true } });
  const words = await prisma.wordProgress.count();
  const fb = await prisma.feedback.count();
  const rev = await prisma.reviewEvent.count();
  console.log('users: ' + JSON.stringify(users.map(u => u.key)));
  console.log('daily_lessons: ' + lessons.length);
  for (const l of lessons) console.log('   ' + l.date.toISOString().slice(0,10) + '  D' + l.dayIndex + '  ' + l.scene);
  console.log('word_progress: ' + words + ' | feedbacks: ' + fb + ' | review_events: ' + rev);
  console.log('tasks (最近5条):');
  for (const t of tasks) console.log('   ' + t.taskKey + '  ' + t.status + '  ' + (t.error || ''));
  await prisma.$disconnect();
})().catch((e) => { console.error('ERR ' + e.message); process.exit(1); });
