import { after } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE, isUserKey } from "@/lib/users";
import { acquireTask, buildTomorrowLesson, completeTask, ensureUser, failTask, getTask, lessonSummary } from "@/lib/data";
import { getPrisma, isDatabaseConfigured } from "@/lib/db";
import { addDays, startOfUtcDay } from "@/lib/srs";
import { isCompleteLesson, type LessonPayload } from "@/lib/lesson";

export const maxDuration = 120;

async function context(request: Request) {
  const key = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!isUserKey(key)) return { response: Response.json({ ok: false, error: "no session" }, { status: 401 }) };
  if (!isDatabaseConfigured()) return { response: Response.json({ ok: false, error: "数据库未配置" }, { status: 503 }) };
  const user = await ensureUser(key);
  if (!user) throw new Error("用户未创建");
  const url = new URL(request.url);
  const today = url.searchParams.get("day") === "today";
  const taskKey = (request.method === "GET" ? url.searchParams.get("task") : null) || `${today ? "today" : "next"}:${addDays(startOfUtcDay(), today ? 0 : 1).toISOString().slice(0, 10)}`;
  if (!/^(today|next):\d{4}-\d{2}-\d{2}$/.test(taskKey)) return { response: Response.json({ ok: false, error: "invalid task" }, { status: 400 }) };
  const date = new Date(`${taskKey.split(":")[1]}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime())) return { response: Response.json({ ok: false, error: "invalid date" }, { status: 400 }) };
  const lesson = await getPrisma().dailyLesson.findUnique({ where: { userId_date: { userId: user.id, date } } });
  return { key, userId: user.id, taskKey, date, lesson: lesson && isCompleteLesson(lesson.payload) ? lesson : null };
}

function ready(payload: unknown) {
  const lesson = lessonSummary(payload as LessonPayload);
  return Response.json({ ok: true, status: "done", lesson, tomorrow: lesson });
}

export async function POST(request: Request) {
  try {
    const current = await context(request);
    if (current.response) return current.response;
    if (current.lesson) return ready(current.lesson.payload);
    const { key, userId, taskKey, date } = current;
    const claim = await acquireTask(userId, taskKey);
    if (claim.acquired) {
      after(async () => {
        try {
          const lesson = await buildTomorrowLesson(key, date);
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
    if (current.lesson) return ready(current.lesson.payload);
    const task = await getTask(current.userId, current.taskKey);
    return Response.json({ ok: task?.status !== "failed", status: task?.status ?? "idle", error: task?.error || undefined }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return Response.json({ ok: false, error: "暂时无法查询生成状态。" }, { status: 503 });
  }
}
