# english-daily · 每日英语

手机端 H5 学习站：每天一课（单词 + 情景对话 + 短文），按记忆曲线反复复习已学内容。

- 线上域名：https://english.lulunote.top
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

### 2. 内容生成（AI 实时生成）

`POST /api/feedback` 保存当天反馈后，立刻调用 MiniMax 生成**第二天**的课程：

- 输入：学习者历史反馈（跟读/阅读分数 + 一句话难点）、到期的复习词、最近用过的场景、当前难度档
- 输出：单词 4-10 个（难度自适应）、8-10 句情景对话、1 篇 150 词短文 + 3 道理解题、3 条值得记的整句
- 生成结果按用户 + 日期存入 `daily_lessons`

难度档规则：连续两次均分 ≥85 → 升级（词更多、对话加追问、短文加长）；≤65 → 降级（词减到 4 个、句子变短）；否则保持。

### 3. 存储策略（免费额度友好）

| 表 | 内容 | 保留策略 |
| --- | --- | --- |
| `daily_lessons` | 当天的对话/短文/单词 | **只保留当天**，新的一天生成时清掉更早的当日内容 |
| `word_progress` | 每个词的盒子等级、记住次数、下次复习日 | 长期保留（复习的依据） |
| `review_events` | 每次复习的「记住了/没记住」 | 长期保留（成长轨迹） |
| `feedbacks` | 每天的跟读/阅读分数 + 一句话难点 | 长期保留（AI 迭代依据） |
| TTS 音频 | 不入库 | 缓存在浏览器 IndexedDB，避免重复消耗额度 |

数据库复用现有 Neon 库，本项目只占用 `english` schema。

### 4. 多用户

打开网站先选学习者：**teefs**（男）/ **groot**（女）。选择写入 httpOnly cookie，各自有独立的学习记录与复习进度。顶部随时可切换用户。

## 本地开发

```bash
pnpm install
cp .env.example .env      # 填 Neon 连接串 + MiniMax Key
pnpm db:migrate -- --name init
pnpm dev
```

`prototype/index.html` 是早期的静态交互原型（单文件，可直接双击打开），保留作设计参考。

## 部署

Vercel 项目挂在 team `teefsjiang-5506`，连接 GitHub 仓库 `redcat27/english-daily` 后自动部署。
环境变量：`DATABASE_URL`、`DIRECT_URL`、`MINIMAX_API_KEY`（可选 `MINIMAX_VOICE_ID` / `MINIMAX_VOICE_SPEED`）。
域名 `english.lulunote.top` 在 Cloudflare 加 CNAME 到 `cname.vercel-dns.com`。

## 质量门禁

```bash
pnpm lint
pnpm build
```
