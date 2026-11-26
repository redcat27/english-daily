# 任务书：复习区交互重做 + 语速默认 0.85 + 词汇量持续扩大

> 触发时间：2026-11-27 05:29 (+08:00)
> 执行位置：本仓库 `C:\teefs_work\next_js_pj\english-daily`（线上 https://english.lulunote.top）
> 原则：文档先行 → 改代码 → `pnpm lint` + `pnpm build` → commit → 部署 → 线上自检

---

## 需求一：今日复习区 = 与「今日新词」同款卡片

**现状**：复习区是自成一体的 `ReviewCard`（深色卡片 + 「看释义和例句」按钮 + 「记住了/没记住」两个大按钮），
和下面「今日新词」的 `WordRow` 卡片风格割裂；句子卡更挤。

**目标**：

1. **视觉与交互统一**：复习卡复用「今日新词」的卡片结构（`.card.word` 体系：
   英文 / 音标 / 词性 / 释义 → 展开显示例句英中 + 发音要点 + 喇叭 + 认识/不熟标记）。
2. **默认只显示英文**：卡片收起时**只显示英文（单词或句子）与音标，不显示中文释义、不显示例句**；
   点击卡片才展开显示释义 / 例句 / 喇叭 / 判定按钮。
   - 也就是说：复习卡第一次看到时是「先回忆中文意思」→ 点开对答案，语义与新词卡一致。
3. **句子卡精简小巧**：句子卡用更紧凑的变体（单行英文 + 右侧喇叭 + 小号来源标签），
   不要和单词卡一样占满高度；展开后显示中文与出处。
4. **喇叭位置固定在每段文本右侧**：
   - 单词卡：喇叭固定在英文行右侧（不是跟着内容流走）。
   - 句子卡：同样固定在右侧。
   - 短文每段：喇叭固定在该段右侧（现在已经是 `.para-en` flex，需保证是「固定列宽 + 右对齐」，
     而不是随文本长度漂移）。
   - 对话每句：同上。
   实现建议：容器 `position: relative` + 喇叭 `position: absolute; right: 10px; top: 8px;`，
   并给文本区加 `padding-right: 44px`，避免文字被喇叭压住。

**涉及文件**：`src/components/lesson-app.tsx`（`ReviewCard` / `WordRow` / 复习区 JSX）、
`src/app/globals.css`（`.card.word` / `.rcard` / `.para-en` / `.line` 相关样式）。

---

## 需求二：语速默认 0.85

- `src/lib/minimax.ts`：`export const TTS_SPEED = Number(process.env.MINIMAX_VOICE_SPEED || 0.85);`
- `.env` / `.env.example`：`MINIMAX_VOICE_SPEED="0.85"`
- `src/lib/speed.ts`：store 默认值跟随服务端（`initSpeed` 已有），确认默认快照为 0.85；
  滑块范围保持 0.6–1.4。
- `src/lib/data.ts`：`audioDefaultSpeed` 取 `MINIMAX_VOICE_SPEED`（已是），确保线上默认 0.85。
- 注意：线上 Vercel 环境变量 `MINIMAX_VOICE_SPEED` 需要同步改成 `0.85`（用 `scripts/vercel-env.mjs` 注入后重新部署）。

---

## 需求三：词汇量要持续扩大

**现状**：每天新词固定 8 个，AI 生成时只看「最近 6 个场景 + 到期复习词」，容易反复在熟悉场景里打转，
历史学过的词没有系统性回避。

**目标**：随着用户历史词汇量增长，每天的新词覆盖面要扩大，且不重复已学词。

实现要点：

1. **向 AI 提供「历史已学词表」**：在 `src/lib/lesson.ts` 的 `buildUserPrompt` 中增加
   「历史已学单词（全部，逗号分隔，最多 N=120 个）」与「其中已掌握 / 仍需复习」两类信息，
   并明确要求：**新词不得出现在历史已学词表中**；同时要求：
   - 优先补用户没接触过的生活场景（避免场景重复）；
   - 词汇难度随用户水平缓慢上升（同义词、近义替换、稍长的表达）。
2. **数据侧提供历史词表**：在 `src/lib/data.ts` 增加
   `getLearnedWords(key, limit)`：从 `word_progress` 取该用户全部词（按最近学习时间倒序），
   返回 `{ word, meaning, hits, graduated }`；同时给出已毕业（graduated）词表。
   数据量大时按「最近 120 + 随机采样已毕业词」组合，保证提示词长度可控。
3. **新词数量可随水平增长**：`buildUserPrompt` 里的 `size.words` 由固定 8 改为随
   `level`/`已学词量` 递增（例如 A2: 8 → 12 → 15），并在「升级」难度档时再加量。
4. **历史词只存文本**（已实现：`word_progress` 不存音频），保持不变。

---

## 需求四：复习来源与数量

1. **复习来源 = 历史学过的词**（`word_progress` 里该用户的词），不是当天新词。
   - 现状 `getDueWords` 已按 `dueDate <= today && graduated = false` 取词 ✅。
2. **已通过记忆法检测的词不再出现在复习卡**：
   - Leitner 规则：连续记住 3 次 → `graduated = true` → 永久不再复习（`src/lib/srs.ts`）。
   - 需要确认 `gradeWord` 正确写入 `graduated`，且 `getDueWords` 过滤掉它（已有，需回归验证）。
   - 句子卡若也进池，同样遵循毕业规则（目前整句也进 `word_progress`，`pos = "句子"`）。
3. **复习量通常大于新词量**：
   - `getDueWords(key, 20)` 的上限保持或提高到 24；
   - 复习区展示条数 = 到期词数（不截断到 8）；
   - 若当天到期词少于新词数，允许把「次日到期」的词提前拉进来复习（提前复习不改变原定到期日）。
4. **复习区支持整段折叠 / 展开**：
   - 在「今日复习」标题行加两个按钮：`全部展开` / `全部收起`；
   - 状态存组件内（默认全部收起 → 只显示英文），点击单张卡片仍可单独展开。

---

## 验收清单（做完必须逐条自检）

```powershell
cd C:\teefs_work\next_js_pj\english-daily
pnpm lint
pnpm build
node scripts/db-status.cjs          # 看 users / lessons / word_progress / tasks
node scripts/lock-check.mjs         # 并发触发只跑一次
```
线上自检（浏览器打开 https://english.lulunote.top）：
- [ ] 复习卡默认只显示英文，点开才见释义与例句
- [ ] 句子卡比单词卡更紧凑
- [ ] 单词 / 句子 / 短文 / 对话的喇叭都固定在文本右侧
- [ ] 语速滑块默认值 0.85，播放变慢
- [ ] 复习条数 ≥ 新词条数
- [ ] 「全部展开 / 全部收起」可用
- [ ] 连续记住 3 次的词，次日不再出现在复习区

## 提交与部署

```powershell
git add -A
git -c user.name="teefs" -c user.email="teefsjiang@gmail.com" commit -m "feat: rework review cards and expand vocabulary generation"
$token = (Get-Content .env | Where-Object { $_ -match '^VERCEL_TOKEN=' }) -replace '^VERCEL_TOKEN=','' -replace '"',''
node scripts/vercel-env.mjs        # 同步 MINIMAX_VOICE_SPEED=0.85
npx vercel deploy --prod --yes --token $token
git push
```
