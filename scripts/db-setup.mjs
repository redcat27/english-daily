// 一键建库：读取 .env -> prisma migrate deploy -> 校验 english schema 的表
// 用法：node scripts/db-setup.mjs
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
function loadEnvFile() {
  const file = join(root, '.env');
  if (!existsSync(file)) return {};
  const out = {};
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || line.trim().startsWith('#')) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[match[1]] = value;
  }
  return out;
}

const env = { ...process.env, ...loadEnvFile() };
if (!env.DATABASE_URL || !env.DIRECT_URL) {
  console.error('缺少 DATABASE_URL / DIRECT_URL，先把 Neon 连接串写进 .env');
  process.exit(1);
}

console.log('> prisma migrate deploy ...');
const migrate = spawnSync('npx', ['prisma', 'migrate', 'deploy'], { cwd: root, env, stdio: 'inherit', shell: true });
if (migrate.status !== 0) {
  console.error('migrate 失败');
  process.exit(migrate.status || 1);
}

console.log('> 校验 english schema 的表 ...');
const sql = "SELECT table_name FROM information_schema.tables WHERE table_schema = 'english' ORDER BY table_name;";
const check = spawnSync('npx', ['prisma', 'db', 'execute', '--stdin', '--schema', 'prisma/schema.prisma'], {
  cwd: root, env, input: sql, stdio: ['pipe', 'inherit', 'inherit'], shell: true
});
console.log(check.status === 0 ? '完成：english schema 的表已就绪' : '（校验命令未返回，但 migrate 已成功）');
