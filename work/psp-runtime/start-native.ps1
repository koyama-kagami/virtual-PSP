[CmdletBinding()]
param(
    [ValidateSet('Vsh', 'InstallFirmware')][string]$Mode = 'Vsh',
    [switch]$EnableDebugger
)

$ErrorActionPreference = 'Stop'
$runtimeRoot = $PSScriptRoot
$manifest = Get-Content -Raw -LiteralPath (Join-Path $runtimeRoot 'runtime-manifest.json') | ConvertFrom-Json
$executable = Join-Path $runtimeRoot $manifest.core.executable
$dataRoot = Join-Path $runtimeRoot 'data'
$nandRoot = Join-Path $dataRoot 'PSP/NAND'
$configPath = Join-Path $dataRoot 'PSP/SYSTEM/ppsspp.ini'
$controlPath = Join-Path $dataRoot 'PSP/SYSTEM/controls.ini'
$statePath = Join-Path $runtimeRoot 'native-state.json'
if (-not (Test-Path -LiteralPath $executable)) { throw 'Run download-runtime.ps1 first.' }
if ((Get-FileHash -LiteralPath $executable -Algorithm SHA256).Hash -ine $manifest.core.executableSha256) {
    throw 'The executable does not match the pinned official build.'
}

$executable = [IO.Path]::GetFullPath($executable)
if ($EnableDebugger) {
    $rule = Get-NetFirewallRule -PolicyStore ActiveStore -Name 'Codex-PSP-Studio-Debugger-Loopback-4332' -ErrorAction Stop
    $appFilter = $rule | Get-NetFirewallApplicationFilter
    $portFilter = $rule | Get-NetFirewallPortFilter
    $addressFilter = $rule | Get-NetFirewallAddressFilter
    if ($rule.Enabled -ne 'True' -or $rule.Action -ne 'Block' -or $rule.Direction -ne 'Inbound' -or $rule.Profile -ne 'Any' -or
        $appFilter.Program -ine $executable -or $portFilter.Protocol -ne 'TCP' -or $portFilter.LocalPort -ne '4332' -or
        $addressFilter.RemoteAddress -ne 'Any' -or @(Get-NetFirewallProfile | Where-Object { -not $_.Enabled }).Count) {
        throw 'The project debugger restriction is missing, changed, or a firewall profile is disabled.'
    }
}
$existing = @(Get-CimInstance Win32_Process -Filter "Name='PPSSPPWindows64.exe'" | Where-Object { $_.ExecutablePath -ieq $executable })
if ($existing.Count -gt 0) {
    if ($EnableDebugger -and $existing.Count -eq 1 -and $existing[0].CommandLine -match '--debugger=4332(?:\s|$)') {
        $recordedState = Get-Content -Raw -LiteralPath $statePath | ConvertFrom-Json
        $ownedListener = @(Get-NetTCPConnection -LocalPort 4332 -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.OwningProcess -eq $existing[0].ProcessId })
        if ($recordedState.pid -ne $existing[0].ProcessId -or $ownedListener.Count -eq 0) {
            throw 'The recorded PPSSPP instance is not ready. Reconnect through the webpage to recover a closed instance.'
        }
        Get-Content -Raw -LiteralPath $statePath
        exit 0
    }
    throw "This project already has a PPSSPP process (PID $($existing.ProcessId -join ', ')). Close it normally before starting another."
}
New-Item -ItemType Directory -Force -Path (Join-Path $dataRoot 'PSP/SYSTEM'),$nandRoot,(Join-Path $runtimeRoot 'logs') | Out-Null
# Windows performs an early directory setup before applying --memstick. This file
# also directs that early setup into our project instead of the user's PPSSPP.
[IO.File]::WriteAllText((Join-Path $runtimeRoot 'ppsspp/installed.txt'), $dataRoot, [Text.UTF8Encoding]::new($false))
if (-not (Test-Path -LiteralPath $configPath)) {
    @'
[General]
FirstRun = False
Language = en_US
CheckForNewVersion = False
RemoteShareOnStartup = False
RemoteDebuggerOnStartup = False
RemoteTab = False
PauseOnLostFocus = False
[Graphics]
InternalResolution = 1
[SystemParam]
PSPModel = 1
PSPFirmwareVersion = 661
'@ | Set-Content -LiteralPath $configPath -Encoding utf8
}
$configText = Get-Content -Raw -LiteralPath $configPath
if ($configText -match '(?im)^\s*(RemoteShareOnStartup|RemoteDebuggerOnStartup)\s*=\s*(True|1)\s*$') {
    throw 'This upstream build cannot restrict debugger listening to loopback. Disable startup network services before launching.'
}
if ($Mode -eq 'Vsh') {
    if (-not (Test-Path -LiteralPath (Join-Path $nandRoot 'flash0/vsh/module/vshmain.prx'))) {
        throw 'Firmware is not installed. Run this script with -Mode InstallFirmware and complete the PPSSPP installer first.'
    }
    $bootArgument = '--vsh'
} else {
    $firmware = Join-Path $runtimeRoot $manifest.firmware.file
    if ((Get-FileHash -LiteralPath $firmware -Algorithm SHA256).Hash -ine $manifest.firmware.sha256) { throw 'Unexpected firmware SHA-256.' }
    # A positional updater path at process startup executes Sony's updater rather
    # than opening PPSSPP's installer. Open it through File > Load in the app.
    $bootArgument = $null
    Write-Host "In PPSSPP choose File > Load..., select $firmware, then choose Install."
}
$logPath = Join-Path $runtimeRoot ('logs/native-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.log')
[string[]]$arguments = @(
    ('--memstick="' + $dataRoot + '"'),
    ('--nand="' + $nandRoot + '"'),
    ('--config="' + $configPath + '"'),
    ('--controlconfig="' + $controlPath + '"'),
    '--cpu=jit', '--graphics=d3d11', '--resolution-scale=1', '--windowed',
    ('--log="' + $logPath + '"'), $bootArgument
) | Where-Object { $_ }
if ($EnableDebugger) {
    # Upstream --debugger pins the exact port and refuses fallback to another port.
    $arguments += '--debugger=4332'
}
$nativeProcess = Start-Process -FilePath $executable -ArgumentList $arguments -WorkingDirectory (Split-Path $executable) -WindowStyle Hidden -PassThru
# A successful CreateProcess is not a ready emulator. Reject early parser exits,
# and require the exact debugger port to belong to this process before reporting.
$launchDeadline = [DateTime]::UtcNow.AddSeconds(15)
$launchReady = $false
do {
    $nativeProcess.Refresh()
    if ($nativeProcess.HasExited) {
        throw "PPSSPP exited before becoming ready (exit $($nativeProcess.ExitCode)). Expected log: $logPath"
    }
    if ($EnableDebugger) {
        $listeners = @(Get-NetTCPConnection -LocalPort 4332 -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.OwningProcess -eq $nativeProcess.Id })
        $launchReady = $listeners.Count -gt 0
    } else {
        $launchReady = $nativeProcess.MainWindowHandle -ne [IntPtr]::Zero
    }
    if (-not $launchReady) { Start-Sleep -Milliseconds 100 }
} until ($launchReady -or [DateTime]::UtcNow -ge $launchDeadline)
if (-not $launchReady) {
    throw "PPSSPP PID $($nativeProcess.Id) is still running but its window or requested debugger port is not ready. Log: $logPath"
}
$state = [ordered]@{
    pid = $nativeProcess.Id
    startedAt = (Get-Date).ToString('o')
    processCreatedAt = $nativeProcess.StartTime.ToUniversalTime().ToString('o')
    executable = $executable
    version = $manifest.core.version
    mode = $Mode
    dataRoot = $dataRoot
    nandRoot = $nandRoot
    config = $configPath
    log = $logPath
    debuggerEnabled = [bool]$EnableDebugger
    note = 'Debugger permitted only after checking the project firewall restriction.'
}
$state | ConvertTo-Json | Set-Content -LiteralPath $statePath -Encoding utf8
$state | ConvertTo-Json
