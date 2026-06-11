# Demo Video Plan — IncidentIQ (target 2:50, hard limit 3:00)

A shot-by-shot script for the hackathon demo video. Built around the verified live flow. Read
the **Voiceover** column word-for-word (~340 words ≈ 2:50 at a calm pace). Public on YouTube/Vimeo.

> One-line thesis to land: **"An agent that turns a 4-hour DORA regulatory scramble into seconds — and catches the major incident every other tool misses."**

---

## Pre-flight (do this before you hit record)
1. **Warm the app** — load https://incidentiq-908307939543.europe-west1.run.app once and run one classify, so the demo has no cold-start lag.
2. Browser at **1920×1080**, zoom 100%, clean window (hide bookmarks bar, close other tabs). Open a second tab on `/health`.
3. Quiet room; record narration in one take or voice it over after.
4. Turn on **click/cursor highlight** (QuickTime: none; Loom/OBS: enable) so clicks read on screen.
5. Have the dashboard showing the **"DB warning: connection pool at 85% saturation"** card visible.

---

## Shot-by-shot script

| Time | On screen (do this) | Voiceover (say this) | On-screen text / callout |
|---|---|---|---|
| **0:00–0:12** | Title card → fade to the **dashboard**. | "When an IT incident hits a European bank, a clock starts. Under DORA, a major-incident report is due to the regulator in **four hours** — miss it, and you're fined." | Title: **IncidentIQ — DORA major-incident triage agent** |
| **0:12–0:30** | Slowly pan the dashboard — open incidents, the 128-precedents stat. | "This is IncidentIQ. It's an **agent, not a chatbot**: it searches past incidents in Elasticsearch, classifies against DORA, drafts the actual regulator filing, and acts only after a human approves." | lower-third: *Gemini · Agent Builder · Elastic MCP* |
| **0:30–1:05** | **Click the "DB warning: 85% saturation" card.** Let the "Searching… classifying… drafting" spinner show ~2s. Verdict appears → **zoom-punch on the red MAJOR**. | "Watch this. A routine database warning — 85% pool saturation, **zero** customer impact. Any tool calls it minor. IncidentIQ calls it **MAJOR**. Why? It's the **sixth** payment incident on this service in thirty days. DORA says individually-minor incidents that recur become a reportable major incident *in aggregate*. That's the rule most tools miss — and it just caught a regulatory obligation hiding in a warning." | callout arrow on **MAJOR**; caption: *the recurring-incident rule* |
| **1:05–1:35** | Scroll to the **Classification Workflow Trace**. Hover each step. | "And it's genuinely an agent. The trace: it embedded the incident with **Gemini**, searched precedents through the **Elastic MCP server** — hybrid vector plus keyword — applied the DORA rules with ES-QL, then **Google Cloud Agent Builder**, on Vertex AI Agent Engine, wrote the explanation and the filing. All three, at runtime." | highlight each tech name as said |
| **1:35–2:05** | Scroll to the **DNB submission draft**, then the **defensibility record**. | "This is the real output — not a summary. The actual DORA **Article 19 early-warning submission** to the Dutch regulator, ready to send. And every verdict carries a **defensibility record**: ruleset, thresholds, the precedents cited — so a supervisor can challenge it." | caption: *the real deliverable, not a summary* |
| **2:05–2:38** | Show the **approval bar**. **Click "Approve & Store."** Show the green **STORED & FILED** banner with the executed Elastic writes. | "Nothing is filed automatically. The agent proposes; a **human approves**. One click — and it writes the classification, saves the reporting obligations, and audit-logs every action to Elasticsearch. Reasoned, planned, **acted** — with a human in control." | callout: *human-in-the-loop* → *audit trail* |
| **2:38–2:50** | Cut to the **`/health`** tab (JSON). Then the live URL / a closing card. | "Gemini, Agent Builder, and Elastic — all wired at runtime, all verifiable on the live health check. It's live, open, no login. **That's IncidentIQ.**" | closing card: URL + *MIT · github.com/manojmallick/incidentiq* |

**Total ≈ 2:50.** If you run long, trim shot 4 (1:05–1:35) first — the trace is supporting evidence, the *wow* in shot 3 is the keeper.

---

## Recording setup
- **Tool:** QuickTime (Mac, ⌘⇧5 → Record Selected Portion) is enough; Loom or OBS if you want webcam/cursor effects.
- **Capture** the browser region at 1080p; export 1080p MP4.
- **Narration:** read the VO column. Calm and clear beats fast and slick. One take, or record screen silent then voice over in iMovie.
- **Music (optional):** soft, low bed at ~10% volume; cut it under narration.

## Editing notes (15 min in iMovie/CapCut)
- **0:00** 2-second title card.
- **0:42** zoom-punch (scale 1.15×) on the **MAJOR** verdict — the single most important frame.
- **Lower-thirds / captions** naming **Elastic MCP**, **Agent Builder**, **Gemini** exactly as the trace shows them (judges are checking the required tech is real).
- Keep cuts tight; no dead air while pages load — speed-ramp any wait to 2× or cut.
- Burn in **captions** (many judges watch muted).
- End on a **static closing card** with the live URL held for 3 seconds.

## 60-second teaser (optional, for social / Devpost summary)
Hook (0:00–0:08) → the **85% warning → MAJOR** moment (0:08–0:35) → one line on the stack + human approval (0:35–0:55) → URL card (0:55–1:00).

## Submission checklist
- [ ] Under **3:00**, exported 1080p.
- [ ] Uploaded to **YouTube or Vimeo**, set to **Public** (not Unlisted/Private).
- [ ] Title: *IncidentIQ — DORA major-incident triage agent (Gemini + Agent Builder + Elastic MCP)*.
- [ ] Link pasted into the Devpost **video** field (separate from the image gallery).
- [ ] Watch it once muted to confirm captions carry the story.
