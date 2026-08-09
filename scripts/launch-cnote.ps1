$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$appUrl = "http://localhost:3000"

try {
  Invoke-WebRequest -Uri $appUrl -UseBasicParsing -TimeoutSec 2 | Out-Null
} catch {
  $logDirectory = Join-Path $env:LOCALAPPDATA "Cnote\logs"
  New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null

  $npmPath = (Get-Command npm.cmd -ErrorAction Stop).Source
  Start-Process `
    -FilePath $npmPath `
    -ArgumentList @("run", "dev", "--", "-p", "3000") `
    -WorkingDirectory $projectRoot `
    -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $logDirectory "dev.log") `
    -RedirectStandardError (Join-Path $logDirectory "dev-error.log")

  for ($attempt = 0; $attempt -lt 60; $attempt++) {
    Start-Sleep -Seconds 1
    try {
      Invoke-WebRequest -Uri $appUrl -UseBasicParsing -TimeoutSec 2 | Out-Null
      break
    } catch {
      if ($attempt -eq 59) {
        throw "Cnote did not start. Check $logDirectory for details."
      }
    }
  }
}

Start-Process $appUrl
