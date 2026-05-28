---
type: skill
title: Connect Skill
updated: 2026-05-28
tags: [skill, connect, wiki, pattern]
---

# Connect Skill — Connection Tour

## Purpose
Read through the entire wiki looking for non-obvious, unexplored relationships and build bridges.
This is not a search — it is a thinking tour.

## When to Run
- Weekly (Sunday — nightly agent or manual)
- After a large ingest from a new domain
- When you have the feeling "I wonder what's in the vault?"

## Process

### 1. Get Scope
Read `wiki/index.md` → list all pages by category.

### 2. Cross-Domain Scan
Read each wiki page with this question:
> "What idea in a *different* domain could this connect to?"

### 3. Connection Types (Priority Order)

**Type A — Same Principle, Different Domain** (most valuable)
Example: "compound interest" appears in both finance and knowledge accumulation

**Type B — Contradiction / Tension** (thought-provoking)
Two pages contradict each other — write the tension, do not resolve it

**Type C — Three+ Pages, One Unnamed Pattern** (synthesis seed)
The same thing appears in three different sources → it is a pattern, name it

**Type D — Question + Answer Match**
A page under `wiki/questions/` gets answered by another page — link them

### 4. For Each Connection
- Add wikilinks to both pages
- Write 1 sentence: "This connection reveals: ..."
- Log strong connections under `wiki/connections/` (optional)

### 5. Write a Report
After the tour, write a short report:
- How many connections were added
- The 2-3 most interesting (why?)
- Any gaps found (add to `wiki/questions/`)

## Quality Standard

Passes:
- Connection explanation says *why it is interesting*, not just "related"
- At least 1 unexpected cross-domain connection

Fails:
- "These are similar topics" → invalid
- Forced connection (if you need a paragraph to explain it, leave it)
- Only same-domain connections

## Trigger
```
/connect
run connection tour
```
