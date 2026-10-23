[CmdletBinding()]
param([switch]$Remove)
$ErrorActionPreference = 'Stop'
$taskRuleLog = Join-Path $PSScriptRoot 'logs/firewall-install.log'
Start-Transcript -LiteralPath $taskRuleLog -Append -Force | Out-Null
trap { $_ | Format-List * -Force | Out-String | Write-Output; Stop-Transcript | Out-Null; exit 1 }
$ruleName = 'Codex-PSP-Studio-Debugger-Loopback-4332'
$executable = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'ppsspp/PPSSPPWindows64.exe'))
$taskIdentity = [Security.Principal.WindowsIdentity]::GetCurrent()
if (-not ([Security.Principal.WindowsPrincipal]::new($taskIdentity)).IsInRole([Security.Principal.WindowsBuiltinRole]::Administrator)) {
    throw 'Administrator rights are required to add this restrictive Windows Firewall rule.'
}
if ($Remove) {
    Get-NetFirewallRule -Name $ruleName -ErrorAction SilentlyContinue | Remove-NetFirewallRule
    exit
}
if (-not (Test-Path -LiteralPath $executable)) { throw 'The project PPSSPP executable is missing.' }
$existing = Get-NetFirewallRule -Name $ruleName -ErrorAction SilentlyContinue
if ($existing) { $existing | Remove-NetFirewallRule }
# This creates no inbound allow rule and does not alter any global profile.
# Windows Firewall exempts same-host loopback traffic. Block all inbound
# network traffic for this executable and port; verify loopback after launch.
New-NetFirewallRule -Name $ruleName -DisplayName 'PSP Studio: restrict native debugger to localhost' `
    -Description 'Project-only PPSSPP debugger on TCP 4332. Blocks non-loopback sources; no inbound exception is opened.' `
    -Direction Inbound -Action Block -Enabled True -Profile Any -Protocol TCP -LocalPort 4332 `
    -Program $executable -RemoteAddress Any | Out-Null
$rule = Get-NetFirewallRule -Name $ruleName
if ($rule.Enabled -ne 'True' -or $rule.Action -ne 'Block') { throw 'Firewall rule verification failed.' }
[ordered]@{name=$rule.Name; executable=$executable; port=4332; action='Block non-loopback'; appliedAt=(Get-Date).ToString('o')} |
    ConvertTo-Json | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'debugger-firewall-receipt.json') -Encoding utf8
Write-Output 'Installed project-only inbound restriction. No global firewall policy was changed.'
Stop-Transcript | Out-Null
