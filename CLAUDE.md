# {{PROJECT_NAME}} — Knowledge Vault OS

**Owner:** {{USER_NAME}}
**Vault:** `{{VAULT_PATH}}`
**Identity:** `USER\DA_IDENTITY.md` | **Mission:** `USER\TELOS\mission.md`

---

## Session Start (Required)
1. Read `wiki/hot.md` — get previous context
2. Read `wiki/index.md` — learn what's in the vault
3. Respond to user

---

## Wiki Commands

**ingest [file|all]** — process `.raw/` source → apply `wiki/skills/ingest.md` rules. Target: 1 source → 8-15 connected pages.

**query: [question]** — hot → index → relevant pages → answer. Don't load the entire vault.

**lint the wiki** — detect broken links, orphan pages, knowledge gaps, stale content.

**/save [name]** — convert current session to a wiki note.

**/autoresearch [topic]** — autonomous research loop.

**/wiki** — vault status summary.

**/connect** — cross-domain connection tour using `wiki/skills/connect.md` rules.

**/synthesize [topic]** — produce synthesis document using `wiki/skills/synthesize.md` rules.

## Skill Files

Read the relevant skill file before each command:

| Command | Skill File |
|---------|------------|
| ingest | `wiki/skills/ingest.md` |
| /connect | `wiki/skills/connect.md` |
| /synthesize | `wiki/skills/synthesize.md` |

---

## Organization Context
<!-- Fill in your organization/project context here -->
- Organization: {{ORGANIZATION}}
- Active projects: (see `20_PROJECTS/` folder)
- Tech stack: {{TECH_STACK}}
- Hosting: {{HOSTING_INFO}}

---

## Folder Structure
```
.raw/          → drop source files here, then ingest
wiki/          → hot.md · index.md · log.md · sources · entities · concepts
00_INBOX/      → nightly agent entry point (Notion + disk sync)
10_NOTES/      → atomic notes
20_PROJECTS/   → project hubs
30_PEOPLE/     → people
40_RESOURCES/  → articles, tweets
50_DAILY/      → morning reports (YYYY-MM-DD-morning.md)
60_ACTIONS/    → actions.md · product-opportunities.md
  decisions/   → decision archive (YYYY-MM-DD-topic.md) — reads pre-decision brief
  patterns/    → weekly/monthly pattern reports (nightly agent writes)
  business-edge/ → BUSINESS-EDGE.md (known weaknesses + edge definition)
70_ARCHIVE/    → processed INBOX
MEMORY/        → WORK · KNOWLEDGE · LEARNING (PAI pattern)
USER/          → DA_IDENTITY · TELOS · ISA template
```

## Compounding Intelligence

Every significant decision → save as `60_ACTIONS/decisions/YYYY-MM-DD-topic.md`.
Template: `60_ACTIONS/decisions/_TEMPLATE.md`

Use `/api/pre-decision` endpoint in the dashboard for pre-decision briefing:
past decisions + known weaknesses + pattern analysis → decision brief.

`BUSINESS-EDGE.md` → updated by nightly agent, tracks your strengths/weaknesses.

---

## Daily Note Capture System

`50_DAILY/YYYY-MM-DD-morning.md` is dual-purpose:
- **Top:** Morning briefing written by nightly agent (Yesterday/Critical/Actions/Today)
- **Bottom:** Day-long capture sections — `## Captures` · `## Research Signals` · `## Content Ideas` · `## Links to Process`
- **Evening (23:00):** Nightly agent PHASE 11 → `## Evening Review` (4 outputs: BEST CAPTURE · CONTENT ANGLE · CONNECTIONS · TOMORROW FOCUS)

**Telegram capture** (`@<your-bot>`): message is appended to today's daily note, routed by tag:
- Plain message → `## Captures`
- `#fikir` / `#idea` → `## Content Ideas`
- `#sinyal` / `#signal` / `#research` → `## Research Signals`
- `#link` or URL → `## Links to Process`

**PHASE 6 behavior:** Morning briefing is written to TOMORROW's file, preserving today's captures. PHASE 6 also extracts uncompleted `- [ ]` actions from today and carries them over to tomorrow's brief in `## Devreden`.

**PHASE 12 (Sunday):** Wiki Lint — broken wikilink + orphan + notes older than 90 days report, written as `wiki/lint-log-YYYY-MM-DD.md`.

**ContentPipeline:** The "CONTENT ANGLE" output from Evening Review is automatically copied to `{{CONTENT_PIPELINE_PATH}}/inbox/YYYY-MM-DD-jarvis-angle.md`.

**Voice capture (Telegram):** Voice message → Whisper.cpp (local, `{{WHISPER_PATH}}`, model configurable via `WHISPER_MODEL` env var, language via `WHISPER_LANG`) → transcribe → daily note (🎤 prefix). FFmpeg converts to 16kHz mono WAV.

**Dashboard `/api/morning-digest`:** Single HTTP request — brief (Yesterday/Critical/Carry-over/Today/Risk/Opportunity) + yesterday's Evening Review + Wiki Hot snippet. Shown as "DAY CONTEXT" panel in dashboard.

## Rules
- Never delete — archive
- Wikilink-first: `[[concept]]`
- Each note = one idea
- Turkish-first (configurable)
- Every note should have YAML metadata: `type, date, tags, related`
- Nightly agent: Algorithm v6.3.0, runs automatically every night at 23:00
