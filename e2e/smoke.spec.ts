import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const PAGES = ["/home", "/tasks", "/shopping", "/expenses", "/expenses/new", "/expenses/insights", "/planner", "/recap", "/household", "/notifications"];

async function login(page: Page, email = "alex@example.com") {
  await page.goto("/login");
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', "password123");
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/home/);
}

/**
 * Wider than the screen? Compare with the viewport, not window.innerWidth: with phone
 * emulation the layout viewport grows to fit wide content, so innerWidth hides the overflow.
 */
async function overflows(page: Page) {
  const width = page.viewportSize()!.width;
  return page.evaluate((w) => document.documentElement.scrollWidth > w + 1, width);
}

function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("response", (r) => { if (r.status() >= 500) errors.push(`${r.status()} ${r.url()}`); });
  return errors;
}

test("every main page loads at phone width with no errors, overflow, or serious a11y issues", async ({ page }) => {
  const errors = watchErrors(page);
  await login(page);
  for (const path of PAGES) {
    const res = await page.goto(path);
    expect(res?.status(), path).toBe(200);
    expect(await overflows(page), `${path} scrolls sideways`).toBe(false);
    // @axe-core/playwright types its Page against an older playwright-core; the runtime API is the same.
    const axe = await new AxeBuilder({ page: page as unknown as ConstructorParameters<typeof AxeBuilder>[0]["page"] }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    const bad = axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(bad.map((v) => `${v.id}: ${v.nodes[0]?.target.join(" ")} :: ${v.nodes[0]?.failureSummary?.split("\n")[1] ?? ""}`), path).toEqual([]);
  }
  expect(errors).toEqual([]);
});

test("every main page fits a small phone (320 px wide)", async ({ browser, baseURL }) => {
  const page = await browser.newPage({ baseURL, viewport: { width: 320, height: 640 } });
  await login(page);
  for (const path of PAGES) {
    await page.goto(path);
    expect(await overflows(page), `${path} scrolls sideways at 320 px`).toBe(false);
  }
  await page.close();
});

test("signed-out pages: login, sign up, forgot and reset password", async ({ page }) => {
  const errors = watchErrors(page);
  for (const path of ["/login", "/signup", "/forgot-password", "/reset-password?token=nope"]) {
    const res = await page.goto(path);
    expect(res?.status(), path).toBe(200);
    const h = res!.headers();
    expect([h["x-frame-options"], h["x-content-type-options"], h["referrer-policy"], h["x-powered-by"]], path).toEqual(["DENY", "nosniff", "strict-origin-when-cross-origin", undefined]);
  }
  await page.goto("/login");
  await page.click('a:has-text("Forgot it?")');
  await expect(page).toHaveURL(/forgot-password/);
  await page.goto("/reset-password?token=" + "a".repeat(43));
  await expect(page.getByText("expired or was already used")).toBeVisible();
  expect(errors).toEqual([]);
});

test("new roommate: sign up, create a household, quick add, and log a split cost", async ({ page }) => {
  const errors = watchErrors(page);
  const email = `e2e-${Date.now()}@test.dev`;
  await page.goto("/signup");
  await page.fill('input[name="name"]', "Riley Test");
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', "password123");
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/onboarding/);
  await page.fill('input[name="name"]', "E2E Flat");
  await page.click("text=Create household");
  await page.waitForURL(/\/onboarding\/first-tasks|\/home/);

  await page.goto("/home");
  await page.fill("#qa", "oat milk x2");
  await expect(page.locator("#qa-preview")).toContainText("shopping list");
  await page.locator('form:has(#qa) button[type="submit"]').click();
  await expect(page.locator("#qa-preview")).toContainText("Added");
  await page.fill("#qa", "take out trash every Tue");
  await expect(page.locator("#qa-preview")).toContainText("every Tue");
  await page.locator('form:has(#qa) button[type="submit"]').click();
  await expect(page.locator("#qa-preview")).toContainText("Added");

  await page.goto("/shopping");
  await expect(page.getByText("Oat milk").first()).toBeVisible();
  await page.goto("/tasks?view=all");
  await expect(page.getByText("Take out trash").first()).toBeVisible();

  await page.goto("/home");
  await page.fill("#qa", "$24 pizza");
  await page.locator('form:has(#qa) button[type="submit"]').click();
  await page.waitForURL(/\/expenses\/new/);
  await expect(page.locator("#description")).toHaveValue("Pizza");
  await page.click('button:has-text("Save expense")');
  await page.waitForURL(/\/expenses\/c/);
  await expect(page.getByText("$24.00").first()).toBeVisible();
  expect(errors).toEqual([]);
});

test("roommates in one household never see another household's data", async ({ page, browser }) => {
  await login(page);
  await page.goto("/expenses");
  const firstExpense = await page.locator('a[href^="/expenses/c"]').first().getAttribute("href");
  expect(firstExpense).toBeTruthy();

  const other = await browser.newPage();
  const email = `outsider-${Date.now()}@test.dev`;
  await other.goto("/signup");
  await other.fill('input[name="name"]', "Outsider");
  await other.fill('input[name="email"]', email);
  await other.fill('input[name="password"]', "password123");
  await other.click('button[type="submit"]');
  await other.waitForURL(/\/onboarding/);
  await other.fill('input[name="name"]', "Elsewhere");
  await other.click("text=Create household");
  await other.waitForURL(/\/onboarding\/first-tasks|\/home/);
  const res = await other.goto(firstExpense!);
  expect([403, 404]).toContain(res?.status());
  await expect(other.getByText("Costco run")).toHaveCount(0);
  await other.close();
});
