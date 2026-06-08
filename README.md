# IncidentIQ — DORA Major-Incident Triage Agent

When a new ICT incident hits a financial entity, IncidentIQ **reasons, plans, and acts**:
it searches similar past incidents in Elasticsearch (hybrid kNN + keyword), classifies the
incident against **DORA Art.18** thresholds informed by precedent and the recurring-incident
rule, drafts the **actual DNB early-warning submission** with Gemini 3, builds a
regulator-defensible record — and, **only after a human approves**, writes the classification,
saves the reporting obligations, and logs the audit trail. ~Seconds vs ~2 hours of manual work.

> **It's an agent, not a chatbot:** multi-step plan → real tool actions (Elastic writes) →
> human-in-the-loop approval gate → audit trail.

## 🔴 Live demo
- **App:** https://incidentiq-starter.vercel.app
- **Login (password-gated demo):** `judge` / `IncidentIQ2026-f5707254`
- Click **Judge Tour** in the top bar for a guided, end-to-end walkthrough.

## Stack (Google Cloud Rapid Agent Hackathon — Elastic bucket)
- 🧠 **Gemini 3** (`gemini-3-flash-preview`) — classification rationale + drafts the DNB submission
- 🏗️ **Google Cloud Agent Builder** — agent definition ([`agent-builder/agent.json`](agent-builder/agent.json))
- 🔍 **Elasticsearch via Elastic MCP** — ES|QL + hybrid kNN/keyword search + gated index writes *(load-bearing)*
- 🔢 **`gemini-embedding-001`** (768-dim) — query + corpus vectors for kNN

## Architecture
```
Browser (public/index.html) ──POST /api/classify──► agent (src/agent.js)
  1. embed incident            → gemini-embedding-001 (768d)
  2. hybrid precedent search    → Elastic (ES|QL + kNN over 100+ incidents)
  3. classify + recurrence      → criteria.js (DORA Art.18 thresholds + aggregate rule)
  4. explain + draft submission → Gemini 3 (cites precedents; deterministic fallback)
  5. defensibility + deadlines  → version-stamped record, Art.19 timeline
  6. PROPOSE store + obligations ─┐  (consequential → GATED)
ApprovalBar (human approves) ──POST /api/execute──► Elastic writes + obligations ledger + audit log
```
The **judged** agent is [`agent-builder/agent.json`](agent-builder/agent.json) (Gemini 3 + Elastic
MCP, writes require approval). The Express app mirrors it via the Elastic REST API so the hosted UI runs end-to-end.

## Two agents
- **ElasticSearcher** — embeds the incident, runs hybrid kNN + keyword precedent search, aggregates impact via ES|QL.
- **DORAAnalyst** — applies DORA Art.18 thresholds + the recurring-incident rule + precedent signal, then Gemini 3 explains and drafts the DNB (Art.19) submission.

## DORA features
- **Art.18 classification** — 5 major-incident thresholds (clients %, transaction value, data breach, core-banking downtime, payments downtime).
- **Recurring-incident aggregation** — individually-MINOR incidents that recur on a service within 30 days escalate to MAJOR in aggregate (the rule most tools miss).
- **Art.19 reporting** — early-warning (4h) / intermediate (72h) / final (1mo) deadlines with a live countdown.
- **DNB submission draft** — the actual EBA/DORA-template notification, not a summary.
- **Defensibility record** — version-stamped rationale a regulator can challenge.
- **Shared obligation ledger** — same schema across the DORA platform; CSV-exportable.
- **Cross-app handoff** — `/api/ingest` accepts a real-time detection (e.g. from DynaCompliance) and classifies + files it.

## Endpoints
| Route | Purpose |
|---|---|
| `GET /health` | proves the stack is wired (`model`, `partner_mcp_connected`, `indexed`) |
| `GET /api/incidents` | open incidents via ES|QL |
| `POST /api/classify` | steps 1–5 (read-only): search → classify → draft |
| `POST /api/ingest` | cross-app detection handoff → classify |
| `POST /api/execute` | step 6 (gated on `approved:true`): writes + obligations + audit |
| `GET /api/obligations/:companyId` | shared ledger (`?format=csv` to export) |

## Quick start

**Zero-credential demo (canned data):**
```bash
npm install
MOCK=true npm start          # → http://localhost:8080
```

**Live (real Gemini 3 + Elastic):**
```bash
cp .env.example .env         # fill GEMINI_API_KEY + ELASTIC_URL + ELASTIC_API_KEY
npm install
npm run setup:elastic        # creates ict-incidents (768d vectors) + seeds 128 incidents (--reset to recreate)
npm start                    # → http://localhost:8080
```

### Environment (`.env`)
| Var | Notes |
|---|---|
| `GEMINI_API_KEY` | Gemini Developer API key (AI Studio). Enables `gemini-3-flash-preview` + embeddings on any host. |
| `GEMINI_MODEL` | `gemini-3-flash-preview` |
| `EMBEDDING_MODEL` | `gemini-embedding-001` (768-dim) |
| `ELASTIC_URL` / `ELASTIC_API_KEY` | Elastic Cloud endpoint + a scoped Elasticsearch API key |
| `ELASTIC_*_INDEX` | `ict-incidents` / `obligations` / `audit_log` |
| `APP_PASSWORD` (+ `APP_USERNAME`) | optional HTTP basic-auth gate (set on public deploys) |
| `MOCK=true` | run the full UI with canned data, no credentials |

## Deploy
- **Vercel (live):** `vercel --prod` (serverless via [`api/index.js`](api/index.js) + [`vercel.json`](vercel.json)); env vars set in the project.
- **Google Cloud Run:** `gcloud run deploy incidentiq --source . --region=europe-west1 --allow-unauthenticated --set-env-vars="GEMINI_MODEL=gemini-3-flash-preview,..." ` (Dockerfile included).

## Health check (proof for judges)
```bash
curl -u judge:<password> https://incidentiq-starter.vercel.app/health
# { "status":"ok", "model":"gemini-3-flash-preview", "partner":"elastic", "partner_mcp_connected":true, "indexed":128, ... }
```

## Evals
`npm run eval` runs the golden classification set in [`evals/`](evals/).

## License
MIT — see [LICENSE](LICENSE).
