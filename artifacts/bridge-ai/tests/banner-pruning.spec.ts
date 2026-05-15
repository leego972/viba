import { test, expect } from "@playwright/test";

const BANNER_PREFIX = "bridge_fallback_banner_";
const MAX_KEYS = 20;

async function createSession(): Promise<number> {
  const res = await fetch("http://localhost:80/api/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      goal: `Banner pruning test ${Date.now()}`,
      autonomyMode: "supervised",
      agents: [{ name: "TestAgent", provider: "openai", role: "Architect", isMock: true }],
    }),
  });
  if (!res.ok) throw new Error(`Failed to create session: ${res.status}`);
  const data = (await res.json()) as { id: number };
  return data.id;
}

function getBannerKeys(page: import("@playwright/test").Page, prefix: string): Promise<string[]> {
  return page.evaluate((p: string) => {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(p)) keys.push(k);
    }
    return keys;
  }, prefix);
}

test.describe("pruneStaleLocalStorageKeys — localStorage cleanup (#47)", () => {
  test("removes oldest entries when 25 banner dismissal keys exist, leaving exactly 20", async ({ page }) => {
    const sessionId = await createSession();

    await page.addInitScript(
      ({ prefix, count }: { prefix: string; count: number }) => {
        localStorage.clear();
        const ts = new Date().toISOString();
        for (let i = 1; i <= count; i++) {
          localStorage.setItem(`${prefix}${i}`, ts);
        }
      },
      { prefix: BANNER_PREFIX, count: 25 },
    );

    await page.goto(`/sessions/${sessionId}`);
    await expect(page.getByText("TestAgent").first()).toBeVisible({ timeout: 10000 });

    const remaining = await getBannerKeys(page, BANNER_PREFIX);

    expect(remaining).toHaveLength(MAX_KEYS);

    for (let i = 1; i <= 5; i++) {
      expect(remaining).not.toContain(`${BANNER_PREFIX}${i}`);
    }

    for (let i = 6; i <= 25; i++) {
      expect(remaining).toContain(`${BANNER_PREFIX}${i}`);
    }
  });

  test("keeps all 20 keys untouched when exactly at the limit", async ({ page }) => {
    const sessionId = await createSession();

    await page.addInitScript(
      ({ prefix, count }: { prefix: string; count: number }) => {
        localStorage.clear();
        const ts = new Date().toISOString();
        for (let i = 1; i <= count; i++) {
          localStorage.setItem(`${prefix}${i}`, ts);
        }
      },
      { prefix: BANNER_PREFIX, count: 20 },
    );

    await page.goto(`/sessions/${sessionId}`);
    await expect(page.getByText("TestAgent").first()).toBeVisible({ timeout: 10000 });

    const remaining = await getBannerKeys(page, BANNER_PREFIX);

    expect(remaining).toHaveLength(MAX_KEYS);

    for (let i = 1; i <= 20; i++) {
      expect(remaining).toContain(`${BANNER_PREFIX}${i}`);
    }
  });

  test("keeps all keys when under the limit", async ({ page }) => {
    const sessionId = await createSession();

    await page.addInitScript(
      ({ prefix, count }: { prefix: string; count: number }) => {
        localStorage.clear();
        const ts = new Date().toISOString();
        for (let i = 1; i <= count; i++) {
          localStorage.setItem(`${prefix}${i}`, ts);
        }
      },
      { prefix: BANNER_PREFIX, count: 10 },
    );

    await page.goto(`/sessions/${sessionId}`);
    await expect(page.getByText("TestAgent").first()).toBeVisible({ timeout: 10000 });

    const remaining = await getBannerKeys(page, BANNER_PREFIX);

    expect(remaining).toHaveLength(10);
  });

  test("prunes by numeric ID order, not lexicographic — removes ID 9 before ID 10", async ({ page }) => {
    const sessionId = await createSession();

    // Seed 21 keys with IDs [9, 10, 11, ..., 29].
    // Under lexicographic sort "10" < "9" so the lexicographic-wrong answer
    // would remove bridge_fallback_banner_10, not bridge_fallback_banner_9.
    // Under correct numeric sort 9 is the smallest and must be removed.
    await page.addInitScript(
      ({ prefix }: { prefix: string }) => {
        localStorage.clear();
        const ts = new Date().toISOString();
        for (let i = 9; i <= 29; i++) {
          localStorage.setItem(`${prefix}${i}`, ts);
        }
      },
      { prefix: BANNER_PREFIX },
    );

    await page.goto(`/sessions/${sessionId}`);
    await expect(page.getByText("TestAgent").first()).toBeVisible({ timeout: 10000 });

    const remaining = await getBannerKeys(page, BANNER_PREFIX);

    expect(remaining).toHaveLength(MAX_KEYS);
    // Numeric sort removes 9 (smallest); lexicographic sort would wrongly remove 10.
    expect(remaining).not.toContain(`${BANNER_PREFIX}9`);
    expect(remaining).toContain(`${BANNER_PREFIX}10`);
    expect(remaining).toContain(`${BANNER_PREFIX}29`);
  });
});

test.describe("pruneStaleLocalStorageKeys — mixed legacy integer and ISO timestamp values", () => {
  test("removes oldest keys by numeric ID even when some keys hold legacy integer values", async ({ page }) => {
    const sessionId = await createSession();

    // Seed 25 keys: IDs 1-12 with valid ISO timestamps, IDs 13-25 with legacy integers.
    // Legacy integer values are silently ignored by readDismissedAt but the key
    // still occupies a slot toward the 20-key limit. Pruning must evict the 5
    // smallest numeric IDs (1-5) regardless of the type of value they store.
    await page.addInitScript(
      ({ prefix }: { prefix: string }) => {
        localStorage.clear();
        const ts = new Date().toISOString();
        for (let i = 1; i <= 12; i++) {
          localStorage.setItem(`${prefix}${i}`, ts);
        }
        for (let i = 13; i <= 25; i++) {
          localStorage.setItem(`${prefix}${i}`, "7"); // legacy count-based integer
        }
      },
      { prefix: BANNER_PREFIX },
    );

    await page.goto(`/sessions/${sessionId}`);
    await expect(page.getByText("TestAgent").first()).toBeVisible({ timeout: 10000 });

    const remaining = await getBannerKeys(page, BANNER_PREFIX);

    // Exactly 20 keys must survive
    expect(remaining).toHaveLength(MAX_KEYS);

    // The 5 oldest (IDs 1-5, all ISO-valued) must be pruned
    for (let i = 1; i <= 5; i++) {
      expect(remaining).not.toContain(`${BANNER_PREFIX}${i}`);
    }

    // The 20 newest (IDs 6-25, mix of ISO and legacy integer values) must remain
    for (let i = 6; i <= 25; i++) {
      expect(remaining).toContain(`${BANNER_PREFIX}${i}`);
    }
  });
});
