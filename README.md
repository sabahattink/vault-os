# vault-os

A personal knowledge management automation system built on top of Obsidian. vault-os adds a Node.js dashboard server, a Telegram capture bot with local voice transcription, and a PowerShell nightly agent that runs 12 automated phases every night — so your vault stays current without manual effort.

> **Windows only.** The nightly agent uses `wmic` (system load) and Windows Task Scheduler. The dashboard server runs on any OS, but the full automation stack is Windows-specific.

## Features

- **Telegram Quick Capture** — send messages to your daily note from anywhere; routing by tag (`#idea`, `#signal`, `#link`) or plain text drops to the right section automatically
- **Local voice transcription** — voice messages transcribed by whisper.cpp on your machine; no audio ever leaves your network
- **12-phase nightly agent** — observe, sync, think, learn, update wiki, write morning brief, archive, pattern analysis, connect tour, evening review, wiki lint (Sundays)
- **Morning digest API** — single endpoint returns today's brief + yesterday's evening review + wiki hot context
- **ContentPipeline integration** — "Content Angle" output from evening review auto-feeds into your content pipeline inbox
- **Decision intelligence** — pre-decision brief endpoint draws on your full decision archive and BUSINESS-EDGE.md
- **Live dashboard** — WebSocket-powered browser UI with vault stats, project git status, service health, and JARVIS AI chat

## Architecture

```
vault-os/
├── dashboard/
│   └── server.js          Express + WebSocket server (port 3777)
│                          Telegram bot (node-telegram-bot-api)
│                          Whisper.cpp voice pipeline (ffmpeg → wav → transcribe)
│                          Claude API via claude CLI (ai-brief, ask, pre-decision)
│
├── scripts/
│   ├── nightly-agent.ps1  12-phase automation (runs at 23:00 via Task Scheduler)
│   ├── notify.ps1         Windows toast notifications
│   ├── h-disk-sync.ps1    Disk scan → vault INBOX sync
│   ├── notion-sync.ps1    Notion → vault INBOX sync
│   └── install-scheduler.ps1  Registers the nightly agent in Task Scheduler
│
├── wiki/
│   └── skills/
│       ├── ingest.md      Rules for ingesting raw sources into wiki pages
│       ├── connect.md     Rules for cross-domain connection discovery
│       └── synthesize.md  Rules for producing synthesis documents
│
├── CLAUDE.md.template     Copy → CLAUDE.md and fill in your vault details
└── .env.example           All environment variables with descriptions

Your Obsidian vault (not included — you bring your own):
  VAULT_PATH/
  ├── 00_INBOX/            Nightly agent entry point
  ├── 10_NOTES/            Atomic notes
  ├── 20_PROJECTS/         Project hubs (auto-created by nightly agent)
  ├── 50_DAILY/            YYYY-MM-DD-morning.md (brief + capture sections)
  ├── 60_ACTIONS/          actions.md, decisions/, patterns/, business-edge/
  ├── 70_ARCHIVE/          Processed inbox files
  ├── wiki/                hot.md, index.md, entities/, skills/
  └── MEMORY/              WORK, KNOWLEDGE, LEARNING
```

Data flows:

1. **Capture:** Telegram message or voice note → `server.js` routes by tag → appended to `50_DAILY/YYYY-MM-DD-morning.md`
2. **Nightly (23:00):** `nightly-agent.ps1` reads inbox + git statuses → calls Claude API → writes tomorrow's morning brief + evening review → archives inbox
3. **Dashboard:** Browser polls REST endpoints; WebSocket pushes vault file changes in real time

## Prerequisites

| Requirement | Version | Notes |
|-------------|---------|-------|
| Node.js | 18+ | `node --version` |
| npm | 9+ | bundled with Node.js |
| PowerShell | 7+ | `pwsh --version` — for nightly agent |
| Obsidian | any | Your vault must exist before first run |
| Claude CLI | latest | `npm install -g @anthropic-ai/claude-code` — used by nightly agent and dashboard AI features |
| ffmpeg | any | Required for voice transcription; must be on PATH |
| whisper.cpp | any | Optional — local voice transcription binary |

## Quick Start

**1. Clone and install**

```bash
git clone https://github.com/sabahattink/vault-os.git
cd vault-os
./setup.sh
```

**2. Configure your environment**

```bash
# .env was created by setup.sh — open it and fill in your values
# Minimum required: VAULT_PATH, TELEGRAM_BOT_TOKEN, ANTHROPIC_API_KEY
notepad .env        # Windows
```

**3. Copy and fill in CLAUDE.md**

```bash
cp CLAUDE.md.template CLAUDE.md
# Edit CLAUDE.md: replace YOUR_NAME, VAULT_PATH, and your project/org context
```

**4. Start the dashboard server**

```bash
cd dashboard
node server.js
# Open http://localhost:3777
```

**5. (Optional) Register the nightly agent**

```powershell
# Run once in PowerShell as Administrator
pwsh -File scripts/install-scheduler.ps1
# The agent will run automatically at 23:00 every night
```

To trigger a manual run at any time:

```powershell
pwsh -File scripts/nightly-agent.ps1 -VaultPath "C:\your\vault\path"
```

## Configuration Reference

All configuration is via environment variables. Copy `.env.example` to `.env` and set your values. The dashboard server loads `.env` automatically on startup. The nightly agent reads these from the system environment (set them in your PowerShell profile or via `$env:VAR = "value"`).

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `VAULT_PATH` | Yes | — | Absolute path to your Obsidian vault root |
| `CONTENT_PIPELINE_DIR` | Yes | — | Absolute path to your ContentPipeline directory |
| `PORT` | No | `3777` | Dashboard server port |
| `TELEGRAM_BOT_TOKEN` | Yes | — | Bot token from @BotFather on Telegram |
| `ANTHROPIC_API_KEY` | Yes | — | Anthropic API key (console.anthropic.com) |
| `WHISPER_CLI` | No | — | Full path to `whisper-cli.exe` — leave empty to disable voice |
| `WHISPER_MODEL` | No | `ggml-small.bin` | Model filename in `models/` next to the binary |
| `WHISPER_LANG` | No | `en` | Transcription language code (e.g. `tr`, `de`, `fr`) |
| `NOTION_TOKEN` | No | — | Notion integration token for inbox sync |
| `DATA_SCAN_PATHS` | No | — | Semicolon-separated paths for disk sync into INBOX |
| `VPS_IP` | No | — | Server IP shown in dashboard sidebar |
| `MONITORED_SERVICES` | No | — | `Name\|URL` pairs, comma-separated, for uptime monitoring |
| `N8N_URL` | No | `http://localhost:5678` | n8n automation URL for status check |
| `DB1_PORT` | No | `5432` | TCP port checked in MCP status panel |
| `DB2_PORT` | No | `5433` | TCP port checked in MCP status panel |
| `DB3_PORT` | No | `5434` | TCP port checked in MCP status panel |

## Nightly Agent — 12 Phases

The agent runs every night at 23:00 and completes in roughly 2–5 minutes depending on inbox size and Claude API response times.

| Phase | Name | What it does |
|-------|------|-------------|
| 1 | Observe | Runs Notion sync + disk sync; reads all files in `00_INBOX/`; collects git status for every project |
| 2 | Vault Sync | Creates or updates `20_PROJECTS/<id>/<id> Overview.md` and `wiki/entities/<id>.md` for each project; preserves manually edited status fields |
| 3 | Think | Sends inbox summary + git statuses to Claude; gets back JSON with critical items, connections, risks, opportunities, priorities |
| 4 | Learn | Appends today's learnings to `MEMORY/LEARNING/learnings.md` |
| 5 | Wiki Update | Prepends fresh project status table + open blockers + pipeline counts to `wiki/hot.md`; appends entry to `wiki/log.md` |
| 6 | Morning Report | Writes tomorrow's morning brief to `50_DAILY/YYYY-MM-DD-morning.md`; extracts uncompleted `- [ ]` items from today and carries them over to the `## Carry-over` section; appends empty capture scaffold (`## Captures`, `## Research Signals`, `## Content Ideas`, `## Links to Process`) |
| 7 | Verify | Checks that all expected output files were written; logs WARN for any missing |
| 8 | Archive | Moves all processed `00_INBOX/` files to `70_ARCHIVE/YYYY/MM/` |
| 9 | Pattern Analysis | Sundays (or when 5+ decisions exist): reads decision archive → Claude writes weekly pattern report to `60_ACTIONS/patterns/`; updates decision counts in `BUSINESS-EDGE.md` |
| 10 | Connect Tour | Sundays only: reads `wiki/skills/connect.md` + wiki sample pages → Claude finds cross-domain connections not yet wikilinked; writes `wiki/skills/connect-log-YYYY-MM-DD.md` |
| 11 | Evening Review | Reads today's four capture sections → Claude produces BEST CAPTURE, CONTENT ANGLE, CONNECTIONS, TOMORROW FOCUS; appends as `## Evening Review` to today's daily note; extracts CONTENT ANGLE into `ContentPipeline/inbox/` |
| 12 | Wiki Lint | Sundays only: scans all vault `.md` files for broken wikilinks, orphan wiki pages (no incoming links), and stale wiki notes (not updated in 90+ days); writes `wiki/lint-log-YYYY-MM-DD.md` |

## Telegram Bot

Start the dashboard server with `TELEGRAM_BOT_TOKEN` set — the bot activates automatically.

**Tag routing**

| Input | Target section in daily note |
|-------|------------------------------|
| Plain text | `## Captures` |
| `#idea <text>` | `## Content Ideas` |
| `#signal <text>` or `#research <text>` | `## Research Signals` |
| `#link <text>` or bare URL | `## Links to Process` |
| Voice message | Transcribed by Whisper.cpp, then routed by any tags in the transcript |

Multi-line messages are supported — each line is routed independently.

Voice messages require `WHISPER_CLI`, a downloaded model, and `ffmpeg` on PATH. The bot replies with a confirmation showing which sections received entries.

## Dashboard API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Server liveness check |
| GET | `/api/morning-digest` | Today's brief (6 sections) + yesterday's evening review + wiki hot snippet |
| GET | `/api/morning` | Raw today's daily note as HTML |
| GET | `/api/stats` | Note counts per vault folder |
| GET | `/api/actions` | Pending and completed action items |
| POST | `/api/action-toggle` | Toggle a checkbox in `60_ACTIONS/actions.md` |
| POST | `/api/quick-capture` | Write a note directly to `00_INBOX/` |
| GET | `/api/pipeline` | ContentPipeline stage counts |
| GET | `/api/pipeline-files/:stage` | File list for a pipeline stage |
| GET | `/api/social` | Content items grouped by platform and stage |
| GET | `/api/projects` | Project list with file counts |
| GET | `/api/ops/projects` | Projects with live git info |
| GET | `/api/ops/github` | Recent repos via `gh` CLI |
| GET | `/api/ops/n8n` | n8n reachability check |
| GET | `/api/vps` | Service uptime check for all `MONITORED_SERVICES` |
| GET | `/api/sysload` | CPU and memory usage (Windows `wmic`) |
| GET | `/api/intel/alerts` | Consolidated health alerts for the dashboard |
| GET | `/api/intel/ai-brief` | Claude-generated daily priority brief (1-hour cache) |
| GET | `/api/brain-data` | Hot nodes from `wiki/hot.md` + MEMORY file list |
| GET | `/api/search?q=` | Filename search across inbox, notes, actions, wiki, pipeline |
| GET | `/api/opportunities` | Items from `60_ACTIONS/product-opportunities.md` |
| GET | `/api/decisions/count` | Decision archive stats |
| POST | `/api/decisions/save` | Save a new decision record |
| POST | `/api/pre-decision` | Claude-generated pre-decision brief from decision history |
| POST | `/api/ask` | JARVIS chat with full vault context; supports fast status commands |
| GET | `/api/system` | Last nightly agent log entry |

WebSocket on the same port: pushes `vault_change` events (file watch via chokidar) and `ping` every 30 seconds.

## Windows-Only Notice

The following components require Windows:

- **`/api/sysload`** uses `wmic cpu get loadpercentage` and `wmic OS get FreePhysicalMemory` — these commands do not exist on Linux or macOS
- **`install-scheduler.ps1`** registers a Windows Task Scheduler job
- **`nightly-agent.ps1`** is written for PowerShell 7 on Windows; some paths and shell invocations are Windows-specific
- The dashboard server itself (`server.js`) is cross-platform; only the `wmic` endpoint and PowerShell integration are Windows-only

## Using with Claude Code

This project ships a `CLAUDE.md.template` that gives Claude Code full context about your vault structure, commands, and automation behavior. Copy it and fill in your details before opening the project with Claude Code.

```bash
cp CLAUDE.md.template CLAUDE.md
# Edit: YOUR_NAME, VAULT_PATH, your organization context, active projects
claude    # Claude Code reads CLAUDE.md automatically
```

See [CLAUDE.md.template](CLAUDE.md.template) for the full context structure.

## License

MIT — see [LICENSE](LICENSE)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md)
