// 用 Vercel REST API 注入环境变量（值里有 & 等字符时，命令行传值会被 shell 截断）
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const PROJECT = process.env.VERCEL_PROJECT || 'english-daily';

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

const env = loadEnv(root + '/.env');
const token = env.VERCEL_TOKEN;
if (!token) {
  console.error('缺少 VERCEL_TOKEN');
  process.exit(1);
}

const api = 'https://api.vercel.com';
const headers = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };

async function main() {
  const projectRes = await fetch(api + '/v9/projects/' + PROJECT, { headers });
  const project = await projectRes.json();
  if (!project.id) {
    console.error('找不到项目 ' + PROJECT + '：' + JSON.stringify(project).slice(0, 200));
    process.exit(1);
  }
  console.log('项目 ' + project.name + ' id=' + project.id);

  // 清理同名旧变量
  const existing = await (await fetch(api + '/v10/projects/' + project.id + '/env?decrypt=false', { headers })).json();
  const names = ['DATABASE_URL', 'DIRECT_URL', 'MINIMAX_API_KEY', 'MINIMAX_BASE_URL', 'MINIMAX_CHAT_MODEL', 'MINIMAX_TTS_MODEL', 'MINIMAX_VOICE_ID', 'MINIMAX_VOICE_SPEED'];
  for (const item of existing.envs || []) {
    if (names.includes(item.key)) {
      await fetch(api + '/v10/projects/' + project.id + '/env/' + item.id, { method: 'DELETE', headers });
    }
  }

  for (const name of names) {
    if (!env[name]) continue;
    const res = await fetch(api + '/v10/projects/' + project.id + '/env', {
      method: 'POST',
      headers,
      body: JSON.stringify({ key: name, value: env[name], type: 'encrypted', target: ['production'] }),
    });
    const body = await res.json().catch(() => ({}));
    console.log((res.ok ? '✓ ' : '✗ ') + name + (res.ok ? '' : ' -> ' + JSON.stringify(body).slice(0, 160)));
  }
}

main().catch((error) => {
  console.error('注入失败：' + error.message);
  process.exit(1);
});
