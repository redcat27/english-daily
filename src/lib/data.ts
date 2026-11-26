// 服务端数据层：课程、复习池（SRS）、反馈。
// 数据库没配好时全部走兜底内容，站点依然可用。
import { Prisma } from "@prisma/client";
import { getPrisma, isDatabaseConfigured } from "./db";
import { LEARNERS, type UserKey } from "./users";
import { grade, startOfUtcDay, addDays, type GradeResult } from "./srs";
import { FALLBACK_LESSON, generateLesson, type LessonPayload } from "./lesson";

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

function dayKey(date: Date = new Date()): Date {
  return startOfUtcDay(date);
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
  dayIndex: number
): Promise<LessonPayload> {
  const feedback = await getRecentFeedback(key);
  const dueWords = await getDueWords(key, 30);
  const recentScenes = await getRecentScenes(key);
  const learner = LEARNERS[key];

  let payload = FALLBACK_LESSON;
  try {
    payload = await generateLesson({
      learner: { name: learner.name, level: learner.level },
      feedback,
      dueWords: dueWords.map((w) => ({ word: w.word, meaning: w.meaning, hits: w.hits, misses: w.misses })),
      recentScenes,
      difficulty: pickDifficulty(feedback),
    });
  } catch (error) {
    console.error("[lesson] AI 生成失败，使用兜底内容:", error);
  }

  if (isDatabaseConfigured()) {
    const prisma = getPrisma();
    const userId = await userIdOf(key);
    await prisma.dailyLesson.upsert({
      where: { userId_date: { userId, date } },
      update: {
        payload: payload as unknown as Prisma.InputJsonValue,
        scene: payload.scene,
        title: payload.title,
        dayIndex,
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
    await seedWords(userId, payload);
  }

  return payload;
}

async function seedWords(userId: string, payload: LessonPayload) {
  const prisma = getPrisma();
  const tomorrow = addDays(dayKey(), 1);
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

export async function getTodayData(key: UserKey): Promise<TodayData> {
  const today = dayKey();
  let lesson = FALLBACK_LESSON;
  let dayIndex = 1;

  if (isDatabaseConfigured()) {
    const prisma = getPrisma();
    const userId = await userIdOf(key);
    const existing = await prisma.dailyLesson.findUnique({
      where: { userId_date: { userId, date: today } },
    });
    if (existing) {
      lesson = existing.payload as unknown as LessonPayload;
      dayIndex = existing.dayIndex;
      // 只保留当天内容：清掉更早的课程内容，节省免费额度
      await prisma.dailyLesson.deleteMany({
        where: { userId, date: { lt: today } },
      });
    } else {
      const count = await prisma.dailyLesson.count({ where: { userId } });
      dayIndex = count + 1;
      lesson = await createLessonFor(key, today, dayIndex);
    }
  }

  const review = await getDueWords(key, 20);
  const stats = await getStats(key);
  return { lesson, review, stats };
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
  if (!isDatabaseConfigured()) return;
  const prisma = getPrisma();
  const userId = await userIdOf(key);
  const today = dayKey();
  await prisma.feedback.upsert({
    where: { userId_date: { userId, date: today } },
    update: { shadowing, reading, note: note.slice(0, 500) },
    create: { userId, date: today, shadowing, reading, note: note.slice(0, 500) },
  });
}

export async function buildTomorrowLesson(key: UserKey): Promise<LessonPayload | null> {
  if (!isDatabaseConfigured()) return null;
  const tomorrow = addDays(dayKey(), 1);
  const userId = await userIdOf(key);
  const count = await getPrisma().dailyLesson.count({ where: { userId } });
  return createLessonFor(key, tomorrow, count + 1);
}
