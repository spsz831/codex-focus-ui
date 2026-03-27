$action = if ($args.Count -gt 0) { [string]$args[0] } else { 'start' }
$rest = if ($args.Count -gt 1) { $args[1..($args.Count - 1)] } else { @() }

$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo

function Write-Usage {
  Write-Host 'Usage:' -ForegroundColor Yellow
  Write-Host '  .\\scripts\\cfu.ps1 start'
  Write-Host '  .\\scripts\\cfu.ps1 doctor'
  Write-Host '  .\\scripts\\cfu.ps1 demo'
  Write-Host '  .\\scripts\\cfu.ps1 sync [YYYY-MM-DD]'
  Write-Host '  .\\scripts\\cfu.ps1 run npm -v'
  Write-Host '  .\\scripts\\cfu.ps1 run codex --version'
}

function Run-Sync([string]$day) {
  $syncArgs = @('scripts/sync-codex-chat.js', '--day', "$day")
  & node @syncArgs
  return $LASTEXITCODE
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

Start-Process "http://127.0.0.1:3939/?session=$targetSession" | Out-Null
Write-Host "Opened: http://127.0.0.1:3939/?session=$targetSession" -ForegroundColor Green
exit 0
