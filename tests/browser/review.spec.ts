import { test, expect } from "@playwright/test";

test("a first lesson shows no due word or sentence review cards", async ({ context, page }) => {
  await context.addCookies([{ name: "english_user", value: "groot", domain: "127.0.0.1", path: "/" }]);
  await page.route("**/api/next-preview", (route) => route.fulfill({ json: { ok: true, status: "idle" } }));
  await page.goto("/");
  const section = page.locator("section").filter({ has: page.getByRole("heading", { name: "今日复习", exact: true }) });
  await expect(section.locator(".rcard")).toHaveCount(0);
  await page.getByRole("button", { name: "句子卡", exact: true }).click();
  await expect(section.locator(".rcard")).toHaveCount(0);
  await expect(section).toContainText("今天没有到期的复习句子");
  await expect(section).toContainText("0 / 0 已复习");
  await expect(page.locator(".hero .scene")).toContainText("Day 1");
});
