# install-scheduler.ps1
# Registers the nightly agent as a Windows Task Scheduler job.
# Run once as Administrator after cloning the repo.

param(
    [string]$VaultPath   = $env:VAULT_PATH,
    [string]$ScriptDir   = (Split-Path -Parent $MyInvocation.MyCommand.Path),
    [string]$TriggerTime = "23:00"
)

if (-not $VaultPath) {
    Write-Error "VAULT_PATH is not set. Pass -VaultPath or set the environment variable."
    exit 1
}

$TaskName  = "VaultOsNightlyAgent"
$ScriptPath = Join-Path $ScriptDir "nightly-agent.ps1"

Write-Host "Registering Nightly Agent with Task Scheduler..."

Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue

$Action = New-ScheduledTaskAction `
    -Execute "powershell.exe" `
    -Argument ("-NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$ScriptPath`" -VaultPath `"$VaultPath`"")

$Trigger = New-ScheduledTaskTrigger -Daily -At $TriggerTime

$Settings = New-ScheduledTaskSettingsSet `
    -ExecutionTimeLimit (New-TimeSpan -Hours 1) `
    -RestartCount 1 `
    -RestartInterval (New-TimeSpan -Minutes 5) `
    -StartWhenAvailable `
    -RunOnlyIfNetworkAvailable:$false

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $Action `
    -Trigger $Trigger `
    -Settings $Settings `
    -Description "Vault-OS Knowledge Vault Nightly Agent" `
    -RunLevel Highest | Out-Null

Write-Host "DONE: Task '$TaskName' created — runs nightly at $TriggerTime"
