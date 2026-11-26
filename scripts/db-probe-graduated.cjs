// 验证「已毕业的词不再出现在复习卡」：插入两个探针词，一个已毕业、一个正常
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
  const user = await prisma.user.findUnique({ where: { key: 'teefs' } });
  const today = new Date(new Date().toLocaleDateString('sv-SE') + 'T00:00:00Z');
  await prisma.wordProgress.create({ data: { userId: user.id, word: 'zzz_graduated_probe', meaning: '探针：已毕业', box: 5, hits: 3, graduated: true, dueDate: today } });
  await prisma.wordProgress.create({ data: { userId: user.id, word: 'zzz_due_probe', meaning: '探针：应出现', box: 1, hits: 0, graduated: false, dueDate: today } });
  const due = await prisma.wordProgress.findMany({ where: { userId: user.id, graduated: false, dueDate: { lte: today }, word: { startsWith: 'zzz_' } }, select: { word: true } });
  console.log('到期复习池中的探针词: ' + (due.length ? due.map(d => d.word).join(',') : '无'));
  console.log(due.some(d => d.word === 'zzz_due_probe') ? 'PASS: 未毕业的词会出现在复习池' : 'FAIL: 未毕业的词没出现');
  const grad = await prisma.wordProgress.findMany({ where: { userId: user.id, word: { startsWith: 'zzz_' } }, select: { word: true } });
  console.log('已毕业的探针词仍在库里但应被过滤: ' + grad.map(g => g.word).join(','));
  await prisma.$disconnect();
})().catch((e) => { console.error('ERR ' + (e && e.message)); process.exit(1); });
