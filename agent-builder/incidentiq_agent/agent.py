"""IncidentIQ — the Google Cloud Agent Builder (ADK) agent.

This is the runtime artifact behind agent.json: a Gemini 3 LlmAgent whose tools are the
OFFICIAL Elastic MCP server (@elastic/mcp-server-elasticsearch) mounted as an MCPToolset.
Deployed to Vertex AI Agent Engine, the Node app calls it via reasoningEngines:streamQuery
(see ../README.md and ../../src/agent-engine.js) — so the required trio (Gemini + Agent
Builder + partner MCP) is genuinely invoked at runtime.

Runtime note: the Elastic MCP server is a Node package, so the deployment target must have
Node/npx available. Agent Engine's managed Python runtime may not — if `npx` isn't found,
deploy with `adk deploy cloud_run` using a container that includes Node, or point the toolset
at Elastic's hosted/HTTP MCP endpoint. See ../README.md.
"""

import os

from google.adk.agents import LlmAgent

# Mount the partner's Elastic MCP server as a toolset ONLY when the runtime has Node/npx
# available (set ELASTIC_MCP_IN_AGENT=true — e.g. an `adk deploy cloud_run` container with
# Node). Vertex AI Agent Engine's managed Python runtime has no Node, so by default the agent
# runs as a pure-Gemini reasoning agent and receives the MCP-fetched precedents in its prompt
# (the Node app at src/elastic-mcp.js performs the Elastic MCP search). This keeps the deploy
# reliable instead of failing on a missing `npx`.
TOOLS = []
if os.environ.get("ELASTIC_MCP_IN_AGENT", "").lower() == "true":
    from google.adk.tools.mcp_tool.mcp_toolset import MCPToolset
    from google.adk.tools.mcp_tool.mcp_session_manager import StdioConnectionParams
    from mcp import StdioServerParameters

    # OTEL is disabled so the server's EDOT banner doesn't corrupt the stdio JSON-RPC channel.
    TOOLS.append(
        MCPToolset(
            connection_params=StdioConnectionParams(
                server_params=StdioServerParameters(
                    command="npx",
                    args=["-y", "@elastic/mcp-server-elasticsearch"],
                    env={
                        "ES_URL": os.environ.get("ELASTIC_URL", ""),
                        "ES_API_KEY": os.environ.get("ELASTIC_API_KEY", ""),
                        "OTEL_SDK_DISABLED": "true",
                        "ELASTIC_OTEL_ENABLED": "false",
                    },
                ),
                timeout=30,
            ),
        )
    )

INSTRUCTION = """You are IncidentIQ, a DORA major-incident analyst (Art.18 classification,
Art.19 reporting). For a new ICT incident:
1. Review the similar historical incidents provided (and, if you have an Elastic `search`
   tool available, use it to find more), and weigh how many of the closest precedents were
   classified MAJOR.
2. Apply the DORA Art.18 thresholds: >10% clients affected, >€5M transaction value, a data
   breach, core-banking downtime >2h, or payments downtime >30min. Also apply the
   recurring-incident rule: individually-MINOR incidents that recur on the same service
   within 30 days aggregate to MAJOR.
3. Explain in 2-3 sentences why the incident is MAJOR or MINOR, citing the matched precedents
   and which thresholds (or the recurrence rule) were met.
4. If MAJOR, draft the ACTUAL early-warning submission to the national competent authority
   (DNB) using the EBA/DORA template fields: entity, incident reference, start time,
   classification + reason, impact (% clients, € value, duration), affected services,
   preliminary root cause, and the next reporting deadline.
Do not invent figures beyond those provided. Do NOT write anything back to Elasticsearch or
create alerts — those consequential actions are gated on human approval in the application
layer. Return STRICT JSON: { "rationale": string, "submission": string, "confidence": number }.
"""

# ADK convention: a module-level `root_agent` is what `adk deploy` / AdkApp picks up.
# On Vertex AI Agent Engine the model is a Vertex publisher model; gemini-3 preview isn't
# available regionally there, so default to a Vertex-GA Gemini. (The Node app's direct path
# still uses gemini-3-flash-preview via the Gemini Developer API.) Override with GEMINI_MODEL.
root_agent = LlmAgent(
    name="incidentiq",
    model=os.environ.get("GEMINI_MODEL", "gemini-2.5-flash"),
    instruction=INSTRUCTION,
    tools=TOOLS,
)
