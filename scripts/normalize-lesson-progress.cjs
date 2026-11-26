// 一次性校正旧版按自然日递增的调试课程；默认预览，--apply 才写入。
// 先在忽略目录保存完整课程快照，仅更新编号和孤立任务状态，不删除学习记录。
const fs = require('node:fs');
const path = require('node:path');
const { Client, types } = require('pg');
// pg 默认把 SQL DATE 当成本机午夜；明确按 UTC 解析，避免上海时区变成前一天。
types.setTypeParser(1082, (value) => new Date(value + 'T00:00:00.000Z'));
process.loadEnvFile('.env');

(async () => {
  const client = new Client({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL });
  client.on('error', () => {});
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query('LOCK TABLE english.daily_lessons IN SHARE ROW EXCLUSIVE MODE');
    const { rows } = await client.query(`
      SELECT l.*, u.key,
        EXISTS (SELECT 1 FROM english.feedbacks f
          WHERE f."userId" = l."userId" AND f.date >= CURRENT_DATE AND f.date < l.date) AS "hasFeedback"
      FROM english.daily_lessons l JOIN english.users u ON u.id = l."userId"
      ORDER BY l."userId", l.date`);
    const today = new Date().toISOString().slice(0, 10);
    if (process.argv.includes('--apply') && today !== '2026-11-26') {
      throw new Error('此脚本只用于 2026-11-26 的旧版测试数据校正，请勿用于重置后续学习进度。');
    }
    const current = new Map();
    for (const row of rows) if (row.date.toISOString().slice(0, 10) <= today) current.set(row.userId, row);
    const changes = [];
    for (const row of rows) {
      if (current.get(row.userId)?.id === row.id) changes.push({ row, dayIndex: 1 });
      else if (row.date.toISOString().slice(0, 10) > today) changes.push({ row, dayIndex: row.hasFeedback ? 2 : 0 });
    }
    console.log(JSON.stringify(changes.map(({ row, dayIndex }) => ({ user: row.key, date: row.date.toISOString().slice(0, 10), before: row.dayIndex, after: dayIndex }))));
    if (!process.argv.includes('--apply')) { await client.query('ROLLBACK'); return; }
    const snapshot = path.join('.vercel', 'lesson-progress-before-' + Date.now() + '.json');
    fs.mkdirSync('.vercel', { recursive: true });
    fs.writeFileSync(snapshot, JSON.stringify(rows, null, 2));
    for (const { row, dayIndex } of changes) {
      await client.query('UPDATE english.daily_lessons SET "dayIndex" = $1 WHERE id = $2', [dayIndex, row.id]);
      if (dayIndex === 0) await client.query(`UPDATE english.generation_tasks SET status = 'failed', error = '请先完成当前课程并提交反馈。' WHERE "userId" = $1 AND "taskKey" = $2`, [row.userId, 'next:' + row.date.toISOString().slice(0, 10)]);
    }
    await client.query('COMMIT');
    console.log('Applied; snapshot: ' + snapshot);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { await client.end(); }
})().catch((error) => { console.error(error.message); process.exitCode = 1; });
