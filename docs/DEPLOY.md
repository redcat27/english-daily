# 上线手册（english-daily）

整条链路需要 3 个东西：Neon 的两条连接串、一个 Vercel Token、Cloudflare 一条 DNS 记录。
拿到之后按下面 4 步走，全程命令行，不需要再开浏览器。

## 0. 准备凭证

| 凭证 | 去哪拿 | 说明 |
| --- | --- | --- |
| `DATABASE_URL` | Neon Console → 项目 `spring-smoke-80019025` → 分支 `br-fancy-base-b3kbwvb0` → **Connect** | **Pooled** 那条（主机名带 `-pooler`），运行时用 |
| `DIRECT_URL` | 同上 | **Direct** 那条（主机名不带 `-pooler`），Prisma 迁移用；密码与 pooled 相同 |
| `VERCEL_TOKEN` | vercel.com/account/tokens → Create Token | Scope 选团队 `teefsjiang-5506` |
| Cloudflare 记录 | dash.cloudflare.com → `lulunote.top` → DNS → Add record | 类型 `CNAME`、名称 `english`、目标 `cname.vercel-dns.com`、Proxy 开启（橙云） |

## 1. 写本地 .env

```powershell
cd C:\teefs_work\next_js_pj\english-daily
Copy-Item .env.example .env
# 然后把上面两条连接串和 MINIMAX_API_KEY 填进去
```

## 2. 建库（建 `english` schema + 5 张表）

```powershell
node scripts/db-setup.mjs
```

它会跑 `prisma migrate deploy` 并打印 `english` schema 下的表清单。
表：`users` / `daily_lessons` / `word_progress` / `review_events` / `feedbacks`。

## 3. 本地自检

```powershell
pnpm build; pnpm start
```

浏览器打开 http://127.0.0.1:3000 ，依次确认：

1. 选 teefs → 页面出现今日课程（此时应该是 AI 实时生成的，不是兜底内容）
2. 复习区出现到期词 → 点「记住了」→ 顶部计数 +1
3. 点喇叭有自然人声（`/api/tts` 返回 audio/mpeg）
4. 填反馈提交 → 弹出「明天 · Day N」的预览
5. 切到 groot → 看到的是它自己的记录，不是 teefs 的

## 4. 部署到 Vercel

```powershell
$env:VERCEL_TOKEN = "你的 token"
node scripts/deploy-vercel.mjs
```

脚本会依次注入环境变量并执行 `vercel deploy --prod`，最后打印线上地址。

## 5. 绑定域名

1. Vercel 项目 → Settings → Domains → 添加 `english.lulunote.top`
2. Cloudflare → `lulunote.top` → DNS → 添加 CNAME（名称 `english`，目标 `cname.vercel-dns.com`，橙云）
3. 等 1-5 分钟，证书自动签发

## 6. 线上验证

```powershell
curl -s -o NUL -w "%{http_code}" https://english.lulunote.top/
curl -s -X POST https://english.lulunote.top/api/tts -H "Content-Type: application/json" -d '{"text":"Hello"}' -o tts.mp3
```

- 首页 200
- tts.mp3 有内容（说明 MiniMax key 在 Vercel 上生效了）
- 页面上提交一次反馈 → Neon 的 `english.feedbacks` 里出现新记录

## 常见问题

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| migrate 报 shadow database / pool 错误 | `DIRECT_URL` 写成了 pooled 串 | 换成不带 `-pooler` 的那条 |
| 线上 `/api/tts` 返回 503 | Vercel 上没配 `MINIMAX_API_KEY` | 重跑 `scripts/deploy-vercel.mjs` |
| 线上页面是兜底内容（点餐场景固定不变） | `MINIMAX_CHAT_MODEL` 没生效或接口报错 | 看 Vercel 部署日志里的 `[lesson] AI 生成失败` |
| 复习区一直是空 | 没连数据库 | 确认 `.env` 有 `DATABASE_URL`，且跑过 `scripts/db-setup.mjs` |
