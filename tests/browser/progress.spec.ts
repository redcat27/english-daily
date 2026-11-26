import { test, expect } from "@playwright/test";
import { FALLBACK_LESSON } from "../../src/lib/lesson";

const tomorrow = { dayIndex: 2, scene: "餐厅", title: "下一课", words: 8, date: "2026-11-27", revision: "1234567890abcdef", payload: FALLBACK_LESSON };

test("generating the next lesson previews Day 2 without changing the current Day 1", async ({ context, page }) => {
  await context.addCookies([{ name: "english_user", value: "teefs", domain: "127.0.0.1", path: "/" }]);
  await page.route("**/api/feedback", (route) => route.fulfill({ status: 201, json: { ok: true, saved: true } }));
  let generated = false;
  let submissions = 0;
  await page.route("**/api/next-preview", (route) => {
    if (route.request().method() === "POST") { submissions++; generated = true; }
    return route.fulfill({ json: generated
      ? { ok: true, status: "done", tomorrow }
      : { ok: true, status: "idle" } });
  });
  await page.goto("/");
  await expect(page.locator(".hero .scene")).toContainText("Day 1");
  await page.getByRole("button", { name: "提交反馈，生成明天的课" }).click();
  await expect(page.getByText("明天 · Day 2", { exact: true })).toBeVisible();
  await expect(page.locator(".hero .scene")).toContainText("Day 1");
  await expect(page.getByRole("button", { name: "Day 2 已生成，无需重复提交" })).toBeDisabled();
  await page.getByText("预览明天课程", { exact: true }).click();
  await expect(page.getByText(`${FALLBACK_LESSON.words[0].word}：${FALLBACK_LESSON.words[0].meaning}`, { exact: true })).toBeVisible();
  await page.getByLabel("调整明天课程").fill("机场托运行李");
  await expect(page.getByRole("button", { name: "按提示词重新生成明天课程" })).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(submissions).toBe(1);
  await page.reload();
  await expect(page.locator(".hero .scene")).toContainText("Day 1");
  await expect(page.getByText("明天 · Day 2", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Day 2 已生成，无需重复提交" })).toBeDisabled();
  expect(submissions).toBe(1);
});

test("reopening the page resumes a running next-lesson task without a new submission", async ({ context, page }) => {
  await context.addCookies([{ name: "english_user", value: "groot", domain: "127.0.0.1", path: "/" }]);
  let polls = 0;
  let posts = 0;
  await page.route("**/api/next-preview**", (route) => {
    if (route.request().method() === "POST") posts++;
    polls++;
    return route.fulfill({ json: polls === 1 ? { ok: true, status: "running", task: "next:lesson-1" }
      : { ok: true, status: "done", tomorrow } });
  });
  await page.goto("/");
  await expect(page.getByText("明天 · Day 2", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Day 2 已生成，无需重复提交" })).toBeDisabled();
  expect(posts).toBe(0);
  expect(polls).toBe(2);
});
