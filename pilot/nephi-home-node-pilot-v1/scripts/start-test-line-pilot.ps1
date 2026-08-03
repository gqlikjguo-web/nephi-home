[CmdletBinding()]
param([switch]$SkipEnvironmentCheck)

$ErrorActionPreference = "Stop"
$requiredEnvironment = @(
  "OPENAI_TEST_API_KEY",
  "OPENAI_TEST_MODEL",
  "NEPHI_PILOT_LINE_CHANNEL_SECRET",
  "NEPHI_PILOT_LINE_CHANNEL_ACCESS_TOKEN"
)
if (-not $SkipEnvironmentCheck) {
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
}

$pilotRoot = Split-Path -Parent $PSScriptRoot
$runtimeRoot = Join-Path $pilotRoot ".runtime"
$pidFile = Join-Path $runtimeRoot "pilot-server.pid.json"
$port = 4275
if (-not [string]::IsNullOrWhiteSpace($env:NEPHI_PILOT_PORT)) {
  $parsedPort = 0
  if (-not [int]::TryParse($env:NEPHI_PILOT_PORT, [ref]$parsedPort) -or $parsedPort -lt 1 -or $parsedPort -gt 65535) {
    Write-Error "INVALID_PORT: NEPHI_PILOT_PORT must be between 1 and 65535" -ErrorAction Continue
    exit 3
  }
  $port = $parsedPort
}
$bindHost = if ([string]::IsNullOrWhiteSpace($env:NEPHI_PILOT_HOST)) { "127.0.0.1" } else { $env:NEPHI_PILOT_HOST }
$localHost = if ($bindHost -eq "0.0.0.0" -or $bindHost -eq "::") { "127.0.0.1" } else { $bindHost }

$occupied = $false
try {
  $occupied = @(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction Stop).Count -gt 0
} catch {
  $client = [System.Net.Sockets.TcpClient]::new()
  try {
    $connect = $client.BeginConnect($localHost, $port, $null, $null)
    if ($connect.AsyncWaitHandle.WaitOne(300)) {
      try { $client.EndConnect($connect); $occupied = $client.Connected } catch { $occupied = $false }
    }
  } finally {
    $client.Dispose()
  }
}
if ($occupied) {
  Write-Error ("PORT_IN_USE: {0}. No process was stopped." -f $port) -ErrorAction Continue
  exit 4
}

$node = Get-Command node.exe -ErrorAction SilentlyContinue
if (-not $node) {
  Write-Error "NODE_NOT_FOUND: node.exe is required" -ErrorAction Continue
  exit 5
}

New-Item -ItemType Directory -Force -Path $runtimeRoot | Out-Null
$process = Start-Process -FilePath $node.Source -ArgumentList @("server.js") -WorkingDirectory $pilotRoot -WindowStyle Hidden -PassThru
@{
  processId = $process.Id
  startedAt = $process.StartTime.ToUniversalTime().ToString("o")
  executablePath = $node.Source
} | ConvertTo-Json | Set-Content -LiteralPath $pidFile -Encoding UTF8

$healthPath = "/api/health"
$webhookPath = "/api/line/webhooks/{webhookKey}"
$healthUrl = "http://${localHost}:${port}${healthPath}"
$ready = $false
for ($attempt = 0; $attempt -lt 20; $attempt += 1) {
  if ($process.HasExited) { break }
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $healthUrl -TimeoutSec 1
    $body = $response.Content | ConvertFrom-Json
    if ($response.StatusCode -eq 200 -and $body.data.status -eq "ready" -and $body.data.testOnly -eq $true) {
      $ready = $true
      break
    }
  } catch {
    Start-Sleep -Milliseconds 250
  }
}
if (-not $ready) {
  if (-not $process.HasExited) { Stop-Process -Id $process.Id -Force }
  Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
  Write-Error "READINESS_FAILED: Pilot did not become healthy; only the process started by this script was stopped." -ErrorAction Continue
  exit 6
}

Write-Output "PILOT_READY"
Write-Output ("PORT={0}" -f $port)
Write-Output ("HEALTH_PATH={0}" -f $healthPath)
Write-Output ("LINE_WEBHOOK_PATH={0}" -f $webhookPath)
Write-Output ("HEALTH_URL={0}" -f $healthUrl)
Write-Output ("WEBHOOK_URL_FORMAT=http://{0}:{1}{2}" -f $localHost, $port, $webhookPath)
