import { test, expect } from "@playwright/test";

test("generating the next lesson previews Day 2 without changing the current Day 1", async ({ context, page }) => {
  await context.addCookies([{ name: "english_user", value: "teefs", domain: "127.0.0.1", path: "/" }]);
  await page.route("**/api/feedback", (route) => route.fulfill({ status: 201, json: { ok: true, saved: true } }));
  await page.route("**/api/next-preview", (route) => route.fulfill({
    json: { ok: true, status: "done", tomorrow: { dayIndex: 2, scene: "餐厅", title: "下一课", words: 8 } },
  }));
  await page.goto("/");
  await expect(page.locator(".hero .scene")).toContainText("Day 1");
  await page.getByRole("button", { name: "提交反馈，生成明天的课" }).click();
  await expect(page.getByText("明天 · Day 2", { exact: true })).toBeVisible();
  await expect(page.locator(".hero .scene")).toContainText("Day 1");
  await page.getByRole("button", { name: "反馈已保存，重试或查看明天的课" }).click();
  await expect(page.getByText("明天 · Day 2", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.locator(".hero .scene")).toContainText("Day 1");
});
