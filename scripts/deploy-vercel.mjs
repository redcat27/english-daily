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
