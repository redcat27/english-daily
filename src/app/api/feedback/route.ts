import { cookies } from "next/headers";
import { SESSION_COOKIE, isUserKey } from "@/lib/users";
import { buildTomorrowLesson, saveFeedback } from "@/lib/data";

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

  let tomorrow = null;
  try {
    tomorrow = await buildTomorrowLesson(user);
  } catch (error) {
    console.error("[feedback] 生成明天课程失败:", error);
  }

  return Response.json({
    ok: true,
    tomorrow: tomorrow
      ? { scene: tomorrow.scene, title: tomorrow.title, words: tomorrow.words.length }
      : null,
  });
}
