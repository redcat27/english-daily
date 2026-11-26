import { cookies } from "next/headers";
import { SESSION_COOKIE, isUserKey, LEARNERS } from "@/lib/users";
import { getTodayData } from "@/lib/data";
import LessonApp from "@/components/lesson-app";

export const maxDuration = 120;

export default async function Home() {
  const store = await cookies();
  const cookie = store.get(SESSION_COOKIE)?.value;
  const user = isUserKey(cookie) ? cookie : null;

  const data = user ? await getTodayData(user) : null;
  const key = `${user ?? "anon"}-${data?.lessonPending ? "preparing" : data ? "ready" : "none"}`;
  return <LessonApp key={key} user={user ? LEARNERS[user] : null} data={data} />;
}
