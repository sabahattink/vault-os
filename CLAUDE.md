# vault-os

**Port:** 3777 | **Stack:** Node.js 18 + Express 5 + PowerShell 7 | **Runtime:** Windows

## What

vault-os adds automation to an Obsidian vault: a dashboard server with a Telegram capture bot, local Whisper.cpp voice transcription, and a 12-phase PowerShell nightly agent that writes morning briefs, synthesizes daily captures, and maintains wiki health — all driven by the Claude API.

## Quick Start

```bash
./setup.sh                              # install deps, copy .env and CLAUDE.md
cd dashboard && node server.js          # start dashboard on http://localhost:3777
pwsh -File scripts/nightly-agent.ps1 -VaultPath "C:\your\vault"   # manual run
```

## Commands

```bash
# Dashboard
cd dashboard
node server.js                          # start server (port from .env PORT, default 3777)

# Nightly agent (PowerShell 7+)
pwsh -File scripts/nightly-agent.ps1 -VaultPath "C:\path\to\vault"

# Register as scheduled task (run as Administrator)
pwsh -File scripts/install-scheduler.ps1

# Dependencies
cd dashboard && npm install
```

## Architecture

```
dashboard/server.js          All API endpoints, WebSocket, Telegram bot, voice pipeline
scripts/nightly-agent.ps1    12 phases, runs at 23:00 via Task Scheduler
scripts/notify.ps1           Windows toast notifications (called by nightly agent)
scripts/h-disk-sync.ps1      Disk → vault INBOX sync (Phase 1)
scripts/notion-sync.ps1      Notion → vault INBOX sync (Phase 1)
scripts/install-scheduler.ps1  Registers nightly agent in Windows Task Scheduler
wiki/skills/ingest.md        Rules: 1 source → 8-15 wiki pages
wiki/skills/connect.md       Rules: cross-domain connection discovery
wiki/skills/synthesize.md    Rules: synthesis document production
CLAUDE.md.template           Copy this → CLAUDE.md, fill in vault details
.env.example                 All 16 env vars with descriptions
```

Claude is invoked via the `claude --print` CLI (piped from a temp file) — not the SDK. Both `server.js` and `nightly-agent.ps1` use this pattern.

## Key Files

```
dashboard/server.js           Single file — read this to understand all API behavior
dashboard/package.json        Dependencies: express, telegraf→node-telegram-bot-api, chokidar, marked, ws, dotenv
.env.example                  Source of truth for all environment variables
scripts/nightly-agent.ps1     All 12 phases in sequence — search "PHASE N:" to jump to one
wiki/skills/*.md              Skill files read by Claude during wiki commands and agent phases
CLAUDE.md.template            Template for the vault-level Claude context file
```

## Nightly Agent Phases (quick reference)

| # | Name | Key output |
|---|------|------------|
| 1 | Observe | `$InboxSummary`, `$GitSummary` |
| 2 | Vault Sync | `20_PROJECTS/<id>/<id> Overview.md`, `wiki/entities/<id>.md` |
| 3 | Think | `$ThinkOutput` (JSON via Claude) |
| 4 | Learn | `MEMORY/LEARNING/learnings.md` |
| 5 | Wiki Update | `wiki/hot.md`, `wiki/log.md` |
| 6 | Morning Report | `50_DAILY/YYYY-MM-DD-morning.md` (tomorrow) + capture scaffold |
| 7 | Verify | Log warnings for missing files |
| 8 | Archive | `00_INBOX/` → `70_ARCHIVE/YYYY/MM/` |
| 9 | Pattern Analysis | `60_ACTIONS/patterns/`, `BUSINESS-EDGE.md` (Sundays / 5+ decisions) |
| 10 | Connect Tour | `wiki/skills/connect-log-YYYY-MM-DD.md` (Sundays) |
| 11 | Evening Review | `## Evening Review` in today's daily note + ContentPipeline angle |
| 12 | Wiki Lint | `wiki/lint-log-YYYY-MM-DD.md` (Sundays) |

## Configuration

All config via environment variables. See `.env.example` for full descriptions.

| Variable | Required | Description |
|----------|----------|-------------|
| `VAULT_PATH` | Yes | Absolute path to Obsidian vault root |
| `CONTENT_PIPELINE_DIR` | Yes | ContentPipeline directory path |
| `PORT` | No | Dashboard port (default: `3777`) |
| `TELEGRAM_BOT_TOKEN` | Yes | From @BotFather — activates capture bot |
| `ANTHROPIC_API_KEY` | Yes | Anthropic API key for Claude CLI |
| `WHISPER_CLI` | No | Path to `whisper-cli.exe` — enables voice |
| `WHISPER_MODEL` | No | Model filename (default: `ggml-small.bin`) |
| `WHISPER_LANG` | No | Transcription language (default: `en`) |
| `NOTION_TOKEN` | No | Notion integration token |
| `CONTENT_PIPELINE_PATH` | No | Used by nightly agent for pipeline counts |
| `MONITORED_SERVICES` | No | `Name\|URL` pairs for uptime monitoring |

## Vault Folder Convention (expected by the code)

```
00_INBOX/          nightly agent reads here, archives after processing
50_DAILY/          YYYY-MM-DD-morning.md — brief (top) + captures (bottom)
60_ACTIONS/        actions.md, decisions/, patterns/, business-edge/
70_ARCHIVE/        processed inbox files (auto-created)
20_PROJECTS/       project hubs (auto-created by Phase 2)
wiki/              hot.md, index.md, log.md, entities/, skills/
MEMORY/LEARNING/   learnings.md (appended by Phase 4)
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).
