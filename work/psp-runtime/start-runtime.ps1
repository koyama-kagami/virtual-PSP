[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$runtimeRoot = $PSScriptRoot
$python = Join-Path $runtimeRoot '.venv/Scripts/python.exe'
$bridgeScript = Join-Path $runtimeRoot 'runtime_bridge.py'
if (-not (Test-Path -LiteralPath $python)) {
    & uv venv --python 3.12 (Join-Path $runtimeRoot '.venv')
    if ($LASTEXITCODE -ne 0) { throw 'uv venv failed.' }
}
& uv pip install --python $python -r (Join-Path $runtimeRoot 'requirements.txt')
if ($LASTEXITCODE -ne 0) { throw 'Runtime dependencies could not be installed.' }
New-Item -ItemType Directory -Force -Path (Join-Path $runtimeRoot 'logs') | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'

function Get-ProjectListener {
    param([int]$Port, [string]$Script)
    $listeners = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
    if ($listeners.Count -eq 0) { return $null }
    if ($listeners.Count -ne 1 -or $listeners[0].LocalAddress -ne '127.0.0.1') {
        throw "Port $Port does not have the expected single loopback listener."
    }
    $process = Get-CimInstance Win32_Process -Filter "ProcessId=$($listeners[0].OwningProcess)"
    $scriptPattern = [regex]::Escape($Script) + '(?:"|\s|$)'
    if (-not $process -or $process.CommandLine -notmatch $scriptPattern) {
        throw "Port $Port belongs to another program; it will not be terminated."
    }
    return $process
}

function Wait-ProjectListener {
    param([int]$Port, [string]$Script, [System.Diagnostics.Process]$Launched, [string]$ErrorLog)
    $deadline = (Get-Date).AddSeconds(12)
    while ((Get-Date) -lt $deadline) {
        $process = Get-ProjectListener -Port $Port -Script $Script
        if ($process) { return $process }
        $Launched.Refresh()
        if ($Launched.HasExited) { throw "Service exited before listening. Inspect $ErrorLog" }
        Start-Sleep -Milliseconds 200
    }
    throw "Service did not establish its loopback listener on port $Port."
}

$stateFile = Join-Path $runtimeRoot 'bridge-state.json'
$bridge = Get-ProjectListener -Port 4331 -Script $bridgeScript
$newBridge = $false
if (-not $bridge) {
    $stdout = Join-Path $runtimeRoot "logs/bridge-$stamp.stdout.log"
    $stderr = Join-Path $runtimeRoot "logs/bridge-$stamp.stderr.log"
    $bridgeLauncher = Start-Process -FilePath $python -ArgumentList @('-u', ('"' + $bridgeScript + '"')) -WorkingDirectory $runtimeRoot -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
    $bridge = Wait-ProjectListener -Port 4331 -Script $bridgeScript -Launched $bridgeLauncher -ErrorLog $stderr
    $newBridge = $true
}
$bridgeHealth = Invoke-RestMethod -Uri 'http://127.0.0.1:4331/status' -TimeoutSec 10
if (-not $bridgeHealth.status) { throw 'Bridge health response did not contain a runtime status.' }
if ($newBridge) {
    # uv's Windows virtualenv executable can launch the managed Python as a child.
    [ordered]@{pid=$bridge.ProcessId;launcherPid=$bridgeLauncher.Id;executable=$bridge.ExecutablePath;startedAt=(Get-Date).ToString('o');url='http://127.0.0.1:4331';stdout=$stdout;stderr=$stderr} | ConvertTo-Json | Set-Content -LiteralPath $stateFile -Encoding utf8
}

$studioRoot = [IO.Path]::GetFullPath((Join-Path $runtimeRoot '../psp-studio'))
$studioScript = Join-Path $studioRoot 'serve.mjs'
$node = (Get-Command node -ErrorAction Stop).Source
$studio = Get-ProjectListener -Port 4330 -Script $studioScript
$newStudio = $false
if (-not $studio) {
    $studioStdout = Join-Path $runtimeRoot "logs/studio-$stamp.stdout.log"
    $studioStderr = Join-Path $runtimeRoot "logs/studio-$stamp.stderr.log"
    $studioLauncher = Start-Process -FilePath $node -ArgumentList ('"' + $studioScript + '"') -WorkingDirectory $studioRoot -WindowStyle Hidden -RedirectStandardOutput $studioStdout -RedirectStandardError $studioStderr -PassThru
    $studio = Wait-ProjectListener -Port 4330 -Script $studioScript -Launched $studioLauncher -ErrorLog $studioStderr
    $newStudio = $true
}
$page = Invoke-WebRequest -Uri 'http://127.0.0.1:4330/' -TimeoutSec 10
if ($page.StatusCode -ne 200 -or $page.Content -notmatch '(?i)<html') { throw 'Studio page health check failed.' }
$proxyHealth = Invoke-RestMethod -Uri 'http://127.0.0.1:4330/runtime/status' -TimeoutSec 10
if (-not $proxyHealth.status) { throw 'Studio runtime proxy health check failed.' }
if ($newStudio) {
    [ordered]@{pid=$studio.ProcessId;executable=$studio.ExecutablePath;startedAt=(Get-Date).ToString('o');url='http://127.0.0.1:4330';stdout=$studioStdout;stderr=$studioStderr} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $runtimeRoot 'studio-state.json') -Encoding utf8
}
$stack = [ordered]@{checkedAt=(Get-Date).ToString('o');bridgePid=$bridge.ProcessId;studioPid=$studio.ProcessId;url='http://127.0.0.1:4330';runtimeStatus=$proxyHealth.status;httpStatus=200;nativeStartedByScript=$false}
$stack | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $runtimeRoot 'runtime-stack-state.json') -Encoding utf8
$stack | ConvertTo-Json
