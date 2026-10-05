$ErrorActionPreference = 'Stop'
try {
    $listeners = @(Get-NetTCPConnection -LocalPort 3100 -State Listen -ErrorAction SilentlyContinue)
    if (-not $listeners.Count) { exit }
    $branding = Invoke-RestMethod -Uri 'http://localhost:3100/api/branding' -TimeoutSec 3
    if ($null -eq $branding.restaurant_name -or $null -eq $branding.theme) { throw 'Port 3100 is not the Bep Team app. Nothing was stopped.' }
    $serverIds = @($listeners | Select-Object -ExpandProperty OwningProcess -Unique)
    foreach ($serverId in $serverIds) {
        $serverProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $serverId"
        if ($serverProcess.Name -ne 'node.exe' -or $serverProcess.CommandLine -notmatch 'server[\\/]index\.js') { throw 'Could not verify the Bep Team server process. Nothing was stopped.' }
    }
    foreach ($serverId in $serverIds) { Stop-Process -Id $serverId -ErrorAction Stop }
} catch {
    Add-Type -AssemblyName PresentationFramework
    [System.Windows.MessageBox]::Show($_.Exception.Message, 'Stop Bep Team') | Out-Null
}
