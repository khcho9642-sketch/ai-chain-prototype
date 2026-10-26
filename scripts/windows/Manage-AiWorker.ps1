[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [ValidateSet('Install', 'Start', 'Stop', 'Check', 'Status', 'Uninstall')]
  [string]$Action = 'Status',
  [switch]$Development,
  [string]$NodePath = '',
  [string]$EnvFile = ''
)
$ErrorActionPreference = 'Stop'
if (-not $Development -or $env:NODE_ENV -eq 'production') {
  throw 'This task manager is for local development only. Pass -Development; never install on production.'
}
$Root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$Local = Join-Path $Root '.local'
$Disabled = Join-Path $Local 'ai-worker.disabled'
$Recovery = Join-Path $Local 'worker-recovery.json'
$sha = [Security.Cryptography.SHA256]::Create()
try { $suffix = ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($Root)))).Replace('-', '').Substring(0, 10) }
finally { $sha.Dispose() }
$TaskName = "AIChain-Worker-Dev-$suffix"
$WatchName = "AIChain-Watch-Dev-$suffix"
$CurrentUser = [Security.Principal.WindowsIdentity]::GetCurrent().Name
if (-not $EnvFile) { $EnvFile = Join-Path $Local 'worker.env' }
$EnvFile = [IO.Path]::GetFullPath($EnvFile)
if (-not $NodePath) { $NodePath = (Get-Command node.exe -ErrorAction Stop).Source }
$NodePath = [IO.Path]::GetFullPath($NodePath)
$WorkerPath = Join-Path $Root 'scripts/ai-worker.mjs'

function Get-WorkerTask { Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue }
function Assert-ManagedTask($Task) {
  if ($Task -and ($Task.Description -ne "AIChain development worker: $Root")) { throw 'Refusing to modify an unrelated scheduled task.' }
}
$Task = Get-WorkerTask
Assert-ManagedTask $Task
switch ($Action) {
  'Install' {
    if (-not (Test-Path -LiteralPath $EnvFile)) { throw "Create the private environment file first: $EnvFile" }
    if (-not $PSCmdlet.ShouldProcess($Root, 'Install development login task and two-hour watchdog')) { return }
    New-Item -ItemType Directory -Path $Local -Force | Out-Null
    # No secrets in task arguments. Node reads the operator-owned private env file.
    $workerAction = New-ScheduledTaskAction -Execute $NodePath -Argument "--env-file=`"$EnvFile`" `"$WorkerPath`" --managed" -WorkingDirectory $Root
    $login = New-ScheduledTaskTrigger -AtLogOn -User $CurrentUser
    $principal = New-ScheduledTaskPrincipal -UserId $CurrentUser -LogonType Interactive -RunLevel Limited
    $settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero)
    Register-ScheduledTask -TaskName $TaskName -Action $workerAction -Trigger $login -Principal $principal -Settings $settings -Description "AIChain development worker: $Root" -Force | Out-Null
    $PowerShellExe = (Get-Process -Id $PID).Path
    $watchAction = New-ScheduledTaskAction -Execute $PowerShellExe -Argument "-NoProfile -File `"$PSCommandPath`" -Action Check -Development -NodePath `"$NodePath`" -EnvFile `"$EnvFile`"" -WorkingDirectory $Root
    $periodic = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(2) -RepetitionInterval (New-TimeSpan -Hours 2)
    $watchSettings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 2)
    Register-ScheduledTask -TaskName $WatchName -Action $watchAction -Trigger $periodic -Principal $principal -Settings $watchSettings -Description "AIChain development watchdog: $Root" -Force | Out-Null
    # Installation is not consent to start model calls immediately.
    Set-Content -LiteralPath $Disabled -Value 'installed-stopped' -Encoding UTF8
    Write-Output 'Installed, stopped. Review CLI settings, then use -Action Start -Development.'
  }
  'Start' {
    if (-not $Task) { throw 'Install the development tasks first.' }
    if ($PSCmdlet.ShouldProcess($TaskName, 'Start development worker')) {
      Remove-Item -LiteralPath $Disabled -Force -ErrorAction SilentlyContinue
      Remove-Item -LiteralPath $Recovery -Force -ErrorAction SilentlyContinue
      Start-ScheduledTask -TaskName $TaskName
    }
  }
  'Stop' {
    if ($PSCmdlet.ShouldProcess($TaskName, 'Stop worker and disable watchdog restart')) {
      New-Item -ItemType Directory -Path $Local -Force | Out-Null
      Set-Content -LiteralPath $Disabled -Value 'operator-stopped' -Encoding UTF8
      if ($Task) { Stop-ScheduledTask -TaskName $TaskName }
    }
  }
  'Check' {
    if ((Test-Path -LiteralPath $Disabled) -or -not $Task -or $Task.State -in @('Running','Queued','Disabled')) { return }
    $now = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
    $history = @()
    if (Test-Path -LiteralPath $Recovery) {
      $history = @(Get-Content -Raw -LiteralPath $Recovery | ConvertFrom-Json | Where-Object { $_ -gt ($now - 86400) })
    }
    if ($history.Count -ge 3) { Write-Warning 'Three recovery attempts in 24 hours. Inspect logs and use explicit Start after fixing the cause.'; return }
    if ($PSCmdlet.ShouldProcess($TaskName, 'Recover stopped development worker')) {
      ConvertTo-Json -InputObject @($history + $now) | Set-Content -LiteralPath $Recovery -Encoding UTF8
      Start-ScheduledTask -TaskName $TaskName
    }
  }
  'Status' {
    [PSCustomObject]@{ Task = $TaskName; State = if ($Task) { $Task.State } else { 'NotInstalled' }; IntentionallyStopped = Test-Path -LiteralPath $Disabled }
  }
  'Uninstall' {
    if ($PSCmdlet.ShouldProcess($Root, 'Remove only this project development tasks')) {
      New-Item -ItemType Directory -Path $Local -Force | Out-Null
      Set-Content -LiteralPath $Disabled -Value 'uninstalled' -Encoding UTF8
      foreach ($name in @($TaskName, $WatchName)) {
        $existing = Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
        if ($existing) {
          if ($existing.Description -notin @("AIChain development worker: $Root", "AIChain development watchdog: $Root")) { throw 'Refusing to modify unrelated task.' }
          Stop-ScheduledTask -TaskName $name
          Unregister-ScheduledTask -TaskName $name -Confirm:$false
        }
      }
    }
  }
}
