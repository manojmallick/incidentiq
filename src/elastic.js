// Elasticsearch integration — the partner capability.
//
// The JUDGED agent reaches Elasticsearch through the Elastic MCP / Agent Builder
// endpoint inside Google Cloud Agent Builder (see agent-builder/agent.json). This
// module mirrors the same reads/writes via the Elasticsearch REST API (ES|QL + hybrid
// search + index) so the hosted web app runs end-to-end.

const URL = process.env.ELASTIC_URL;
const KEY = process.env.ELASTIC_API_KEY;
const INDEX = process.env.ELASTIC_INCIDENTS_INDEX || "ict-incidents";

async function es(path, init = {}) {
  const res = await fetch(`${URL}${path}`, {
    ...init,
    headers: { Authorization: `ApiKey ${KEY}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  if (!res.ok) throw new Error(`Elastic ${res.status} ${path}: ${await res.text()}`);
  return res.json();
}

// --- READS (run automatically) ---

/** Find similar past incidents via hybrid (kNN vector + keyword) search.
 *  excludeId drops the incident being classified so it can't match itself. */
export async function findSimilar(queryVector, text, { k = 5, excludeId } = {}) {
  const exclude = excludeId ? { bool: { must_not: [{ term: { incident_id: excludeId } }] } } : null;
  const body = {
    query: { bool: { must: [{ match: { description: text } }], ...(excludeId ? { must_not: [{ term: { incident_id: excludeId } }] } : {}) } },
    size: k,
    _source: ["incident_id", "description", "dora_classification", "clients_affected_pct", "transaction_value_eur"],
  };
  // kNN only when an embedding vector is available; otherwise keyword-only search.
  if (queryVector) body.knn = { field: "description_vector", query_vector: queryVector, k, num_candidates: 100, ...(exclude ? { filter: exclude } : {}) };
  const d = await es(`/${INDEX}/_search`, { method: "POST", body: JSON.stringify(body) });
  return (d.hits?.hits || []).map((h) => ({ score: h._score, ...h._source }));
}

// Canned open-incident feed for the dashboard in MOCK mode (mirrors the Stitch design).
// Timestamps are relative to "now" so the dashboard always feels live (Today filter, "x min ago").
const minsAgo = (m) => new Date(Date.now() - m * 60_000).toISOString();
const mockIncidents = () => [
  {
    incident_id: "INC-2026-047", title: "Payment Service Unavailability",
    dora_classification: "MAJOR", status: "open", severity: "critical",
    clients_affected_pct: 15.2, transaction_value_eur: 8_300_000, duration_min: 47,
    affected_systems: ["PaymentProcessing", "CardAuth"], timestamp: minsAgo(47),
    description: "Payment service unavailable, 15.2% clients affected, €8.3M transactions blocked, DB connection pool exhaustion",
  },
  {
    incident_id: "INC-2026-046", title: "API latency spike in West-EU-1",
    dora_classification: "MINOR", status: "open", severity: "warning",
    clients_affected_pct: 0.4, transaction_value_eur: 0, duration_min: 12,
    affected_systems: ["APIGateway"], timestamp: minsAgo(95),
    description: "Latency: 450ms (peak) in West-EU-1",
  },
  {
    incident_id: "INC-2026-048", title: "DB warning: Connection pool at 85% saturation",
    dora_classification: null, status: "analyzing", severity: "warning",
    clients_affected_pct: 0, transaction_value_eur: 0, duration_min: 0,
    affected_systems: ["PaymentProcessing"], timestamp: minsAgo(6),
    description: "DB warning: Connection pool at 85% saturation",
  },
];

/** Total indexed incidents — backs the "precedents indexed" stat truthfully. */
export async function countIncidents() {
  if (process.env.MOCK === "true") return 128;
  try { const d = await es(`/${INDEX}/_count`); return d.count ?? 0; }
  catch { return 0; }
}

/** Open incidents for the dashboard feed. ES|QL in prod; canned data in MOCK mode. */
export async function listOpenIncidents() {
  if (process.env.MOCK === "true") return mockIncidents();
  const idx = process.env.ELASTIC_INCIDENTS_INDEX || INDEX;
  return esql(`FROM ${idx} | WHERE status == "open" OR status == "analyzing" | SORT timestamp DESC | LIMIT 20`);
}

/** Aggregate impact metrics for an incident via ES|QL. */
export async function esql(query) {
  const d = await es(`/_query`, { method: "POST", body: JSON.stringify({ query }) });
  // Map columnar ES|QL result to row objects.
  const cols = (d.columns || []).map((c) => c.name);
  return (d.values || []).map((row) => Object.fromEntries(cols.map((c, i) => [c, row[i]])));
}

/**
 * Recurring-incident count: how many incidents hit the same service in a window.
 * Powers the "MINOR-but-recurrent → MAJOR in aggregate" DORA rule via ES|QL STATS.
 * @returns {Promise<number>}
 */
export async function recurrenceCount({ service, windowDays = 30 } = {}) {
  if (process.env.MOCK === "true") return 6; // canned: enough to trigger escalation in the demo
  if (!service) return 0;
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();
  // MV_EXPAND handles affected_systems being multi-valued; count matching incidents.
  const q =
    `FROM ${INDEX} | WHERE timestamp > "${since}" ` +
    `| MV_EXPAND affected_systems | WHERE affected_systems == "${service}" ` +
    `| STATS c = COUNT(*)`;
  const rows = await esql(q);
  return Number(rows?.[0]?.c ?? 0);
}

// --- WRITES (consequential — gated on human approval in server.js /execute) ---
export const storeClassification = (incidentId, fields) =>
  es(`/${INDEX}/_update/${encodeURIComponent(incidentId)}?refresh=wait_for`, {
    method: "POST",
    body: JSON.stringify({ doc: fields, doc_as_upsert: true }),
  });

// --- SHARED Obligation ledger + audit log (same schema as RegQuery — the platform spine) ---
const OBLIG = process.env.ELASTIC_OBLIGATIONS_INDEX || "obligations";
const AUDIT = process.env.ELASTIC_AUDIT_INDEX || "audit_log";
const mem = { obligations: [], audit: [] }; // MOCK in-memory stores

export async function recordObligations(companyId, obligations = []) {
  const now = new Date().toISOString();
  const docs = obligations.map((o) => ({
    company_id: companyId,
    obligation_id: o.obligation_id || `${o.regulation || "?"}-${o.article || "?"}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    regulation: o.regulation || null, article: o.article || null, who: o.who || null,
    what: o.what || null, deadline: o.deadline || null, authority: o.authority || null,
    trigger: o.trigger || null, status: "open", created_at: now,
  }));
  if (!docs.length) return { inserted: 0 };
  if (process.env.MOCK === "true") { mem.obligations.push(...docs); return { inserted: docs.length }; }
  await es(`/${OBLIG}/_bulk?refresh=wait_for`, { method: "POST",
    headers: { "Content-Type": "application/x-ndjson" },
    body: docs.map((d) => `{"index":{}}\n${JSON.stringify(d)}\n`).join("") });
  return { inserted: docs.length };
}

export async function listObligations(companyId) {
  if (process.env.MOCK === "true") return mem.obligations.filter((o) => o.company_id === companyId);
  try {
    const d = await es(`/${OBLIG}/_search`, { method: "POST",
      body: JSON.stringify({ query: { term: { "company_id.keyword": companyId } }, size: 100, sort: [{ created_at: "desc" }] }) });
    return (d.hits?.hits || []).map((h) => h._source);
  } catch (e) {
    if (String(e.message).includes("index_not_found")) return []; // empty ledger before first filing
    throw e;
  }
}

export async function recordAudit(entry) {
  const doc = { ...entry, at: new Date().toISOString() };
  if (process.env.MOCK === "true") { mem.audit.push(doc); return doc; }
  await es(`/${AUDIT}/_doc`, { method: "POST", body: JSON.stringify(doc) });
  return doc;
}

export async function pingElastic() {
  if (process.env.MOCK === "true") return true;
  try { await es(`/_cluster/health`); return true; } catch { return false; }
}
