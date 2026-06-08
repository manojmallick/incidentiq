// One-shot setup for a real Elastic Cloud deployment:
//   1. creates the ict-incidents index with a 768-dim dense_vector mapping
//   2. seeds historical precedents + recent recurrence-triggering incidents
//   3. embeds each description with Gemini (text-embedding-004) so hybrid kNN search works
//
// Run:  npm run setup:elastic   (loads .env automatically)
// Re-runnable: pass --reset to drop and recreate the index.

import { GoogleGenAI } from "@google/genai";

const URL = process.env.ELASTIC_URL;
const KEY = process.env.ELASTIC_API_KEY;
const INDEX = process.env.ELASTIC_INCIDENTS_INDEX || "ict-incidents";
const EMBED = process.env.EMBEDDING_MODEL || "text-embedding-004";
const RESET = process.argv.includes("--reset");

if (!URL || !KEY) {
  console.error("✗ ELASTIC_URL and ELASTIC_API_KEY must be set in .env first.");
  console.error("  Elastic Cloud → your deployment → copy the Elasticsearch endpoint, then create an API key.");
  process.exit(1);
}

const ai = new GoogleGenAI(process.env.GEMINI_API_KEY ? { apiKey: process.env.GEMINI_API_KEY } : { vertexai: true });

async function es(path, init = {}) {
  const res = await fetch(`${URL}${path}`, {
    ...init,
    headers: { Authorization: `ApiKey ${KEY}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Elastic ${res.status} ${path}: ${text}`);
  return text ? JSON.parse(text) : {};
}

async function embed(text) {
  // 768-dim to match the dense_vector index mapping (gemini-embedding-001 defaults to 3072).
  const r = await ai.models.embedContent({ model: EMBED, contents: text, config: { outputDimensionality: 768 } });
  return r.embeddings[0].values;
}

const daysAgo = (d) => new Date(Date.now() - d * 24 * 60 * 60 * 1000).toISOString();

// Seed set: 2025 precedents (mixed MAJOR/MINOR) + recent PaymentProcessing incidents
// (≥5 in 30d) so the DORA recurring-incident escalation rule fires, + today's open incidents.
const SEED = [
  { incident_id: "INC-2025-112", title: "Card Processing Outage", dora_classification: "MAJOR", status: "closed", severity: "critical", clients_affected_pct: 22, transaction_value_eur: 11_000_000, duration_min: 95, payments_down_min: 95, affected_systems: ["PaymentProcessing", "CardAuth"], root_cause_third_party: true, timestamp: daysAgo(210), description: "Card processing outage: authorization failures across the estate, 22% of clients affected, €11M transactions blocked, upstream acquirer timeout." },
  { incident_id: "INC-2025-089", title: "Payment Gateway Down", dora_classification: "MAJOR", status: "closed", severity: "critical", clients_affected_pct: 18, transaction_value_eur: 7_400_000, duration_min: 61, payments_down_min: 61, affected_systems: ["PaymentProcessing"], root_cause_third_party: false, timestamp: daysAgo(180), description: "Payment gateway down: checkout and transfers failing, 18% clients affected, €7.4M blocked, DB connection pool exhaustion." },
  { incident_id: "INC-2025-203", title: "Latency spike on checkout", dora_classification: "MINOR", status: "closed", severity: "warning", clients_affected_pct: 1.5, transaction_value_eur: 0, duration_min: 18, payments_down_min: 0, affected_systems: ["APIGateway"], root_cause_third_party: false, timestamp: daysAgo(120), description: "Latency spike on checkout: p95 450ms for 18 minutes, no failed transactions, autoscaling lag." },
  { incident_id: "INC-2025-150", title: "Core banking degraded", dora_classification: "MAJOR", status: "closed", severity: "critical", clients_affected_pct: 12, transaction_value_eur: 0, duration_min: 140, payments_down_min: 0, core_banking_down_min: 140, affected_systems: ["CoreBanking"], root_cause_third_party: false, timestamp: daysAgo(150), description: "Core banking degraded for over two hours, account servicing unavailable for 12% of clients." },

  // Recent recurrence cluster on PaymentProcessing (within 30 days)
  { incident_id: "INC-2026-031", title: "Payment retries elevated", dora_classification: "MINOR", status: "closed", severity: "warning", clients_affected_pct: 0.8, transaction_value_eur: 0, duration_min: 9, payments_down_min: 0, affected_systems: ["PaymentProcessing"], root_cause_third_party: false, timestamp: daysAgo(26), description: "Elevated payment retries on PaymentProcessing, brief degradation, recovered automatically." },
  { incident_id: "INC-2026-034", title: "Payment timeout burst", dora_classification: "MINOR", status: "closed", severity: "warning", clients_affected_pct: 1.2, transaction_value_eur: 0, duration_min: 14, payments_down_min: 4, affected_systems: ["PaymentProcessing"], root_cause_third_party: true, timestamp: daysAgo(19), description: "Payment timeout burst on PaymentProcessing, third-party acquirer latency, partial failures." },
  { incident_id: "INC-2026-037", title: "Payment queue backlog", dora_classification: "MINOR", status: "closed", severity: "warning", clients_affected_pct: 0.6, transaction_value_eur: 0, duration_min: 11, payments_down_min: 0, affected_systems: ["PaymentProcessing"], root_cause_third_party: false, timestamp: daysAgo(12), description: "Payment queue backlog on PaymentProcessing, processing delayed, no client-facing failures." },
  { incident_id: "INC-2026-041", title: "Payment auth errors", dora_classification: "MINOR", status: "closed", severity: "warning", clients_affected_pct: 1.1, transaction_value_eur: 0, duration_min: 16, payments_down_min: 6, affected_systems: ["PaymentProcessing"], root_cause_third_party: true, timestamp: daysAgo(6), description: "Intermittent payment auth errors on PaymentProcessing, third-party DB connection pool pressure." },

  // Today's open incidents (match the dashboard)
  { incident_id: "INC-2026-046", title: "API latency spike in West-EU-1", dora_classification: "MINOR", status: "open", severity: "warning", clients_affected_pct: 0.4, transaction_value_eur: 0, duration_min: 12, payments_down_min: 0, affected_systems: ["APIGateway"], root_cause_third_party: false, timestamp: daysAgo(0), description: "API latency spike in West-EU-1, p95 450ms peak, no failed transactions." },
  { incident_id: "INC-2026-047", title: "Payment Service Unavailability", dora_classification: "MAJOR", status: "open", severity: "critical", clients_affected_pct: 15.2, transaction_value_eur: 8_300_000, duration_min: 47, payments_down_min: 47, affected_systems: ["PaymentProcessing", "CardAuth"], root_cause_third_party: true, timestamp: daysAgo(0), description: "Payment service unavailable, 15.2% clients affected, €8.3M transactions blocked, DB connection pool exhaustion (AWS RDS)." },
  { incident_id: "INC-2026-048", title: "DB warning: Connection pool at 85% saturation", dora_classification: null, status: "analyzing", severity: "warning", clients_affected_pct: 0, transaction_value_eur: 0, duration_min: 0, payments_down_min: 0, affected_systems: ["PaymentProcessing"], root_cause_third_party: false, timestamp: daysAgo(0), description: "Database warning: connection pool at 85% saturation on PaymentProcessing, no client impact yet." },
];

// Generate a realistic historical corpus so precedent search runs over 100+ incidents
// (backs the "100+ precedents" claim; the displayed count is read live from Elastic).
// Deterministic (index-based, not random) so re-seeds are reproducible.
const G_SVC = ["PaymentProcessing","CardAuth","CoreBanking","APIGateway","MobileApp","FraudEngine","SettlementBatch","KYCService","NotificationService","TradingPlatform","OnlineBanking","ATMNetwork"];
const G_ROOT = ["third-party provider outage","DB connection pool exhaustion","TLS certificate expiry","misconfigured autoscaling rule","upstream acquirer timeout","cache stampede after deploy","network partition in West-EU-1","memory leak following a release","rate-limit cascade","DNS resolution failure","Kafka consumer lag","expired API credential","disk saturation on primary node","failover that did not trigger"];
const G_SYMPTOM = ["elevated error rates","a latency spike","a complete outage","intermittent failures","degraded throughput","widespread timeouts","partial unavailability"];
const pick = (a, i) => a[((i % a.length) + a.length) % a.length];

function generateCorpus(n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const svc = pick(G_SVC, i);
    const root = pick(G_ROOT, i * 3 + 1);
    const symptom = pick(G_SYMPTOM, i * 5 + 2);
    const isMajor = i % 3 === 0; // ~1/3 major
    const isPayment = /Payment|Card|Settlement|Trading/.test(svc);
    const clients = isMajor ? 11 + (i % 14) + 0.3 : 0.2 + (i % 4);
    const value = isMajor && isPayment ? (5_500_000 + (i % 10) * 1_100_000) : 0;
    const duration = isMajor ? 60 + (i % 12) * 10 : 4 + (i % 20);
    const paymentsDown = isMajor && isPayment ? 31 + (i % 8) * 7 : 0;
    const coreDown = isMajor && svc === "CoreBanking" ? 121 + (i % 6) * 12 : 0;
    const cls = (value > 5_000_000 || paymentsDown > 30 || coreDown > 120 || (clients > 10 && duration > 120)) ? "MAJOR" : "MINOR";
    const yy = 2025 + ((i % 12) < 6 ? 0 : 0);
    const seq = String(100 + i).padStart(3, "0");
    out.push({
      incident_id: `INC-${yy}-H${seq}`,
      title: `${svc} ${symptom.replace(/^a |^an /, "")}`,
      dora_classification: cls,
      status: "closed",
      severity: cls === "MAJOR" ? "critical" : "warning",
      clients_affected_pct: Math.round(clients * 10) / 10,
      transaction_value_eur: value,
      duration_min: duration,
      payments_down_min: paymentsDown,
      core_banking_down_min: coreDown,
      affected_systems: [svc],
      root_cause_third_party: i % 4 === 0,
      timestamp: daysAgo(40 + (i % 320)), // older than the recent recurrence cluster
      description: `${svc} experienced ${symptom} caused by ${root}. About ${Math.round(clients * 10) / 10}% of clients affected${value ? `, ~€${(value / 1e6).toFixed(1)}M transactions impacted` : ""}; duration ${duration} minutes. Classified ${cls} under DORA Art.18.`,
    });
  }
  return out;
}

const ALL_INCIDENTS = [...SEED, ...generateCorpus(117)]; // 11 hero + 117 = 128

const MAPPINGS = {
  mappings: {
    properties: {
      incident_id: { type: "keyword" },
      title: { type: "text" },
      description: { type: "text" },
      description_vector: { type: "dense_vector", dims: 768, index: true, similarity: "cosine" },
      dora_classification: { type: "keyword" },
      status: { type: "keyword" },
      severity: { type: "keyword" },
      clients_affected_pct: { type: "float" },
      transaction_value_eur: { type: "long" },
      duration_min: { type: "integer" },
      payments_down_min: { type: "integer" },
      core_banking_down_min: { type: "integer" },
      affected_systems: { type: "keyword" },
      root_cause_third_party: { type: "boolean" },
      timestamp: { type: "date" },
    },
  },
};

async function main() {
  console.log(`→ Elastic: ${URL}`);
  console.log(`→ Index:   ${INDEX}`);

  if (RESET) {
    try { await es(`/${INDEX}`, { method: "DELETE" }); console.log("• dropped existing index (--reset)"); } catch {}
  }

  try {
    await es(`/${INDEX}`, { method: "PUT", body: JSON.stringify(MAPPINGS) });
    console.log("✓ created index with dense_vector(768) mapping");
  } catch (e) {
    if (String(e.message).includes("resource_already_exists")) console.log("• index already exists (use --reset to recreate)");
    else throw e;
  }

  console.log(`• embedding ${ALL_INCIDENTS.length} incidents with ${EMBED}…`);
  let lines = "";
  for (const doc of ALL_INCIDENTS) {
    const description_vector = await embed(doc.description);
    lines += JSON.stringify({ index: { _index: INDEX, _id: doc.incident_id } }) + "\n";
    lines += JSON.stringify({ ...doc, description_vector }) + "\n";
    process.stdout.write(".");
  }
  process.stdout.write("\n");

  const r = await es(`/_bulk?refresh=true`, {
    method: "POST",
    headers: { "Content-Type": "application/x-ndjson" },
    body: lines,
  });
  const errors = (r.items || []).filter((i) => i.index?.error);
  if (errors.length) { console.error("✗ bulk errors:", JSON.stringify(errors[0].index.error)); process.exit(1); }

  console.log(`✓ seeded ${ALL_INCIDENTS.length} incidents (${ALL_INCIDENTS.filter((s) => s.dora_classification === "MAJOR").length} MAJOR, recurrence cluster on PaymentProcessing)`);

  // Pre-create the shared ledger indices so the Compliance Vault reads cleanly (empty) before any filing.
  for (const idx of [process.env.ELASTIC_OBLIGATIONS_INDEX || "obligations", process.env.ELASTIC_AUDIT_INDEX || "audit_log"]) {
    // Leave company_id to dynamic mapping (text + .keyword) so the listObligations term query matches.
    try { await es(`/${idx}`, { method: "PUT", body: JSON.stringify({ mappings: { properties: { created_at: { type: "date" }, at: { type: "date" } } } }) }); console.log(`✓ created ${idx} index`); }
    catch (e) { if (String(e.message).includes("resource_already_exists")) console.log(`• ${idx} already exists`); else throw e; }
  }
  console.log("\nDone. Start the app live:  npm start   (then open http://localhost:8080)");
}

main().catch((e) => { console.error("\n✗", e.message); process.exit(1); });
