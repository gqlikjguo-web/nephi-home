[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$pilotRoot = Split-Path -Parent $PSScriptRoot
$runtimeRoot = Join-Path $pilotRoot ".runtime"
$modulePath = Join-Path $PSScriptRoot "test-line-chain-common.psm1"
Import-Module $modulePath -Force
$failure = $false

function Stop-OwnedRecord {
  param([string]$PidFile, [string]$AllowedName, [string]$StoppedLabel, [string]$MissingLabel)
  if (-not (Test-Path -LiteralPath $PidFile)) {
    Write-Output $MissingLabel
    return
  }
  $record = Get-Content -Raw -LiteralPath $PidFile | ConvertFrom-Json
  $process = Get-Process -Id ([int]$record.processId) -ErrorAction SilentlyContinue
  if (-not $process) {
    Remove-Item -LiteralPath $PidFile -Force
    Write-Output $MissingLabel
    return
  }
  if (-not (Test-OwnedProcess -Record $record -AllowedProcessName $AllowedName)) {
    Write-Output ("PID_MISMATCH: refusing to stop process {0}." -f $record.processId)
    $script:failure = $true
    return
  }
  Stop-Process -Id $process.Id
  Remove-Item -LiteralPath $PidFile -Force
  Write-Output $StoppedLabel
}

Stop-OwnedRecord -PidFile (Join-Path $runtimeRoot "pilot-tunnel.pid.json") -AllowedName "node*" -StoppedLabel "TUNNEL_STOPPED" -MissingLabel "TUNNEL_NOT_RUNNING"
Stop-OwnedRecord -PidFile (Join-Path $runtimeRoot "pilot-server.pid.json") -AllowedName "node*" -StoppedLabel "PILOT_STOPPED" -MissingLabel "PILOT_NOT_RUNNING"

if ($failure) { exit 2 }
