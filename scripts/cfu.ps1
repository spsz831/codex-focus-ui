$action = if ($args.Count -gt 0) { [string]$args[0] } else { 'start' }
$rest = if ($args.Count -gt 1) { $args[1..($args.Count - 1)] } else { @() }

$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo

$configPath = Join-Path $repo 'codex-focus-ui.config.json'
$serviceDir = Join-Path $repo '.data\service'
$runnerPidFile = Join-Path $serviceDir 'runner.pid'
$statusFile = Join-Path $serviceDir 'status.json'

function Get-ViewerPort {
  $defaultPort = 3939
  if ($env:CODEX_FOCUS_UI_PORT) {
    return [int]$env:CODEX_FOCUS_UI_PORT
  }
  if (-not (Test-Path $configPath)) {
    return $defaultPort
  }
  try {
    $cfg = Get-Content $configPath -Raw | ConvertFrom-Json
    if ($cfg.viewerPort) {
      return [int]$cfg.viewerPort
    }
  } catch {
  }
  return $defaultPort
}

$viewerPort = Get-ViewerPort
$viewerUrl = "http://127.0.0.1:$viewerPort"

function Write-Usage {
  Write-Host 'Usage:' -ForegroundColor Yellow
  Write-Host '  .\\scripts\\cfu.ps1 start'
  Write-Host '  .\\scripts\\cfu.ps1 doctor'
  Write-Host '  .\\scripts\\cfu.ps1 demo'
  Write-Host '  .\\scripts\\cfu.ps1 sync [YYYY-MM-DD]'
  Write-Host '  .\\scripts\\cfu.ps1 run npm -v'
  Write-Host '  .\\scripts\\cfu.ps1 service-start'
  Write-Host '  .\\scripts\\cfu.ps1 service-stop'
  Write-Host '  .\\scripts\\cfu.ps1 service-status'
}

function Run-Sync([string]$day) {
  $syncArgs = @('scripts/sync-codex-chat.js', '--day', "$day")
  & node @syncArgs
  return $LASTEXITCODE
}

function Read-RunnerPid {
  if (-not (Test-Path $runnerPidFile)) { return $null }
  $txt = (Get-Content $runnerPidFile -ErrorAction SilentlyContinue | Select-Object -First 1)
  if (-not $txt) { return $null }
  return [int]$txt
}

function Is-Running([int]$procId) {
  if (-not $procId) { return $false }
  try {
    $null = Get-Process -Id $procId -ErrorAction Stop
    return $true
  } catch {
    return $false
  }
}

if ($action -eq 'doctor') {
  & npm run doctor
  exit $LASTEXITCODE
}

if ($action -eq 'demo') {
  & npm run demo:capture
  exit $LASTEXITCODE
}

if ($action -eq 'sync') {
  $raw = ($rest -join ' ')
  $m = [regex]::Match($raw, '\d{4}-\d{2}-\d{2}')
  $day = if ($m.Success) { $m.Value } else { (Get-Date -Format 'yyyy-MM-dd') }
  Run-Sync $day | Out-Null
  exit $LASTEXITCODE
}

if ($action -eq 'run') {
  if (-not $rest -or $rest.Count -eq 0) {
    Write-Host 'run mode requires a command.' -ForegroundColor Red
    Write-Usage
    exit 1
  }
  & node apps/cli/src/index.js proxy -- @rest
  exit $LASTEXITCODE
}


if ($action -eq 'ui') {
  $runnerPid = Read-RunnerPid
  if (-not ($runnerPid -and (Is-Running -procId $runnerPid))) {
    New-Item -ItemType Directory -Path $serviceDir -Force | Out-Null
    Start-Process -FilePath node -ArgumentList 'scripts/service-runner.js' -WorkingDirectory $repo -WindowStyle Hidden | Out-Null
    Start-Sleep -Seconds 1
    $runnerPid = Read-RunnerPid
    if (-not ($runnerPid -and (Is-Running -procId $runnerPid))) {
      Write-Host 'Service failed to start. Check .data/service/service.log' -ForegroundColor Red
      exit 1
    }
  }

  $today = Get-Date -Format 'yyyy-MM-dd'
  $targetSession = "codex-auto-$today.jsonl"
  Start-Process "$viewerUrl/?session=$targetSession" | Out-Null
  Write-Host "Opened: $viewerUrl/?session=$targetSession" -ForegroundColor Green
  exit 0
}
if ($action -eq 'service-start') {
  $runnerPid = Read-RunnerPid
  if ($runnerPid -and (Is-Running -procId $runnerPid)) {
    Write-Host "Service already running (PID: $runnerPid)." -ForegroundColor Cyan
    Write-Host "Viewer: $viewerUrl" -ForegroundColor Cyan
    exit 0
  }

  New-Item -ItemType Directory -Path $serviceDir -Force | Out-Null
  Start-Process -FilePath node -ArgumentList 'scripts/service-runner.js' -WorkingDirectory $repo -WindowStyle Hidden | Out-Null
  Start-Sleep -Seconds 1

  $runnerPid2 = Read-RunnerPid
  if ($runnerPid2 -and (Is-Running -procId $runnerPid2)) {
    Write-Host "Service started (PID: $runnerPid2)." -ForegroundColor Green
    Write-Host "Viewer: $viewerUrl" -ForegroundColor Green
    exit 0
  }

  Write-Host 'Service failed to start. Check .data/service/service.log' -ForegroundColor Red
  exit 1
}

if ($action -eq 'service-stop') {
  $runnerPid = Read-RunnerPid
  if (-not $runnerPid) {
    Write-Host 'Service is not running.' -ForegroundColor Yellow
    exit 0
  }

  if (Is-Running -procId $runnerPid) {
    Stop-Process -Id $runnerPid -Force
    Start-Sleep -Milliseconds 400
    Write-Host "Service stopped (PID: $runnerPid)." -ForegroundColor Green
  } else {
    Write-Host 'Service pid file exists but process not running, cleaned.' -ForegroundColor Yellow
  }

  if (Test-Path $runnerPidFile) { Remove-Item $runnerPidFile -Force }
  exit 0
}

if ($action -eq 'service-status') {
  $runnerPid = Read-RunnerPid
  if ($runnerPid -and (Is-Running -procId $runnerPid)) {
    Write-Host "Service: RUNNING (PID: $runnerPid)" -ForegroundColor Green
    Write-Host "Viewer: $viewerUrl" -ForegroundColor Green
    if (Test-Path $statusFile) {
      Write-Host ''
      Get-Content $statusFile
    }
    exit 0
  }

  Write-Host 'Service: STOPPED' -ForegroundColor Yellow
  exit 0
}

if ($action -ne 'start') {
  Write-Host "Unknown action: $action" -ForegroundColor Red
  Write-Usage
  exit 1
}

$today = Get-Date -Format 'yyyy-MM-dd'
Run-Sync $today | Out-Null
$targetSession = "codex-auto-$today.jsonl"

$existing = Get-CimInstance Win32_Process |
  Where-Object {
    $_.Name -eq 'node.exe' -and
    $_.CommandLine -like '*codex-focus-ui*apps\\viewer\\src\\index.js*'
  } |
  Select-Object -First 1

if (-not $existing) {
  Start-Process -FilePath node -ArgumentList 'apps/viewer/src/index.js' -WorkingDirectory $repo | Out-Null
  Start-Sleep -Seconds 1
  Write-Host 'Viewer started.' -ForegroundColor Green
} else {
  Write-Host 'Viewer already running.' -ForegroundColor Cyan
}

Start-Process "$viewerUrl/?session=$targetSession" | Out-Null
Write-Host "Opened: $viewerUrl/?session=$targetSession" -ForegroundColor Green
exit 0




