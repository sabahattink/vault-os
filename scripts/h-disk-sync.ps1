param(
    [string]$VaultPath   = $env:VAULT_PATH,
    [string]$LogPath     = "",
    [string[]]$ScanPaths = @()   # Override with your own folder list; falls back to DATA_SCAN_PATHS env var
)

if (-not $VaultPath) {
    Write-Error "VAULT_PATH is not set. Pass -VaultPath or set the environment variable."
    exit 1
}

if (-not $LogPath) { $LogPath = Join-Path $VaultPath ".scripts\logs" }

$Date     = Get-Date -Format "yyyy-MM-dd"
$DateTime = Get-Date -Format "yyyy-MM-dd-HH-mm"
$LogFile  = Join-Path $LogPath "$Date-agent.log"
$Since    = (Get-Date).AddHours(-24)

New-Item -ItemType Directory -Path $LogPath -Force | Out-Null

function Write-Log {
    param([string]$Message, [string]$Level = "INFO")
    $Timestamp = Get-Date -Format "HH:mm:ss"
    $Line = "[$Timestamp] [$Level] $Message"
    Add-Content -Path $LogFile -Value $Line -Encoding UTF8
    Write-Host $Line
}

# Resolve scan folders: parameter > env var > empty (script will warn)
if ($ScanPaths.Count -eq 0 -and $env:DATA_SCAN_PATHS) {
    $ScanPaths = $env:DATA_SCAN_PATHS -split ';' | Where-Object { $_ -ne '' }
}

if ($ScanPaths.Count -eq 0) {
    Write-Log "No scan paths configured. Set DATA_SCAN_PATHS in .env or pass -ScanPaths." "WARN"
    exit 0
}

# Folders to exclude from results
$ExcludePaths = @(
    "node_modules",
    ".git",
    "dist",
    ".next",
    "build"
)

Write-Log "--- Disk Sync Started ---"
Write-Log "Scanning .md files changed in the last 24 hours..."

$ChangedFiles = @()

foreach ($Folder in $ScanPaths) {
    if (-not (Test-Path $Folder)) { continue }

    try {
        $Files = Get-ChildItem -Path $Folder -Recurse -Filter "*.md" -ErrorAction SilentlyContinue |
            Where-Object {
                $_.LastWriteTime -gt $Since -and
                $_.FullName -notlike "*$([System.IO.Path]::GetFileName($VaultPath))*" -and
                ($ExcludePaths | ForEach-Object { $_.FullName -like ("*\$_\*") }) -notcontains $true
            }
        $ChangedFiles += $Files
    } catch {
        Write-Log "Scan error: $Folder - $_" "WARN"
    }
}

Write-Log "Changed files found: $($ChangedFiles.Count)"

if ($ChangedFiles.Count -eq 0) {
    Write-Log "No changed files — skipping"
    exit 0
}

$OutputLines = @()
$OutputLines += "---"
$OutputLines += "tags: [disk-sync, workspace]"
$OutputLines += "date: $Date"
$OutputLines += "source: disk-sync"
$OutputLines += "type: resource"
$OutputLines += "---"
$OutputLines += ""
$OutputLines += "# Disk Changes - $Date"
$OutputLines += ""

foreach ($File in $ChangedFiles) {
    # Use a relative path from the nearest scan root for readability
    $RelPath = $File.FullName
    foreach ($root in $ScanPaths) {
        if ($File.FullName.StartsWith($root)) {
            $RelPath = $File.FullName.Substring($root.Length).TrimStart('\','/')
            break
        }
    }

    $OutputLines += "## $($File.BaseName)"
    $OutputLines += "**Location:** $RelPath"
    $OutputLines += "**Updated:** $($File.LastWriteTime.ToString('yyyy-MM-dd HH:mm'))"
    $OutputLines += ""

    try {
        $Content = Get-Content $File.FullName -Raw -Encoding UTF8 -ErrorAction Stop
        $Lines = $Content -split "`n"
        if ($Lines.Count -gt 100) {
            $OutputLines += ($Lines | Select-Object -First 100)
            $OutputLines += ""
            $OutputLines += "*... ($($Lines.Count - 100) more lines) — Full file: $($File.FullName)*"
        } else {
            $OutputLines += $Content
        }
    } catch {
        $OutputLines += "*File could not be read*"
    }

    $OutputLines += ""
    $OutputLines += "---"
    $OutputLines += ""
}

$OutputFile = Join-Path $VaultPath "00_INBOX\$DateTime-disk-sync.md"
[System.IO.File]::WriteAllLines($OutputFile, $OutputLines, [System.Text.Encoding]::UTF8)

Write-Log "Disk sync complete: $($ChangedFiles.Count) files"
Write-Log "Output: $OutputFile"
