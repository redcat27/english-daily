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
  const result = body?.result === "know" ? "know" : "forgot";
  if (!word) return Response.json({ ok: false, error: "word required" }, { status: 400 });

  const next = await gradeWord(user, word, result);
  return Response.json({ ok: true, next });
}
