import { test, expect } from "@playwright/test";

test.beforeEach(async ({ context, page }) => {
  await context.addCookies([{ name: "english_user", value: "teefs", domain: "127.0.0.1", path: "/" }]);
  await page.addInitScript(() => {
    const state = { inClick: false, spoken: [] as { text: string; inClick: boolean }[], failNext: false, current: null as SpeechSynthesisUtterance | null };
    Object.defineProperty(window, "__audioTest", { value: state });
    document.addEventListener("click", () => {
      state.inClick = true;
      setTimeout(() => { state.inClick = false; }, 0);
    }, true);
    Object.defineProperty(window, "SpeechSynthesisUtterance", {
      value: class { text: string; constructor(text: string) { this.text = text; } },
    });
    Object.defineProperty(window, "speechSynthesis", { value: {
      getVoices: () => [],
      cancel: () => { state.current = null; },
      resume() {},
      speak(utterance: SpeechSynthesisUtterance) {
        state.spoken.push({ text: utterance.text, inClick: state.inClick });
        state.current = utterance;
        setTimeout(() => {
          if (state.failNext || !state.inClick && !state.spoken.at(-1)?.inClick) {
            state.failNext = false;
            utterance.onerror?.({ error: "not-allowed" } as SpeechSynthesisErrorEvent);
          } else {
            utterance.onstart?.(new Event("start") as SpeechSynthesisEvent);
          }
        }, 10);
      },
    } });
    // 测试无视实际声音设备，模拟浏览器拒绝异步 HTMLAudioElement.play()。
    HTMLMediaElement.prototype.play = () => Promise.reject(new DOMException("Gesture required", "NotAllowedError"));
  });
});

test("iPhone words, dialogue and full article speak inside the click without the cloud TTS endpoint", async ({ page }, info) => {
  test.skip(info.project.name !== "iPhone WebKit");
  let requests = 0;
  await page.route("**/api/tts", async (route) => { requests++; await route.fulfill({ status: 502, body: "unavailable" }); });
  await page.goto("/");
  const word = page.locator(".word").first();
  await word.locator(".word-top").click();
  await word.getByRole("button", { name: "朗读", exact: true }).click();
  await expect(word.getByRole("button", { name: "停止朗读" })).toBeVisible();
  const line = page.locator(".line").first();
  await line.getByRole("button", { name: "朗读", exact: true }).click();
  await expect(word.getByRole("button", { name: "朗读", exact: true })).toBeVisible();
  await expect(line.getByRole("button", { name: "停止朗读" })).toBeVisible();
  await page.getByRole("button", { name: "通读全文" }).click();
  await expect(page.getByRole("button", { name: "停止朗读" })).toHaveCount(1);
  const spoken = await page.evaluate(() => Reflect.get(window, "__audioTest").spoken as { text: string; inClick: boolean }[]);
  expect(spoken).toHaveLength(3);
  expect(spoken.every((item) => item.inClick)).toBe(true);
  expect(spoken[0].text).toBe("menu");
  expect(spoken[2].text.length).toBeGreaterThan(100);
  expect(requests).toBe(0);
  await page.getByRole("button", { name: "停止朗读" }).click();
  await expect(page.getByRole("button", { name: "通读全文" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("iPhone speech rejection shows a recoverable error and an explicit new-gesture retry", async ({ page }, info) => {
  test.skip(info.project.name !== "iPhone WebKit");
  await page.goto("/");
  await page.evaluate(() => { Reflect.get(window, "__audioTest").failNext = true; });
  const word = page.locator(".word").first();
  await word.locator(".word-top").click();
  await word.getByRole("button", { name: "朗读", exact: true }).click();
  await expect(word.getByRole("status")).toContainText("未能播放");
  await word.getByRole("button", { name: "使用系统朗读" }).click();
  await expect(word.getByRole("button", { name: "停止朗读" })).toBeVisible();
});

test("desktop cloud failure offers direct system speech and remembers the unavailable service", async ({ page }, info) => {
  test.skip(info.project.name !== "Desktop Chromium");
  let requests = 0;
  await page.route("**/api/tts", async (route) => { requests++; await route.fulfill({ status: 502, contentType: "application/json", body: "{}" }); });
  await page.goto("/");
  const word = page.locator(".word").first();
  await word.locator(".word-top").click();
  await word.getByRole("button", { name: "朗读", exact: true }).click();
  await expect(word.getByRole("status")).toContainText("自然人声暂不可用");
  await word.getByRole("button", { name: "使用系统朗读" }).click();
  await expect(word.getByRole("button", { name: "停止朗读" })).toBeVisible();
  const next = page.locator(".word").nth(1);
  await next.locator(".word-top").click();
  await next.getByRole("button", { name: "朗读", exact: true }).click();
  await expect(next.getByRole("button", { name: "停止朗读" })).toBeVisible();
  expect(requests).toBe(1);
});

test("desktop blocked mp3 playback exposes the error rather than swallowing play rejection", async ({ page }, info) => {
  test.skip(info.project.name !== "Desktop Chromium");
  await page.route("**/api/tts", async (route) => route.fulfill({ status: 200, contentType: "audio/mpeg", body: Buffer.from("test-audio") }));
  await page.goto("/");
  const word = page.locator(".word").first();
  await word.locator(".word-top").click();
  await word.getByRole("button", { name: "朗读", exact: true }).click();
  await expect(word.getByRole("status")).toContainText("播放未启动");
  await word.getByRole("button", { name: "使用系统朗读" }).click();
  await expect(word.getByRole("button", { name: "停止朗读" })).toBeVisible();
});
