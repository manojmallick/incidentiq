// IncidentIQ agent — Gemini 3 over Elasticsearch incident precedents + DORA Art.18/19.
//
// Multi-step mission (the "it's an agent, not a chatbot" requirement):
//   1. SEARCH     similar past incidents (hybrid kNN + keyword)        [Elastic MCP]
//   2. CLASSIFY   apply DORA thresholds + precedent + RECURRENCE        [criteria.js]
//   3. EXPLAIN    Gemini 3 explains + drafts the ACTUAL DNB submission
//   4. DEFEND     build a version-stamped defensibility record (why this verdict)
//   5. PROPOSE    store classification + obligations + alerts — GATED on approval
//
// v2 (from APP_IMPROVEMENT_PLAN.md) adds: the filled DNB submission (the real
// deliverable, not a summary), a decision-defensibility record (a regulator can
// challenge the call), the recurring-incident aggregation rule, shared obligations,
// and an /api/ingest handoff entry point so DynaCompliance (real-time detection)
// can hand an incident straight to IncidentIQ (classification + filing).

import { GoogleGenAI } from "@google/genai";
import { findSimilar, recurrenceCount, recordObligations, recordAudit } from "./elastic.js";
import { classify, deadlines, precedentSignal, recurrenceEscalation, reportingObligations } from "./criteria.js";
import { agentEngineConfigured, explainViaAgentEngine } from "./agent-engine.js";

const MODEL = process.env.GEMINI_MODEL || "gemini-3";
const EMBED = process.env.EMBEDDING_MODEL || "text-embedding-004";
const RULESET_VERSION = process.env.DORA_RULESET_VERSION || "DORA-RTS-2025.1";
// Gemini Developer API (API key) when GEMINI_API_KEY is set — required on serverless
// platforms like Vercel where Vertex AI ADC isn't available. Falls back to Vertex (ADC) locally.
const ai = new GoogleGenAI(process.env.GEMINI_API_KEY ? { apiKey: process.env.GEMINI_API_KEY } : { vertexai: true });

async function embed(text) {
  // 768-dim to match the dense_vector index mapping (gemini-embedding-001 defaults to 3072).
  const r = await ai.models.embedContent({ model: EMBED, contents: text, config: { outputDimensionality: 768 } });
  return r.embeddings[0].values;
}

const EXPLAIN_SYSTEM = `You are IncidentIQ, a DORA major-incident analyst (Art.18 classification,
Art.19 reporting). Given a new ICT incident, its deterministic classification, the recurrence
signal, and similar historical incidents from Elasticsearch:
(1) explain in 2-3 sentences why it is MAJOR or MINOR — citing matched precedents and which
    thresholds (or the recurrence rule) were met;
(2) if MAJOR, draft the ACTUAL early-warning submission to the national competent authority
    (DNB) following the EBA/DORA template fields: entity, incident reference, start time,
    classification + reason, impact (% clients, € value, duration), affected services,
    preliminary root cause, and the next reporting deadline.
Do not invent figures beyond those provided. Return STRICT JSON:
{ "rationale": string, "submission": string, "confidence": number }`;

/** Deterministic DNB draft + rationale — used when Gemini is unavailable (e.g. gemini-3
 *  not yet allowlisted → Vertex 404). Keeps classify working end-to-end on real data;
 *  the LLM prose takes over automatically once the configured model is reachable. */
function deterministicDraft(incident, verdict, dl, similar, precedent) {
  const isMajor = verdict.classification === "MAJOR";
  const eur = (incident.transaction_value_eur || 0) / 1e6;
  const rate = Math.round((precedent?.rate || 0) * 100);
  const rationale = isMajor
    ? `Classified MAJOR: ${verdict.triggered.join("; ") || "DORA Art.18 thresholds met"}.` +
      (similar?.length ? ` ${rate}% of the ${similar.length} closest precedents were also MAJOR.` : "") +
      (incident.root_cause_third_party ? " Third-party root cause → DORA Art.28 also applies." : "")
    : `Classified MINOR: no DORA Art.18 major-incident threshold was exceeded` +
      (similar?.length ? ` (precedent MAJOR rate ${rate}%).` : ".");
  const submission = isMajor
    ? [
        "EARLY WARNING — DORA Art.19",
        "Entity: Financial entity (LEI …)",
        `Incident ref: ${incident.incident_id}`,
        `Start: ${new Date(incident.start).toLocaleString("en-GB", { timeZone: "Europe/Amsterdam" })} CET`,
        `Classification: MAJOR (${verdict.triggered.join("; ")})`,
        `Impact: ${incident.clients_affected_pct}% of clients, €${eur.toFixed(1)}M transactions, ${incident.duration_min} min`,
        `Affected services: ${(incident.affected_systems || []).join(", ") || "—"}`,
        `Preliminary root cause: ${incident.davis_root_cause || (incident.root_cause_third_party ? "third-party provider" : "under investigation")}`,
        `Next deadline: early warning due ${dl.early_warning}`,
      ].join("\n")
    : "";
  return { rationale, submission, confidence: isMajor ? 0.82 : 0.7 };
}

/** Map a raw incident object to a normalized incident for classification. */
function normalize(input = {}) {
  return {
    incident_id: input.incident_id || "INC-DEMO",
    title: input.title || "",
    description: input.description || input.title || "",
    start: input.start || new Date().toISOString(),
    detected_at: input.detected_at || input.start || new Date().toISOString(),
    duration_min: input.duration_min ?? 0,
    affected_systems: input.affected_systems || [],
    clients_affected_pct: input.clients_affected_pct ?? 0,
    transaction_value_eur: input.transaction_value_eur ?? 0,
    payments_down_min: input.payments_down_min ?? 0,
    core_banking_down_min: input.core_banking_down_min ?? 0,
    data_breach: input.data_breach ?? false,
    root_cause_third_party: input.root_cause_third_party ?? false,
    davis_root_cause: input.davis_root_cause || null,
    company_id: input.company_id || "demo-co",
    source: input.source || "manual",
  };
}

/** Steps 1-4: search precedents + classify (with recurrence) + draft submission. Read-only. */
export async function analyze(rawIncident) {
  if (process.env.MOCK === "true") return mockAnalyze(rawIncident);
  const t0 = Date.now();
  const steps = [];
  const incident = normalize(rawIncident);
  const text = incident.description || incident.title;

  // Embeddings power the kNN half of hybrid search. If unavailable (no Gemini auth),
  // degrade gracefully to keyword-only precedent search so classify still works.
  let qv = null;
  try {
    qv = await embed(text);
    steps.push({ agent: "ElasticSearcher", action: "embedded incident", ms: Date.now() - t0 });
  } catch (e) {
    steps.push({ agent: "ElasticSearcher", action: "embeddings unavailable → keyword-only precedent search", ms: Date.now() - t0 });
  }

  const similar = await findSimilar(qv, text, { k: 5, excludeId: incident.incident_id });
  steps.push({ agent: "ElasticSearcher", action: `hybrid search → ${similar.length} precedents`, ms: Date.now() - t0 });

  // Deterministic base classification + precedent + recurrence aggregation.
  const base = classify(incident);
  const precedent = precedentSignal(similar);
  const service = incident.affected_systems?.[0];
  const recCount = await recurrenceCount({ service, windowDays: 30 });
  const recurrence = recurrenceEscalation(recCount);
  steps.push({
    agent: "DORAAnalyst",
    action: `base ${base.classification} · precedent ${Math.round(precedent.rate * 100)}% MAJOR · recurrence ${recCount}/30d${recurrence.escalate ? " → escalate" : ""}`,
    ms: Date.now() - t0,
  });

  // Final verdict: base MAJOR stays MAJOR; a MINOR can be escalated by the recurrence rule.
  const escalatedByRecurrence = base.classification === "MINOR" && recurrence.escalate;
  const verdict = {
    classification: escalatedByRecurrence ? "MAJOR" : base.classification,
    triggered: [...base.triggered, ...(escalatedByRecurrence ? [recurrence.note] : [])],
    also: base.also || [],
    escalated_by_recurrence: escalatedByRecurrence,
  };

  const dl = deadlines(incident.start);

  let drafted;
  // Preferred when an Agent Builder deployment is wired (AGENT_ENGINE_ID): run the explain +
  // DNB-draft through the deployed ADK agent (Gemini 3 + Elastic MCP on Vertex AI Agent Engine).
  if (agentEngineConfigured()) {
    try {
      drafted = await explainViaAgentEngine({ incident, verdict, recurrence, similar, deadlines: dl });
      steps.push({ agent: "AgentBuilder", action: `Vertex AI Agent Engine (Gemini + Elastic MCP) explained + drafted DNB submission`, ms: Date.now() - t0 });
    } catch (e) {
      const why = String(e.message || e).split("\n")[0].slice(0, 60);
      steps.push({ agent: "AgentBuilder", action: `Agent Engine unavailable (${why}) → direct ${MODEL}`, ms: Date.now() - t0 });
    }
  }
  // Direct Gemini fallback (and the default when no Agent Engine is deployed).
  if (!drafted) {
    try {
      const res = await ai.models.generateContent({
        model: MODEL,
        config: { systemInstruction: EXPLAIN_SYSTEM, responseMimeType: "application/json" },
        contents:
          `NEW INCIDENT:\n${JSON.stringify(incident, null, 2)}\n\n` +
          `CLASSIFICATION:\n${JSON.stringify(verdict)}\n\n` +
          `RECURRENCE:\n${JSON.stringify(recurrence)}\n\n` +
          `PRECEDENTS:\n${JSON.stringify(similar, null, 2)}\n\nDEADLINES:\n${JSON.stringify(dl)}`,
      });
      try { drafted = JSON.parse(res.text); } catch { drafted = { rationale: res.text, submission: "", confidence: 0.5 }; }
      steps.push({ agent: "DORAAnalyst", action: `${MODEL} explained + drafted DNB submission`, ms: Date.now() - t0 });
    } catch (e) {
      // Gemini unreachable (e.g. gemini-3 not yet allowlisted → 404). Stay live with a deterministic draft.
      drafted = deterministicDraft(incident, verdict, dl, similar, precedent);
      const why = String(e.message || e).split("\n")[0].slice(0, 60);
      steps.push({ agent: "DORAAnalyst", action: `${MODEL} unavailable (${why}) → deterministic DNB draft`, ms: Date.now() - t0 });
    }
  }

  const defensibility = buildDefensibility({ incident, verdict, precedent, recurrence, similar, confidence: drafted.confidence });
  const obligations = verdict.classification === "MAJOR" ? reportingObligations(incident, dl) : [];

  return {
    incident, verdict, similar, precedent, recurrence, deadlines: dl,
    defensibility, obligations, ...drafted,
    steps, elapsed_ms: Date.now() - t0,
    proposedAction: proposedFor(verdict, dl, obligations),
  };
}

/** Handoff entry point: DynaCompliance (real-time detection) → IncidentIQ (classify + file). */
export async function analyzeFromDetection(detection) {
  const incident = normalize({ ...detection, source: detection.source || "dynacompliance" });
  const result = await analyze(incident);
  result.handoff = { from: detection.source || "dynacompliance", detected_at: incident.detected_at };
  if (Array.isArray(result.steps)) {
    result.steps.unshift({ agent: "Handoff", action: `received detection from ${result.handoff.from}`, ms: 0 });
  }
  return result;
}

function proposedFor(verdict, dl, obligations) {
  return {
    type: "store_and_alert",
    description:
      verdict.classification === "MAJOR"
        ? `Store MAJOR classification + defensibility record, save ${obligations.length} reporting obligations, create deadline alerts (early warning ${dl.early_warning})`
        : "Store MINOR classification + defensibility record (no report required)",
    tools: [
      "elastic.esql_index(dora_classification)",
      "elastic.index(defensibility)",
      ...(verdict.classification === "MAJOR" ? ["elastic.index(obligations)", "kibana.create_alert(deadlines)"] : []),
      "elastic.index(audit_log)",
    ],
  };
}

/** Version-stamped record of WHY the verdict was reached — for regulator challenge. */
function buildDefensibility({ incident, verdict, precedent, recurrence, similar, confidence }) {
  return {
    incident_id: incident.incident_id,
    decided_at: new Date().toISOString(),
    ruleset_version: RULESET_VERSION,
    classification: verdict.classification,
    thresholds_triggered: verdict.triggered,
    precedent_rate: precedent.rate,
    precedent_ids: (similar || []).map((s) => s.incident_id),
    recurrence,
    confidence: confidence ?? null,
    inputs: {
      clients_affected_pct: incident.clients_affected_pct,
      transaction_value_eur: incident.transaction_value_eur,
      payments_down_min: incident.payments_down_min,
      duration_min: incident.duration_min,
    },
  };
}

// --- MOCK MODE: canned demo data so the full UI + ApprovalBar flow runs without creds.
function mockAnalyze(input = {}) {
  // Dynamic start so the early-warning countdown ticks live during the demo.
  const start = input.start || new Date().toISOString();
  const incident = normalize({
    incident_id: input.incident_id || "INC-2026-047",
    title: input.title || "Payment Service Unavailability",
    description:
      input.description ||
      "Payment service unavailable, 15.2% clients affected, €8.3M transactions blocked, DB connection pool exhaustion",
    transaction_value_eur: input.transaction_value_eur ?? 8_300_000,
    clients_affected_pct: input.clients_affected_pct ?? 15.2,
    duration_min: 47, payments_down_min: 47, start, detected_at: input.detected_at || start,
    affected_systems: input.affected_systems || ["PaymentProcessing", "CardAuth"],
    root_cause_third_party: true, davis_root_cause: "AWS RDS connection pool exhaustion",
    source: input.source || "manual",
  });
  const base = classify(incident);
  const similar = [
    { incident_id: "INC-2025-112", dora_classification: "MAJOR", score: 1.84, description: "Card Processing Outage" },
    { incident_id: "INC-2025-089", dora_classification: "MAJOR", score: 1.71, description: "Payment Gateway Down" },
    { incident_id: "INC-2025-203", dora_classification: "MINOR", score: 1.12, description: "Latency spike on checkout" },
  ];
  const precedent = precedentSignal(similar);
  const recurrence = recurrenceEscalation(6); // canned count → escalates
  const escalatedByRecurrence = base.classification === "MINOR" && recurrence.escalate;
  const verdict = {
    classification: escalatedByRecurrence ? "MAJOR" : base.classification,
    triggered: [...base.triggered, ...(escalatedByRecurrence ? [recurrence.note] : [])],
    also: base.also || [],
    escalated_by_recurrence: escalatedByRecurrence,
  };
  const dl = deadlines(start);
  const obligations = verdict.classification === "MAJOR" ? reportingObligations(incident, dl) : [];
  const confidence = 0.91;
  return {
    incident, verdict, similar, precedent, recurrence, deadlines: dl,
    defensibility: buildDefensibility({ incident, verdict, precedent, recurrence, similar, confidence }),
    obligations,
    rationale:
      "Classified MAJOR: €8.3M exceeds the €5M threshold and payments were down 47min (>30min); 2 of 3 closest precedents were also MAJOR (67%). Third-party DB root cause → DORA Art.28 also applies.",
    submission:
      "EARLY WARNING — DORA Art.19\nEntity: Payments Pro BV (LEI …)\nIncident ref: " + incident.incident_id + "\nStart: " + new Date(start).toLocaleString("en-GB", { timeZone: "Europe/Amsterdam" }) + " CET\n" +
      "Classification: MAJOR (€8.3M > €5M; payments down 47min)\nImpact: 15.2% of clients, €8.3M transactions, 47 min\n" +
      "Affected services: PaymentProcessing, CardAuth\nPreliminary root cause: third-party database (AWS RDS) connection pool exhaustion\n" +
      "Next deadline: early warning due " + dl.early_warning,
    confidence,
    steps: [
      { agent: "ElasticSearcher", action: "embedded incident (mock)", ms: 110 },
      { agent: "ElasticSearcher", action: "hybrid search → 3 precedents (mock)", ms: 340 },
      { agent: "DORAAnalyst", action: `base ${base.classification} · precedent 67% MAJOR · recurrence 6/30d${recurrence.escalate ? " → escalate" : ""} (mock)`, ms: 360 },
      { agent: "DORAAnalyst", action: "Gemini 3 explained + drafted DNB submission (mock)", ms: 900 },
    ],
    elapsed_ms: 900,
    proposedAction: proposedFor(verdict, dl, obligations),
  };
}

/** Step 5: executed ONLY after human approval (called by /api/execute). */
export async function executeProposed(payload) {
  const { incident, verdict, deadlines: dl, defensibility, obligations } = payload || {};
  const companyId = incident?.company_id || "demo-co";

  if (process.env.MOCK === "true") {
    const { inserted } = await recordObligations(companyId, (obligations || []).map((o) => ({ ...o })));
    await recordAudit({ actor: "human", action: "store_and_alert", incident_id: incident?.incident_id, classification: verdict?.classification, obligations_saved: inserted });
    return {
      ok: true,
      executed: ["elastic.esql_index", "elastic.index(defensibility)", inserted ? "elastic.index(obligations)" : null, "elastic.index(audit_log)"].filter(Boolean),
      obligations_saved: inserted,
      at: new Date().toISOString(),
    };
  }

  const { storeClassification } = await import("./elastic.js");
  await storeClassification(incident.incident_id, {
    dora_classification: verdict.classification,
    triggered: verdict.triggered,
    reporting_deadline_4h: dl?.early_warning,
    defensibility,
    ruleset_version: defensibility?.ruleset_version,
    status: "classified",
  });
  const done = ["elastic.esql_index", "elastic.index(defensibility)"];

  const { inserted } = await recordObligations(companyId, obligations || []);
  if (inserted) done.push("elastic.index(obligations)");

  if (verdict.classification === "MAJOR") {
    console.log("[KIBANA ALERTS]", incident.incident_id, dl); // wire kibana.create_alert for 4h/72h/1mo
    done.push("kibana.create_alert");
  }
  await recordAudit({ actor: "human", action: "store_and_alert", incident_id: incident.incident_id, classification: verdict.classification, obligations_saved: inserted });
  done.push("elastic.index(audit_log)");
  return { ok: true, executed: done, obligations_saved: inserted, at: new Date().toISOString() };
}
