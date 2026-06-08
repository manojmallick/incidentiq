// DORA Article 17 major-incident criteria + reporting-deadline math.
// Shared with dynacompliance-starter — same regulation, same thresholds.

export const THRESHOLDS = {
  clients_pct: 10,
  clients_duration_min: 120,
  transaction_value_eur: 5_000_000,
  core_banking_down_min: 120,
  payments_down_min: 30,
};

export function classify(m) {
  const triggered = [];
  if (m.clients_affected_pct > THRESHOLDS.clients_pct && (m.duration_min ?? 0) > THRESHOLDS.clients_duration_min)
    triggered.push(`Clients ${m.clients_affected_pct}% > 10% for >2h`);
  if ((m.transaction_value_eur ?? 0) > THRESHOLDS.transaction_value_eur)
    triggered.push(`Transaction value €${(m.transaction_value_eur / 1e6).toFixed(1)}M > €5M`);
  if (m.data_breach) triggered.push("Customer data breach");
  if ((m.core_banking_down_min ?? 0) > THRESHOLDS.core_banking_down_min)
    triggered.push("Core banking unavailable >2h");
  if ((m.payments_down_min ?? 0) > THRESHOLDS.payments_down_min)
    triggered.push("Payment processing down >30min");
  return { classification: triggered.length ? "MAJOR" : "MINOR", triggered };
}

export function deadlines(startIso) {
  const start = new Date(startIso);
  const add = (mins) => new Date(start.getTime() + mins * 60_000).toISOString();
  return { early_warning: add(4 * 60), intermediate: add(72 * 60), final: add(30 * 24 * 60) };
}

/** Precedent-based signal: if past similar incidents were mostly MAJOR, lean MAJOR. */
export function precedentSignal(similar) {
  if (!similar?.length) return { rate: 0, lean: null };
  const major = similar.filter((s) => s.dora_classification === "MAJOR").length;
  const rate = major / similar.length;
  return { rate, lean: rate >= 0.5 ? "MAJOR" : "MINOR" };
}

// --- RECURRING-INCIDENT AGGREGATION (the hidden DORA rule most tools miss) ---
// DORA: incidents that are individually MINOR can become MAJOR *in aggregate* when
// they recur on the same service within a reference window. We surface that here.
export const RECURRENCE = { window_days: 30, count_threshold: 5 };

/**
 * @param {number} count  similar incidents on the same service in the window
 * @returns {{count,window_days,count_threshold,escalate,note}}
 */
export function recurrenceEscalation(count, { window_days, count_threshold } = RECURRENCE) {
  const escalate = (count ?? 0) >= count_threshold;
  return {
    count: count ?? 0,
    window_days,
    count_threshold,
    escalate,
    note: escalate
      ? `Recurring: ${count} similar incidents in ${window_days}d ≥ ${count_threshold} → MAJOR in aggregate (DORA recurring-incident rule)`
      : null,
  };
}

/**
 * Build reporting obligations in the SHARED Obligation schema (same shape RegQuery
 * uses) so the whole platform speaks one language. One row per DORA report stage.
 */
export function reportingObligations(incident, dl, { authority = "DNB (Netherlands)" } = {}) {
  const base = { regulation: "DORA", who: "Financial entity", authority, trigger: `Major incident ${incident.incident_id}` };
  return [
    { ...base, article: "Art.19 ¶1", what: "Submit early-warning notification", deadline: dl.early_warning },
    { ...base, article: "Art.19 ¶4", what: "Submit intermediate report", deadline: dl.intermediate },
    { ...base, article: "Art.19 ¶4", what: "Submit final report", deadline: dl.final },
  ];
}
