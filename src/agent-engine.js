// Vertex AI Agent Engine client — calls the DEPLOYED Google Cloud Agent Builder agent
// (the ADK agent in agent-builder/, which itself runs Gemini 3 + the Elastic MCP toolset).
//
// This is how "Agent Builder" becomes load-bearing at RUNTIME rather than a static config:
// when AGENT_ENGINE_ID is set, src/agent.js routes the explain + DNB-draft step through the
// deployed reasoningEngine here. Without it (local dev / no GCP), the app falls back to the
// direct @google/genai call so it always runs end-to-end.
//
// REST shape verified against the Agent Engine docs (reasoningEngines :query / :streamQuery):
//   create session : POST .../reasoningEngines/{id}:query
//                    { "class_method": "async_create_session", "input": { "user_id": "..." } }
//   stream query   : POST .../reasoningEngines/{id}:streamQuery?alt=sse
//                    { "class_method": "async_stream_query",
//                      "input": { "user_id": "...", "session_id": "...", "message": "..." } }

import { GoogleAuth } from "google-auth-library";

const PROJECT = process.env.GOOGLE_CLOUD_PROJECT;
const LOCATION = process.env.GOOGLE_CLOUD_LOCATION || "europe-west1";
const ENGINE = process.env.AGENT_ENGINE_ID; // numeric id OR full resource name
const USER_ID = process.env.AGENT_ENGINE_USER || "incidentiq-app";

/** True when an Agent Engine deployment is wired (gates the runtime path in agent.js). */
export function agentEngineConfigured() {
  return Boolean(ENGINE && PROJECT && process.env.MOCK !== "true");
}

const auth = new GoogleAuth({ scopes: "https://www.googleapis.com/auth/cloud-platform" });

/** Resolve the reasoningEngine resource path from either a bare id or a full name. */
function enginePath() {
  if (ENGINE.startsWith("projects/")) return ENGINE;
  return `projects/${PROJECT}/locations/${LOCATION}/reasoningEngines/${ENGINE}`;
}
/** Region the engine lives in — parsed from a full resource name, else GOOGLE_CLOUD_LOCATION.
 *  Keeps the API host aligned with the engine even if the app's default location differs. */
function engineRegion() {
  const m = ENGINE && ENGINE.match(/locations\/([^/]+)\//);
  return m ? m[1] : LOCATION;
}
const apiBase = () => `https://${engineRegion()}-aiplatform.googleapis.com/v1/${enginePath()}`;

async function authHeader() {
  const token = await auth.getAccessToken();
  if (!token) throw new Error("no ADC access token (run `gcloud auth application-default login`)");
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

/** Create a session and return its id (the create_session response carries it in `id`/output). */
async function createSession() {
  const res = await fetch(`${apiBase()}:query`, {
    method: "POST",
    headers: await authHeader(),
    body: JSON.stringify({ class_method: "async_create_session", input: { user_id: USER_ID } }),
  });
  if (!res.ok) throw new Error(`Agent Engine create_session ${res.status}: ${await res.text()}`);
  const j = await res.json();
  const sid = j?.output?.id || j?.id || j?.output?.session_id;
  if (!sid) throw new Error("Agent Engine create_session returned no session id");
  return sid;
}

/** Pull all assistant text out of the :streamQuery response. The endpoint may return raw
 *  NDJSON events, SSE `data:`-framed events, or a JSON array — handle all three. Each event
 *  carries the model output at content.parts[].text (author/role "model"). */
function collectText(body) {
  let text = "";
  const consume = (evt) => {
    for (const part of evt?.content?.parts || []) {
      if (typeof part.text === "string") text += part.text;
    }
  };
  const trimmed = (body || "").trim();
  if (trimmed.startsWith("[")) {
    try { JSON.parse(trimmed).forEach(consume); return text; } catch { /* fall through */ }
  }
  for (let line of body.split("\n")) {
    line = line.trim();
    if (line.startsWith("data:")) line = line.slice(5).trim();
    if (!line || line === "[DONE]") continue;
    try { consume(JSON.parse(line)); } catch { /* skip partial / keep-alive frames */ }
  }
  return text;
}

/** Send a message to the deployed agent and return its full text response. */
export async function queryAgentEngine(message) {
  const session_id = await createSession();
  const res = await fetch(`${apiBase()}:streamQuery?alt=sse`, {
    method: "POST",
    headers: await authHeader(),
    body: JSON.stringify({ class_method: "async_stream_query", input: { user_id: USER_ID, session_id, message } }),
  });
  if (!res.ok) throw new Error(`Agent Engine streamQuery ${res.status}: ${await res.text()}`);
  return collectText(await res.text());
}

/** Lightweight reachability probe for /health (does not run a full query). */
export async function agentEngineConnected() {
  if (!agentEngineConfigured()) return false;
  try {
    const res = await fetch(`${apiBase()}`, { headers: await authHeader() });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Explain + draft the DNB submission via the deployed Agent Builder agent.
 * Same contract as the direct-Gemini path in agent.js (returns {rationale, submission, confidence}).
 */
export async function explainViaAgentEngine({ incident, verdict, recurrence, similar, deadlines }) {
  const message =
    "You are IncidentIQ, a DORA major-incident analyst. Use your Elastic search tool if you need " +
    "more precedent context. Given the incident, its deterministic classification, the recurrence " +
    "signal and similar past incidents, (1) explain in 2-3 sentences why it is MAJOR/MINOR citing " +
    "precedents and the thresholds (or recurrence rule) met; (2) if MAJOR, draft the actual DNB " +
    "early-warning submission (EBA/DORA template fields). Do not invent figures. Return STRICT JSON " +
    `{ "rationale": string, "submission": string, "confidence": number }.\n\n` +
    `INCIDENT:\n${JSON.stringify(incident)}\n\nCLASSIFICATION:\n${JSON.stringify(verdict)}\n\n` +
    `RECURRENCE:\n${JSON.stringify(recurrence)}\n\nPRECEDENTS:\n${JSON.stringify(similar)}\n\n` +
    `DEADLINES:\n${JSON.stringify(deadlines)}`;
  const text = await queryAgentEngine(message);
  const jsonStr = (text.match(/\{[\s\S]*\}/) || [text])[0]; // tolerate prose around the JSON
  try {
    return JSON.parse(jsonStr);
  } catch {
    return { rationale: text.trim(), submission: "", confidence: 0.5 };
  }
}
