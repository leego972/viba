import { test, expect } from "@playwright/test";
import pg from "pg";

const SIMULATED_PREFIX = "⚠️ [Simulated";
const BANNER_KEY = (id: number) => `bridge_fallback_banner_${id}`;

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

async function insertSimulatedMessageAt(sessionId: number, isoTimestamp: string): Promise<void> {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query(
      `INSERT INTO messages (session_id, role, content, agent_name, agent_role, created_at)
       VALUES ($1, 'assistant', $2, 'TestAgent', 'Architect', $3::timestamptz)`,
      [sessionId, `${SIMULATED_PREFIX}] This is a test simulated response.`, isoTimestamp]
    );
  } finally {
    await client.end();
  }
}

async function insertSimulatedMessage(sessionId: number): Promise<void> {
  await insertSimulatedMessageAt(sessionId, new Date().toISOString());
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

  test("banner stays hidden on reload after dismissal", async ({ page }) => {
    const futureTs = new Date(Date.now() + 60_000).toISOString();
    await page.addInitScript(
      ({ key, ts }) => { localStorage.setItem(key, ts); },
      { key: BANNER_KEY(sessionId), ts: futureTs }
    );

    await page.goto(`/sessions/${sessionId}`);

    // Wait for the page to hydrate by asserting a stable element is present,
    // then confirm the banner is absent. Using a positive wait first prevents
    // the "not visible" assertion from passing on an empty page.
    await expect(page.getByText("TestAgent").first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole("button", { name: "Dismiss banner" })).not.toBeVisible();
    await expect(page.getByText("switched to simulation mid-run")).not.toBeVisible();
  });
});

test.describe("Simulation fallback banner — re-appearance after new fallbacks", () => {
  test("banner re-appears when a new simulated message arrives after the dismissal timestamp", async ({ page }) => {
    const sessionId = await createSession();

    const beforeDismissal = new Date(Date.now() - 5_000).toISOString();
    const dismissalTs = new Date(Date.now() - 2_000).toISOString();
    const afterDismissal = new Date(Date.now() + 1_000).toISOString();

    await insertSimulatedMessageAt(sessionId, beforeDismissal);
    await insertSimulatedMessageAt(sessionId, afterDismissal);

    await page.addInitScript(
      ({ key, ts }) => { localStorage.setItem(key, ts); },
      { key: BANNER_KEY(sessionId), ts: dismissalTs }
    );

    await page.goto(`/sessions/${sessionId}`);

    const dismissBtn = page.getByRole("button", { name: "Dismiss banner" });
    await expect(dismissBtn).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("switched to simulation mid-run")).toBeVisible();
  });

  test("banner stays hidden when all simulated messages pre-date the dismissal timestamp", async ({ page }) => {
    const sessionId = await createSession();

    const messageTs = new Date(Date.now() - 10_000).toISOString();
    const dismissalTs = new Date(Date.now() - 5_000).toISOString();

    await insertSimulatedMessageAt(sessionId, messageTs);

    await page.addInitScript(
      ({ key, ts }) => { localStorage.setItem(key, ts); },
      { key: BANNER_KEY(sessionId), ts: dismissalTs }
    );

    await page.goto(`/sessions/${sessionId}`);

    // Wait for the page to hydrate before asserting the banner is absent.
    await expect(page.getByText("TestAgent").first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole("button", { name: "Dismiss banner" })).not.toBeVisible();
    await expect(page.getByText("switched to simulation mid-run")).not.toBeVisible();
  });
});
