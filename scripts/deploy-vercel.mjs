// 一键部署：注入 Vercel 环境变量 + 生产部署
// 用法：VERCEL_TOKEN=xxx node scripts/deploy-vercel.mjs
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
const token = env.VERCEL_TOKEN;
if (!token) {
  console.error('缺少 VERCEL_TOKEN（vercel.com/account/tokens 创建，Scope 选 teefsjiang-5506）');
  process.exit(1);
}

const run = (args) => spawnSync('npx', ['vercel', ...args, '--token', token, '--yes'], { cwd: root, env, stdio: 'inherit', shell: true }).status === 0;

const vars = ['DATABASE_URL', 'DIRECT_URL', 'MINIMAX_API_KEY', 'MINIMAX_BASE_URL', 'MINIMAX_CHAT_MODEL', 'MINIMAX_TTS_MODEL', 'MINIMAX_VOICE_ID', 'MINIMAX_VOICE_SPEED'];
for (const name of vars) {
  if (!env[name]) continue;
  console.log('> vercel env add ' + name);
  run(['env', 'add', name, '--value', env[name], '--environment', 'production']);
}

console.log('> vercel deploy --prod');
run(['deploy', '--prod']);
