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
  const del = await prisma.wordProgress.deleteMany({ where: { word: { startsWith: 'zzz_' } } });
  console.log('已清理探针词: ' + del.count + ' 条');
  await prisma.$disconnect();
})().catch((e) => { console.error('ERR ' + (e && e.message)); process.exit(1); });
