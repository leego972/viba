import { test, expect } from "@playwright/test";

async function createSession(): Promise<number> {
  const res = await fetch("http://localhost:80/api/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      goal: `Spike alert test ${Date.now()}`,
      autonomyMode: "supervised",
      agents: [{ name: "TestAgent", provider: "openai", role: "Architect", isMock: true }],
    }),
  });
  if (!res.ok) throw new Error(`Failed to create session: ${res.status}`);
  const data = await res.json();
  return data.id as number;
}

function mockStatsWithSpike(page: import("@playwright/test").Page, providers: string[]) {
  return page.route("**/api/stats", (route) => {
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        totalFallbacks: providers.length * 6,
        recentSpikeProviders: providers,
        recentSpikeThreshold: 5,
        alertEnabled: true,
        spikeProviders: [],
        webhookUrl: null,
        webhookEnabled: false,
      }),
    });
  });
}

function mockStatsNoSpike(page: import("@playwright/test").Page) {
  return page.route("**/api/stats", (route) => {
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        totalFallbacks: 0,
        recentSpikeProviders: [],
        recentSpikeThreshold: 5,
        alertEnabled: true,
        spikeProviders: [],
        webhookUrl: null,
        webhookEnabled: false,
      }),
    });
  });
}

test.describe("Spike alert banner", () => {
  let sessionId: number;

  test.beforeAll(async () => {
    sessionId = await createSession();
  });

  test("shows red spike alert with provider name and Settings link when recentSpikeProviders is non-empty", async ({ page }) => {
    await mockStatsWithSpike(page, ["openai"]);
    await page.addInitScript((key) => {
      localStorage.removeItem(key);
    }, `bridge_spike_dismissed_${sessionId}`);

    await page.goto(`/sessions/${sessionId}`);

    const alert = page.locator('[aria-label="Dismiss spike alert"]');
    await expect(alert).toBeVisible({ timeout: 15000 });

    await expect(page.getByText("Fallback spike alert")).toBeVisible();
    await expect(page.getByText(/The openai provider/)).toBeVisible();

    const settingsLink = page.getByRole("link", { name: "Check your API keys" });
    await expect(settingsLink).toBeVisible();
    await expect(settingsLink).toHaveAttribute("href", /settings/);
  });

  test("shows provider name in spike alert text when a single provider is spiking", async ({ page }) => {
    await mockStatsWithSpike(page, ["anthropic"]);
    await page.addInitScript((key) => {
      localStorage.removeItem(key);
    }, `bridge_spike_dismissed_${sessionId}`);

    await page.goto(`/sessions/${sessionId}`);

    await expect(page.getByText("Fallback spike alert")).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(/The anthropic provider/)).toBeVisible();
    await expect(page.getByText(/5\+ fallbacks/)).toBeVisible();
  });

  test("spike alert banner is absent when recentSpikeProviders is empty", async ({ page }) => {
    await mockStatsNoSpike(page);

    await page.goto(`/sessions/${sessionId}`);

    await expect(page.getByText("TestAgent").first()).toBeVisible({ timeout: 15000 });
    await expect(page.locator('[aria-label="Dismiss spike alert"]')).not.toBeVisible();
    await expect(page.getByText("Fallback spike alert")).not.toBeVisible();
  });

  test("dismissing the spike alert hides the banner", async ({ page }) => {
    await mockStatsWithSpike(page, ["openai"]);
    await page.addInitScript((key) => {
      localStorage.removeItem(key);
    }, `bridge_spike_dismissed_${sessionId}`);

    await page.goto(`/sessions/${sessionId}`);

    const dismissBtn = page.locator('[aria-label="Dismiss spike alert"]');
    await expect(dismissBtn).toBeVisible({ timeout: 15000 });

    await dismissBtn.click();

    await expect(dismissBtn).not.toBeVisible();
    await expect(page.getByText("Fallback spike alert")).not.toBeVisible();
  });

  test("spike alert stays hidden after dismissal when all current providers are already dismissed", async ({ page }) => {
    await mockStatsWithSpike(page, ["openai"]);
    await page.addInitScript((key) => {
      localStorage.setItem(key, JSON.stringify(["openai"]));
    }, `bridge_spike_dismissed_${sessionId}`);

    await page.goto(`/sessions/${sessionId}`);

    await expect(page.getByText("TestAgent").first()).toBeVisible({ timeout: 15000 });
    await expect(page.locator('[aria-label="Dismiss spike alert"]')).not.toBeVisible();
    await expect(page.getByText("Fallback spike alert")).not.toBeVisible();
  });

  test("spike alert re-appears for a new provider not in the dismissed list", async ({ page }) => {
    await mockStatsWithSpike(page, ["openai", "anthropic"]);
    await page.addInitScript((key) => {
      localStorage.setItem(key, JSON.stringify(["openai"]));
    }, `bridge_spike_dismissed_${sessionId}`);

    await page.goto(`/sessions/${sessionId}`);

    const dismissBtn = page.locator('[aria-label="Dismiss spike alert"]');
    await expect(dismissBtn).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(/anthropic/)).toBeVisible();
  });

  test("spike alert stays hidden after page reload once dismissed", async ({ page }) => {
    await mockStatsWithSpike(page, ["openai"]);
    // addInitScript runs on EVERY navigation (including reload), so use a sessionStorage
    // flag to ensure localStorage is only cleared on the very first page load.
    await page.addInitScript((key) => {
      if (!sessionStorage.getItem("__spike_test_first_load")) {
        sessionStorage.setItem("__spike_test_first_load", "1");
        localStorage.removeItem(key);
      }
    }, `bridge_spike_dismissed_${sessionId}`);

    await page.goto(`/sessions/${sessionId}`);

    const dismissBtn = page.locator('[aria-label="Dismiss spike alert"]');
    await expect(dismissBtn).toBeVisible({ timeout: 15000 });

    await dismissBtn.click();
    await expect(dismissBtn).not.toBeVisible();

    await page.reload();

    await expect(page.getByText("TestAgent").first()).toBeVisible({ timeout: 15000 });
    await expect(page.locator('[aria-label="Dismiss spike alert"]')).not.toBeVisible();
    await expect(page.getByText("Fallback spike alert")).not.toBeVisible();
  });
});

test.describe("Spike alert — full end-to-end flow", () => {
  test("alert appears, dismisses on click, then reappears when a new provider is added", async ({ page }) => {
    // Use the shared helper — creates a unique session so localStorage starts empty
    const sessionId = await createSession();

    // Step 1 — load page with a single spiking provider
    // No addInitScript needed: the session is brand-new so no prior dismissal exists
    // in localStorage. Using addInitScript here would re-run on every navigation and
    // would wipe the dismissal that the click in Step 2 is supposed to persist.
    await mockStatsWithSpike(page, ["openai"]);
    await page.goto(`/sessions/${sessionId}`);

    const dismissBtn = page.locator('[aria-label="Dismiss spike alert"]');
    await expect(dismissBtn).toBeVisible({ timeout: 15000 });
    await expect(page.getByText("Fallback spike alert")).toBeVisible();
    await expect(page.getByText(/The openai provider/)).toBeVisible();

    // Step 2 — click X; alert must disappear immediately within the same page load
    await dismissBtn.click();
    await expect(dismissBtn).not.toBeVisible();
    await expect(page.getByText("Fallback spike alert")).not.toBeVisible();

    // Step 3 — change the stats mock so "anthropic" is now also spiking
    await page.unroute("**/api/stats");
    await mockStatsWithSpike(page, ["openai", "anthropic"]);

    // Reload — localStorage still holds ["openai"] as dismissed (written by the dismiss
    // click above). "anthropic" was never dismissed, so it is the only undismissed
    // provider. The alert must reappear showing the singular "The anthropic provider"
    // form, which proves openai remains dismissed.
    await page.goto(`/sessions/${sessionId}`);

    await expect(dismissBtn).toBeVisible({ timeout: 15000 });
    await expect(page.getByText("Fallback spike alert")).toBeVisible();
    // Singular form confirms only anthropic is undismissed (openai stayed dismissed)
    await expect(page.getByText(/The anthropic provider/)).toBeVisible();
  });
});
