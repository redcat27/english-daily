import { cookies } from "next/headers";
import { SESSION_COOKIE, isUserKey } from "@/lib/users";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const user = body?.user;
  if (!isUserKey(user)) {
    return Response.json({ ok: false, error: "unknown user" }, { status: 400 });
  }
  const store = await cookies();
  store.set(SESSION_COOKIE, user, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  return Response.json({ ok: true, user });
}

