const { test, expect } = require("@playwright/test");
const { mkdirSync } = require("node:fs");

const viewports = [
  { name: "small-phone", width: 320, height: 700 },
  { name: "iphone-se", width: 375, height: 667 },
  { name: "iphone-regular", width: 390, height: 844 },
  { name: "iphone-large", width: 430, height: 932 },
  { name: "android-large", width: 480, height: 900 },
  { name: "small-tablet", width: 768, height: 1024 },
  { name: "ipad-portrait", width: 820, height: 1180 },
  { name: "ipad-landscape", width: 1024, height: 768 },
  { name: "small-laptop", width: 1280, height: 800 },
  { name: "laptop", width: 1440, height: 900 },
  { name: "monitor", width: 1920, height: 1080 },
];

test.beforeAll(() => mkdirSync("test-results/screenshots", { recursive: true }));

for (const size of viewports) {
  test(size.name + ": all domain navigation and layout", async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: size.width, height: size.height },
      deviceScaleFactor: size.width <= 480 ? 2 : 1,
      isMobile: size.width <= 480,
      hasTouch: size.width <= 900,
    });
    const page = await context.newPage();
    await page.goto("/work", { waitUntil: "domcontentloaded", timeout: 60000 });
    const nav = page.getByRole("navigation", { name: "JARVIS domain navigation" });
    await expect(nav).toBeVisible({ timeout: 30_000 });
    await expect(nav.getByRole("button")).toHaveCount(4);

    for (const domain of ["TRADING", "FINANCE", "SENTRYOPS", "LIFE"]) {
      const button = nav.getByRole("button", { name: domain, exact: true });
      await button.click();
      await expect(button).toHaveAttribute("aria-current", "page");
      const geometry = await page.evaluate(() => {
        const root = document.documentElement;
        const center = document.querySelector(".center-core");
        const navigation = center?.querySelector(":scope > nav.domain-switcher");
        const content = [...(center?.children || [])].find(el =>
          el !== navigation && !el.matches(".command-label,.command-box"));
        const navRect = navigation?.getBoundingClientRect();
        const contentRect = content?.getBoundingClientRect();
        const centerRect = center?.getBoundingClientRect();
        const leftRect = document.querySelector(".left-column")?.getBoundingClientRect();
        const rightRect = document.querySelector(".right-column")?.getBoundingClientRect();
        return {
          docWidth: Math.max(root.scrollWidth, document.body.scrollWidth),
          windowWidth: window.innerWidth,
          navAtTop: Boolean(navRect && contentRect && navRect.top <= contentRect.top && navRect.bottom <= contentRect.top + 3),
          centerWithinViewport: Boolean(centerRect && centerRect.left >= -2 && centerRect.right <= window.innerWidth + 2),
          columnsVerticallyOrdered: !centerRect || !leftRect || !rightRect ||
            (centerRect.bottom <= leftRect.top + 3 && leftRect.bottom <= rightRect.top + 3),
        };
      });
      expect(geometry.docWidth - geometry.windowWidth, domain + " causes horizontal overflow at " + size.width + ": " + JSON.stringify(geometry)).toBeLessThanOrEqual(4);
      expect(geometry.navAtTop, domain + " navigation overlaps content: " + JSON.stringify(geometry)).toBe(true);
      expect(geometry.centerWithinViewport, domain + " center exceeds viewport").toBe(true);
      if (size.width <= 900) {
        expect(geometry.columnsVerticallyOrdered, domain + " mobile columns overlap").toBe(true);
      }
    }

    await nav.getByRole("button", { name: "SENTRYOPS", exact: true }).click();
    const frame = page.frameLocator('iframe[title="Actual SentryOps public marketing homepage before sign in"]');
    await expect(frame.getByRole("heading", { name: /Central Hub for/i })).toBeVisible({ timeout: 30_000 });
    // The original deployed stylesheet must apply; merely loading unstyled text
    // is not a successful public marketing preview.
    await expect.poll(async () => frame.locator(".min-h-screen").evaluate(
      node => getComputedStyle(node).backgroundImage
    ), { timeout: 30_000 }).toContain("linear-gradient");
    await expect(frame.locator(".jarvis-global-controls")).toHaveCount(0);
    await page.screenshot({ path: "test-results/screenshots/" + size.name + "-sentryops.png", fullPage: true });
    await context.close();
  });
}
