---
name: Bug report
about: Something is broken or behaving unexpectedly
title: '[bug] '
labels: bug
assignees: ''
---

## What happened

A clear description of the bug.

## Expected behavior

What you expected to happen instead.

## Steps to reproduce

1. ...
2. ...
3. ...

## Environment

| Field | Value |
|-------|-------|
| OS | e.g. Windows 10 22H2 |
| Node.js version | `node --version` |
| PowerShell version | `pwsh --version` |
| Component | dashboard / nightly-agent / telegram-bot / voice |

## Relevant log output

For nightly agent bugs, paste the relevant lines from `VAULT_PATH\.scripts\logs\YYYY-MM-DD-agent.log`.
For dashboard bugs, paste the terminal output from `node server.js`.

```
paste log output here
```

## .env settings (redact secrets)

List any relevant env vars with their values redacted:

```
VAULT_PATH=C:\vault\...         # set
TELEGRAM_BOT_TOKEN=             # set / not set
WHISPER_CLI=                    # set / not set
```
