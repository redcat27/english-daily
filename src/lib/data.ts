// 服务端数据层：课程、复习池（SRS）、反馈。
// 数据库没配好时全部走兜底内容，站点依然可用。
import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { getPrisma, isDatabaseConfigured } from "./db";
import { LEARNERS, type UserKey } from "./users";
import { grade, startOfUtcDay, addDays, type GradeResult } from "./srs";
import { FALLBACK_LESSON, generateLesson, isCompleteLesson, type LessonPayload } from "./lesson";

export type ReviewWord = {
  word: string;
  phonetic: string;
  pos: string;
  meaning: string;
  example: string;
  exampleCn: string;
  box: number;
  hits: number;
  misses: number;
  graduated: boolean;
  dueDate: string;
};

export type TodayData = {
  lesson: LessonPayload;
  dayIndex: number;
  /** 默认播报语速（用户可在页面上调整） */
  audioDefaultSpeed: number;
  lessonId?: string;
  nextLesson?: ReturnType<typeof previewLesson>;
  lessonWarning?: string;
  lessonPending?: boolean;
  review: ReviewWord[];
  stats: {
    streak: number;
    totalDays: number;
    knownWords: number;
    learningWords: number;
    graduatedWords: number;
    dueToday: number;
  };
};

export function dayKey(date: Date = new Date()): Date {
  // 学习日按北京时间切换；数据库 DATE 仍用 UTC 午夜表示日期键。
  return startOfUtcDay(new Date(date.getTime() + 8 * 60 * 60 * 1000));
}

function toIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export async function ensureUser(key: UserKey) {
  if (!isDatabaseConfigured()) return null;
  const prisma = getPrisma();
  const learner = LEARNERS[key];
  return prisma.user.upsert({
    where: { key },
    update: {},
    create: { key, name: learner.name, gender: learner.gender, level: learner.level },
  });
}

/** 外键用的是用户 id（cuid），不是 key（teefs/groot） */
async function userIdOf(key: UserKey): Promise<string> {
  const user = await ensureUser(key);
  return user ? user.id : key;
}

export async function getRecentFeedback(key: UserKey) {
  if (!isDatabaseConfigured()) return [];
  const prisma = getPrisma();
  const userId = await userIdOf(key);
  const rows = await prisma.feedback.findMany({
    where: { userId },
    orderBy: { date: "desc" },
    take: 10,
  });
  return rows.map((row) => ({
    date: toIso(row.date),
    shadowing: row.shadowing,
    reading: row.reading,
    note: row.note,
  }));
}

export async function getRecentScenes(key: UserKey): Promise<string[]> {
  if (!isDatabaseConfigured()) return [];
  const prisma = getPrisma();
  const userId = await userIdOf(key);
  const rows = await prisma.dailyLesson.findMany({
    where: { userId },
    orderBy: { date: "desc" },
    take: 6,
  });
  return rows.map((row) => row.scene);
}

export function pickDifficulty(feedback: { shadowing: number; reading: number }[]): "up" | "base" | "down" {
  if (feedback.length < 2) return "base";
  const recent = feedback.slice(0, 2);
  const avg = recent.reduce((sum, f) => sum + (f.shadowing + f.reading) / 2, 0) / recent.length;
  if (avg >= 85) return "up";
  if (avg <= 65) return "down";
  return "base";
}

async function createLessonFor(
  key: UserKey,
  date: Date,
  dayIndex: number,
  instruction?: string
): Promise<LessonPayload> {
  const [feedback, dueWords, recentScenes] = await Promise.all([
    getRecentFeedback(key), getDueWords(key, 12), getRecentScenes(key),
  ]);
  const learner = LEARNERS[key];

  const payload = await generateLesson({
    learner: { name: learner.name, level: learner.level },
    feedback,
    dueWords: dueWords.map((w) => ({ word: w.word, meaning: w.meaning, hits: w.hits, misses: w.misses })),
    recentScenes,
    difficulty: pickDifficulty(feedback),
    instruction,
  });

  if (isDatabaseConfigured()) {
    const prisma = getPrisma();
    const userId = await userIdOf(key);
    await prisma.$transaction(async (tx) => {
      if (instruction && date.getTime() <= dayKey().getTime()) throw new Error("课程已开始学习，不能再改写。");
      await tx.dailyLesson.upsert({
        where: { userId_date: { userId, date } },
        update: {
          payload: payload as unknown as Prisma.InputJsonValue,
          scene: payload.scene,
          title: payload.title,
          dayIndex,
          revision: { increment: 1 },
          level: payload.level,
        },
        create: {
          userId,
          date,
          dayIndex,
          scene: payload.scene,
          title: payload.title,
          level: payload.level,
          payload: payload as unknown as Prisma.InputJsonValue,
        },
      });
    }, { timeout: 15000 });
  }

  return payload;
}

async function seedWords(prisma: Prisma.TransactionClient, userId: string, payload: LessonPayload, lessonDate: Date) {
  const tomorrow = addDays(lessonDate, 1);
  const entries = [
    ...payload.words.map((w) => ({
      word: w.word,
      phonetic: w.phonetic ?? "",
      pos: w.pos ?? "",
      meaning: w.meaning ?? "",
      example: w.example ?? "",
      exampleCn: w.exampleCn ?? "",
    })),
    ...payload.reviewSentences.map((s) => ({
      word: s.en,
      phonetic: "",
      pos: "句子",
      meaning: s.cn,
      example: s.source ? `场景：${s.source}` : "",
      exampleCn: "",
    })),
  ];
  for (const item of entries) {
    if (!item.word) continue;
    await prisma.wordProgress.upsert({
      where: { userId_word: { userId, word: item.word } },
      update: {},
      create: {
        userId,
        word: item.word,
        phonetic: item.phonetic,
        pos: item.pos,
        meaning: item.meaning,
        example: item.example,
        exampleCn: item.exampleCn,
        scene: payload.scene,
        box: 1,
        hits: 0,
        misses: 0,
        dueDate: tomorrow,
      },
    });
  }
}

export async function getDueWords(key: UserKey, limit = 20): Promise<ReviewWord[]> {
  if (!isDatabaseConfigured()) return [];
  const prisma = getPrisma();
  const userId = await userIdOf(key);
  const today = dayKey();
  const rows = await prisma.wordProgress.findMany({
    where: { userId, graduated: false, dueDate: { lte: today } },
    orderBy: [{ dueDate: "asc" }, { box: "asc" }],
    take: limit,
  });
  return rows.map((row) => ({
    word: row.word,
    phonetic: row.phonetic,
    pos: row.pos,
    meaning: row.meaning,
    example: row.example,
    exampleCn: row.exampleCn,
    box: row.box,
    hits: row.hits,
    misses: row.misses,
    graduated: row.graduated,
    dueDate: toIso(row.dueDate),
  }));
}


// ---------------- 任务锁：防止同一个生成任务被重复触发 ----------------

const TASK_STALE_MS = 5 * 60 * 1000;

export type GenerationTaskState = {
  status: "running" | "done" | "failed";
  summary: string;
  error: string;
};

/** 抢占任务锁：同一 (user, taskKey) 只有一个调用方能拿到 acquired=true */
export async function acquireTask(
  userId: string,
  taskKey: string
): Promise<{ acquired: boolean; task: GenerationTaskState | null }> {
  const prisma = getPrisma();
  const now = new Date();
  const existing = await prisma.generationTask.findUnique({
    where: { userId_taskKey: { userId, taskKey } },
  });

  if (existing) {
    const running = existing.status === "running";
    const stale = now.getTime() - existing.startedAt.getTime() > TASK_STALE_MS;
    if (running && !stale) {
      return { acquired: false, task: { status: "running", summary: existing.summary, error: existing.error } };
    }
    // 调用方已经确认没有完整课程；失败、残缺结果或僵死任务可以重新抢占。
    const claimed = await prisma.generationTask.updateMany({
      where: { id: existing.id, status: existing.status, startedAt: existing.startedAt },
      data: { status: "running", startedAt: now, finishedAt: null, error: "", summary: "" },
    });
    return { acquired: claimed.count === 1, task: { status: "running", summary: "", error: "" } };
  }

  try {
    await prisma.generationTask.create({ data: { userId, taskKey, status: "running" } });
    return { acquired: true, task: { status: "running", summary: "", error: "" } };
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
    // 唯一约束冲突：别的请求刚创建
    const task = await prisma.generationTask.findUnique({
      where: { userId_taskKey: { userId, taskKey } },
    });
    return {
      acquired: false,
      task: task
        ? { status: task.status as GenerationTaskState["status"], summary: task.summary, error: task.error }
        : null,
    };
  }
}

export async function completeTask(userId: string, taskKey: string, summary: string) {
  const prisma = getPrisma();
  await prisma.generationTask.update({
    where: { userId_taskKey: { userId, taskKey } },
    data: { status: "done", finishedAt: new Date(), summary: summary.slice(0, 400), error: "" },
  });
}

export async function failTask(userId: string, taskKey: string, error: string) {
  const prisma = getPrisma();
  await prisma.generationTask.update({
    where: { userId_taskKey: { userId, taskKey } },
    data: { status: "failed", finishedAt: new Date(), error: error.slice(0, 300) },
  });
}

export async function getTask(userId: string, taskKey: string): Promise<GenerationTaskState | null> {
  if (!isDatabaseConfigured()) return null;
  const prisma = getPrisma();
  const task = await prisma.generationTask.findUnique({
    where: { userId_taskKey: { userId, taskKey } },
  });
  if (!task) return null;
  if (task.status === "running" && Date.now() - task.startedAt.getTime() > TASK_STALE_MS) {
    return { status: "failed", summary: "", error: "生成任务已超时，请重试。" };
  }
  return { status: task.status as GenerationTaskState["status"], summary: task.summary, error: task.error };
}

export function lessonSummary(lesson: LessonPayload) {
  return {
    scene: lesson.scene,
    title: lesson.title,
    words: lesson.words.length,
    lines: lesson.dialogue.lines.length,
    paras: lesson.article.paras.length,
  };
}

export function previewLesson(row: { payload: unknown; dayIndex: number; date: Date; revision?: number }) {
  const payload = row.payload as LessonPayload;
  return { ...lessonSummary(payload), dayIndex: row.dayIndex, date: toIso(row.date), payload,
    revision: createHash("sha256").update(`${row.revision ?? 0}:${JSON.stringify(payload)}`).digest("hex").slice(0, 16) };
}

// date 是课程可开始学习的日期；Day 是课程序号，不能由自然日或反馈条数推算。
export async function getCurrentLesson(key: UserKey, date = dayKey()) {
  if (!isDatabaseConfigured()) return null;
  const userId = await userIdOf(key);
  const row = await getPrisma().dailyLesson.findUnique({ where: { userId_date: { userId, date } } });
  return row && row.dayIndex > 0 && isCompleteLesson(row.payload) ? row : null;
}

export async function canGenerateNextLesson(key: UserKey, date = dayKey()) {
  const current = await getCurrentLesson(key, date);
  if (!current) return false;
  const userId = await userIdOf(key);
  const feedback = await getPrisma().feedback.findFirst({
    where: { userId, date: { gte: current.date, lte: date } },
  });
  return Boolean(feedback);
}

export async function getNextLesson(key: UserKey, source: { dayIndex: number; date?: Date }) {
  if (!isDatabaseConfigured()) return null;
  const userId = await userIdOf(key);
  const date = addDays(source.date ?? dayKey(), 1);
  const row = await getPrisma().dailyLesson.findUnique({ where: { userId_date: { userId, date } } });
  return row?.dayIndex === source.dayIndex + 1 && isCompleteLesson(row.payload) ? row : null;
}


/**
 * 存储策略：情景对话、今日短文这类"当天内容"只保留当天与第二天。
 * 更早的课程只留一个极小的占位（保留 Day 序号与场景列），不再保存对话/短文正文，
 * 历史学习数据只以单词进度（word_progress）与反馈（feedbacks）形式保留纯文本。
 */
export async function pruneOldLessons(userId: string) {
  if (!isDatabaseConfigured()) return 0;
  const prisma = getPrisma();
  const cutoff = addDays(dayKey(), 1); // 当天与第二天都保留
  const result = await prisma.dailyLesson.updateMany({
    where: { userId, dayIndex: { gt: 0 }, date: { lt: cutoff } },
    data: { payload: { archived: true } as unknown as Prisma.InputJsonValue },
  });
  return result.count;
}

export async function getTodayData(key: UserKey): Promise<TodayData> {
  let lesson = FALLBACK_LESSON;
  let dayIndex = 1;
  let lessonWarning: string | undefined;
  let lessonPending = false;
  let lessonId: string | undefined;
  let nextLesson: TodayData["nextLesson"];

  if (isDatabaseConfigured()) {
    // 只保留当天与第二天的课程内容，历史对话/短文不再保存
    const userId = await userIdOf(key);
    await pruneOldLessons(userId);
    const existing = await getCurrentLesson(key);
    if (existing) {
      lesson = existing.payload as unknown as LessonPayload;
      dayIndex = existing.dayIndex;
      lessonId = existing.id;
      // 只在课程成为当前课后加入复习池；预览或反复改写明天课程不计入学习记录。
      await seedWords(getPrisma(), existing.userId, existing.payload as unknown as LessonPayload, existing.date);
      const next = await getNextLesson(key, existing);
      if (next) nextLesson = previewLesson(next);
    } else {
      const latest = await getPrisma().dailyLesson.findFirst({ where: { userId, dayIndex: { gt: 0 }, date: { lt: dayKey() } }, orderBy: { date: "desc" } });
      dayIndex = latest?.dayIndex ?? 1;
      lessonPending = true;
      lessonWarning = "今日课程正在准备，以下暂为体验课程；完成后将自动更新。";
    }
  }

  const review = await getDueWords(key, 20);
  const stats = await getStats(key);
  const audioDefaultSpeed = Math.max(0.6, Math.min(1.4, Number(process.env.MINIMAX_VOICE_SPEED) || 1));
  return { lesson, dayIndex, audioDefaultSpeed, lessonId, nextLesson, lessonWarning, lessonPending, review, stats };
}

export async function getStats(key: UserKey) {
  const empty = {
    streak: 0,
    totalDays: 0,
    knownWords: 0,
    learningWords: 0,
    graduatedWords: 0,
    dueToday: 0,
  };
  if (!isDatabaseConfigured()) return empty;
  const prisma = getPrisma();
  const userId = await userIdOf(key);
  const today = dayKey();

  const feedbacks = await prisma.feedback.findMany({
    where: { userId },
    orderBy: { date: "desc" },
    take: 60,
  });
  const wordRows = await prisma.wordProgress.findMany({
    where: { userId },
    select: { graduated: true, hits: true, dueDate: true },
  });

  // 连续学习天数：从今天（或昨天）往回数连续的自然日
  const studied = new Set(feedbacks.map((row) => toIso(row.date)));
  let streak = 0;
  let cursor = studied.has(toIso(today)) ? today : addDays(today, -1);
  while (studied.has(toIso(cursor))) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }

  return {
    streak,
    totalDays: feedbacks.length,
    knownWords: wordRows.filter((w) => w.hits > 0 && !w.graduated).length,
    learningWords: wordRows.filter((w) => w.hits === 0).length,
    graduatedWords: wordRows.filter((w) => w.graduated).length,
    dueToday: wordRows.filter((w) => !w.graduated && w.dueDate.getTime() <= today.getTime()).length,
  };
}

export async function gradeWord(key: UserKey, word: string, result: GradeResult) {
  if (!isDatabaseConfigured()) return null;
  const prisma = getPrisma();
  const userId = await userIdOf(key);
  const row = await prisma.wordProgress.findUnique({
    where: { userId_word: { userId, word } },
  });
  if (!row) return null;

  const next = grade(
    { box: row.box, hits: row.hits, misses: row.misses, graduated: row.graduated },
    result
  );

  await prisma.wordProgress.update({
    where: { id: row.id },
    data: {
      box: next.box,
      hits: next.hits,
      misses: next.misses,
      graduated: next.graduated,
      dueDate: next.dueDate,
    },
  });

  await prisma.reviewEvent.create({
    data: {
      userId,
      word,
      result,
      boxBefore: row.box,
      boxAfter: next.box,
    },
  });

  return {
    box: next.box,
    hits: next.hits,
    misses: next.misses,
    graduated: next.graduated,
    dueDate: toIso(next.dueDate),
  };
}

export async function saveFeedback(
  key: UserKey,
  shadowing: number,
  reading: number,
  note: string
) {
  if (!isDatabaseConfigured()) throw new Error("数据库未配置");
  const prisma = getPrisma();
  const userId = await userIdOf(key);
  const today = dayKey();
  await prisma.feedback.upsert({
    where: { userId_date: { userId, date: today } },
    update: { shadowing, reading, note: note.slice(0, 500) },
    create: { userId, date: today, shadowing, reading, note: note.slice(0, 500) },
  });
}

export async function buildTodayLesson(key: UserKey): Promise<LessonPayload | null> {
  if (!isDatabaseConfigured()) return null;
  const current = await getCurrentLesson(key);
  if (current) return current.payload as unknown as LessonPayload;
  const userId = await userIdOf(key);
  const previous = await getPrisma().dailyLesson.findFirst({ where: { userId, date: { lt: dayKey() }, dayIndex: { gt: 0 } }, orderBy: { date: "desc" } });
  return createLessonFor(key, dayKey(), previous?.dayIndex ?? 1);
}

export async function buildTomorrowLesson(key: UserKey, tomorrow = addDays(dayKey(), 1), sourceId?: string): Promise<LessonPayload | null> {
  if (!isDatabaseConfigured()) return null;
  const previousDay = addDays(tomorrow, -1);
  const current = await getCurrentLesson(key, previousDay);
  if (sourceId && current?.id !== sourceId) throw new Error("当前课程已更新，请刷新页面后再提交。");
  if (!current || !await canGenerateNextLesson(key, previousDay)) throw new Error("请先完成当前课程并提交反馈。");
  const userId = await userIdOf(key);
  const prisma = getPrisma();
  const prepared = await prisma.dailyLesson.findUnique({ where: { userId_date: { userId, date: tomorrow } } });
  if (prepared && prepared.dayIndex === current.dayIndex + 1 && isCompleteLesson(prepared.payload)) return prepared.payload as unknown as LessonPayload;
  return createLessonFor(key, tomorrow, current.dayIndex + 1);
}

export async function regenerateTomorrowLesson(key: UserKey, sourceId: string, revision: string, instruction: string) {
  const current = await getCurrentLesson(key);
  if (!current || current.id !== sourceId) throw new Error("当前课程已更新，请刷新页面后再提交。");
  const next = await getNextLesson(key, current);
  if (!next || next.date.getTime() !== addDays(dayKey(), 1).getTime()) throw new Error("只能重新生成尚未开始学习的明天课程。");
  if (previewLesson(next).revision !== revision) return next.payload as unknown as LessonPayload;
  return createLessonFor(key, next.date, next.dayIndex, instruction);
}
