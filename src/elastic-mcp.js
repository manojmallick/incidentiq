// Elastic MCP client — connects IncidentIQ's runtime to the OFFICIAL Elastic MCP
// server (@elastic/mcp-server-elasticsearch) over stdio. This is the partner's MCP
// server, genuinely spawned as a child process and called at runtime: precedent
// search runs through the MCP `search` tool (hybrid kNN + keyword DSL).
//
// Scope note (honest): the Elastic MCP server v0.3.x exposes read tools only
// (`search`, `list_indices`, `get_mappings`, `get_shards`) — there is NO ES|QL or
// index-write tool. So ES|QL aggregation and the human-approved writes stay on the
// Elasticsearch REST API in elastic.js. The MCP path is primary for search; REST is
// the fallback so the app stays live if the MCP child process can't start.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createRequire } from "module";
import path from "path";

const require = createRequire(import.meta.url);

const ES_URL = process.env.ELASTIC_URL;
const ES_API_KEY = process.env.ELASTIC_API_KEY;
const CONNECT_TIMEOUT_MS = Number(process.env.ELASTIC_MCP_TIMEOUT_MS || 8000);

let _client = null; // connected Client once established
let _connecting = null; // in-flight connect promise (singleton across requests)
let _tools = new Set(); // tool names the server actually exposes

/** MCP is disabled in MOCK mode, when explicitly turned off, or without credentials. */
function mcpDisabled() {
  return process.env.MOCK === "true" || process.env.ELASTIC_MCP === "off" || !ES_URL || !ES_API_KEY;
}

/** Absolute path to the installed Elastic MCP server entrypoint (its package `bin`). */
function serverBinPath() {
  const pkgJsonPath = require.resolve("@elastic/mcp-server-elasticsearch/package.json");
  const pkg = require("@elastic/mcp-server-elasticsearch/package.json");
  const bin = typeof pkg.bin === "string" ? pkg.bin : pkg.bin["mcp-server-elasticsearch"];
  return path.join(path.dirname(pkgJsonPath), bin);
}

/** Drop the connection so a later request can transparently re-establish (or use REST). */
function reset() {
  _client = null;
  _connecting = null;
  _tools = new Set();
}

async function connect() {
  const transport = new StdioClientTransport({
    command: process.execPath, // run the server with this same Node binary
    args: [serverBinPath()],
    env: {
      // The Elastic MCP server bundles EDOT (@elastic/opentelemetry-node), which prints a
      // bootstrap banner to STDOUT — the same channel as the JSON-RPC protocol — corrupting
      // the stream. Disable it so stdout carries pure MCP messages. (Caller can override.)
      OTEL_SDK_DISABLED: "true",
      ELASTIC_OTEL_ENABLED: "false",
      OTEL_LOG_LEVEL: "none",
      ...process.env,
      ES_URL, // the server reads ES_URL / ES_API_KEY
      ES_API_KEY,
    },
  });
  // The SDK routes child-process / stdin / stdout errors here. Without a handler a
  // dead child (e.g. EPIPE) would surface as an uncaught exception and crash the app.
  transport.onerror = (e) => console.warn("[MCP] transport error:", e?.message || e);
  transport.onclose = () => reset(); // child exited → fall back to REST, allow reconnect
  const client = new Client({ name: "incidentiq", version: "2.0.0" }, { capabilities: {} });
  client.onerror = (e) => console.warn("[MCP] client error:", e?.message || e);
  await client.connect(transport);
  const { tools } = await client.listTools();
  _tools = new Set((tools || []).map((t) => t.name));
  _client = client;
  return client;
}

/** Lazily connect once; return the connected client or null (caller falls back to REST). */
export async function mcpClient() {
  if (mcpDisabled() || _client) return _client;
  if (!_connecting) {
    const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error("MCP connect timeout")), CONNECT_TIMEOUT_MS));
    _connecting = Promise.race([connect(), timeout]).catch((e) => {
      console.warn("[MCP] Elastic MCP unavailable, using REST fallback:", e.message);
      _connecting = null; // allow a later retry
      return null;
    });
  }
  return _connecting;
}

/** True only when the partner MCP server is actually connected (used by /health). */
export async function mcpConnected() {
  return Boolean(await mcpClient());
}

/** Parse the Elastic MCP `search` tool result (text fragments) back into hit objects. */
function parseHits(res) {
  const hits = [];
  for (const frag of res?.content || []) {
    if (frag.type !== "text" || !frag.text) continue;
    const obj = {};
    for (const line of frag.text.split("\n")) {
      const m = line.match(/^([a-z0-9_]+)(?: \(highlighted\))?:\s*(.*)$/i);
      if (!m) continue;
      const [, key, raw] = m;
      if (key in obj) continue; // keep first occurrence
      let value = raw.replace(/<\/?em>/g, ""); // strip highlight tags
      try { value = JSON.parse(value); } catch { /* keep as string */ }
      obj[key] = value;
    }
    if (obj.incident_id) hits.push(obj); // skip the trailing "Total results:" metadata fragment
  }
  return hits;
}

/**
 * Precedent search through the partner MCP server's `search` tool.
 * @returns {Promise<object[]|null>} hits, or null if MCP isn't available (→ REST fallback)
 */
export async function mcpSearch(index, queryBody) {
  const client = await mcpClient();
  if (!client || !_tools.has("search")) return null;
  const res = await client.callTool({ name: "search", arguments: { index, queryBody } });
  return parseHits(res);
}
