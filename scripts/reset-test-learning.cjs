// 手动运维：默认只统计，--apply 才清空 english 的学习数据，保留用户档案。
// 应在后台任务结束后执行；完整快照仅保存在已忽略的本地 .vercel/ 目录。
const fs = require('node:fs');
const { Client } = require('pg');
process.loadEnvFile('.env');
const tables = ['review_events', 'word_progress', 'feedbacks', 'generation_tasks', 'daily_lessons'];
(async () => {
  const client = new Client({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL });
  client.on('error', () => {});
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query('LOCK TABLE english.generation_tasks, english.daily_lessons IN SHARE ROW EXCLUSIVE MODE');
    const active = await client.query("SELECT count(*)::int n FROM english.generation_tasks WHERE status = 'running' AND \"startedAt\" > NOW() - interval '5 minutes'");
    if (active.rows[0].n) throw new Error('还有课程任务正在执行，等结束后再清理。');
    const snapshot = {};
    for (const table of ['users', ...tables]) {
      snapshot[table] = (await client.query('SELECT row_to_json(t) AS row FROM english.' + table + ' t')).rows.map((item) => item.row);
    }
    console.log(JSON.stringify(Object.fromEntries(Object.entries(snapshot).map(([table, rows]) => [table, rows.length]))));
    if (!process.argv.includes('--apply')) { await client.query('ROLLBACK'); return; }
    fs.mkdirSync('.vercel', { recursive: true });
    const filename = '.vercel/learning-test-backup-' + Date.now() + '.json';
    fs.writeFileSync(filename, JSON.stringify(snapshot, null, 2));
    for (const table of tables) await client.query('DELETE FROM english.' + table);
    await client.query('COMMIT');
    console.log('Learning data cleared; user profiles retained. Backup: ' + filename);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { await client.end(); }
})().catch((error) => { console.error(error.message); process.exitCode = 1; });
