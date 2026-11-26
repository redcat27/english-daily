# english-daily · 每日英语

手机端 H5 学习站：每天一课（单词 + 情景对话 + 短文），按记忆曲线反复复习已学内容。

- 当前线上地址：https://english.lulunote.top
- 备用部署地址：https://english-daily-cyan.vercel.app
- 技术栈：Next.js 16（App Router）+ Tailwind v4 + Prisma 6 + Neon Postgres + Vercel
- 视觉：移植 teefs-portfolio 的 "Developer Console" 设计令牌（暗色优先 + 翡翠绿），移动优先单列

## 核心机制

### 1. 记忆法：Leitner 间隔重复

每个词有一个盒子等级（1-5），决定下次复习间隔：

| 盒子 | 1 | 2 | 3 | 4 | 5 |
| --- | --- | --- | --- | --- | --- |
| 间隔 | 1 天 | 2 天 | 4 天 | 7 天 | 15 天 |

- 答「记住了」→ 升盒，间隔变长
- 答「没记住」→ 退回第 1 盒，明天再来
- **连续记住 3 次 → 毕业，不再推送**

复习卡不只有词条，还带例句（英 + 中），对话里的关键整句也会进复习池（句子卡）。

“今日复习”的单词卡和句子卡都来自已到期的复习池，按类型分栏并分别计数；不直接展示当天新课的 `reviewSentences`。新课单词和整句首次到期时间为次日，所以首次学习当天两栏都为空。句子卡使用真实的盒子、连续记住次数及评分状态。

### 2. 内容生成（AI 实时生成）

`POST /api/feedback` 先保存当天反馈（201）；`POST /api/next-preview` 启动**第二天**的课程生成（202），页面通过 `GET /api/next-preview?task=...` 查询结果。

- 模型顺序：MiniMax `MiniMax-M2.5` → SenseNova `deepseek-flash` → `sensenova-6.8-flash-lite`。遇到限流、超时、空结果或校验失败自动切换，每个模型最多一次，整条链路共用 85 秒预算。
- 后台执行使用 Next.js `after()`，数据库任务锁避免重复生成，已存在的次日课程直接复用。任务失败可以重试；不会把体验课程当成 AI 结果入库。
- 新用户第一课为 Day 1，日期按北京时间切换，每天只学习当天课程。首次缺课通过 `/api/next-preview?day=today` 后台准备，不在首屏等待 AI。未提交生成下一课时 Day 不递增，缺课时按当天日期重新准备同一 Day 的内容。
- 提交反馈后生成明天 Day N+1，普通重复 POST 直接返回已保存结果。下一课预览从数据库恢复，刷新后仍可见；输入提示词并明确点击才会用 PATCH 替换同一 Day 的明天课程。版本号及用户/当前课任务锁防重复，失败保留旧版；只预览，不产生明天的学习记录。
- 一次生成整课并校验章节、条目数量及数据库字段长度，避免不同场景内容拼接。日志只记录模型、耗时和状态。

- 输入：学习者历史反馈（跟读/阅读分数 + 一句话难点）、到期的复习词、最近用过的场景、当前难度档
- 输出：单词 4/8/10 个、对话 6/8/10 句、短文至少 4/6/7 句（随难度变化，按英中对照分段）、3 道理解题、3 条值得记的整句
- 生成结果按用户 + 日期存入 `daily_lessons`

难度档规则：连续两次均分 ≥85 → 升级（词更多、对话加追问、短文加长）；≤65 → 降级（词减到 4 个、句子变短）；否则保持。

### 3. 存储策略（免费额度友好）

| 表 | 内容 | 保留策略 |
| --- | --- | --- |
| `daily_lessons` | 按日期及 Day 编号的对话/短文/单词 | 主页面只取当天；明天只能预览和改写，`revision` 记录版本 |
| `word_progress` | 每个词的盒子等级、记住次数、下次复习日 | 长期保留（复习的依据） |
| `review_events` | 每次复习的「记住了/没记住」 | 长期保留（成长轨迹） |
| `feedbacks` | 每天的跟读/阅读分数 + 一句话难点 | 长期保留（AI 迭代依据） |
| `generation_tasks` | 每个用户的生成状态与任务锁 | 失败可重试；僵死任务 5 分钟后可接管 |
| TTS 音频 | 不入库 | 缓存在浏览器 IndexedDB，避免重复消耗额度 |

语音播放：iPhone / iPad / Safari 直接使用系统英语朗读，由点击同步触发，避免异步请求丢失播放权限。桌面优先使用 MiniMax 音频和 IndexedDB 缓存；云服务失败或浏览器拒绝播放时显示“使用系统朗读”按钮。所有播放器支持停止，失败时给出可见提示；苹果设备的朗读不依赖 MiniMax 额度。

数据库复用现有 Neon 库，本项目只占用 `english` schema。

### 4. 多用户

打开网站先选学习者：**teefs**（男）/ **groot**（女）。选择写入 httpOnly cookie，各自有独立的学习记录与复习进度。顶部随时可切换用户。

## 本地开发

```bash
pnpm install
cp .env.example .env      # 填 Neon、MiniMax Key 与 SenseNova 备用 Key
pnpm db:migrate -- --name init
pnpm dev
```

`prototype/index.html` 是早期的静态交互原型（单文件，可直接双击打开），保留作设计参考。

## 部署

Vercel 项目挂在 team `teefsjiang-5506`，连接 GitHub 仓库 `redcat27/english-daily` 后自动部署。
函数区域配置为 `sin1`（新加坡），靠近 Neon 和模型供应商。生产部署后可运行 GitHub Actions 的 `Production smoke` 验证公开页面与后台生成。
环境变量见 `.env.example`。`AI_PRIMARY_PROVIDER=minimax`，主模型及语音使用 `MINIMAX_API_KEY`；文本备用使用 `SENSENOVA_API_KEY`、`SENSENOVA_CHAT_MODEL`、`SENSENOVA_FALLBACK_MODEL`。密钥仅在服务端读取。
域名 `english.lulunote.top` 已在 Cloudflare 配置 CNAME 到 `86018548a8e751f3.vercel-dns-017.com`，使用 DNS only（灰云），与 `teefs.lulunote.top` 的配置方式一致。HTTPS 证书由 Vercel 自动续期。

## 质量门禁

```bash
pnpm lint
pnpm test
pnpm build
```
