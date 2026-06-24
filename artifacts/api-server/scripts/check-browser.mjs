import { chromium } from "playwright";

async function main() {
  const browser = await chromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
    ],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.goto("data:text/html,<html><body><h1>VIBA browser check</h1></body></html>");
  const title = await page.locator("h1").textContent();
  await browser.close();
  if (title !== "VIBA browser check") {
    throw new Error("Chromium check failed: page content mismatch");
  }
  console.log("chromium ok");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
