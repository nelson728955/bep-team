$ErrorActionPreference = 'Stop'
$projectDirectory = $PSScriptRoot
$appUrl = 'http://localhost:3100'
function Test-ShiftHub {
    try {
        $branding = Invoke-RestMethod -Uri "$appUrl/api/branding" -TimeoutSec 2
        return ($null -ne $branding.restaurant_name -and $null -ne $branding.theme)
    } catch { return $false }
}
try {
    if (-not (Test-ShiftHub)) {
        $nodeExecutable = (Get-Command node -ErrorAction Stop).Source
        Start-Process -FilePath $nodeExecutable -ArgumentList '--no-warnings', 'server/index.js' -WorkingDirectory $projectDirectory -WindowStyle Hidden -RedirectStandardOutput (Join-Path $projectDirectory 'data/desktop-start.log') -RedirectStandardError (Join-Path $projectDirectory 'data/desktop-error.log')
        $ready = $false
        for ($attempt = 0; $attempt -lt 45; $attempt++) {
            if (Test-ShiftHub) { $ready = $true; break }
            Start-Sleep -Seconds 1
        }
        if (-not $ready) { throw 'ShiftHub could not start. Check data/desktop-error.log in the app folder.' }
    }
    Start-Process $appUrl
} catch {
    Add-Type -AssemblyName PresentationFramework
    [System.Windows.MessageBox]::Show($_.Exception.Message, 'Bep Team') | Out-Null
}
