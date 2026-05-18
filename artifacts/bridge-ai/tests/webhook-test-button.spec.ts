import { test, expect } from "@playwright/test";

const SAVED_WEBHOOK = "https://hooks.example.com/bridgeai";

function mockSettingsWithWebhook(page: import("@playwright/test").Page) {
  return page.route("**/api/settings", (route) => {
    if (route.request().method() !== "GET") return route.continue();
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        { key: "NOTIFICATION_WEBHOOK_URL", value: SAVED_WEBHOOK },
        { key: "FALLBACK_ALERT_ENABLED", value: "true" },
      ]),
    });
  });
}

function mockTestNotificationOk(page: import("@playwright/test").Page) {
  return page.route("**/api/stats/test-notification", (route) => {
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        message: "Webhook delivered.",
      }),
    });
  });
}

function mockTestNotificationFail(page: import("@playwright/test").Page) {
  return page.route("**/api/stats/test-notification", (route) => {
    route.fulfill({
      status: 400,
      contentType: "application/json",
      body: JSON.stringify({
        error: "Webhook delivery failed: Webhook returned status 404",
      }),
    });
  });
}

function mockStats(page: import("@playwright/test").Page) {
  return page.route("**/api/stats", (route) => {
    if (route.request().method() !== "GET") return route.continue();
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        totalSessions: 0,
        activeSessions: 0,
        completedSessions: 0,
        fallbackEvents: 0,
        fallbacksByProvider: [],
        fallbackTrend: [],
        modelUsage: [],
        modelUsageBreakdown: [],
        spikeProviders: [],
        recentSpikeProviders: [],
        recentSpikeThreshold: 5,
        alertEnabled: true,
        lastSpikeNotification: null,
      }),
    });
  });
}

test.describe("Webhook 'Send test' button", () => {
  test("button is disabled when webhook URL is unsaved", async ({ page }) => {
    await page.route("**/api/settings", (route) => {
      if (route.request().method() !== "GET") return route.continue();
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          { key: "FALLBACK_ALERT_ENABLED", value: "true" },
        ]),
      });
    });
    await mockStats(page);

    await page.goto("/settings");

    const webhookInput = page.getByLabel("Webhook URL");
    await expect(webhookInput).toBeVisible({ timeout: 15000 });

    await webhookInput.fill("https://hooks.example.com/test");

    const sendTestBtn = page.locator("button", { hasText: "Send test" }).first();
    await expect(sendTestBtn).toBeVisible();
    await expect(sendTestBtn).toBeDisabled();
  });

  test("button is enabled when webhook URL matches saved value", async ({ page }) => {
    await mockSettingsWithWebhook(page);
    await mockStats(page);

    await page.goto("/settings");

    const webhookInput = page.getByLabel("Webhook URL");
    await expect(webhookInput).toBeVisible({ timeout: 15000 });
    await expect(webhookInput).toHaveValue(SAVED_WEBHOOK);

    const sendTestBtn = page.locator("button", { hasText: "Send test" }).first();
    await expect(sendTestBtn).toBeVisible();
    await expect(sendTestBtn).toBeEnabled();
  });

  test("shows success toast when webhook is delivered", async ({ page }) => {
    await mockSettingsWithWebhook(page);
    await mockTestNotificationOk(page);
    await mockStats(page);

    await page.goto("/settings");

    const webhookInput = page.getByLabel("Webhook URL");
    await expect(webhookInput).toBeVisible({ timeout: 15000 });
    await expect(webhookInput).toHaveValue(SAVED_WEBHOOK);

    const sendTestBtn = page.locator("button", { hasText: "Send test" }).first();
    await expect(sendTestBtn).toBeEnabled();
    await sendTestBtn.click();

    await expect(page.getByText("Test sent", { exact: true }).first()).toBeVisible({ timeout: 10000 });
  });

  test("shows error toast when webhook delivery fails", async ({ page }) => {
    await mockSettingsWithWebhook(page);
    await mockTestNotificationFail(page);
    await mockStats(page);

    await page.goto("/settings");

    const webhookInput = page.getByLabel("Webhook URL");
    await expect(webhookInput).toBeVisible({ timeout: 15000 });
    await expect(webhookInput).toHaveValue(SAVED_WEBHOOK);

    const sendTestBtn = page.locator("button", { hasText: "Send test" }).first();
    await expect(sendTestBtn).toBeEnabled();
    await sendTestBtn.click();

    await expect(page.getByText("Test failed").first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/Webhook delivery failed/).first()).toBeVisible();
  });
});
