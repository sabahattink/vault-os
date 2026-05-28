# n8n — Project Sync Workflow

This workflow syncs project directories into the vault's `20_PROJECTS/` folder every night.

## Workflow Steps

### 1. Schedule Trigger
- Runs nightly at 22:45 (15 minutes before the nightly agent)
- Cron: `45 22 * * *`

### 2. Read Project Directories
**Node type:** Execute Command
```bash
Get-ChildItem "$env:PROJECTS_ROOT" -Directory | Select-Object Name, LastWriteTime | ConvertTo-Json
```

### 3. For Each Project
**Node type:** Split In Batches

For each project:

#### 3a. Check Recent Changes
```bash
Get-ChildItem "$env:PROJECTS_ROOT\{{$json.Name}}" -Recurse -File |
  Where-Object { $_.LastWriteTime -gt (Get-Date).AddDays(-1) } |
  Select-Object Name, FullName, LastWriteTime |
  ConvertTo-Json
```

#### 3b. Generate Project Summary (Claude)
**Node type:** HTTP Request → Claude API
```json
{
  "model": "claude-haiku-4-5-20251001",
  "max_tokens": 500,
  "messages": [{
    "role": "user",
    "content": "Summarize the last 24 hours of changes for this project and write a status.md in vault format:\n\nProject: {{$json.projectName}}\nChanged files:\n{{$json.changes}}\n\nFormat:\n## Status: [Active/On Hold/Done]\n## Recent changes\n## Notes"
  }]
}
```

#### 3c. Write to Vault
**Node type:** Write Binary File
- Target: `<VAULT_PATH>/20_PROJECTS/{{projectName}}/status.md`

### 4. Send Notification (optional)
**Node type:** Send Email or Slack
- "Project sync complete: X projects updated"

## Setup

1. Create a "New Workflow" in n8n
2. Add the nodes described above
3. Activate the schedule
4. Click "Execute Workflow" for a first test

## Alternative: Simple PowerShell Sync

If you don't want to set up n8n, use a standalone PowerShell script:

```powershell
# Simple project status notes — no n8n required
$ProjectsRoot = $env:PROJECTS_ROOT
$VaultPath    = $env:VAULT_PATH

$Products = Get-ChildItem $ProjectsRoot -Directory
foreach ($p in $Products) {
    $dest = Join-Path $VaultPath "20_PROJECTS\$($p.Name)"
    New-Item -ItemType Directory -Path $dest -Force | Out-Null

    $recent = Get-ChildItem $p.FullName -Recurse -File |
        Where-Object { $_.LastWriteTime -gt (Get-Date).AddDays(-7) } |
        Select-Object -ExpandProperty Name

    $content = "# $($p.Name)`n`n**Last updated:** $(Get-Date -Format 'yyyy-MM-dd')`n`n## Recently Changed Files`n$($recent -join "`n")"
    Set-Content -Path "$dest\status.md" -Value $content -Encoding UTF8
}
Write-Host "Project sync complete"
```
