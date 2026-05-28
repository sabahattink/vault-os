param([string]$Title = "JARVIS", [string]$Message = "Morning report ready!")

Add-Type -AssemblyName System.Windows.Forms
$notify = New-Object System.Windows.Forms.NotifyIcon
$notify.Icon = [System.Drawing.SystemIcons]::Information
$notify.BalloonTipTitle = $Title
$notify.BalloonTipText = $Message
$notify.BalloonTipIcon = "Info"
$notify.Visible = $true
$notify.ShowBalloonTip(10000)
Start-Sleep -Seconds 3
$notify.Dispose()
