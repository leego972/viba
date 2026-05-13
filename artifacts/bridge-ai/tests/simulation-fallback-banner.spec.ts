import { test, expect } from "@playwright/test";
import pg from "pg";

const SIMULATED_PREFIX = "⚠️ [Simulated";

async function createSession(): Promise<number> {
  const res = await fetch("http://localhost:80/api/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      goal: `Simulation banner test ${Date.now()}`,
      autonomyMode: "supervised",
      agents: [{ name: "TestAgent", provider: "openai", role: "Architect", isMock: true }],
    }),
  });
  if (!res.ok) throw new Error(`Failed to create session: ${res.status}`);
  const data = await res.json();
  return data.id as number;
}

async function insertSimulatedMessage(sessionId: number): Promise<void> {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query(
      `INSERT INTO messages (session_id, role, content, agent_name, agent_role, created_at)
       VALUES ($1, 'assistant', $2, 'TestAgent', 'Architect', NOW())`,
      [sessionId, `${SIMULATED_PREFIX}] This is a test simulated response.`]
    );
  } finally {
    await client.end();
  }
}

test.describe("Simulation fallback banner", () => {
  let sessionId: number;

  test.beforeAll(async () => {
    sessionId = await createSession();
    await insertSimulatedMessage(sessionId);
  });

  test("shows amber banner with expected text when session has a simulated message", async ({ page }) => {
    await page.addInitScript(() => localStorage.clear());
    await page.goto(`/sessions/${sessionId}`);

    const dismissBtn = page.getByRole("button", { name: "Dismiss banner" });
    await expect(dismissBtn).toBeVisible({ timeout: 10000 });

    await expect(page.getByText("switched to simulation mid-run")).toBeVisible();
    await expect(page.getByText("Simulated").first()).toBeVisible();
  });

  test("dismisses the banner when the X button is clicked", async ({ page }) => {
    await page.addInitScript((id) => {
      localStorage.removeItem(`bridge_fallback_banner_${id}`);
    }, sessionId);

    await page.goto(`/sessions/${sessionId}`);

    const dismissBtn = page.getByRole("button", { name: "Dismiss banner" });
    await expect(dismissBtn).toBeVisible({ timeout: 10000 });

    await dismissBtn.click();

    await expect(dismissBtn).not.toBeVisible();
    await expect(page.getByText("switched to simulation mid-run")).not.toBeVisible();
  });
});
