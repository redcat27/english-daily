// Leitner 间隔重复：盒子等级决定下次复习间隔。
// 记住了 -> 升盒；没记住 -> 退回第 1 盒；连续记住 3 次 -> 毕业，不再推送。

export const INTERVALS = [1, 2, 4, 7, 15, 30];
export const GRADUATE_HITS = 3;

export type GradeResult = "know" | "forgot";

export type SrsState = {
  box: number;
  hits: number;
  misses: number;
  graduated: boolean;
};

export function intervalFor(box: number): number {
  return INTERVALS[Math.min(Math.max(box, 1), INTERVALS.length) - 1];
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

export function startOfUtcDay(date: Date = new Date()): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function grade(
  current: SrsState,
  result: GradeResult,
  today: Date = new Date()
): SrsState & { dueDate: Date } {
  let box = current.box;
  let hits = current.hits;
  let misses = current.misses;

  if (result === "know") {
    hits += 1;
    box = Math.min(box + 1, INTERVALS.length);
  } else {
    misses += 1;
    hits = 0;
    box = 1;
  }

  const graduated = hits >= GRADUATE_HITS;
  if (graduated) box = INTERVALS.length;

  return {
    box,
    hits,
    misses,
    graduated,
    dueDate: addDays(startOfUtcDay(today), graduated ? 365 : intervalFor(box)),
  };
}
