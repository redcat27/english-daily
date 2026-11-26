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

当前项目已连接 `redcat27/english-daily` 的 `main`，推送该分支会自动生产部署。
修改供应商配置时先更新 Vercel 服务端环境变量，再部署；仅修改环境变量不会更新已存在的部署。

`pnpm build` 先执行 `prisma generate` 再构建 Next.js，避免 Vercel 恢复依赖缓存后沿用旧 schema 的客户端类型。

课程生成配置：`AI_PRIMARY_PROVIDER=minimax`、`SENSENOVA_API_KEY`、
`SENSENOVA_BASE_URL=https://token.sensenova.cn/v1`、`SENSENOVA_CHAT_MODEL=deepseek-flash`、
`SENSENOVA_FALLBACK_MODEL=sensenova-6.8-flash-lite`、`SENSENOVA_TIMEOUT_MS=40000`。
`MINIMAX_API_KEY` 用于优先文本生成和语音。文本失败后尝试 SenseNova DeepSeek Flash，再尝试 Flash Lite。

`node scripts/vercel-env.mjs` 可从本地 `.env` 原位更新生产环境变量（不输出密钥）。

```powershell
$env:VERCEL_TOKEN = "你的 token"
node scripts/deploy-vercel.mjs
```

脚本会依次注入环境变量并执行 `vercel deploy --prod`，最后打印线上地址。

## 5. 绑定域名

1. Vercel 项目 → Settings → Domains → 添加 `english.lulunote.top`
2. Cloudflare → `lulunote.top` → DNS → CNAME：名称 `english`，目标 `86018548a8e751f3.vercel-dns-017.com`，DNS only（灰云）、TTL 自动；该方式与已可用的 `teefs` 子域一致。
3. 确认 Vercel 的域名配置有效，并等待证书签发；公共递归 DNS 可能保留先前不存在记录的负缓存。

2026-11-26 已通过 Cloudflare API 创建并回读确认记录，Vercel `misconfigured=false`；已签发 `english.lulunote.top` 的 Let's Encrypt 证书并开启自动续期。本机 HTTPS 直接请求返回 200（约 0.9 秒），TLS 主机名及信任链校验通过。未修改现有 `teefs` 或主域的记录。

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

### 生成状态与故障排查

- `/api/feedback` 的 201 只说明反馈已保存。`/api/next-preview` 首次 POST 返回 202，GET 返回 `running` / `done` / `failed`，`done` 才表示课程已保存。
- 每天只学习北京时间当天的课程；缺课用 `POST /api/next-preview?day=today` 后台准备，未提交推进时沿用最近 Day 编号，内容按当天重新生成。下一课 POST 必须携带 `sourceLessonId`，且当前课程已提交反馈；同一用户/当前课共用 `next:<sourceLessonId>` 任务锁，已保存时直接返回，刷新、重复点击及旧页面不会生成 Day N+2。
- `GET /api/next-preview` 或 `?task=...` 返回持久化预览及任务进度；`tomorrow` 包含 `payload`、`date`、`dayIndex`、`revision`。`PATCH /api/next-preview` 接收 `{sourceLessonId, revision, prompt}`，提示词限 1–500 字，只覆盖明天同一 Day；重放旧 revision 直接返回新版，失败保留旧版。`revision` 整数随保存递增，API 使用摘要版本标记，避免模型返回相同内容时重复执行。
- `POST /api/feedback` 也须携带 `sourceLessonId`，防止旧页面反馈误写入新课程。预览或改写不加入复习池，仅当前课进入复习池。
- 手动清理测试数据：`node scripts/reset-test-learning.cjs` 默认统计，`--apply` 在备份到本地忽略目录 `.vercel/` 后只清理 english 的课程、任务、反馈和复习记录，保留用户档案；有活跃任务时拒绝执行。之后为每个用户启动当天第一课并验证 Day 1。
- 2026-11-26：校正上线调试期间两位用户的现有课程为 Day 1；已存在的次日课程有反馈才编号为 Day 2，无反馈的旧测试预览保留内容并标记 `dayIndex=0`，不参与学习进度。未删除反馈、复习记录或课程内容；修复前快照保存在本地忽略目录 `.vercel/`。新逻辑停止按自然日删除课程。
  校正脚本 `node scripts/normalize-lesson-progress.cjs` 默认预览，`--apply` 写入并先保存快照；只允许在上述校正日期写入，避免以后误运行重置学习进度。
- `vercel.json` 将函数放在 `sin1`，避免数据库与模型请求跨美洲绕行。
- 生成任务在 `english.generation_tasks`；单个候选最多尝试一次，共享 85 秒生成预算。五分钟仍未结束的任务视为僵死，可重试。
- HTTP 200 也可能包含供应商业务错误。MiniMax `base_resp.status_code=2056` 表示 Token Plan 用量耗尽，不能通过延长超时修复。SenseNova `EndpointRPMExceeded` 表示该模型推理限流。
- MiniMax TTS 目前同样受额度限制时，页面使用现有浏览器朗读降级；SenseNova 文本模型不会提供音频。
- iPhone / iPad / Safari 的所有朗读按钮直接在点击调用栈里启动系统英语语音，不在请求 MiniMax 或读取 IndexedDB 之后才降级。桌面仍可用 MiniMax 音频；云服务失败时提供明确的“使用系统朗读”重试按钮，短期内跳过失效云服务。播放拒绝不会被吞掉，按钮显示实际开始/结束状态并支持停止。
- `pnpm test:browser` 使用 WebKit iPhone 模拟和 Chromium 验证真实页面交互；语音引擎与音频设备在自动化中使用测试替身，验证调用时机、错误提示、停止和重试，不代表已完成实体 iPhone 的听感验收。真机应确认媒体音量、静音状态和蓝牙输出。
- 2026-11-26：Next.js / eslint-config-next 升至 16.4.5。运行依赖审计剩余两条 high 均来自 Prisma CLI 的 `@prisma/config` → `effect` / `deepmerge-ts`；应用服务器不导入该配置解析链路。暂不对 Prisma 6 的内部依赖做破坏性 override；下次升级 Prisma 时复核。
