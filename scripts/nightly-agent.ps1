param(
    [string]$VaultPath = $env:VAULT_PATH,
    [string]$LogPath   = ""
)

# ─── DEFAULT PATHS ─────────────────────────────────────────────────────────────
# Set VAULT_PATH in your environment or .env file, OR pass -VaultPath explicitly.
# Example: $env:VAULT_PATH = "C:\Users\you\Documents\MyVault"
if (-not $VaultPath) {
    Write-Error "VAULT_PATH is not set. Pass -VaultPath or set the VAULT_PATH environment variable."
    exit 1
}
if (-not $LogPath) { $LogPath = "$VaultPath\.scripts\logs" }

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
$env:PYTHONIOENCODING = 'utf-8'
$ErrorActionPreference = "Continue"

$StartTime    = Get-Date
$Date         = Get-Date -Format "yyyy-MM-dd"
$TomorrowDate = (Get-Date).AddDays(1).ToString("yyyy-MM-dd")
$Year         = Get-Date -Format "yyyy"
$Month        = Get-Date -Format "MM"
$LogFile      = "$LogPath\$Date-agent.log"

New-Item -ItemType Directory -Path $LogPath -Force | Out-Null
Set-Location $VaultPath

function Write-Log {
    param([string]$Msg, [string]$Level = "INFO")
    $Line = "[$(Get-Date -Format 'HH:mm:ss')] [$Level] $Msg"
    Add-Content -Path $LogFile -Value $Line -Encoding UTF8
    Write-Host $Line
}

function Invoke-Claude {
    param([string]$Prompt, [string]$OutFile = "")
    $Tmp = "$VaultPath\.scripts\tmp-prompt.txt"
    [System.IO.File]::WriteAllText($Tmp, $Prompt, [System.Text.Encoding]::UTF8)
    $Out = Get-Content $Tmp -Raw | claude --print 2>&1
    Remove-Item $Tmp -ErrorAction SilentlyContinue
    $Text = ($Out -join "`n").Trim()
    if ($OutFile) { [System.IO.File]::WriteAllText($OutFile, $Text, [System.Text.Encoding]::UTF8) }
    return $Text
}

function Get-SectionContent {
    param([string]$FilePath, [string]$SectionName)
    if (-not (Test-Path $FilePath)) { return "" }
    $lines = [System.IO.File]::ReadAllLines($FilePath, [System.Text.Encoding]::UTF8)
    $header = "## $SectionName"
    $inSection = $false
    $captured = New-Object System.Collections.Generic.List[string]
    foreach ($line in $lines) {
        if ($line.TrimEnd() -eq $header) { $inSection = $true; continue }
        if ($inSection -and $line -match '^## ') { break }
        if ($inSection) { [void]$captured.Add($line) }
    }
    return (($captured -join "`n").Trim())
}

function Set-Section {
    param([string]$FilePath, [string]$SectionName, [string]$Content)
    $lines = if (Test-Path $FilePath) {
        [System.IO.File]::ReadAllLines($FilePath, [System.Text.Encoding]::UTF8)
    } else {
        @("# Daily Note", "")
    }
    $header = "## $SectionName"
    $out = New-Object System.Collections.Generic.List[string]
    $skip = $false
    foreach ($line in $lines) {
        if ($line.TrimEnd() -eq $header) { $skip = $true; continue }
        if ($skip -and $line -match '^## ') { $skip = $false }
        if (-not $skip) { [void]$out.Add($line) }
    }
    while ($out.Count -gt 0 -and [string]::IsNullOrWhiteSpace($out[$out.Count - 1])) {
        $out.RemoveAt($out.Count - 1)
    }
    [void]$out.Add("")
    [void]$out.Add($header)
    foreach ($l in ($Content -split "`r?`n")) { [void]$out.Add($l) }
    [System.IO.File]::WriteAllText($FilePath, (($out -join "`n")) + "`n", [System.Text.Encoding]::UTF8)
}

function Get-GitInfo {
    param([string]$Path)
    if (-not (Test-Path "$Path\.git")) { return @{branch="no-git"; commit="-"; ago="-"; dirty=$false; changes=0} }
    try {
        $branch = (git -C $Path rev-parse --abbrev-ref HEAD 2>$null) -join "" | Out-String
        $log    = (git -C $Path log -1 --pretty=format:"%s|%cr" 2>$null) -join "" | Out-String
        $status = (git -C $Path status --porcelain 2>$null)
        $parts  = $log.Trim().Split("|")
        $changes = if ($status) { ($status | Measure-Object -Line).Lines } else { 0 }
        return @{ branch=$branch.Trim(); commit=($parts[0] -replace '\s+',' ').Trim(); ago=($parts[1] -replace '\s+',' ').Trim(); dirty=($changes -gt 0); changes=$changes }
    } catch { return @{branch="error"; commit="-"; ago="-"; dirty=$false; changes=0} }
}

# ─── PROJECT DEFINITION ────────────────────────────────────────────────────────
#
# Replace the entries below with your own projects.
# Each entry describes one repository/project on your local disk.
#
# Schema:
#   id     — display name (used as folder name under 20_PROJECTS/)
#   path   — absolute local path to the project's root directory
#             TIP: use environment variables, e.g. "$env:HOME\projects\my-app"
#   status — initial status string; preserved once the vault hub file exists
#   color  — UI badge color: blue | green | yellow | purple | red
#   url    — live URL (empty string if not deployed)
#   desc   — one-line description shown in the dashboard
#
# Example entries — replace with your real projects:
$Projects = @(
    @{ id="project-one";   path="$env:HOME\projects\project-one";   status="Active";      color="green";  url="";                       desc="Your first project description" },
    @{ id="project-two";   path="$env:HOME\projects\project-two";   status="In Progress"; color="blue";   url="https://your-domain.com"; desc="Your second project description" },
    @{ id="project-three"; path="$env:HOME\projects\project-three"; status="Maintenance"; color="yellow"; url="";                       desc="Your third project description" }
    # Add more projects as needed — the nightly agent will create a vault hub and wiki entity for each one
)

Write-Log "=== Vault Nightly Agent v8.0 Started ==="

# ==============================================================================
# PHASE 1: OBSERVE - Collect signals
# ==============================================================================
Write-Log "--- PHASE 1: OBSERVE ---"

try { & "$VaultPath\.scripts\notion-sync.ps1" -VaultPath $VaultPath -LogPath $LogPath } catch { Write-Log "Notion sync: $_" "WARN" }
try { & "$VaultPath\.scripts\h-disk-sync.ps1" -VaultPath $VaultPath -LogPath $LogPath } catch { Write-Log "H-disk sync: $_" "WARN" }

$InboxFiles = Get-ChildItem -Path "$VaultPath\00_INBOX" -Filter "*.md" -ErrorAction SilentlyContinue
Write-Log "INBOX: $($InboxFiles.Count) files"

$InboxSummary = ""
foreach ($f in $InboxFiles) {
    $lines = Get-Content $f.FullName -TotalCount 80 -Encoding UTF8 -ErrorAction SilentlyContinue
    $InboxSummary += "=== $($f.Name) ===`n" + ($lines -join "`n") + "`n`n"
}

# Project git statuses
$GitSummary = ""
foreach ($p in $Projects) {
    $g = Get-GitInfo -Path $p.path
    $dirty = if ($g.dirty) { " ⚠ $($g.changes) changes" } else { "" }
    $GitSummary += "$($p.id) [$($g.branch)]: $($g.commit) ($($g.ago))$dirty`n"
    Write-Log "Git $($p.id): $($g.branch) / $($g.commit)"
}

# ==============================================================================
# PHASE 2: VAULT SYNC - Auto-update project hub and wiki entity files
# ==============================================================================
Write-Log "--- PHASE 2: VAULT SYNC ---"

foreach ($p in $Projects) {
    $hubDir    = "$VaultPath\20_PROJECTS\$($p.id)"
    $entityDir = "$VaultPath\wiki\entities"
    New-Item -ItemType Directory -Path $hubDir -Force | Out-Null
    New-Item -ItemType Directory -Path "$hubDir\Session Notes" -Force | Out-Null
    New-Item -ItemType Directory -Path $entityDir -Force | Out-Null

    # Git info
    $g = Get-GitInfo -Path $p.path
    $fileCount = if (Test-Path $p.path) { (Get-ChildItem $p.path -ErrorAction SilentlyContinue).Count } else { 0 }

    # Overview file (updated every night)
    $overviewFile = "$hubDir\$($p.id) Overview.md"

    # Preserve manually edited status
    $currentStatus = $p.status
    if (Test-Path $overviewFile) {
        $existingContent = Get-Content $overviewFile -Raw -Encoding UTF8
        if ($existingContent -match '(?m)^status:\s*(.+)$') {
            $currentStatus = $matches[1].Trim()
        }
    }

    $overviewContent = @"
---
type: project
status: $currentStatus
date: $Date
updated: $Date
url: $($p.url)
tags: [project, $($p.id.ToLower() -replace '\.','')]
---

# $($p.id) - $($p.desc)

## Status
**Status:** $currentStatus
**URL:** $(if ($p.url) { $p.url } else { "-" })
**Path:** $($p.path)
**File Count:** $fileCount

## Git
**Branch:** $($g.branch)
**Last Commit:** $($g.commit)
**When:** $($g.ago)
**Changes:** $(if ($g.dirty) { "⚠ $($g.changes) uncommitted files" } else { "✓ Clean" })

## Links
- [[your-organization]]
- [[your-vault-owner]]

## Last Updated
This file is auto-updated by the nightly agent. Last update: $Date
"@
    [System.IO.File]::WriteAllText($overviewFile, $overviewContent, [System.Text.Encoding]::UTF8)

    # Wiki entity (short, evergreen)
    $entityName = $p.id.ToLower() -replace '\.', '-' -replace '\s+', '-'
    $entityFile = "$entityDir\$entityName.md"
    # Only create if it doesn't exist — don't overwrite hand-written entities
    if (-not (Test-Path $entityFile)) {
        $entityContent = @"
---
type: entity
entity-type: project
status: $($p.status)
date: $Date
tags: [project]
---

# $($p.id)

$($p.desc)

**Status:** $($p.status)
**URL:** $(if ($p.url) { $p.url } else { "-" })
**Path:** `$($p.path)`

## Summary
$($p.id) project.

## Related
- [[your-organization]]
- [[your-vault-owner]]
"@
        [System.IO.File]::WriteAllText($entityFile, $entityContent, [System.Text.Encoding]::UTF8)
        Write-Log "Entity created: $entityFile"
    }

    Write-Log "Hub updated: $($p.id)"
}

# ==============================================================================
# PHASE 3: THINK - Analysis
# ==============================================================================
Write-Log "--- PHASE 3: THINK ---"

$ThinkPrompt = @"
You are the vault AI assistant.
Date: $Date

PROJECT GIT STATUSES:
$GitSummary

INBOX ($($InboxFiles.Count) files):
$($InboxSummary.Substring(0, [Math]::Min(2000, $InboxSummary.Length)))

Analyze and respond ONLY in JSON format:
{"kritik":["..","..",".."],"baglantilar":[".."],"riskler":[".."],"firsatlar":[".."],"bugun_oncelik":["1.","2.","3."]}

Write nothing else.
"@

$ThinkOutput = Invoke-Claude -Prompt $ThinkPrompt
Write-Log "THINK complete"

# ==============================================================================
# PHASE 4: LEARN - Update vault memory
# ==============================================================================
Write-Log "--- PHASE 4: LEARN ---"

$LearnPrompt = @"
Date: $Date
THINK: $ThinkOutput

Write only in this format:
## $Date Learnings
- [learning 1]
- [learning 2]
- [learning 3]

Add nothing else.
"@

$LearnFile = "$VaultPath\MEMORY\LEARNING\learnings.md"
New-Item -ItemType Directory -Path (Split-Path $LearnFile) -Force | Out-Null
$LearnOutput = Invoke-Claude -Prompt $LearnPrompt
if (Test-Path $LearnFile) {
    Add-Content -Path $LearnFile -Value ("`n" + $LearnOutput) -Encoding UTF8
} else {
    [System.IO.File]::WriteAllText($LearnFile, $LearnOutput, [System.Text.Encoding]::UTF8)
}
Write-Log "LEARN complete"

# ==============================================================================
# PHASE 5: WIKI UPDATE - Auto-update hot.md and log.md
# ==============================================================================
Write-Log "--- PHASE 5: WIKI UPDATE ---"

# hot.md - new status is prepended every night
$HotFile = "$VaultPath\wiki\hot.md"
$ProjStatusLines = ($Projects | ForEach-Object {
    $g = Get-GitInfo -Path $_.path
    "| [[$(($_.id.ToLower() -replace '\.', '-'))|$($_.id)]] | $($_.status) | $($g.commit.Substring(0,[Math]::Min(45,$g.commit.Length))) | $($g.ago) |"
}) -join "`n"

# Read ContentPipeline path from environment
$PipelinePath = $env:CONTENT_PIPELINE_PATH

$HotHeader = @"
---
updated: $Date
---

# Vault Hot Context

*Last update: $Date (nightly agent v8.0)*

## Today's Status

| Project | Status | Last Commit | When |
|---------|--------|-------------|------|
$ProjStatusLines

## Open Blockers
$(try {
    $acts = Get-Content "$VaultPath\60_ACTIONS\actions.md" -Encoding UTF8 -ErrorAction SilentlyContinue
    ($acts | Select-String "- \[ \]" | ForEach-Object { "- $($_.Line.Trim())" }) -join "`n"
} catch { "- Actions file not readable" })

## Pipeline
$(if ($PipelinePath -and (Test-Path $PipelinePath)) {
"- Inbox: $(try{(Get-ChildItem "$PipelinePath\inbox" -Filter '*.md' -EA SilentlyContinue).Count}catch{0}) | Research: $(try{(Get-ChildItem "$PipelinePath\research-briefs" -Filter '*.md' -EA SilentlyContinue).Count}catch{0}) | Draft: $(try{(Get-ChildItem "$PipelinePath\drafts" -Filter '*.md' -EA SilentlyContinue).Count}catch{0}) | Approved: $(try{(Get-ChildItem "$PipelinePath\approved-content" -Filter '*.md' -EA SilentlyContinue).Count}catch{0}) | Distribution: $(try{(Get-ChildItem "$PipelinePath\distribution" -Filter '*.md' -EA SilentlyContinue).Count}catch{0})"
} else {
"- ContentPipeline: not configured (set CONTENT_PIPELINE_PATH)"
})

---

"@

$ExistingHot = if (Test-Path $HotFile) {
    (Get-Content $HotFile -Encoding UTF8 -Raw) -replace '(?s)^---.*?---\s*\n# Vault Hot Context.*?---\s*\n', ''
} else { "" }

[System.IO.File]::WriteAllText($HotFile, ($HotHeader + $ExistingHot.Trim()), [System.Text.Encoding]::UTF8)
Write-Log "hot.md updated"

# wiki/log.md - change log
$LogWikiFile = "$VaultPath\wiki\log.md"
$LogEntry = "## $Date`n- Nightly agent v8.0 ran`n- $($Projects.Count) project hubs updated`n- INBOX: $($InboxFiles.Count) files processed`n- Git summary scanned`n"
if (Test-Path $LogWikiFile) {
    $Existing = Get-Content $LogWikiFile -Raw -Encoding UTF8
    [System.IO.File]::WriteAllText($LogWikiFile, ($LogEntry + "`n" + $Existing), [System.Text.Encoding]::UTF8)
} else {
    [System.IO.File]::WriteAllText($LogWikiFile, "# Wiki Log`n`n$LogEntry", [System.Text.Encoding]::UTF8)
}
Write-Log "wiki/log.md updated"

# ==============================================================================
# PHASE 6: MORNING REPORT — brief for tomorrow + carry-over + empty capture sections
# ==============================================================================
Write-Log "--- PHASE 6: MORNING REPORT (tomorrow: $TomorrowDate) ---"

$TomorrowFile = "$VaultPath\50_DAILY\$TomorrowDate-morning.md"

# Collect uncompleted actions from today's morning file
$CarryOver = ""
if (Test-Path $MorningFile) {
    $TodayLines = [System.IO.File]::ReadAllLines($MorningFile, [System.Text.Encoding]::UTF8)
    $OpenItems = $TodayLines | Where-Object { $_ -match '^\s*-\s*\[\s\]\s+\S' }
    if ($OpenItems.Count -gt 0) {
        $CarryOver = ($OpenItems | ForEach-Object { $_.Trim() }) -join "`n"
        Write-Log "Carry-over action count: $($OpenItems.Count)"
    } else {
        Write-Log "No carry-over actions"
    }
} else {
    Write-Log "Today's file not found, carry-over skipped"
}
$MorningFile  = "$VaultPath\50_DAILY\$Date-morning.md"

$CarryOverBlock = if ($CarryOver) {
    "CARRY-OVER ACTIONS (not completed today, should be on tomorrow's agenda):`n$CarryOver"
} else {
    "NO CARRY-OVER ACTIONS."
}

$ReportPrompt = @"
You are the vault AI assistant writing tomorrow's morning report.
Today: $Date — Tomorrow: $TomorrowDate

PROJECT STATUSES:
$GitSummary

THINK ANALYSIS:
$ThinkOutput

INBOX SUMMARY:
$($InboxSummary.Substring(0, [Math]::Min(1500, $InboxSummary.Length)))

$CarryOverBlock

Write ONLY the following markdown format. Add nothing else:

# Morning Brief - $TomorrowDate

## Yesterday
- [top 3 most important developments from today ($Date) - concrete and short]

## Critical Info
- [critical 1]
- [critical 2]

## Carry-over
- [ ] [copy priority items from carry-over actions above, in priority order]

## Actions
- [ ] [action 1 - NEW concrete]
- [ ] [action 2 - NEW concrete]
- [ ] [action 3 - NEW concrete]

## Opportunities
- [opportunity 1]

## Risks
- [risk 1]

## Today's Tasks
- [ ] [priority 1]
- [ ] [priority 2]
- [ ] [priority 3]

IMPORTANT: If carry-over actions exist, fill the ## Carry-over section. Otherwise keep "## Carry-over" but write "- [x] no carry-over actions" below it. Carry-over actions must NOT repeat in ## Today's Tasks or ## Actions — show them only once in ## Carry-over.

Short, actionable. Markdown only.
"@

Invoke-Claude -Prompt $ReportPrompt -OutFile $TomorrowFile | Out-Null

# Add empty capture sections below the brief — for Telegram + manual capture during the day
$CaptureScaffold = @"

---

## Captures

## Research Signals

## Content Ideas

## Links to Process
"@
Add-Content -Path $TomorrowFile -Value $CaptureScaffold -Encoding UTF8
Write-Log "Tomorrow's morning report + capture scaffold written: $TomorrowFile"

# ==============================================================================
# PHASE 7: VERIFY
# ==============================================================================
Write-Log "--- PHASE 7: VERIFY ---"
@($TomorrowFile, $LearnFile, $HotFile) | ForEach-Object {
    if (Test-Path $_) { Write-Log "OK: $_" } else { Write-Log "MISSING: $_" "WARN" }
}

# Check project hubs
foreach ($p in $Projects) {
    $f = "$VaultPath\20_PROJECTS\$($p.id)\$($p.id) Overview.md"
    if (Test-Path $f) { Write-Log "Hub OK: $($p.id)" } else { Write-Log "Hub MISSING: $($p.id)" "WARN" }
}

# ==============================================================================
# PHASE 8: ARCHIVE
# ==============================================================================
Write-Log "--- PHASE 8: ARCHIVE ---"
if ($InboxFiles.Count -gt 0) {
    $ArchivePath = "$VaultPath\70_ARCHIVE\$Year\$Month"
    New-Item -ItemType Directory -Path $ArchivePath -Force | Out-Null
    foreach ($f in $InboxFiles) {
        Move-Item -Path $f.FullName -Destination "$ArchivePath\$($f.Name)" -Force
        Write-Log "Archived: $($f.Name)"
    }
}

# ==============================================================================
# PHASE 9: PATTERN ANALYSIS - Weekly decision analysis (Sundays)
# ==============================================================================
Write-Log "--- PHASE 9: PATTERN ANALYSIS ---"

$DecisionsDir = "$VaultPath\60_ACTIONS\decisions"
$PatternsDir  = "$VaultPath\60_ACTIONS\patterns"
$EdgeFile     = "$VaultPath\60_ACTIONS\business-edge\BUSINESS-EDGE.md"

New-Item -ItemType Directory -Path $DecisionsDir -Force | Out-Null
New-Item -ItemType Directory -Path $PatternsDir  -Force | Out-Null
New-Item -ItemType Directory -Path (Split-Path $EdgeFile) -Force | Out-Null

# Update decision count
$AllDecisions = Get-ChildItem -Path $DecisionsDir -Filter "*.md" -ErrorAction SilentlyContinue | Where-Object { $_.Name -notlike "_*" }
$TotalDecisions = $AllDecisions.Count

# Last 30 days decisions
$30DayAgo = (Get-Date).AddDays(-30)
$RecentDecisions = $AllDecisions | Where-Object { $_.LastWriteTime -gt $30DayAgo }
$RecentCount = $RecentDecisions.Count

# Update decision count in BUSINESS-EDGE.md
if (Test-Path $EdgeFile) {
    $EdgeContent = Get-Content $EdgeFile -Raw -Encoding UTF8
    $EdgeContent = $EdgeContent -replace '\*\*Total Decisions:\*\* \d+', "**Total Decisions:** $TotalDecisions"
    $EdgeContent = $EdgeContent -replace '\*\*Last 30 Days:\*\* \d+', "**Last 30 Days:** $RecentCount"
    [System.IO.File]::WriteAllText($EdgeFile, $EdgeContent, [System.Text.Encoding]::UTF8)
    Write-Log "BUSINESS-EDGE.md decision count updated: Total=$TotalDecisions Last30=$RecentCount"
}

# Write weekly pattern report on Sundays
$DayOfWeek = (Get-Date).DayOfWeek
if ($DayOfWeek -eq "Sunday" -or $TotalDecisions -ge 5) {
    Write-Log "Preparing weekly pattern report..."

    # Read last 7 days' decisions
    $7DayAgo = (Get-Date).AddDays(-7)
    $WeekDecisions = $AllDecisions | Where-Object { $_.LastWriteTime -gt $7DayAgo }
    $WeekContent = ""
    foreach ($d in $WeekDecisions) {
        $lines = Get-Content $d.FullName -TotalCount 50 -Encoding UTF8 -ErrorAction SilentlyContinue
        $WeekContent += "=== $($d.Name) ===`n" + ($lines -join "`n") + "`n`n"
    }

    # Summary of all decision archive
    $AllContent = ""
    foreach ($d in ($AllDecisions | Sort-Object LastWriteTime -Descending | Select-Object -First 15)) {
        $lines = Get-Content $d.FullName -TotalCount 30 -Encoding UTF8 -ErrorAction SilentlyContinue
        $AllContent += "=== $($d.Name) ===`n" + ($lines -join "`n") + "`n`n"
    }

    # Current edge file
    $CurrentEdge = if (Test-Path $EdgeFile) { Get-Content $EdgeFile -Raw -Encoding UTF8 | Out-String } else { "" }

    if ($WeekDecisions.Count -gt 0 -or $TotalDecisions -ge 5) {
        $PatternPrompt = @"
You are the vault AI decision analyst.
Date: $Date

TASK: Analyze the decision history, identify patterns, update BUSINESS-EDGE.md.

CURRENT BUSINESS EDGE (before update):
$($CurrentEdge.Substring(0, [Math]::Min(1000, $CurrentEdge.Length)))

THIS WEEK'S DECISIONS ($($WeekDecisions.Count) total):
$($WeekContent.Substring(0, [Math]::Min(2000, $WeekContent.Length)))

ALL DECISION ARCHIVE ($TotalDecisions total, last 15):
$($AllContent.Substring(0, [Math]::Min(2000, $AllContent.Length)))

Write a WEEKLY PATTERN REPORT in the following markdown format:

# Weekly Pattern Report - $Date

## Decisions Made This Week
- [decision list and outcomes]

## Identified Patterns
[Recurring behaviors in the decision archive]

## Weakness Warnings
[Decisions this week that triggered known weakness patterns, if any]

## Strengths Reinforced
[Strong patterns confirmed this week]

## Business Edge Update Suggestion
[Items in BUSINESS-EDGE.md that need updating]

## Watch Out Next Week
[1-2 specific warnings]

Concise. Evidence-based.
"@
        $PatternFile = "$PatternsDir\$Date-pattern-report.md"
        $PatternOutput = Invoke-Claude -Prompt $PatternPrompt -OutFile $PatternFile
        Write-Log "Pattern report written: $PatternFile"
    } else {
        Write-Log "Not enough decision data for pattern report (total: $TotalDecisions)"
    }
} else {
    Write-Log "Pattern analysis skipped - not Sunday and decision count low ($TotalDecisions)"
}

# ==============================================================================
# PHASE 10: CONNECT TOUR - Weekly cross-domain connection tour (Sundays)
# ==============================================================================
Write-Log "--- PHASE 10: CONNECT TOUR ---"

$DayOfWeek = (Get-Date).DayOfWeek
if ($DayOfWeek -eq 'Sunday') {
    $ConnectSkill = "$VaultPath\wiki\skills\connect.md"
    $WikiIndex    = "$VaultPath\wiki\index.md"

    if ((Test-Path $ConnectSkill) -and (Test-Path $WikiIndex)) {
        $SkillContent = Get-Content $ConnectSkill -Raw -Encoding UTF8
        $IndexContent = Get-Content $WikiIndex -Raw -Encoding UTF8

        # Sample wiki pages (first 3000 chars)
        $WikiSample = ""
        $WikiDirs = @("concepts","entities","sources","patterns","questions","comparisons","domains")
        foreach ($dir in $WikiDirs) {
            $dirPath = "$VaultPath\wiki\$dir"
            if (Test-Path $dirPath) {
                $files = Get-ChildItem $dirPath -Filter "*.md" -ErrorAction SilentlyContinue | Select-Object -First 3
                foreach ($f in $files) {
                    $lines = Get-Content $f.FullName -TotalCount 10 -Encoding UTF8 -ErrorAction SilentlyContinue
                    $WikiSample += "=== wiki/$dir/$($f.Name) ===`n" + ($lines -join "`n") + "`n`n"
                    if ($WikiSample.Length -gt 3000) { break }
                }
            }
            if ($WikiSample.Length -gt 3000) { break }
        }

        $ConnectPrompt = @"
You are the vault AI connection analyst.
Date: $Date (Sunday - Weekly Connect Tour)

CONNECT SKILL RULES:
$SkillContent

WIKI INDEX (short):
$($IndexContent.Substring(0, [Math]::Min(1500, $IndexContent.Length)))

WIKI SAMPLE PAGES:
$WikiSample

TASK: Find meaningful cross-domain connections between wiki pages that haven't been linked yet.
Look for Type A, B, C, D connections per the Connect Skill rules.

OUTPUT FORMAT (markdown):
# Weekly Connect Tour - $Date

## Connections Found

### [Connection 1 - Type X]
**Page A:** [[page-a]]
**Page B:** [[page-b]]
**Connection:** [This connection explains: ...]

[continue...]

## Summary
- Total connections: X
- Most interesting: [explain]
- Suggested new question: [[wiki/questions/...]]
"@

        $ConnectFile = "$VaultPath\wiki\skills\connect-log-$Date.md"
        Write-Log "Starting Connect Tour..."
        $ConnectResult = Invoke-Claude -Prompt $ConnectPrompt -OutFile $ConnectFile
        Write-Log "Connect Tour complete: $ConnectFile"
    } else {
        Write-Log "Connect Skill or Wiki Index not found — skipped" "WARN"
    }
} else {
    Write-Log "Connect Tour runs on Sundays only (today: $DayOfWeek) — skipped"
}

# ==============================================================================
# PHASE 11: EVENING REVIEW — process today's captures, produce 4 outputs
# ==============================================================================
Write-Log "--- PHASE 11: EVENING REVIEW ($Date) ---"

if (Test-Path $MorningFile) {
    $Captures        = Get-SectionContent -FilePath $MorningFile -SectionName "Captures"
    $ResearchSignals = Get-SectionContent -FilePath $MorningFile -SectionName "Research Signals"
    $ContentIdeas    = Get-SectionContent -FilePath $MorningFile -SectionName "Content Ideas"
    $LinksToProcess  = Get-SectionContent -FilePath $MorningFile -SectionName "Links to Process"

    $TotalCaptureLen = ($Captures + $ResearchSignals + $ContentIdeas + $LinksToProcess).Trim().Length

    if ($TotalCaptureLen -gt 0) {
        $WikiHotPath = "$VaultPath\wiki\hot.md"
        $WikiHotCtx = if (Test-Path $WikiHotPath) {
            $hotRaw = Get-Content $WikiHotPath -Raw -Encoding UTF8
            $hotRaw.Substring(0, [Math]::Min(1500, $hotRaw.Length))
        } else { "" }

        $ReviewPrompt = @"
You are the vault AI assistant doing the evening review.
Date: $Date

RAW IDEAS CAPTURED TO THE VAULT TODAY:

[CAPTURES]
$Captures

[RESEARCH SIGNALS]
$ResearchSignals

[CONTENT IDEAS]
$ContentIdeas

[LINKS TO PROCESS]
$LinksToProcess

WIKI HOT CONTEXT (reference — what's hot in the vault):
$WikiHotCtx

Write ONLY in the following markdown format. Add nothing else:

### 1. BEST CAPTURE
[Pick the single most valuable idea from today's captures. 1 sentence: what and why it's valuable.]

### 2. CONTENT ANGLE
[If any capture/idea could be a strong article or thread, pick it and write the opening hook. Hook + 1 sentence rationale.]

### 3. CONNECTIONS
[If any of today's captures connect to an existing note/topic in the vault, reference it with a wikilink: [[note-title]]. If none, write "No new connections found today."]

### 4. TOMORROW FOCUS
[Given today's notes + active projects ($($Projects.Count) projects), what is the single most important focus for tomorrow? 1 sentence.]

Under 200 words. Direct. No padding.
"@

        $EveningReview = Invoke-Claude -Prompt $ReviewPrompt
        if ($EveningReview -and $EveningReview.Trim().Length -gt 0) {
            Set-Section -FilePath $MorningFile -SectionName "Evening Review" -Content $EveningReview
            Write-Log "Evening Review written: $MorningFile (capture: $TotalCaptureLen chars)"

            # ContentPipeline integration: extract "CONTENT ANGLE" section, write to inbox
            $PipelinePath = $env:CONTENT_PIPELINE_PATH
            if ($PipelinePath -and (Test-Path $PipelinePath)) {
                $ContentInbox = "$PipelinePath\inbox"
                New-Item -ItemType Directory -Path $ContentInbox -Force | Out-Null

                # Regex: "### 2. CONTENT ANGLE" through next "###" or end
                $angleMatch = [regex]::Match($EveningReview, '###\s*2\.\s*CONTENT\s*ANGLE(.*?)(?=###\s*\d+\.|\z)', 'Singleline')
                if ($angleMatch.Success) {
                    $angleText = $angleMatch.Groups[1].Value.Trim()
                    # Skip empty/placeholder "none" messages
                    if ($angleText.Length -gt 20 -and $angleText -notmatch '^(none|no content|not found|no strong)') {
                        $AngleFile = "$ContentInbox\$Date-jarvis-angle.md"
                        $AngleContent = @"
---
type: content-angle
source: jarvis-evening-review
date: $Date
status: draft
---

# Evening Review Content Angle - $Date

$angleText

---

**Source:** [JARVIS Evening Review]($MorningFile)
**Generated:** $((Get-Date).ToString("yyyy-MM-dd HH:mm"))
"@
                        [System.IO.File]::WriteAllText($AngleFile, $AngleContent, [System.Text.Encoding]::UTF8)
                        Write-Log "Content angle written to ContentPipeline: $AngleFile"
                    } else {
                        Write-Log "No content angle in Evening Review, ContentPipeline skipped"
                    }
                } else {
                    Write-Log "CONTENT ANGLE section could not be parsed" "WARN"
                }
            } else {
                Write-Log "ContentPipeline path not set or not found (CONTENT_PIPELINE_PATH), skipped"
            }
        } else {
            Write-Log "Evening Review: Claude returned empty, skipped" "WARN"
        }
    } else {
        Write-Log "Evening Review: No captures today, skipped"
    }
} else {
    Write-Log "Evening Review: $MorningFile not found, skipped" "WARN"
}

# ==============================================================================
# PHASE 12: WIKI LINT — broken link + orphan + stale note report (Sundays)
# ==============================================================================
if ($DayOfWeek -eq "Sunday") {
    Write-Log "--- PHASE 12: WIKI LINT ---"

    $WikiRoot = "$VaultPath\wiki"
    if (Test-Path $WikiRoot) {
        # Scan all vault md files, exclude system folders
        $ExcludeFolders = @('.scripts', '.dashboard', '.obsidian', '.raw', '.claude', '.stfolder', '70_ARCHIVE', 'docs', 'node_modules')
        $AllVaultMd = Get-ChildItem -Path $VaultPath -Filter "*.md" -Recurse -ErrorAction SilentlyContinue | Where-Object {
            $rel = $_.FullName.Substring($VaultPath.Length + 1)
            $topDir = ($rel -split '[\\/]')[0]
            -not ($ExcludeFolders -contains $topDir)
        }

        # Only wiki/ files are lint targets (orphan + stale)
        $WikiMdFiles = $AllVaultMd | Where-Object { $_.FullName.StartsWith($WikiRoot + [System.IO.Path]::DirectorySeparatorChar) }

        $NoteNames = @{}   # basename (lowercased) -> full path (for vault-wide resolve)
        foreach ($f in $AllVaultMd) {
            $key = [System.IO.Path]::GetFileNameWithoutExtension($f.Name).ToLower()
            if (-not $NoteNames.ContainsKey($key)) { $NoteNames[$key] = $f.FullName }
        }

        $BrokenLinks  = New-Object System.Collections.Generic.List[string]
        $LinkTargets  = New-Object System.Collections.Generic.HashSet[string]
        $StaleNotes   = New-Object System.Collections.Generic.List[string]
        $StaleThreshold = (Get-Date).AddDays(-90)

        # Collect wikilinks vault-wide (which notes link to what)
        foreach ($f in $AllVaultMd) {
            $content = [System.IO.File]::ReadAllText($f.FullName, [System.Text.Encoding]::UTF8)
            $matches = [regex]::Matches($content, '\[\[([^\[\]\|\#]+?)(?:\#[^\[\]]+)?(?:\|[^\[\]]+)?\]\]')
            foreach ($m in $matches) {
                $target = $m.Groups[1].Value.Trim().ToLower()
                if ($target -match '/') { $target = ($target -split '/')[-1] }
                [void]$LinkTargets.Add($target)
                if (-not $NoteNames.ContainsKey($target)) {
                    $rel = $f.FullName.Substring($VaultPath.Length + 1)
                    [void]$BrokenLinks.Add("$($rel): [[$($m.Groups[1].Value)]]")
                }
            }
        }

        # Stale + orphan check for wiki/ files
        foreach ($f in $WikiMdFiles) {
            if ($f.LastWriteTime -lt $StaleThreshold) {
                $daysSince = [math]::Round(((Get-Date) - $f.LastWriteTime).TotalDays)
                [void]$StaleNotes.Add("$($f.Name) — last updated $daysSince days ago")
            }
        }

        # Orphan: wiki files that receive no links from anywhere in the vault
        $OrphanNotes = New-Object System.Collections.Generic.List[string]
        $SkipOrphan = @('hot', 'index', 'log', '_template', 'readme', 'wiki')
        foreach ($f in $WikiMdFiles) {
            $key = [System.IO.Path]::GetFileNameWithoutExtension($f.Name).ToLower()
            if ($SkipOrphan -contains $key) { continue }
            if (-not $LinkTargets.Contains($key)) {
                [void]$OrphanNotes.Add($f.FullName.Replace("$WikiRoot\", ''))
            }
        }

        $LintFile = "$WikiRoot\lint-log-$Date.md"
        $BrokenSection = if ($BrokenLinks.Count -gt 0) {
            ($BrokenLinks | Select-Object -First 50 | ForEach-Object { "- $_" }) -join "`n"
        } else { "- No broken links." }
        $OrphanSection = if ($OrphanNotes.Count -gt 0) {
            ($OrphanNotes | Select-Object -First 50 | ForEach-Object { "- $_" }) -join "`n"
        } else { "- No orphan notes." }
        $StaleSection = if ($StaleNotes.Count -gt 0) {
            ($StaleNotes | Select-Object -First 50 | ForEach-Object { "- $_" }) -join "`n"
        } else { "- No stale notes (all notes updated within 90 days)." }

        $LintReport = @"
---
type: lint
date: $Date
---

# Wiki Lint Report - $Date

**Vault total notes:** $($AllVaultMd.Count) | **Wiki notes:** $($WikiMdFiles.Count) | **Broken links:** $($BrokenLinks.Count) | **Orphans:** $($OrphanNotes.Count) | **Stale (>90d):** $($StaleNotes.Count)

## Broken Wikilinks
$BrokenSection

## Orphan Notes (no incoming links)
$OrphanSection

## Stale Notes (>90 days not updated)
$StaleSection

---

> This report is auto-generated every Sunday. Action: fix broken links, link orphans to index, refresh or archive stale notes to 70_ARCHIVE.
"@
        [System.IO.File]::WriteAllText($LintFile, $LintReport, [System.Text.Encoding]::UTF8)
        Write-Log "Wiki Lint: $($BrokenLinks.Count) broken, $($OrphanNotes.Count) orphans, $($StaleNotes.Count) stale → $LintFile"
    } else {
        Write-Log "Wiki Lint: $WikiRoot not found, skipped" "WARN"
    }
} else {
    Write-Log "Wiki Lint runs on Sundays only (today: $DayOfWeek) — skipped"
}

$Duration = [math]::Round(((Get-Date) - $StartTime).TotalSeconds)
Write-Log "=== Agent Complete === Duration: ${Duration}s ==="

# Notification
try {
    $ActionCount = if (Test-Path $TomorrowFile) { (Select-String -Path $TomorrowFile -Pattern "- \[ \]" -ErrorAction SilentlyContinue).Count } else { 0 }
    & powershell -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "$VaultPath\.scripts\notify.ps1" -Title "Vault Agent Ready" -Message "v8.0 complete. $ActionCount actions, $($Projects.Count) projects, $TotalDecisions decisions analyzed."
} catch {}
