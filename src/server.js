// IncidentIQ hosted backend — Express. Search precedents + classify + gated writes.

import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { analyze, analyzeFromDetection, executeProposed } from "./agent.js";
import { esql, pingElastic, listObligations, listOpenIncidents, countIncidents } from "./elastic.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "../public"); // absolute → works on Vercel too

const app = express();
app.use(express.json({ limit: "1mb" }));

// Optional password gate (HTTP Basic). Enabled only when APP_PASSWORD is set, so local
// dev stays open. Protects the whole app — including writes to Elastic — on public deploys.
const AUTH_USER = process.env.APP_USERNAME || "judge";
const AUTH_PASS = process.env.APP_PASSWORD;
if (AUTH_PASS) {
  app.use((req, res, next) => {
    const [scheme, enc] = (req.headers.authorization || "").split(" ");
    if (scheme === "Basic" && enc) {
      const [u, p] = Buffer.from(enc, "base64").toString().split(":");
      if (u === AUTH_USER && p === AUTH_PASS) return next();
    }
    res.set("WWW-Authenticate", 'Basic realm="IncidentIQ"');
    return res.status(401).send("Authentication required");
  });
}

app.use(express.static(PUBLIC_DIR));

// --- Health: proves the required stack is wired ---
app.get("/health", async (_req, res) => {
  res.json({
    status: "ok",
    service: "incidentiq",
    version: "2.0.0",
    model: process.env.GEMINI_MODEL || "gemini-3",
    partner: "elastic",
    partner_mcp_connected: await pingElastic(),
    indexed: await countIncidents(),
    agents: ["ElasticSearcher", "DORAAnalyst"],
    regulations: ["DORA Art.18", "DORA Art.19", "DORA Art.28"],
    features: ["recurrence_aggregation", "dnb_submission_draft", "defensibility_record", "obligation_ledger", "detection_handoff"],
    timestamp: new Date().toISOString(),
  });
});

// --- Open incidents for the dashboard (beat 1), via ES|QL ---
app.get("/api/incidents", async (_req, res) => {
  try { res.json(await listOpenIncidents()); }
  catch (e) { res.status(500).json({ error: String(e.message || e) }); }
});

// --- Beat 1→2: classify an incident from its description (read-only steps 1-4) ---
app.post("/api/classify", async (req, res) => {
  const incident = req.body || {};
  if (!incident.description && !incident.title) return res.status(400).json({ error: "description or title required" });
  try { res.json(await analyze(incident)); }
  catch (e) { res.status(500).json({ error: String(e.message || e) }); }
});

// --- Cross-app handoff: DynaCompliance (real-time detection) → IncidentIQ (classify + file).
//     Body = a detection payload { source, incident_id, start, detected_at, metrics... } ---
app.post("/api/ingest", async (req, res) => {
  const detection = req.body || {};
  if (!detection.incident_id && !detection.description && !detection.title)
    return res.status(400).json({ error: "detection needs incident_id or description/title" });
  try { res.json(await analyzeFromDetection(detection)); }
  catch (e) { res.status(500).json({ error: String(e.message || e) }); }
});

// --- Beat 3→4: human approved → store classification + obligations + alerts ---
app.post("/api/execute", async (req, res) => {
  const { approved, payload } = req.body || {};
  if (!approved) return res.status(403).json({ error: "human approval required" });
  try { res.json(await executeProposed(payload)); }
  catch (e) { res.status(500).json({ error: String(e.message || e) }); }
});

// --- Shared obligation ledger (JSON; ?format=csv to export) ---
app.get("/api/obligations/:companyId", async (req, res) => {
  try {
    const rows = await listObligations(req.params.companyId);
    if (req.query.format === "csv") {
      const cols = ["regulation", "article", "who", "what", "deadline", "authority", "trigger", "status", "created_at"];
      const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
      const csv = [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
      res.setHeader("content-type", "text/csv");
      res.setHeader("content-disposition", `attachment; filename="obligations-${req.params.companyId}.csv"`);
      return res.send(csv);
    }
    res.json(rows);
  } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
});

// SPA fallback: serve the dashboard for any non-API GET (must be after API routes).
app.get(/^(?!\/(api|health)).*/, (_req, res) => res.sendFile(path.join(PUBLIC_DIR, "index.html")));

// Only listen when run directly (local/dev). On Vercel the app is exported as a handler.
if (!process.env.VERCEL) {
  const port = process.env.PORT || 8080;
  app.listen(port, () => console.log(`IncidentIQ listening on :${port}`));
}

export default app;
