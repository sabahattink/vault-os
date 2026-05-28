# Contributing to vault-os

Thank you for your interest in contributing. This document covers everything you need to get started.

## What We Welcome

- Bug fixes (especially cross-platform compatibility improvements)
- New dashboard API endpoints
- Improvements to nightly agent phases
- Better Telegram routing rules or new capture types
- Documentation improvements
- Additional wiki skill files

## What to Discuss First

For significant changes — new phases in the nightly agent, architectural changes to how the daily note is structured, or changes to the `.env.example` format — open an issue before writing code. This avoids duplicated effort and ensures the change fits the project's direction.

## Development Setup

**Prerequisites:** Node.js 18+, PowerShell 7+ (Windows), Obsidian vault.

```bash
git clone https://github.com/sabahattink/vault-os.git
cd vault-os
./setup.sh
```

Then copy and fill in your environment:

```bash
cp .env.example .env
# Edit .env with your VAULT_PATH and other values
cp CLAUDE.md.template CLAUDE.md
# Edit CLAUDE.md with your vault context
```

Start the dashboard:

```bash
cd dashboard
node server.js
```

## Project Structure

```
dashboard/server.js      Single-file Express server — all API endpoints and the Telegram bot
scripts/nightly-agent.ps1   All 12 automation phases in one PowerShell script
wiki/skills/             Skill files read by Claude during wiki commands
CLAUDE.md.template       Context file for Claude Code users
.env.example             Canonical list of all environment variables
```

The codebase is intentionally kept in a small number of files — this makes it easy to understand and modify without navigating a large directory tree. When adding significant new functionality, consider whether it genuinely needs a new file or whether it fits in the existing structure.

## Code Style

**JavaScript (server.js)**

- No TypeScript — keep it plain Node.js so there is no build step
- Use `const` and `let`; avoid `var`
- Handle all errors explicitly — never let a failed file read crash an endpoint; return a safe default or an error JSON response
- Keep endpoint handlers short; extract named helper functions for anything more than 15 lines
- No external logging libraries — `console.log` and `console.error` are fine
- All file paths must go through `path.join()` — never string concatenation

**PowerShell (nightly-agent.ps1)**

- UTF-8 everywhere: use `[System.IO.File]::WriteAllText` and `[System.IO.File]::ReadAllLines` with explicit encoding
- Wrap all phase logic in `try/catch` and log warnings rather than letting one phase abort the whole run
- Use `Write-Log` for all output — do not use bare `Write-Host`
- New phases belong in the numbered sequence; add a `PHASE N:` comment block header matching the existing style

**General**

- No secrets, API keys, or personal paths in committed code — use `.env` and environment variables
- `.env.example` must stay in sync: every new environment variable the code reads must have an entry there with a description

## Branch and PR Workflow

1. Fork the repository and create a branch from `main`
2. Branch naming: `fix/short-description`, `feat/short-description`, `docs/short-description`
3. Keep commits focused — one logical change per commit
4. Commit message format: `type: short description` where type is one of `feat`, `fix`, `docs`, `refactor`, `test`, `chore`
5. Open a pull request against `main` with a clear description of what changed and why
6. Include steps to test your change in the PR description

## Testing Your Changes

There is no automated test suite yet. Before submitting a PR, verify manually:

- `node dashboard/server.js` starts without errors
- The endpoint(s) you changed return correct JSON (use `curl` or a browser)
- If you changed the nightly agent, run it manually against a test vault:
  ```powershell
  pwsh -File scripts/nightly-agent.ps1 -VaultPath "C:\path\to\test-vault"
  ```
- Check the log file at `VAULT_PATH\.scripts\logs\YYYY-MM-DD-agent.log` for any WARN or ERROR lines
- If you added an environment variable, confirm it has an entry in `.env.example`

## Reporting Issues

Use the GitHub issue templates:

- **Bug report** — include your OS version, Node.js version, PowerShell version, and the relevant log output
- **Feature request** — describe the problem you are trying to solve, not just the solution

## Using Claude Code for Contributions

The project ships `CLAUDE.md.template` specifically to help AI-assisted development. After setup:

```bash
cp CLAUDE.md.template CLAUDE.md
# Fill in your vault details
claude    # Opens Claude Code with full project context
```

Claude Code will read `CLAUDE.md` automatically and understand the vault folder structure, daily note format, nightly agent phases, and API surface.
