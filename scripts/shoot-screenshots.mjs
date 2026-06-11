// Capture the project gallery by driving the LIVE, open app with Playwright.
// Usage:  npm i -D playwright   &&   IQ_URL=<url> node scripts/shoot-screenshots.mjs
// Writes retina 2x PNGs to screenshots/. Each classify hits real Gemini + Elastic + Agent Engine.
// Uses your installed Chrome via channel:'chrome' (no chromium download needed).

import { chromium } from "playwright";
import { fileURLToPath } from "url";
import path from "path";

const URL = process.env.IQ_URL || "https://incidentiq-908307939543.europe-west1.run.app";
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "screenshots");

const WOW = { incident_id: "INC-2026-048", title: "DB warning: Connection pool at 85% saturation",
  description: "Database warning: connection pool at 85% saturation on PaymentProcessing, no client impact yet",
  clients_affected_pct: 0, transaction_value_eur: 0, payments_down_min: 0, duration_min: 0, affected_systems: ["PaymentProcessing"] };
const MAJOR = { incident_id: "INC-2026-047", title: "Payment Service Unavailability",
  description: "Payment service unavailable, 15.2% clients affected, €8.3M transactions blocked, payments down 47 minutes, DB connection pool exhaustion (AWS RDS)",
  clients_affected_pct: 15.2, transaction_value_eur: 8_300_000, payments_down_min: 47, duration_min: 47, affected_systems: ["PaymentProcessing", "CardAuth"], root_cause_third_party: true };

const KILL_ANIM = `*{animation:none!important;transition:none!important;caret-color:transparent!important}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ channel: "chrome", headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
page.setDefaultTimeout(90000);

const freeze = () => page.addStyleTag({ content: KILL_ANIM }).catch(() => {});
async function classify(obj) {
  await page.evaluate((o) => window.classifyIncident(o), obj);
  await page.waitForSelector("#report-body h1", { timeout: 90000 });
  await sleep(1200); await freeze();
}
const shot = (name, opts = {}) => page.screenshot({ path: `${OUT}/${name}.png`, ...opts }).then(() => console.log("✓", name));
async function shotEl(sel, name) {
  try {
    const el = page.locator(sel).first();
    await el.scrollIntoViewIfNeeded(); await sleep(400); await freeze();
    await el.screenshot({ path: `${OUT}/${name}.png` }); console.log("✓", name, "(element)");
  } catch (e) { console.log("✗", name, "—", e.message.split("\n")[0]); }
}

try {
  await page.goto(URL, { waitUntil: "networkidle" });
  await page.waitForFunction(() => { const f = document.querySelector("#feed"); return f && /Payment|Incident|INC-/.test(f.innerText); }, { timeout: 60000 }).catch(() => {});
  await sleep(800); await freeze();
  await shot("01-dashboard");

  await classify(WOW);
  await page.evaluate(() => window.scrollTo(0, 0)); await sleep(400);
  await shot("02-recurrence-major");
  await shot("02b-recurrence-full", { fullPage: true });
  await shotEl('div.glass-card:has-text("CLASSIFICATION WORKFLOW TRACE")', "03-workflow-trace");
  await shotEl('div.glass-card:has-text("DEFENSIBILITY RECORD")', "04-defensibility");
  await shotEl("#dnb-draft", "05-dnb-draft");

  try {
    await page.waitForSelector("#approval:not(.hidden)", { timeout: 15000 }); await freeze();
    await shotEl("#approval", "06-approval-gate");
    await page.click('#approval button:has-text("Approve")');
    await page.waitForSelector("#exec-banner", { timeout: 60000 }); await sleep(900);
    await page.evaluate(() => { const b = document.querySelector("#exec-banner"); if (b) b.scrollIntoView({ block: "center" }); });
    await sleep(400); await freeze();
    await shotEl("#exec-banner", "06b-approved-audit");
  } catch (e) { console.log("✗ 06 —", e.message.split("\n")[0]); }

  await classify(MAJOR);
  await page.evaluate(() => window.scrollTo(0, 0)); await sleep(400);
  await shot("07-dora-thresholds");
  await shot("07b-major-full", { fullPage: true });

  const hp = await ctx.newPage();
  await hp.setViewportSize({ width: 1100, height: 520 });
  await hp.goto(URL + "/health", { waitUntil: "networkidle" });
  await hp.screenshot({ path: `${OUT}/08-health-proof.png` }); console.log("✓ 08-health-proof");

  console.log("\nDONE → screenshots/");
} catch (e) {
  console.error("FATAL:", e.message);
} finally {
  await browser.close();
}
