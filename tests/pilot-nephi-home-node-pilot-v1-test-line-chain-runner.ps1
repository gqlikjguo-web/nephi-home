[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$scriptsRoot = Join-Path $projectRoot "pilot\nephi-home-node-pilot-v1\scripts"
$modulePath = Join-Path $scriptsRoot "test-line-chain-common.psm1"
$startPath = Join-Path $scriptsRoot "start-test-line-pilot-with-tunnel.ps1"
$stopPath = Join-Path $scriptsRoot "stop-test-line-pilot.ps1"

foreach ($path in @($modulePath, $startPath, $stopPath)) {
  if (-not (Test-Path -LiteralPath $path)) { throw "Missing chain file: $path" }
  $tokens = $null
  $errors = $null
  [void][System.Management.Automation.Language.Parser]::ParseFile($path, [ref]$tokens, [ref]$errors)
  if ($errors.Count -gt 0) { throw "PowerShell syntax error: $path" }
}

Import-Module $modulePath -Force
$defaultTimeout = Resolve-ClassifierTimeoutMs -Value $null
if ($defaultTimeout -ne 15000) { throw "Default classifier timeout is not 15000ms" }
$overrideTimeout = Resolve-ClassifierTimeoutMs -Value "23000"
if ($overrideTimeout -ne 23000) { throw "Classifier timeout override failed" }
$invalidTimeoutFailed = $false
try { [void](Resolve-ClassifierTimeoutMs -Value "invalid") } catch { $invalidTimeoutFailed = $true }
if (-not $invalidTimeoutFailed) { throw "Invalid classifier timeout did not fail" }
$tunnelEntry = Find-TunnelmoleEntry
if ([string]::IsNullOrWhiteSpace($tunnelEntry) -or -not (Test-Path -LiteralPath $tunnelEntry)) {
  throw "Existing Tunnelmole entry was not found"
}

$sample = @"
connecting
https://abc123.tunnelmole.net is forwarding to localhost
"@
$publicUrl = Get-TunnelPublicUrl -Text $sample
if ($publicUrl -ne "https://abc123.tunnelmole.net") { throw "Tunnel URL parsing failed" }
$webhookUrl = Get-TestLineWebhookUrl -PublicUrl "$publicUrl/" -PropertyId "nephi_home"
if ($webhookUrl -ne "https://abc123.tunnelmole.net/api/test-line/webhook?customerId=nephi_home") {
  throw "Webhook URL composition failed"
}

$node = Get-Command node.exe -ErrorAction Stop
$tempRoot = Join-Path $PSScriptRoot (".tmp-nephi-chain-test-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force -Path $tempRoot | Out-Null
$serverScript = Join-Path $tempRoot "health-server.js"
$process = $null
try {
  @'
const http = require("http");
const port = Number(process.argv[2]);
const server = http.createServer((req, res) => {
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({ ok: true, data: { status: "ready", testOnly: true } }));
});
server.listen(port, "127.0.0.1");
'@ | Set-Content -LiteralPath $serverScript -Encoding UTF8
  $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
  $listener.Start()
  $port = ([System.Net.IPEndPoint]$listener.LocalEndpoint).Port
  $listener.Stop()
  $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
  $startInfo.FileName = $node.Source
  $startInfo.Arguments = ('"{0}" {1}' -f $serverScript, $port)
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true
  $startInfo.RedirectStandardError = $true
  $process = [System.Diagnostics.Process]::Start($startInfo)
  for ($attempt = 0; $attempt -lt 30 -and -not (Test-PortInUse -HostName "127.0.0.1" -Port $port); $attempt += 1) {
    Start-Sleep -Milliseconds 100
  }
  if (-not (Test-PilotHealth -HealthUrl "http://127.0.0.1:$port/api/health")) {
    $detail = if ($process.HasExited) { " process exited: " + $process.StandardError.ReadToEnd() } else { "" }
    throw ("Local health check failed" + $detail)
  }
  if (-not (Test-PortInUse -HostName "127.0.0.1" -Port $port)) { throw "Port occupancy check failed" }

  $record = [pscustomobject]@{
    processId = $process.Id
    startedAt = $process.StartTime.ToUniversalTime().ToString("o")
    executablePath = $node.Source
  }
  if (-not (Test-OwnedProcess -Record $record -AllowedProcessName "node*")) { throw "Owned process check failed" }
  $wrong = [pscustomobject]@{ processId=$process.Id; startedAt="2000-01-01T00:00:00.0000000Z"; executablePath=$node.Source }
  if (Test-OwnedProcess -Record $wrong -AllowedProcessName "node*") { throw "Process ownership mismatch was accepted" }
} finally {
  if ($process -and -not $process.HasExited) { Stop-Process -Id $process.Id -Force }
  Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
}

$required = @(
  "OPENAI_TEST_API_KEY",
  "OPENAI_TEST_MODEL",
  "NEPHI_PILOT_LINE_CHANNEL_SECRET",
  "NEPHI_PILOT_LINE_CHANNEL_ACCESS_TOKEN"
)
foreach ($name in $required) { Remove-Item -LiteralPath "Env:$name" -ErrorAction SilentlyContinue }
$runtimeRoot = Join-Path $projectRoot "pilot\nephi-home-node-pilot-v1\.runtime"
$ownedPidFiles = @(
  Join-Path $runtimeRoot "pilot-server.pid.json"
  Join-Path $runtimeRoot "pilot-tunnel.pid.json"
)
$pidStateBefore = @{}
foreach ($path in $ownedPidFiles) {
  $pidStateBefore[$path] = if (Test-Path -LiteralPath $path) { (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash } else { "ABSENT" }
}
$previousErrorAction = $ErrorActionPreference
$ErrorActionPreference = "Continue"
$missingOutput = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $startPath 2>&1
$ErrorActionPreference = $previousErrorAction
if ($LASTEXITCODE -ne 2) { throw "Missing environment check did not stop with exit code 2" }
foreach ($name in $required) {
  if (($missingOutput -join "`n") -notmatch [regex]::Escape("ENV ${name}: MISSING")) { throw "Missing environment name was not reported: $name" }
}
foreach ($path in $ownedPidFiles) {
  $after = if (Test-Path -LiteralPath $path) { (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash } else { "ABSENT" }
  if ($after -ne $pidStateBefore[$path]) { throw "Missing environment check changed process ownership state" }
}

Write-Output '{"caseCount":10,"passCount":10,"failCount":0}'
