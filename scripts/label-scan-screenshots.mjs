/**
 * Capture prototype multi-device + guide screenshots (local only).
 *   npx playwright test --config=scripts/label-scan-screenshots.mjs
 * Or run: node scripts/label-scan-screenshots.mjs
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const OUT = join(process.cwd(), "fixtures", "label-scan", "screenshots");
mkdirSync(OUT, { recursive: true });

const base = process.env.PROTOTYPE_BASE_URL || "http://localhost:3000";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 900, height: 1400 } });

await page.goto(`${base}/prototype/label-scan`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "Load demo: 2 devices in one job" }).click();
await page.waitForTimeout(500);
await page.screenshot({ path: join(OUT, "01-two-device-job-summary.png"), fullPage: true });

await page.getByRole("button", { name: "View Installation Guide" }).first().click();
await page.waitForTimeout(400);
await page.screenshot({ path: join(OUT, "02-guide-link-on-device-card.png"), fullPage: true });

await page.getByRole("button", { name: "Add another device" }).click();
await page.waitForTimeout(300);
await page.screenshot({ path: join(OUT, "03-add-another-device-capture.png"), fullPage: true });

await page.getByRole("button", { name: "Synthetic Vehicle Tracker" }).click();
await page.waitForSelector("text=Confirm device family", { timeout: 120000 });
await page.screenshot({ path: join(OUT, "04-vehicle-tracker-family-confirm.png"), fullPage: true });

await page.getByRole("button", { name: "Confirm family" }).click();
await page.waitForSelector("text=Installation variant", { timeout: 10000 });
await page.screenshot({ path: join(OUT, "05-obd-jbus-variant-required.png"), fullPage: true });

await page.getByText("OBD-II", { exact: true }).click();
await page.getByRole("button", { name: "Continue & extract fields" }).click();
await page.waitForSelector("text=View Installation Guide", { timeout: 120000 });
await page.screenshot({ path: join(OUT, "06-device-section-with-guide.png"), fullPage: true });

await browser.close();
console.log(`Screenshots written to ${OUT}`);
