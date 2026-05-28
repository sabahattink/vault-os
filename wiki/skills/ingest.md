---
type: skill
title: Ingest Skill
updated: 2026-05-28
tags: [skill, ingest, wiki]
---

# Ingest Skill — Processing New Sources

## Purpose
Process a raw source from `.raw/` or `00_INBOX/` and integrate it into the wiki.
Create a summary file — extract ideas and connect them to existing knowledge.

## Process

### 1. Read the Source Fully
Read the entire source before writing anything.

### 2. Extract Core Ideas (3–7 ideas)
For each idea ask:
- Does this idea already exist in the vault? (check `wiki/index.md`)
- If yes: update the existing page, add the new nuance
- If no: create a new `wiki/` page

### 3. For Each Idea, Create at Least 2 Connections
- Find related existing wiki pages
- Add wikilinks in both directions: `[[concept]]`
- Write 1 sentence explaining *what the connection reveals*

### 4. Update Index and Hot
- `wiki/index.md` → add new pages
- `wiki/hot.md` → add "ingested: [source]" line
- `wiki/log.md` → date + source + how many pages created

### 5. Archive the Source
- Move to `70_ARCHIVE/` or mark as processed

## Quality Standard

Passes:
- At least 1 existing wiki page was updated
- At least 2 new wikilinks added
- No idea is just a source summary (idea = clear, single, standalone)

Fails:
- You only copied the source summary — that is not ingesting
- You created a disconnected standalone page
- You wrote "will connect later" and left it

## JARVIS Special Rules
- Every new page starts with YAML metadata: `type, date, tags, related`
- English preferred; technical terms kept in original form
- Wikilink format: `[[page-name|Display Name]]`
- Page types: `concept`, `entity`, `source`, `pattern`, `question`

## Trigger
```
ingest [file]
ingest all
```
