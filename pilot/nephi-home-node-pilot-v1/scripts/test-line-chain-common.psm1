Set-StrictMode -Version Latest

function Resolve-ClassifierTimeoutMs {
  param($Value)
  if ([string]::IsNullOrWhiteSpace([string]$Value)) { return 15000 }
  $parsed = 0
  if (-not [int]::TryParse([string]$Value, [ref]$parsed) -or $parsed -lt 1) {
    throw "INVALID_CLASSIFIER_TIMEOUT: NEPHI_PILOT_CLASSIFIER_TIMEOUT_MS must be a positive integer"
  }
  return $parsed
}

function Test-PortInUse {
  param([string]$HostName = "127.0.0.1", [Parameter(Mandatory)][int]$Port)
  try {
    $connections = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop)
    return $connections.Count -gt 0
  } catch {
    $client = [System.Net.Sockets.TcpClient]::new()
    try {
      $pending = $client.BeginConnect($HostName, $Port, $null, $null)
      if (-not $pending.AsyncWaitHandle.WaitOne(300)) { return $false }
      try { $client.EndConnect($pending) } catch { return $false }
      return $client.Connected
    } finally {
      $client.Dispose()
    }
  }
}

function Test-PilotHealth {
  param([Parameter(Mandatory)][string]$HealthUrl, [int]$TimeoutSec = 2)
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $HealthUrl -TimeoutSec $TimeoutSec
    $body = $response.Content | ConvertFrom-Json
    return $response.StatusCode -eq 200 -and $body.data.status -eq "ready" -and $body.data.testOnly -eq $true
  } catch {
    return $false
  }
}

function Get-TunnelPublicUrl {
  param([string]$Text)
  $match = [regex]::Match([string]$Text, 'https://[a-z0-9][a-z0-9.-]*\.tunnelmole\.(?:net|com)', 'IgnoreCase')
  if (-not $match.Success) { return "" }
  return $match.Value.TrimEnd('/')
}

function Get-PropertyScopedLineWebhookUrl {
  param(
    [Parameter(Mandatory)][string]$PublicUrl,
    [Parameter(Mandatory)][string]$WebhookKey
  )
  $base = $PublicUrl.Trim().TrimEnd('/')
  if ($base -notmatch '^https://') { throw "Public URL must use HTTPS" }
  $encodedWebhookKey = [uri]::EscapeDataString($WebhookKey)
  return "$base/api/line/webhooks/$encodedWebhookKey"
}

function Find-TunnelmoleEntry {
  $command = Get-Command tmole -ErrorAction SilentlyContinue
  if ($command) {
    $binDirectory = Split-Path -Parent $command.Source
    $candidate = Join-Path (Split-Path -Parent $binDirectory) "tunnelmole\dist\bin\tunnelmole.js"
    if (Test-Path -LiteralPath $candidate) { return (Resolve-Path -LiteralPath $candidate).Path }
  }
  $npxRoot = Join-Path $env:LOCALAPPDATA "npm-cache\_npx"
  if (Test-Path -LiteralPath $npxRoot) {
    foreach ($directory in Get-ChildItem -LiteralPath $npxRoot -Directory -ErrorAction SilentlyContinue) {
      $candidate = Join-Path $directory.FullName "node_modules\tunnelmole\dist\bin\tunnelmole.js"
      if (Test-Path -LiteralPath $candidate) { return (Resolve-Path -LiteralPath $candidate).Path }
    }
  }
  return ""
}

function Test-OwnedProcess {
  param(
    [Parameter(Mandatory)]$Record,
    [Parameter(Mandatory)][string]$AllowedProcessName
  )
  $processId = 0
  if (-not [int]::TryParse([string]$Record.processId, [ref]$processId)) { return $false }
  $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
  if (-not $process -or $process.ProcessName -notlike $AllowedProcessName) { return $false }
  if ($process.StartTime.ToUniversalTime().ToString("o") -ne [string]$Record.startedAt) { return $false }
  if (-not [string]::IsNullOrWhiteSpace([string]$Record.executablePath)) {
    try {
      if ([System.IO.Path]::GetFullPath($process.Path) -ne [System.IO.Path]::GetFullPath([string]$Record.executablePath)) { return $false }
    } catch { return $false }
  }
  return $true
}

Export-ModuleMember -Function Resolve-ClassifierTimeoutMs,Test-PortInUse,Test-PilotHealth,Get-TunnelPublicUrl,Get-PropertyScopedLineWebhookUrl,Find-TunnelmoleEntry,Test-OwnedProcess
