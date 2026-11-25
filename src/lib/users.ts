export type UserKey = "teefs" | "groot";

export type Learner = {
  key: UserKey;
  name: string;
  gender: "男" | "女";
  initial: string;
  level: string;
};

export const LEARNERS: Record<UserKey, Learner> = {
  teefs: { key: "teefs", name: "teefs", gender: "男", initial: "T", level: "A2" },
  groot: { key: "groot", name: "groot", gender: "女", initial: "G", level: "A2" },
};

export const USER_KEYS = Object.keys(LEARNERS) as UserKey[];

export function isUserKey(value: unknown): value is UserKey {
  return typeof value === "string" && (USER_KEYS as string[]).includes(value);
}

export const SESSION_COOKIE = "english_user";
