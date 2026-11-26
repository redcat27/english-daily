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

课程生成配置：`AI_PRIMARY_PROVIDER=sensenova`、`SENSENOVA_API_KEY`、
`SENSENOVA_BASE_URL=https://token.sensenova.cn/v1`、`SENSENOVA_CHAT_MODEL=deepseek-flash`、
`SENSENOVA_FALLBACK_MODEL=sensenova-6.8-flash-lite`、`SENSENOVA_TIMEOUT_MS=40000`。
`MINIMAX_API_KEY` 用于第三级文本备用和语音。SenseNova 限流后先尝试 Flash Lite。

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
- 当天课程使用 `POST /api/next-preview?day=today`，首屏本身不调用模型；后台完成后客户端自动刷新。`vercel.json` 将函数放在 `sin1`，避免数据库与模型请求跨美洲绕行。
- 生成任务在 `english.generation_tasks`；单个候选最多尝试一次，共享 85 秒生成预算。五分钟仍未结束的任务视为僵死，可重试。
- HTTP 200 也可能包含供应商业务错误。MiniMax `base_resp.status_code=2056` 表示 Token Plan 用量耗尽，不能通过延长超时修复。SenseNova `EndpointRPMExceeded` 表示该模型推理限流。
- MiniMax TTS 目前同样受额度限制时，页面使用现有浏览器朗读降级；SenseNova 文本模型不会提供音频。
- 2026-11-26：Next.js / eslint-config-next 升至 16.4.5。运行依赖审计剩余两条 high 均来自 Prisma CLI 的 `@prisma/config` → `effect` / `deepmerge-ts`；应用服务器不导入该配置解析链路。暂不对 Prisma 6 的内部依赖做破坏性 override；下次升级 Prisma 时复核。
