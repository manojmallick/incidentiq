# IncidentIQ — Design System

The UI is a single-file dashboard ([`public/index.html`](public/index.html)) built on **Tailwind
CSS (CDN)** with a **Material Design 3** dark token set and **Material Symbols** icons. The accent
is **Elastic teal**, nodding to the partner stack. Everything below is the system as actually used
in the app — not aspirational.

## Brand & tone
- **Product**: IncidentIQ — a regulator-grade DORA incident triage console.
- **Voice**: precise, calm, compliance-grade. No hype in-product; thresholds and deadlines speak for themselves.
- **Feel**: dark "ops center" — high-contrast data, teal for system/primary, red for breached thresholds and regulatory urgency.

## Color tokens (Material 3, dark)

| Token | Hex | Use |
|---|---|---|
| `primary` | `#00BFB3` | Elastic teal — primary actions, active nav, system accents |
| `primary-fixed-dim` / `surface-tint` | `#43dccf` | hovers, syntax keywords |
| `secondary` | `#adc6ff` | secondary accents, function syntax |
| `secondary-container` | `#0162cf` | active side-nav background |
| `error` | `#ffb4ab` | breached thresholds, MAJOR verdict, urgency |
| `error-container` | `#93000a` | error fills |
| `tertiary` | `#ffb2b8` | string syntax, soft alerts |
| `background` / `surface` / `surface-dim` | `#071422` | app background |
| `surface-container-lowest` | `#030f1d` | deepest panels / code blocks (`#07080D` body) |
| `surface-container-low` → `highest` | `#0f1c2b` → `#293645` | card elevation ramp |
| `on-surface` | `#d6e4f7` | primary text |
| `on-surface-variant` | `#bbcac7` | secondary text, labels |
| `outline` / `outline-variant` | `#859491` / `#3c4947` | borders, dividers |

Semantic rule: **teal = system/normal/approved**, **red = threshold breached / MAJOR / regulatory deadline**. Verdict color is the fastest signal on the page.

## Typography
- **Inter** — all UI text (`headline-lg/md/sm`, `body-lg/md/sm`, `label-caps`).
- **JetBrains Mono** — code, the DNB submission draft, IDs, countdowns (`mono-code`).
- **Label-caps** — uppercase tracking for section labels (e.g. `SIMILAR INCIDENTS (ES|QL)`, `DEFENSIBILITY RECORD`).

## Iconography
- **Material Symbols (Outlined)** throughout: `search`, `gavel`, `shield`, `hub`, `description`, `assignment`, `history`, `warning`, `check`, `arrow_forward`, `euro_symbol`, `group`.
- Icons are meaning-bearing: `gavel` = DORA judgment, `shield` = defensibility, `hub` = hybrid search, `warning`/`check` = threshold pass/fail in the workflow trace.

## Components

| Component | Pattern |
|---|---|
| **Stat card** | `glass-card`, top border-accent, headline number + caption. Dashboard metrics (Precedents Indexed, etc.). |
| **Threshold card** | border turns `error` when breached; shows the raw rule (`clients_affected_pct > 10`), the value, and a ✓/✗ verdict chip. |
| **Verdict banner** | 48px black weight, bordered, `status-pulse` animation when MAJOR. |
| **Workflow trace** | horizontal stepper; each step shows agent · action · ms; `warning` red node when a step escalates/exceeds. |
| **DNB draft** | monospace `<pre>` in the deepest surface — looks like the real regulator document. |
| **Defensibility record** | grid of ruleset version, precedent rate, cited precedent IDs, recurrence. |
| **ApprovalBar** | the human-in-the-loop gate; consequential writes happen only after the click. |
| **Reporting countdown** | live `HH:MM:SS` to the Art.19 early-warning deadline, pinging red dot. |
| **Filter chips / nav** | top-nav + side-nav with teal active states. |
| **Judge Tour** | guided overlay walking the end-to-end flow. |

## Motion
- `status-pulse` on the MAJOR verdict (draws the eye to the regulatory outcome).
- `animate-ping` on the early-warning deadline dot (urgency).
- `animate-spin` progress while the agent searches/classifies/drafts.
- Subtle `translateX` on active side-nav and hover lift on cards.

## Layout
- Dark app shell, top nav + contextual side nav.
- Responsive grid (`grid-cols-1 md:grid-cols-3`) for threshold and reporting cards.
- Generous spacing scale (`p-lg`, `gap-gutter`) for an uncluttered, scannable ops view.
- Single-page: dashboard → click incident → classification report → approval → executed, all in one flow.

## Accessibility & legibility
- High contrast `on-surface` (`#d6e4f7`) on dark surfaces.
- Color is never the only signal — verdicts pair color with text (`MAJOR`/`MINOR`) and ✓/✗ icons.
- Monospace for all machine-exact data (IDs, figures, timestamps) to avoid misreads in a compliance context.
