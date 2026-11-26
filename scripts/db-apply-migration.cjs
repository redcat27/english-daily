// 直接用 Prisma 连接执行迁移 DDL（绕过 migrate CLI 的直连/TUN 拦截问题）
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { readFileSync } = require('fs');
const { createHash } = require('crypto');
const { join } = require('path');

function loadEnv(file) {
  const out = {};
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq < 0) continue;
    const key = t.slice(0, eq).trim();
    const rest = t.slice(eq + 1).trim();
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

const MIGRATIONS = [
  {
    name: '20260127000000_add_generation_tasks',
    file: 'prisma/migrations/20260127000000_add_generation_tasks/migration.sql',
    sql: [
      `CREATE TABLE IF NOT EXISTS "english"."generation_tasks" (
         "id" TEXT NOT NULL,
         "userId" TEXT NOT NULL,
         "taskKey" VARCHAR(40) NOT NULL,
         "status" VARCHAR(16) NOT NULL,
         "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
         "updatedAt" TIMESTAMP(3) NOT NULL,
         "finishedAt" TIMESTAMP(3),
         "error" VARCHAR(300) NOT NULL DEFAULT '',
         "summary" VARCHAR(400) NOT NULL DEFAULT '',
         CONSTRAINT "generation_tasks_pkey" PRIMARY KEY ("id")
       )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS "generation_tasks_userId_taskKey_key" ON "english"."generation_tasks"("userId", "taskKey")`,
      `CREATE INDEX IF NOT EXISTS "generation_tasks_userId_status_idx" ON "english"."generation_tasks"("userId", "status")`,
      `ALTER TABLE "english"."generation_tasks" ADD CONSTRAINT "generation_tasks_userId_fkey" FOREIGN KEY ("userId") REFERENCES "english"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
    ],
  },
];

async function main() {
  // 找到 _prisma_migrations 表在哪个 schema
  const found = await prisma.$queryRawUnsafe(
    `SELECT table_schema::text AS table_schema, table_name::text AS table_name FROM information_schema.tables WHERE table_name = '_prisma_migrations'`
  );
  const migrationsSchema = found.length ? found[0].table_schema : 'public';
  const migrationsTable = `"${migrationsSchema}"."_prisma_migrations"`;
  console.log('_prisma_migrations 位于 schema: ' + migrationsSchema);

  for (const migration of MIGRATIONS) {
    const sql = readFileSync(join(process.cwd(), migration.file), 'utf8');
    const checksum = createHash('sha256').update(sql).digest('hex');

    const existing = await prisma.$queryRawUnsafe(
      `SELECT migration_name FROM ${migrationsTable} WHERE migration_name = '${migration.name}'`
    );
    if (existing.length) {
      console.log('· 已记录，跳过: ' + migration.name);
      continue;
    }

    for (const statement of migration.sql) {
      try {
        await prisma.$executeRawUnsafe(statement);
      } catch (error) {
        if (!/already exists|duplicate/i.test(error.message)) throw error;
      }
    }

    await prisma.$executeRawUnsafe(
      `INSERT INTO ${migrationsTable}
       (id, migration_name, checksum, started_at, finished_at, applied_steps_count, logs, rolled_back_at)
       VALUES (gen_random_uuid()::text, '${migration.name}', '${checksum}', NOW(), NOW(), ${migration.sql.length}, '', NULL)`
    );
    console.log('✓ 已应用: ' + migration.name);
  }

  const tables = await prisma.$queryRawUnsafe(
    `SELECT table_name::text AS table_name FROM information_schema.tables WHERE table_schema = 'english' ORDER BY table_name`
  );
  console.log('english schema 表: ' + tables.map((t) => t.table_name).join(', '));
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error('执行失败：' + error.message);
  process.exit(1);
});



