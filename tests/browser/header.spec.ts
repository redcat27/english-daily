import { test, expect } from "@playwright/test";

test("header keeps a circular avatar, aligned controls and readable labels on narrow screens", async ({ context, page }, info) => {
  await context.addCookies([{ name: "english_user", value: "groot", domain: "127.0.0.1", path: "/" }]);
  await page.route("**/api/next-preview", (route) => route.fulfill({ json: { ok: true, status: "idle" } }));
  await page.goto("/");
  for (const width of [320, 390, 768]) {
    await page.setViewportSize({ width, height: 844 });
    const header = page.locator("header.top");
    const chip = header.locator(".user-chip");
    const theme = header.getByRole("button", { name: "切换主题" });
    const avatar = chip.locator(".avatar");
    await expect(chip).toContainText("groot");
    await expect(avatar).toHaveText("G");
    const shape = await avatar.evaluate((element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      const radius = style.borderTopLeftRadius;
      return { width: rect.width, height: rect.height, circular: radius.endsWith("%") ? parseFloat(radius) >= 50 : parseFloat(radius) >= rect.width / 2,
        centered: style.display === "grid" && style.alignItems === "center" && style.justifyItems === "center" };
    });
    if (width === 390) await header.screenshot({ path: `.vercel/header-${info.project.name.replaceAll(" ", "-")}-dark.png` });
    expect(shape.circular).toBe(true);
    expect(shape.centered).toBe(true);
    expect(shape.width).toBe(shape.height);
    expect((await chip.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect((await theme.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    const controls = await header.locator("button").evaluateAll((buttons) => buttons.map((button) => {
      const { x, y, width, height } = button.getBoundingClientRect();
      return { x, y, width, height };
    }));
    expect(controls[0].y + controls[0].height / 2).toBeCloseTo(controls[1].y + controls[1].height / 2, 0);
    expect(controls[0].x + controls[0].width).toBeLessThanOrEqual(controls[1].x);
    expect(await header.evaluate((element) => element.scrollWidth <= window.innerWidth)).toBe(true);
    await theme.click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    if (width === 390) await header.screenshot({ path: `.vercel/header-${info.project.name.replaceAll(" ", "-")}-light.png` });
    await theme.click();
  }
  await page.locator(".user-chip").focus();
  await expect(page.locator(".user-chip")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByText("切换学习者", { exact: true })).toBeVisible();
  await expect(page.locator(".ucard .avatar").first()).toHaveCSS("border-radius", "50%");
});
