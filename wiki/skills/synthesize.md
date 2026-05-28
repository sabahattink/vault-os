---
type: skill
title: Synthesize Skill
updated: 2026-05-28
tags: [skill, synthesize, wiki, thinking]
---

# Synthesize Skill — Producing a Synthesis Document

## Purpose
Produce a high-quality thinking document from multiple sources in the wiki.
Not summarizing — extracting new meaning.

## When to Use
- Before an important decision
- When asking "what do I actually think about this?"
- When writing an article, strategy document, or plan
- When preparing a pre-decision brief for `60_ACTIONS/decisions/`

## Process

### 1. Frame the Question Precisely
Synthesis answers a question. Write the question before starting:
> "This document answers: ..."

Without a question, the document will drift.

### 2. Gather Relevant Wiki Pages
- List related pages via `wiki/index.md` + wikilinks
- Include both directly and indirectly related pages
- Add any relevant questions from `wiki/questions/`

### 3. Four-Part Analysis

**A — What Does the Vault Know?**
Write what the vault genuinely knows about this topic (specific page references, not generalities)

**B — Where Are the Contradictions?**
If two pages disagree, write both sides — do not resolve prematurely

**C — Where Are the Gaps?**
What is missing in the vault to fully answer the question?
→ Add these gaps to `wiki/questions/`

**D — Position**
If evidence is sufficient: take a clear position
If evidence is insufficient: write "We don't know this because..."

### 4. Write the Synthesis Document
- First paragraph: central insight (single, clear, strong)
- Body: argument + evidence from vault (page references)
- End: open questions or next steps

### 5. Save and Link
- Save to `60_ACTIONS/` or relevant `20_PROJECTS/` folder
- Add wikilinks to related wiki pages

## Quality Standard

Passes:
- The document contains at least 1 insight that does not exist in any single source page alone
- The central sentence is single, clear, defensible

Fails:
- A collection of summaries from multiple sources → that is not synthesis
- Document ends with "both sides have valid points"
- Written without referencing the vault

## Trigger
```
/synthesize [topic]
synthesize [topic]
```
