import { cookies } from "next/headers";
import { SESSION_COOKIE, isUserKey } from "@/lib/users";
import { gradeWord } from "@/lib/data";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const store = await cookies();
  const user = store.get(SESSION_COOKIE)?.value;
  if (!isUserKey(user)) {
    return Response.json({ ok: false, error: "no session" }, { status: 401 });
  }
  const word = String(body?.word || "");
  const result = body?.result;
  if (!word || word.length > 80 || (result !== "know" && result !== "forgot")) return Response.json({ ok: false, error: "invalid review" }, { status: 400 });

  try {
    const next = await gradeWord(user, word, result);
    if (!next) return Response.json({ ok: false, error: "复习条目不存在" }, { status: 404 });
    return Response.json({ ok: true, next });
  } catch {
    return Response.json({ ok: false, error: "复习结果保存失败" }, { status: 503 });
  }
}

