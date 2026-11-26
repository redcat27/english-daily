import { cookies } from "next/headers";
import { SESSION_COOKIE, isUserKey } from "@/lib/users";
import { saveFeedback } from "@/lib/data";

// 提交反馈只负责落库，不等 AI（AI 生成放到 /api/next-preview，避免函数超时）
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const store = await cookies();
  const user = store.get(SESSION_COOKIE)?.value;
  if (!isUserKey(user)) {
    return Response.json({ ok: false, error: "no session" }, { status: 401 });
  }

  const shadowing = Math.max(0, Math.min(100, Number(body?.shadowing) || 0));
  const reading = Math.max(0, Math.min(100, Number(body?.reading) || 0));
  const note = String(body?.note || "");

  await saveFeedback(user, shadowing, reading, note);
  return Response.json({ ok: true, saved: true });
}
