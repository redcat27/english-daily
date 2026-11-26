import { cookies } from "next/headers";
import { SESSION_COOKIE, isUserKey } from "@/lib/users";
import { getCurrentLesson, saveFeedback } from "@/lib/data";

// 提交反馈只负责落库，不等 AI（AI 生成放到 /api/next-preview，避免函数超时）
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const store = await cookies();
  const user = store.get(SESSION_COOKIE)?.value;
  if (!isUserKey(user)) {
    return Response.json({ ok: false, error: "no session" }, { status: 401 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return Response.json({ ok: false, error: "invalid feedback" }, { status: 400 });
  }

  const { shadowing, reading } = body;
  if (![shadowing, reading].every((score) => typeof score === "number" && Number.isInteger(score) && score >= 0 && score <= 100) || (body.note !== undefined && typeof body.note !== "string")) {
    return Response.json({ ok: false, error: "反馈分数应为 0–100 的整数" }, { status: 400 });
  }
  const note = body.note || "";

  try {
    const current = await getCurrentLesson(user);
    if (!current || body.sourceLessonId !== current.id) {
      return Response.json({ ok: false, saved: false, error: "当前课程已更新，请刷新页面后再提交。" }, { status: 409 });
    }
    await saveFeedback(user, shadowing, reading, note);
    return Response.json({ ok: true, saved: true }, { status: 201 });
  } catch {
    return Response.json({ ok: false, saved: false, error: "反馈保存失败，请稍后重试" }, { status: 503 });
  }
}

