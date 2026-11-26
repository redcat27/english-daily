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
  for (const u of users) {
    const all = await prisma.wordProgress.findMany({ where: { userId: { equals: (await prisma.user.findUnique({ where: { key: u.key } })).id } }, select: { word: true, graduated: true, hits: true, dueDate: true } });
    const today = new Date(new Date().toLocaleDateString('sv-SE') + 'T00:00:00Z');
    const due = all.filter(w => !w.graduated && new Date(w.dueDate) <= today);
    const grad = all.filter(w => w.graduated);
    console.log(`${u.key}: 累计 ${all.length} 词 | 已毕业 ${grad.length} | 今日到期 ${due.length}`);
    if (grad.length) console.log('   已毕业（不再出现在复习卡）: ' + grad.map(g => g.word + '(' + g.hits + ')').join('、'));
  }
  await prisma.$disconnect();
})().catch((e) => { console.error('ERR ' + (e && e.message)); process.exit(1); });
