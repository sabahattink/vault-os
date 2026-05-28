param(
    [string]$VaultPath = $env:VAULT_PATH,
    [string]$LogPath   = ""
)

if (-not $VaultPath) {
    Write-Error "VAULT_PATH is not set. Pass -VaultPath or set the environment variable."
    exit 1
}

if (-not $LogPath) { $LogPath = Join-Path $VaultPath ".scripts\logs" }

$Date     = Get-Date -Format "yyyy-MM-dd"
$DateTime = Get-Date -Format "yyyy-MM-dd-HH-mm"
$LogFile  = Join-Path $LogPath "$Date-agent.log"

New-Item -ItemType Directory -Path $LogPath -Force | Out-Null

function Write-Log {
    param([string]$Message, [string]$Level = "INFO")
    $Timestamp = Get-Date -Format "HH:mm:ss"
    $Line = "[$Timestamp] [$Level] $Message"
    Add-Content -Path $LogFile -Value $Line -Encoding UTF8
    Write-Host $Line
}

# Read NOTION_TOKEN from .env file next to this script, or from environment
$Token = $env:NOTION_TOKEN
if (-not $Token) {
    $EnvFile = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) ".env"
    if (Test-Path $EnvFile) {
        foreach ($line in Get-Content $EnvFile) {
            if ($line -match "^NOTION_TOKEN=(.+)") {
                $Token = $Matches[1].Trim()
            }
        }
    }
}

if (-not $Token) {
    Write-Log "NOTION_TOKEN not found — set it in .env or as an environment variable" "ERROR"
    exit 1
}

$Headers = @{
    "Authorization"  = "Bearer $Token"
    "Notion-Version" = "2022-06-28"
    "Content-Type"   = "application/json"
}

Write-Log "--- Notion Sync Started ---"

# Fetch all pages (pagination supported)
$AllPages = @()
$HasMore  = $true
$Cursor   = $null

while ($HasMore) {
    $Body = @{ page_size = 100 }
    if ($Cursor) { $Body.start_cursor = $Cursor }

    try {
        $Response = Invoke-RestMethod -Uri "https://api.notion.com/v1/search" -Method POST -Headers $Headers -Body ($Body | ConvertTo-Json) -ErrorAction Stop
        $AllPages += $Response.results
        $HasMore   = $Response.has_more
        $Cursor    = $Response.next_cursor
        Write-Log "Pages fetched so far: $($AllPages.Count)"
    } catch {
        Write-Log "Notion API error: $_" "ERROR"
        exit 1
    }
}

Write-Log "Total pages found: $($AllPages.Count)"

$OutputLines = @()
$OutputLines += "---"
$OutputLines += "tags: [notion, sync, workspace]"
$OutputLines += "date: $Date"
$OutputLines += "source: notion"
$OutputLines += "type: resource"
$OutputLines += "---"
$OutputLines += ""
$OutputLines += "# Notion Workspace Sync - $Date"
$OutputLines += ""

$PageCount = 0
foreach ($Page in $AllPages) {
    if ($Page.object -ne "page") { continue }

    $Title = "Untitled"
    if ($Page.properties.title.title.Count -gt 0) {
        $Title = $Page.properties.title.title[0].plain_text
    } elseif ($Page.properties.Name.title.Count -gt 0) {
        $Title = $Page.properties.Name.title[0].plain_text
    }

    $PageUrl    = $Page.url
    $LastEdited = $Page.last_edited_time

    $OutputLines += "## $Title"
    $OutputLines += "**URL:** $PageUrl"
    $OutputLines += "**Last updated:** $LastEdited"
    $OutputLines += ""

    try {
        $Blocks = Invoke-RestMethod -Uri "https://api.notion.com/v1/blocks/$($Page.id)/children" -Method GET -Headers $Headers -ErrorAction Stop
        foreach ($Block in $Blocks.results) {
            $BlockType = $Block.type
            $Text = ""
            if ($Block.$BlockType.rich_text.Count -gt 0) {
                $Text = ($Block.$BlockType.rich_text | ForEach-Object { $_.plain_text }) -join ""
            }
            if ($Text -ne "") {
                if ($BlockType -eq "heading_1")          { $OutputLines += "### $Text" }
                elseif ($BlockType -eq "heading_2")      { $OutputLines += "#### $Text" }
                elseif ($BlockType -eq "bulleted_list_item") { $OutputLines += "- $Text" }
                elseif ($BlockType -eq "to_do") {
                    $Checked = if ($Block.to_do.checked) { "[x]" } else { "[ ]" }
                    $OutputLines += "- $Checked $Text"
                }
                else { $OutputLines += $Text }
            }
        }
    } catch {
        $OutputLines += "*Content could not be loaded*"
    }

    $OutputLines += ""
    $OutputLines += "---"
    $OutputLines += ""
    $PageCount++
}

$OutputFile = Join-Path $VaultPath "00_INBOX\$DateTime-notion-sync.md"
[System.IO.File]::WriteAllLines($OutputFile, $OutputLines, [System.Text.Encoding]::UTF8)

Write-Log "Notion sync complete: $PageCount pages processed"
Write-Log "Output: $OutputFile"
