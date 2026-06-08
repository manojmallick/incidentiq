// IncidentIQ eval harness — the "irrefutable proof" the master plan demands.
//
// The DORA classifier (src/criteria.js) is deterministic, so this produces a REAL,
// reproducible accuracy number with no API calls and no credentials. It scores the
// classification cases as a confusion matrix and checks the recurrence rule, then
// exits non-zero if accuracy is below the target — wire it into CI as a gate.
//
//   node scripts/eval.js            # run the eval, print the report
//
// Output is also written to evals/report.json for the Devpost screenshot.

import { readFile, writeFile } from "node:fs/promises";
import { classify, recurrenceEscalation } from "../src/criteria.js";

const TARGET = Number(process.env.EVAL_TARGET ?? 0.95);

function pad(s, n) { return String(s).padEnd(n); }

async function main() {
  const gold = JSON.parse(await readFile(new URL("../evals/golden-classification.json", import.meta.url)));

  // --- classification accuracy + confusion matrix ---
  const cm = { TP: 0, TN: 0, FP: 0, FN: 0 }; // positive = MAJOR
  const rows = [];
  for (const c of gold.cases) {
    const got = classify(c.incident).classification;
    const ok = got === c.expected;
    if (c.expected === "MAJOR" && got === "MAJOR") cm.TP++;
    else if (c.expected === "MINOR" && got === "MINOR") cm.TN++;
    else if (c.expected === "MINOR" && got === "MAJOR") cm.FP++;
    else cm.FN++;
    rows.push({ name: c.name, expected: c.expected, got, ok });
  }
  const total = gold.cases.length;
  const correct = cm.TP + cm.TN;
  const accuracy = correct / total;
  const precision = cm.TP / (cm.TP + cm.FP || 1);
  const recall = cm.TP / (cm.TP + cm.FN || 1);

  // --- recurrence rule ---
  const recRows = (gold.recurrence_cases || []).map((r) => {
    const got = recurrenceEscalation(r.count).escalate;
    return { name: r.name, count: r.count, expected: r.expected_escalate, got, ok: got === r.expected_escalate };
  });
  const recOk = recRows.filter((r) => r.ok).length;

  // --- report ---
  console.log(`\nIncidentIQ — DORA classification eval (ruleset ${gold.ruleset_version})\n`);
  for (const r of rows) console.log(`  ${r.ok ? "✅" : "❌"} ${pad(r.name, 42)} expected ${pad(r.expected, 6)} got ${r.got}`);
  console.log(`\n  Confusion matrix (positive = MAJOR): TP=${cm.TP} TN=${cm.TN} FP=${cm.FP} FN=${cm.FN}`);
  console.log(`  Accuracy ${(accuracy * 100).toFixed(1)}%  ·  Precision ${(precision * 100).toFixed(1)}%  ·  Recall ${(recall * 100).toFixed(1)}%`);
  console.log(`\n  Recurrence rule: ${recOk}/${recRows.length} correct`);
  for (const r of recRows) console.log(`  ${r.ok ? "✅" : "❌"} ${pad(r.name, 50)} count ${r.count} → escalate ${r.got}`);

  const report = {
    ran_at: new Date().toISOString(), ruleset_version: gold.ruleset_version,
    classification: { total, correct, accuracy, precision, recall, confusion_matrix: cm, rows },
    recurrence: { total: recRows.length, correct: recOk, rows: recRows },
    target: TARGET, passed: accuracy >= TARGET && recOk === recRows.length,
  };
  await writeFile(new URL("../evals/report.json", import.meta.url), JSON.stringify(report, null, 2));

  const passed = report.passed;
  console.log(`\n  ${passed ? "✅ PASS" : "❌ FAIL"} — target ${(TARGET * 100).toFixed(0)}%  (report → evals/report.json)\n`);
  process.exit(passed ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(2); });
