import { after } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE, isUserKey } from "@/lib/users";
import { acquireTask, buildTodayLesson, buildTomorrowLesson, canGenerateNextLesson, completeTask, ensureUser, failTask, getCurrentLesson, getNextLesson, getTask, lessonSummary, previewLesson, regenerateTomorrowLesson, dayKey } from "@/lib/data";
import { getPrisma, isDatabaseConfigured } from "@/lib/db";
import { addDays } from "@/lib/srs";
import { isCompleteLesson } from "@/lib/lesson";

export const maxDuration = 120;

async function context(request: Request) {
  const key = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!isUserKey(key)) return { response: Response.json({ ok: false, error: "no session" }, { status: 401 }) };
  if (!isDatabaseConfigured()) return { response: Response.json({ ok: false, error: "数据库未配置" }, { status: 503 }) };
  const user = await ensureUser(key);
  if (!user) throw new Error("用户未创建");
  const url = new URL(request.url);
  const task = request.method === "GET" ? url.searchParams.get("task") : null;
  if (task && !/^(today:\d{4}-\d{2}-\d{2}|next:[a-zA-Z0-9_-]{1,32})$/.test(task)) {
    return { response: Response.json({ ok: false, error: "invalid task" }, { status: 400 }) };
  }
  const initial = task ? task.startsWith("today:") : url.searchParams.get("day") === "today";
  const current = await getCurrentLesson(key);
  let source = current;
  if (initial && task) {
    const sourceDate = new Date(`${task.slice(6)}T00:00:00.000Z`);
    if (!Number.isFinite(sourceDate.getTime())) return { response: Response.json({ ok: false, error: "invalid task date" }, { status: 400 }) };
    source = await getCurrentLesson(key, sourceDate);
  }
  if (!initial) {
    const body = request.method !== "GET" ? await request.json().catch(() => ({})) : null;
    const sourceId = task?.slice(5) || body?.sourceLessonId;
    if (request.method !== "GET" && (typeof sourceId !== "string" || !/^[a-zA-Z0-9_-]{1,32}$/.test(sourceId))) {
      return { response: Response.json({ ok: false, error: "请刷新页面后提交当前课程。" }, { status: 409 }) };
    }
    if (sourceId) {
      const row = await getPrisma().dailyLesson.findUnique({ where: { id: sourceId } });
      source = row?.userId === user.id && row.dayIndex > 0 && isCompleteLesson(row.payload) ? row : null;
    }
    if (!source) return { response: Response.json({ ok: false, error: "请先准备当前课程。" }, { status: 409 }) };
  }
  const taskKey = task || (initial ? `today:${dayKey().toISOString().slice(0, 10)}` : `next:${source!.id}`);
  const date = initial ? source?.date ?? dayKey() : addDays(source!.date, 1);
  const lesson = initial ? source : await getNextLesson(key, source!);
  return { key, userId: user.id, taskKey, date, initial, sourceId: source?.id, stale: !initial && source?.id !== current?.id, lesson };
}

function ready(row: { payload: unknown; dayIndex: number; date: Date; revision?: number }, sourceLessonId?: string) {
  const lesson = previewLesson(row);
  return Response.json({ ok: true, status: "done", sourceLessonId, lesson, tomorrow: lesson }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  try {
    const current = await context(request);
    if (current.response) return current.response;
    if (current.lesson) return ready(current.lesson, current.sourceId);
    if (current.stale) return Response.json({ ok: false, error: "当前课程已更新，请刷新页面后再提交。" }, { status: 409 });
    if (!current.initial && !await canGenerateNextLesson(current.key)) {
      return Response.json({ ok: false, error: "请先完成当前课程并提交反馈。" }, { status: 409 });
    }
    const { key, userId, taskKey, date, initial, sourceId } = current;
    const claim = await acquireTask(userId, taskKey);
    if (claim.acquired) {
      after(async () => {
        try {
          const lesson = initial ? await buildTodayLesson(key) : await buildTomorrowLesson(key, date, sourceId);
          if (!lesson) throw new Error("课程未保存");
          await completeTask(userId, taskKey, JSON.stringify(lessonSummary(lesson)));
        } catch {
          await failTask(userId, taskKey, "课程生成暂时失败，请稍后重试；反馈已保存。");
        }
      });
    }
    return Response.json({ ok: true, status: "running", task: taskKey }, { status: 202 });
  } catch {
    return Response.json({ ok: false, error: "暂时无法启动课程生成，请稍后重试。" }, { status: 503 });
  }
}

export async function GET(request: Request) {
  try {
    const current = await context(request);
    if (current.response) return current.response;
    const task = await getTask(current.userId, current.taskKey);
    if (current.lesson && task?.status !== "running" && task?.status !== "failed") return ready(current.lesson, current.sourceId);
    const status = task?.status === "done" ? "failed" : task?.status ?? "idle";
    return Response.json({ ok: status !== "failed", status, task: current.taskKey, tomorrow: current.lesson ? previewLesson(current.lesson) : undefined,
      error: task?.error || (status === "failed" ? "课程尚未准备完成，请提交反馈后重试。" : undefined) }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return Response.json({ ok: false, error: "暂时无法查询生成状态。" }, { status: 503 });
  }
}

// 显式改写只替换尚未开始的下一课；revision 让重放同一次请求直接返回结果。
export async function PATCH(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body.sourceLessonId !== "string" || !/^[a-zA-Z0-9_-]{1,32}$/.test(body.sourceLessonId) ||
      typeof body.prompt !== "string" || !body.prompt.trim() || body.prompt.length > 500 ||
      typeof body.revision !== "string" || !/^[a-f0-9]{16}$/.test(body.revision)) {
      return Response.json({ ok: false, error: "请输入 1–500 字的课程要求，并刷新后重试。" }, { status: 400 });
    }
    const current = await context(new Request(request.url, { method: "PATCH", body: JSON.stringify(body) }));
    if (current.response) return current.response;
    if (current.initial || current.stale || !current.lesson || current.lesson.date.getTime() <= dayKey().getTime()) {
      return Response.json({ ok: false, error: "只能重新生成明天尚未开始的课程，请刷新页面。" }, { status: 409 });
    }
    if (previewLesson(current.lesson).revision !== body.revision) return ready(current.lesson, current.sourceId);
    const { userId, taskKey, key, sourceId } = current;
    const claim = await acquireTask(userId, taskKey);
    if (claim.acquired) after(async () => {
      try {
        await regenerateTomorrowLesson(key, sourceId!, body.revision, body.prompt.trim());
        await completeTask(userId, taskKey, "明天课程已按要求重新生成并保存。");
      } catch {
        await failTask(userId, taskKey, "重新生成失败，已保留原来的明天课程，可稍后重试。");
      }
    });
    return Response.json({ ok: true, status: "running", task: taskKey }, { status: 202 });
  } catch {
    return Response.json({ ok: false, error: "暂时无法重新生成，请稍后重试。" }, { status: 503 });
  }
}
