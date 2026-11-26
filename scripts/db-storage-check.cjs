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
  const rows = await prisma.$queryRawUnsafe(
    `SELECT u.key AS ukey, l.date::text AS d, l."dayIndex" AS di, l.scene AS scene,
            pg_column_size(l.payload) AS payload_bytes, l.payload->>'archived' AS archived
     FROM english.daily_lessons l JOIN english.users u ON u.id = l."userId"
     ORDER BY l.date DESC LIMIT 10`
  );
  for (const r of rows) console.log(`${r.ukey} ${r.d} D${r.di} ${r.scene} | payload=${r.payload_bytes}B archived=${r.archived ?? 'no'}`);
  const words = await prisma.wordProgress.count();
  const fb = await prisma.feedback.count();
  console.log('word_progress(纯文本): ' + words + ' | feedbacks: ' + fb);
  await prisma.$disconnect();
})().catch((e) => { console.error('ERR ' + e.message); process.exit(1); });

