# IncidentIQ — DORA Incident Precedent Search + Classifier

A new ICT incident arrives → IncidentIQ finds similar past incidents in Elasticsearch
(ES|QL + hybrid kNN/keyword search), applies DORA Article 17 criteria informed by how
those precedents were classified, computes the reporting deadlines, and — **with your
approval** — stores the classification and creates Kibana deadline alerts. ~12 seconds
vs ~2 hours of manual precedent search.

**Stack (Google Cloud Rapid Agent Hackathon — Elastic bucket):**
- 🧠 **Gemini 3** — precedent-informed classification rationale *(required)*
- 🏗️ **Google Cloud Agent Builder** — agent orchestration *(required)*
- 🔍 **Elasticsearch via Elastic MCP** — partner superpower *(required)*
- ☁️ Cloud Run (hosting) · Vertex AI `text-embedding-004` (query vectors)

> Working scaffold, not a finished product. Sibling of the other `*-starter/` dirs —
> same agent loop, approval gate, `/health` proof. Elastic MCP swapped in, accent teal.
> **`[TESTED: NO]`** vs live Elasticsearch/Vertex. You need an `ict-incidents` index with
> a `description_vector` dense_vector field + some seeded incidents for search to return.

## Architecture
```
Browser (public/index.html) ──POST /api/classify──► agent (src/agent.js)
                                                      1. embed + hybrid search → Elastic MCP (ES|QL + kNN)
                                                      2. classify              → criteria.js (Art.17 + precedent)
                                                      3. explain               → Gemini 3 (cites precedents)
                                                      4. deadlines             → from incident start
                                                      5. PROPOSE store+alert ─┐ (gated)
ApprovalBar (human approves) ──POST /api/execute──►  elastic index update + kibana alerts
```
The **judged** agent is [`agent-builder/agent.json`](agent-builder/agent.json)
(Gemini 3 + Elastic MCP, writes require approval). The Express app mirrors it.

## Two agents
- **ElasticSearcher** — embeds the incident, runs hybrid kNN + keyword search, aggregates impact via ES|QL.
- **DORAAnalyst** — applies Art.17 thresholds + precedent signal, explains, proposes the store + alerts.

## Index mapping (one-time)
```json
PUT ict-incidents
{ "mappings": { "properties": {
  "incident_id": { "type": "keyword" },
  "description": { "type": "text" },
  "description_vector": { "type": "dense_vector", "dims": 768, "index": true, "similarity": "cosine" },
  "dora_classification": { "type": "keyword" },
  "clients_affected_pct": { "type": "float" },
  "transaction_value_eur": { "type": "float" },
  "status": { "type": "keyword" },
  "timestamp": { "type": "date" }
}}}
```
Seed a handful of past incidents (with embeddings) so precedent search returns matches.

## Quick start (local)
```bash
cp .env.example .env     # GCP project + ELASTIC_URL + ELASTIC_API_KEY
npm install
gcloud auth application-default login && gcloud config set project "$GOOGLE_CLOUD_PROJECT"
npm run dev              # http://localhost:8080
```

## Deploy to Cloud Run
```bash
gcloud run deploy incidentiq \
  --source . \
  --region=europe-west1 \
  --allow-unauthenticated \
  --set-secrets="ELASTIC_API_KEY=incidentiq-elastic-key:latest" \
  --set-env-vars="GOOGLE_GENAI_USE_VERTEXAI=true,GEMINI_MODEL=gemini-3,ELASTIC_URL=https://your-deployment.es.cloud.es.io"
```

## Health check (proof for judges)
```bash
curl https://<your-cloud-run-url>/health
# { "status":"ok", "model":"gemini-3", "partner":"elastic", "partner_mcp_connected":true, ... }
```

## License
MIT — see [LICENSE](LICENSE).
