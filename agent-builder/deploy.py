"""Deploy the IncidentIQ ADK agent to Vertex AI Agent Engine.

Prints the reasoningEngine resource name — set it as AGENT_ENGINE_ID for the Node app so
/api/classify routes the explain + DNB-draft step through the deployed Agent Builder agent.

Prereqs:
  pip install -r requirements.txt
  gcloud auth application-default login
  export GOOGLE_CLOUD_PROJECT=...  GOOGLE_CLOUD_LOCATION=us-central1
  export STAGING_BUCKET=gs://your-bucket   ELASTIC_URL=...  ELASTIC_API_KEY=...

Run:
  python deploy.py

Alternative (often more stable than the SDK): the ADK CLI
  adk deploy agent_engine --project $GOOGLE_CLOUD_PROJECT --region $GOOGLE_CLOUD_LOCATION \
      --staging_bucket $STAGING_BUCKET incidentiq_agent

Runtime caveat: the Elastic MCP server is a Node package (npx). If the managed runtime lacks
Node, deploy instead with `adk deploy cloud_run` (a container that includes Node) or point the
toolset at Elastic's hosted/HTTP MCP endpoint. See README.md.
"""

import os

import vertexai
from vertexai import agent_engines
from vertexai.preview.reasoning_engines import AdkApp

from incidentiq_agent.agent import root_agent


def main() -> None:
    project = os.environ["GOOGLE_CLOUD_PROJECT"]
    location = os.environ.get("GOOGLE_CLOUD_LOCATION", "us-central1")
    staging_bucket = os.environ["STAGING_BUCKET"]

    vertexai.init(project=project, location=location, staging_bucket=staging_bucket)

    app = AdkApp(agent=root_agent, enable_tracing=False)

    # Cloud-runtime requirements. The default (Agent Engine) build runs the agent with no
    # tools, so `mcp` isn't needed there; add it (and ELASTIC_MCP_IN_AGENT=true) only for a
    # Node-capable target. Pinned to the versions verified locally.
    requirements = [
        "google-adk>=2.2.0",
        "google-cloud-aiplatform[agent_engines]>=1.156.0",
    ]
    env_vars = {"GEMINI_MODEL": os.environ.get("GEMINI_MODEL", "gemini-3-flash-preview")}

    # gemini-3-flash-preview is served by the Gemini Developer API (not a Vertex regional
    # publisher model), so point the agent's google-genai client at the Developer API with an
    # API key — same model the rest of the app uses. Without GOOGLE_API_KEY it defaults to Vertex.
    api_key = os.environ.get("GOOGLE_API_KEY") or os.environ.get("GEMINI_API_KEY")
    if api_key:
        env_vars["GOOGLE_GENAI_USE_VERTEXAI"] = "False"
        env_vars["GOOGLE_API_KEY"] = api_key

    if os.environ.get("ELASTIC_MCP_IN_AGENT", "").lower() == "true":
        requirements.append("mcp>=1.13.0")
        env_vars.update({
            "ELASTIC_MCP_IN_AGENT": "true",
            "ELASTIC_URL": os.environ.get("ELASTIC_URL", ""),
            "ELASTIC_API_KEY": os.environ.get("ELASTIC_API_KEY", ""),
        })

    existing = os.environ.get("AGENT_ENGINE_ID")
    if existing:
        remote = agent_engines.update(
            resource_name=existing,
            agent_engine=app,
            requirements=requirements,
            extra_packages=["incidentiq_agent"],
            env_vars=env_vars,
            display_name="incidentiq",
        )
    else:
        remote = agent_engines.create(
            agent_engine=app,
            requirements=requirements,
            extra_packages=["incidentiq_agent"],
            env_vars=env_vars,
            display_name="incidentiq",
        )

    print("\n✅ Deployed. Set this in the Node app's environment:")
    print(f"AGENT_ENGINE_ID={remote.resource_name}")


if __name__ == "__main__":
    main()
