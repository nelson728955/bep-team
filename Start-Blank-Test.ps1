$ErrorActionPreference = 'Stop'
$env:DATA_DIR = Join-Path $PSScriptRoot 'data/blank-manager-test'
$env:PORT = '3101'
$env:NODE_ENV = 'development'
$env:EMPLOYEE_ACCESS = 'true'
$nodeExecutable = (Get-Command node).Source
$running = Get-NetTCPConnection -LocalPort 3101 -State Listen -ErrorAction SilentlyContinue
if (-not $running) {
    Start-Process -FilePath $nodeExecutable -ArgumentList '--no-warnings','server/index.js' -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $env:DATA_DIR 'server.log') -RedirectStandardError (Join-Path $env:DATA_DIR 'error.log')
    Start-Sleep -Seconds 2
}
Start-Process 'http://localhost:3101'
