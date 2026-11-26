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
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const rest = trimmed.slice(eq + 1).trim();
    let value;
    if (rest.startsWith('"') || rest.startsWith("'")) {
      const quote = rest[0];
      const end = rest.indexOf(quote, 1);
      value = end > 0 ? rest.slice(1, end) : rest.slice(1);
    } else {
      const hash = rest.indexOf(' #');
      value = hash >= 0 ? rest.slice(0, hash).trim() : rest;
    }
    if (value) out[key] = value;
  }
  return out;
}

// Neon 的 direct 连接串 = pooled 连接串去掉主机名里的 -pooler
function deriveDirect(url) {
  const at = url.lastIndexOf('@');
  if (at < 0) return url;
  const head = url.slice(0, at + 1);
  const tail = url.slice(at + 1);
  return head + tail.replace('-pooler.', '.');
}
const env = { ...process.env, ...loadEnvFile() };
if (env.DATABASE_URL && (!env.DIRECT_URL || /USER:PASSWORD|ep-xxx/i.test(env.DIRECT_URL))) {
  env.DIRECT_URL = deriveDirect(env.DATABASE_URL);
  console.log('DIRECT_URL 未填写，已从 DATABASE_URL 推导：' + env.DIRECT_URL.replace(/\/\/[^@]+@/, '//***@'));
}
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
