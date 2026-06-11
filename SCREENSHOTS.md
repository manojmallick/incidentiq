# Project Gallery — screenshots, order & captions

Ready-to-upload gallery for the Devpost/hackathon submission. All shots were captured from the
**live, open** app (no login) at retina 2× — they show real Gemini, Elastic MCP, and Agent
Builder output, not mocks. Files are in [`screenshots/`](screenshots/).

## Recommended gallery order (with captions)

Upload in this order — it tells the story judges reward (problem → the "wow" → proof → control).

| # | File | Caption to paste |
|---|---|---|
| 1 | `01-dashboard.png` | **Incident command center** — open ICT incidents, live DORA stats, 128 precedents indexed in Elasticsearch. |
| 2 | `02-recurrence-major.png` | **The rule everyone misses** — a *zero-impact* "85% connection-pool warning" is classified **MAJOR**, because it's the 6th PaymentProcessing incident in 30 days (DORA recurring-incident aggregation). |
| 3 | `03-workflow-trace.png` | **Agent, not chatbot** — the multi-step trace: ElasticSearcher (hybrid kNN+keyword via Elastic MCP) → DORAAnalyst → **Vertex AI Agent Engine** drafts the submission. All three required techs, at runtime. |
| 4 | `05-dnb-draft.png` | **The real deliverable** — the actual DORA Art.19 early-warning submission to the regulator (DNB), drafted by Gemini, not a summary. |
| 5 | `04-defensibility.png` | **Regulator-defensible** — a version-stamped record (ruleset, thresholds, cited precedent IDs, recurrence) a supervisor can challenge. |
| 6 | `06-approval-gate.png` | **Human-in-the-loop** — nothing is written or filed until a human approves. The agent proposes; the Risk Officer decides. |
| 7 | `06b-approved-audit.png` | **Stored, filed & audited** — on approval: classification + defensibility written, obligations saved to the shared ledger, every action audit-logged. |
| 8 | `07-dora-thresholds.png` | **DORA Art.18 classification** — a major payment outage breaches the client %, €5M value, and payments-downtime thresholds, shown with the exact rules. |
| 9 | `08-health-proof.png` | **Proof it's all live** — `/health` shows `partner_mcp_connected:true`, `agent_builder_connected:true`, model `gemini-3-flash-preview`. |

**Cover image:** use `02-recurrence-major.png` — it's the most memorable single frame (a harmless warning becoming a regulatory MAJOR).

**Full-page extras** (optional, for a "see everything" slide): `02b-recurrence-full.png` and `07b-major-full.png` capture an entire classification report top-to-bottom.

## How to add them to Devpost

1. Edit your project → **Media / Image gallery**.
2. Upload the 9 files **in the order above** (Devpost shows them in upload order; drag to reorder).
3. Paste the caption under each image.
4. Set `02-recurrence-major.png` as the **thumbnail/cover**.
5. The **demo video** goes in the video field (separate from the gallery).

## Tips if you re-take any manually
- Browser at **1440×900**, zoom 100%, light-on-dark looks best; use a clean window (no bookmarks bar).
- On a Mac, **⌘⇧4 then Space** captures a single window crisply.
- The "wow": on the dashboard, click the **"DB warning: connection pool at 85% saturation"** card → wait for the MAJOR verdict.
- A classic MAJOR: click **"Payment Service Unavailability"** → shows the breached thresholds.

## Regenerating the whole gallery (automated)
Captured with Playwright driving the live app via your installed Chrome. The script lives at
[`scripts/shoot-screenshots.mjs`](scripts/shoot-screenshots.mjs):

```bash
npm i -D playwright            # or: npx playwright@1.60 ...
IQ_URL=https://incidentiq-908307939543.europe-west1.run.app \
  node scripts/shoot-screenshots.mjs
```
It writes all shots to `screenshots/`. Each classify hits real Gemini + Elastic + Agent Engine,
so expect a few seconds per shot (and a few cents of usage).
