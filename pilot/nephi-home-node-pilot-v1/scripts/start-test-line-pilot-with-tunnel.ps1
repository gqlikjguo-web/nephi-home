[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$requiredEnvironment = @(
  "OPENAI_TEST_API_KEY",
  "OPENAI_TEST_MODEL",
  "NEPHI_PILOT_LINE_CHANNEL_SECRET",
  "NEPHI_PILOT_LINE_CHANNEL_ACCESS_TOKEN"
)
$missing = @()
foreach ($name in $requiredEnvironment) {
  $present = -not [string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($name, "Process"))
  Write-Output ("ENV {0}: {1}" -f $name, $(if ($present) { "PRESENT" } else { "MISSING" }))
  if (-not $present) { $missing += $name }
}
if ($missing.Count -gt 0) {
  Write-Error ("MISSING_ENVIRONMENT_VARIABLES: {0}" -f ($missing -join ", ")) -ErrorAction Continue
  exit 2
}

$modulePath = Join-Path $PSScriptRoot "test-line-chain-common.psm1"
Import-Module $modulePath -Force
try {
  $classifierTimeoutMs = Resolve-ClassifierTimeoutMs -Value $env:NEPHI_PILOT_CLASSIFIER_TIMEOUT_MS
} catch {
  Write-Error $_.Exception.Message -ErrorAction Continue
  exit 3
}
$env:NEPHI_PILOT_CLASSIFIER_TIMEOUT_MS = [string]$classifierTimeoutMs
Write-Output ("CLASSIFIER_TIMEOUT_MS={0}" -f $classifierTimeoutMs)
$pilotRoot = Split-Path -Parent $PSScriptRoot
$runtimeRoot = Join-Path $pilotRoot ".runtime"
$pilotStart = Join-Path $PSScriptRoot "start-test-line-pilot.ps1"
$tunnelPidFile = Join-Path $runtimeRoot "pilot-tunnel.pid.json"
$tunnelStdout = Join-Path $runtimeRoot "pilot-tunnel.stdout.log"
$tunnelStderr = Join-Path $runtimeRoot "pilot-tunnel.stderr.log"
$port = 4275
$localHealthUrl = "http://127.0.0.1:${port}/api/health"

$tunnelEntry = Find-TunnelmoleEntry
$node = Get-Command node.exe -ErrorAction SilentlyContinue
$env:NEPHI_PILOT_PORT = [string]$port
$env:NEPHI_PILOT_HOST = "127.0.0.1"
$previousErrorAction = $ErrorActionPreference
$ErrorActionPreference = "Continue"
$pilotOutput = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $pilotStart -SkipEnvironmentCheck 2>&1
$pilotExit = $LASTEXITCODE
$ErrorActionPreference = $previousErrorAction
$pilotOutput | Write-Output
if ($pilotExit -ne 0) { exit $pilotExit }

if (-not $node) {
  Write-Error "NODE_NOT_FOUND: Pilot is healthy, but node.exe is required to start Tunnelmole." -ErrorAction Continue
  exit 5
}
if ([string]::IsNullOrWhiteSpace($tunnelEntry)) {
  Write-Output "TUNNEL_TOOL_MISSING: Pilot remains healthy. Install or restore the existing Tunnelmole command, then run: tmole 4275"
  exit 7
}

if (Test-Path -LiteralPath $tunnelPidFile) {
  $existing = Get-Content -Raw -LiteralPath $tunnelPidFile | ConvertFrom-Json
  if (Test-OwnedProcess -Record $existing -AllowedProcessName "node*") {
    Write-Error "TUNNEL_ALREADY_RUNNING: stop the Pilot chain before starting another tunnel." -ErrorAction Continue
    exit 8
  }
  Remove-Item -LiteralPath $tunnelPidFile -Force
}

Remove-Item -LiteralPath $tunnelStdout,$tunnelStderr -Force -ErrorAction SilentlyContinue
try {
  $tunnel = Start-Process -FilePath $node.Source -ArgumentList @($tunnelEntry, [string]$port) -WorkingDirectory $pilotRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput $tunnelStdout -RedirectStandardError $tunnelStderr
} catch {
  Write-Output "TUNNEL_START_FAILED: Pilot remains healthy. Run 'tmole 4275' manually."
  exit 9
}
$record = @{
  processId = $tunnel.Id
  startedAt = $tunnel.StartTime.ToUniversalTime().ToString("o")
  executablePath = $node.Source
  tool = "tunnelmole"
  localPort = $port
  publicUrl = ""
}
$record | ConvertTo-Json | Set-Content -LiteralPath $tunnelPidFile -Encoding UTF8

$publicUrl = ""
for ($attempt = 0; $attempt -lt 40 -and -not $publicUrl; $attempt += 1) {
  if ($tunnel.HasExited) { break }
  Start-Sleep -Milliseconds 500
  $text = ""
  if (Test-Path -LiteralPath $tunnelStdout) { $text += Get-Content -Raw -LiteralPath $tunnelStdout -ErrorAction SilentlyContinue }
  if (Test-Path -LiteralPath $tunnelStderr) { $text += "`n" + (Get-Content -Raw -LiteralPath $tunnelStderr -ErrorAction SilentlyContinue) }
  $publicUrl = Get-TunnelPublicUrl -Text $text
}
if (-not $publicUrl) {
  if (Test-OwnedProcess -Record ([pscustomobject]$record) -AllowedProcessName "node*") { Stop-Process -Id $tunnel.Id -Force }
  Remove-Item -LiteralPath $tunnelPidFile -Force -ErrorAction SilentlyContinue
  Write-Output "TUNNEL_URL_NOT_AVAILABLE: Pilot remains healthy. Run 'tmole 4275' manually and use the HTTPS URL it prints."
  exit 9
}

$record.publicUrl = $publicUrl
$record | ConvertTo-Json | Set-Content -LiteralPath $tunnelPidFile -Encoding UTF8
$publicHealthUrl = "$publicUrl/api/health"
$publicReady = $false
for ($attempt = 0; $attempt -lt 20 -and -not $publicReady; $attempt += 1) {
  $publicReady = Test-PilotHealth -HealthUrl $publicHealthUrl -TimeoutSec 3
  if (-not $publicReady) { Start-Sleep -Milliseconds 500 }
}
if (-not $publicReady) {
  Write-Output "PUBLIC_HEALTH=FAIL"
  Write-Output ("PUBLIC_HEALTH_URL={0}" -f $publicHealthUrl)
  Write-Output "Pilot and tunnel remain running for inspection; use stop-test-line-pilot.ps1 to stop only this chain."
  exit 10
}

$webhookUrl = Get-TestLineWebhookUrl -PublicUrl $publicUrl -PropertyId "nephi_home"
Write-Output "TEST_LINE_CHAIN_READY"
Write-Output ("PORT={0}" -f $port)
Write-Output "PILOT_HEALTH=PASS"
Write-Output ("LOCAL_HEALTH_URL={0}" -f $localHealthUrl)
Write-Output ("PUBLIC_URL={0}" -f $publicUrl)
Write-Output "PUBLIC_HEALTH=PASS"
Write-Output ("PUBLIC_HEALTH_URL={0}" -f $publicHealthUrl)
Write-Output ("TEST_ONLY_LINE_WEBHOOK_URL={0}" -f $webhookUrl)
Write-Output "LINE_DEVELOPERS_NOT_MODIFIED"
