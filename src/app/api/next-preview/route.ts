import { cookies } from "next/headers";
import { SESSION_COOKIE, isUserKey } from "@/lib/users";
import { buildTomorrowLesson } from "@/lib/data";

// AI 生成明天的课：独立接口，避免和「提交反馈」绑在同一个函数的时长里
export const maxDuration = 60;

export async function POST() {
  const store = await cookies();
  const user = store.get(SESSION_COOKIE)?.value;
  if (!isUserKey(user)) {
    return Response.json({ ok: false, error: "no session" }, { status: 401 });
  }
  try {
    const tomorrow = await buildTomorrowLesson(user);
    if (!tomorrow) return Response.json({ ok: true, tomorrow: null });
    return Response.json({
      ok: true,
      tomorrow: {
        scene: tomorrow.scene,
        title: tomorrow.title,
        words: tomorrow.words.length,
        lines: tomorrow.dialogue.lines.length,
        paras: tomorrow.article.paras.length,
      },
    });
  } catch (error) {
    console.error("[next-preview] 生成失败:", error);
    return Response.json({ ok: false, error: "生成失败" }, { status: 500 });
  }
}
