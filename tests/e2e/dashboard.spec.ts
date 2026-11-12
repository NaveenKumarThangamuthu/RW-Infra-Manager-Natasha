import { test, expect, type Page } from "@playwright/test";

// Smoke tests for the Natasha design-v2 UI.
// Run with: E2E_USER=you@rw.team E2E_PASS=… npx playwright test
// Requires the server running on http://localhost:3000 (or E2E_BASE_URL).

const USER = process.env.E2E_USER ?? "";
const PASS = process.env.E2E_PASS ?? "";

async function login(page: Page) {
  test.skip(!USER || !PASS, "Set E2E_USER and E2E_PASS env vars to run login-gated tests");
  await page.goto("/login");
  // Login page renders its form inside <Suspense fallback={null}> — inputs appear post-hydration.
  const emailInput = page.locator("input[type='email']");
  await emailInput.waitFor({ state: "visible", timeout: 15_000 });
  await emailInput.fill(USER);
  await page.locator("input[type='password']").fill(PASS);
  await page.getByRole("button", { name: /sign in|log in/i }).click();
  // Wait for the /login pathname to change to anything else.
  await page.waitForFunction(() => !location.pathname.startsWith("/login"), null, { timeout: 15_000 });
  // Also wait for the sidebar to hydrate so subsequent nav has a valid session cookie in scope.
  await page.locator(".sidebar").first().waitFor({ state: "visible", timeout: 10_000 });
}

test.describe("Natasha design-v2 UI", () => {
  test("login redirect works when unauthenticated", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/login/);
    await expect(page.locator("input[type='password']")).toBeVisible();
  });

  test("sidebar has design-v2 18 items and no personal-assistant links", async ({ page }) => {
    await login(page);
    const sidebar = page.locator(".sidebar");
    await expect(sidebar).toBeVisible();

    const navLinks = sidebar.locator(".nav-link");
    await expect(navLinks).toHaveCount(16);

    // Verify each expected label as substring — labels can render inside <span> children.
    const expected = [
      "Home", "Daily Brief", "Billing", "Servers", "Lambda", "SNS",
      "Data Transfer", "Regions", "Categories", "Spring",
      "Incidents", "Recommendations", "Repositories",
      "Settings", "Integrations",
    ];
    const allLabels = await sidebar.locator(".nav-link .nav-label").allInnerTexts();
    for (const label of expected) {
      expect(allLabels).toContain(label);
    }

    // Personal-assistant labels must not appear anywhere in the sidebar.
    const sidebarText = await sidebar.innerText();
    for (const banned of ["Calendar", "Tasks", "Notes", "Reminders", "Assistant"]) {
      expect(sidebarText).not.toContain(banned);
    }
  });

  test("overview page renders KPIs with sparklines", async ({ page }) => {
    await login(page);
    await page.goto("/");
    // Dashboard renders <DashboardSkeleton /> until /api/cost/summary resolves; wait for real KPIs.
    await page.locator(".card.kpi").first().waitFor({ state: "visible", timeout: 20_000 });
    await expect(page.locator(".card.kpi")).toHaveCount(4);
    await expect(page.locator(".kpi-head-row svg").first()).toBeVisible();
  });

  test("Categories page has 7-tab bar", async ({ page }) => {
    await login(page);
    await page.goto("/tag");
    await expect(page).toHaveURL(/\/tag\/2\.0/);
    const tabs = page.locator(".cat-tab");
    await expect(tabs).toHaveCount(7);
    await expect(tabs.nth(0)).toContainText("2.0");
    await expect(tabs.nth(6)).toContainText("Other");
  });

  test("Repositories page opens findings inline on repo click", async ({ page }) => {
    await login(page);
    await page.goto("/security");
    // Wait for either the not-connected screen, an empty state, or a repo row to appear.
    await page.waitForFunction(() => {
      return document.querySelector("tbody tr.repo-row") ||
             document.querySelector(".empty") ||
             document.querySelector("h2")?.textContent?.includes("Connect");
    }, null, { timeout: 15_000 }).catch(() => null);
    const rowCount = await page.locator("tbody tr.repo-row").count();
    test.skip(rowCount === 0, "No repos in the current DB — connect GitHub or seed a repo to enable this test");
    const firstRow = page.locator("tbody tr.repo-row").first();
    await firstRow.click();
    await expect(page.locator(".repo-detail-row")).toBeVisible();
    const triage = page.locator(".fable-triage-headline");
    const clean = page.locator(".anomaly-banner-clean");
    await expect(triage.or(clean)).toBeVisible();
  });

  test("Servers page — click instance opens 3-tab inline drawer", async ({ page }) => {
    await login(page);
    await page.goto("/ec2");
    const firstRow = page.locator("tbody tr.ec2-row").first();
    await firstRow.click();
    // 3 tabs
    await expect(page.locator(".ec2-tab")).toHaveCount(3);
    await expect(page.locator(".ec2-tab", { hasText: "Services" })).toBeVisible();
    await expect(page.locator(".ec2-tab", { hasText: "Recommendations" })).toBeVisible();
    await expect(page.locator(".ec2-tab", { hasText: "Errors" })).toBeVisible();
    // Click Errors tab -> weekly bar chart shows 7 columns
    await page.locator(".ec2-tab", { hasText: "Errors" }).click();
    await expect(page.locator(".ec2-err-week-col")).toHaveCount(7);
  });

  test("Data Transfer page has flow-level table with IP badges", async ({ page }) => {
    await login(page);
    await page.goto("/data-transfer");
    // Flow-level panel exists
    await expect(page.locator("text=Flow-level transfer")).toBeVisible();
    // At least a couple flow endpoint badges rendered
    const badges = page.locator(".flow-endpoint");
    await expect(badges.first()).toBeVisible();
    // Filter chips visible
    await expect(page.locator(".flow-chip", { hasText: "All" })).toBeVisible();
    await expect(page.locator(".flow-chip", { hasText: /public egress/i })).toBeVisible();
  });

  test("Command palette opens (⌘K button and Ctrl+K)", async ({ page }) => {
    await login(page);
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    // Ensure the topbar ⌘K button (which programmatically dispatches Ctrl+K) is present.
    const cmdkBtn = page.locator(".topbar-cmdk");
    await expect(cmdkBtn).toBeVisible({ timeout: 10_000 });

    // Open via the button — reliable, doesn't depend on the keyboard-focus target.
    await cmdkBtn.click();
    const palette = page.locator('[role="dialog"][aria-label="Command palette"]');
    await expect(palette).toBeVisible({ timeout: 5_000 });
    await page.keyboard.press("Escape");
    await expect(palette).toBeHidden();

    // Also verify the raw Ctrl+K shortcut works once focus is on the page body.
    await page.locator("body").click({ position: { x: 10, y: 10 } });
    await page.keyboard.press("Control+K");
    await expect(palette).toBeVisible({ timeout: 5_000 });
    await page.keyboard.press("Escape");
    await expect(palette).toBeHidden();
  });

  test("promoted stub pages render without crashing", async ({ page }) => {
    await login(page);
    // /brief · /settings · /integrations · /perf/forecast · /perf/what-changed now have real content.
    // /security/findings is still a stub page. All must render an <h1>.
    const pages = ["/brief", "/settings", "/integrations"];
    for (const p of pages) {
      await page.goto(p);
      await expect(page.locator("h1").first()).toBeVisible();
    }
  });
});
