import { test, expect } from "@playwright/test";

const SAVED_EMAIL = "alerts@example.com";

function mockSettingsWithEmail(page: import("@playwright/test").Page) {
  return page.route("**/api/settings", (route) => {
    if (route.request().method() !== "GET") return route.continue();
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([{ key: "NOTIFICATION_EMAIL", value: SAVED_EMAIL }]),
    });
  });
}

function mockTestNotificationSent(page: import("@playwright/test").Page) {
  return page.route("**/api/stats/test-notification", (route) => {
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        emailSent: true,
        message: `Test email sent to ${SAVED_EMAIL}.`,
      }),
    });
  });
}

function mockTestNotificationSmtpNotConfigured(page: import("@playwright/test").Page) {
  return page.route("**/api/stats/test-notification", (route) => {
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        emailSent: false,
        message: "SMTP not configured — test notification logged instead.",
      }),
    });
  });
}

test.describe("Email 'Send test' button confirmation", () => {
  test("shows 'Test sent' toast when email was delivered (SMTP configured)", async ({ page }) => {
    await mockSettingsWithEmail(page);
    await mockTestNotificationSent(page);

    await page.goto("/settings");

    const emailInput = page.getByLabel("Email address");
    await expect(emailInput).toBeVisible({ timeout: 15000 });
    await expect(emailInput).toHaveValue(SAVED_EMAIL);

    const sendTestBtn = page.locator("button", { hasText: "Send test" }).last();
    await expect(sendTestBtn).toBeVisible();
    await expect(sendTestBtn).toBeEnabled();

    await sendTestBtn.click();

    await expect(page.getByText("Test sent", { exact: true }).first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(`Test email sent to ${SAVED_EMAIL}.`).first()).toBeVisible();
  });

  test("shows 'Test sent — email not delivered' toast when SMTP is not configured", async ({ page }) => {
    await mockSettingsWithEmail(page);
    await mockTestNotificationSmtpNotConfigured(page);

    await page.goto("/settings");

    const emailInput = page.getByLabel("Email address");
    await expect(emailInput).toBeVisible({ timeout: 15000 });
    await expect(emailInput).toHaveValue(SAVED_EMAIL);

    const sendTestBtn = page.locator("button", { hasText: "Send test" }).last();
    await expect(sendTestBtn).toBeVisible();
    await expect(sendTestBtn).toBeEnabled();

    await sendTestBtn.click();

    await expect(page.getByText("Test sent — email not delivered", { exact: true }).first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/SMTP not configured/).first()).toBeVisible();
    await expect(page.getByText(/SMTP credentials required for email delivery/).first()).toBeVisible();
  });
});
