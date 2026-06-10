# IncidentIQ — Pitch Deck

> DORA major-incident triage agent · Gemini 3 + Google Cloud Agent Builder + Elastic MCP
> Google Cloud Rapid Agent Hackathon — **Elastic track**

---

## 1 — The problem

When an ICT incident hits a financial entity in the EU, the clock starts.

**DORA** (Digital Operational Resilience Act) requires a **major-incident early-warning report to the regulator within 4 hours.** Miss it, misclassify it, or file a sloppy one → **fines and supervisory scrutiny.**

Today this is **manual**: a compliance officer reads the incident, checks Article 18 thresholds, hunts for similar past incidents, decides MAJOR vs MINOR, and hand-writes the regulator submission. **~2 hours, under deadline pressure, error-prone.**

---

## 2 — The insight everyone misses

DORA has a rule most tools ignore: **incidents that are individually MINOR become MAJOR *in aggregate*** when they recur on the same service within a reference window.

A string of "harmless" payment warnings is, legally, a **reportable major incident.** Miss the pattern, miss the filing.

**IncidentIQ encodes this rule.** It's the difference between a demo and a compliance tool.

---

## 3 — What IncidentIQ does

It's an **agent, not a chatbot** — a multi-step plan that takes real actions:

1. **Search** similar past incidents — hybrid kNN + keyword over Elasticsearch
2. **Classify** against DORA Art.18 thresholds **+ the recurrence-aggregation rule**
3. **Draft** the *actual* DNB early-warning submission (the real EBA/DORA template, not a summary)
4. **Defend** — a version-stamped record a regulator can challenge
5. **Wait** — consequential writes are **gated on human approval**
6. **Act** — store the classification, save reporting obligations, write the audit trail

**~Seconds vs ~2 hours.**

---

## 4 — The "wow" (live in the demo)

On the dashboard, an innocuous card: **"DB warning: connection pool at 85% saturation."** Zero client impact. Any tool calls it MINOR.

Click it → **IncidentIQ returns MAJOR.**

> *"Would individually be MINOR… however classified MAJOR due to the DORA recurrence rule. This is the 6th PaymentProcessing incident in 30 days."* — generated live by the deployed Agent Builder agent.

A regulatory obligation, hiding in a routine warning. **That's the product.**

---

## 5 — Architecture

```
Browser ─POST /api/classify─► agent
  embed (Gemini) → precedent search (Elastic MCP `search`) → classify + recurrence (ES|QL)
  → explain + draft DNB (Agent Builder · Vertex AI Agent Engine) → defensibility + deadlines
  → PROPOSE (gated) ──ApprovalBar──► writes + obligations + audit (Elastic)
```

All three required techs are invoked **at runtime** — verifiable on the live `/health`:
`partner_mcp_connected: true · agent_builder_connected: true · model: gemini-3-flash-preview`

---

## 6 — Tech stack (required trio, no competitors)

- **Gemini 3** (`gemini-3-flash-preview` + `gemini-embedding-001`) — rationale, DNB draft, 768-dim vectors
- **Google Cloud Agent Builder** — ADK agent deployed to **Vertex AI Agent Engine**, called via `reasoningEngines:streamQuery`
- **Elastic MCP server** (`@elastic/mcp-server-elasticsearch`) — spawned at runtime; hybrid kNN + keyword precedent search
- **Cloud Run** — hosts the app; no competing AI or cloud services

---

## 7 — Why it wins the Elastic track

- **Elastic is load-bearing**, not decorative: hybrid vector + keyword search *is* the precedent engine, and ES|QL `STATS` *is* how the recurrence rule fires.
- **Genuine agent behavior**: multi-step plan → real tool actions → human-in-the-loop → audit trail.
- **Real domain depth**: DORA Art.18/19/28, the recurrence rule, a regulator-defensible record, the actual submission draft.
- **Verifiable runtime compliance**: all three required techs provably invoked live.

---

## 8 — Learnings

- **An MCP server's stdout is sacred** — the Elastic server's EDOT OTEL banner corrupted the JSON-RPC channel until we set `OTEL_SDK_DISABLED`.
- **Read the partner server, don't trust the docs** — Elastic MCP v0.3.x is read-only (`search`/`list_indices`/…), so we split work honestly: search via MCP, ES|QL + gated writes via REST.
- **Agent Engine sessions are Vertex-native** — mixing a Developer-API key broke session creation; keep the engine Vertex-native.
- **Design for graceful degradation** — every hop (Gemini, embeddings, MCP child, Agent Engine) has a fallback, and `/health` reports what's *actually* connected.

---

## 9 — Live & open

- **App** (no login): https://incidentiq-908307939543.europe-west1.run.app
- **Repo**: https://github.com/manojmallick/incidentiq (MIT)
- **Health proof**: `/health` → all three techs connected

**IncidentIQ — turn a 4-hour regulatory scramble into seconds, with a human always in control.**
