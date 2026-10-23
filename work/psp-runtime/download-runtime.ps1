[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$runtimeRoot = $PSScriptRoot
$manifest = Get-Content -Raw -LiteralPath (Join-Path $runtimeRoot 'runtime-manifest.json') | ConvertFrom-Json
New-Item -ItemType Directory -Force -Path (Join-Path $runtimeRoot 'downloads') | Out-Null

function Get-PinnedFile {
    param([string]$Uri, [string]$FallbackUri, [string]$Destination, [string]$Sha256)
    if (Test-Path -LiteralPath $Destination) {
        $actual = (Get-FileHash -LiteralPath $Destination -Algorithm SHA256).Hash
        if ($actual -ieq $Sha256) { return }
        throw "Existing file has an unexpected SHA-256; preserve and inspect it: $Destination"
    }
    $partial = "$Destination.partial"
    try {
        try { Invoke-WebRequest -Uri $Uri -OutFile $partial -TimeoutSec 300 }
        catch {
            if (-not $FallbackUri) { throw }
            Write-Warning "HTTPS download failed. Using the manifest's official HTTP fallback and requiring the pinned SHA-256."
            Invoke-WebRequest -Uri $FallbackUri -OutFile $partial -TimeoutSec 300
        }
        if ((Get-FileHash -LiteralPath $partial -Algorithm SHA256).Hash -ine $Sha256) {
            throw "Downloaded file does not match the pinned SHA-256: $partial"
        }
        Move-Item -LiteralPath $partial -Destination $Destination
    }
    catch { throw }
}

$archive = Join-Path $runtimeRoot $manifest.core.archive
$firmware = Join-Path $runtimeRoot $manifest.firmware.file
Get-PinnedFile -Uri $manifest.core.url -Destination $archive -Sha256 $manifest.core.sha256
Get-PinnedFile -Uri $manifest.firmware.url -FallbackUri $manifest.firmware.fallbackUrl -Destination $firmware -Sha256 $manifest.firmware.sha256
if ((Get-FileHash -LiteralPath $firmware -Algorithm MD5).Hash -ine $manifest.firmware.md5) {
    throw 'Firmware MD5 does not match the Sony URL.'
}
$executable = Join-Path $runtimeRoot $manifest.core.executable
if (-not (Test-Path -LiteralPath $executable)) {
    $destination = Join-Path $runtimeRoot 'ppsspp'
    if (Test-Path -LiteralPath $destination) { throw "Partial extraction exists; inspect it first: $destination" }
    Expand-Archive -LiteralPath $archive -DestinationPath $destination
}
if ((Get-FileHash -LiteralPath $executable -Algorithm SHA256).Hash -ine $manifest.core.executableSha256) {
    throw "Executable does not match the pinned official build: $executable"
}
[pscustomobject]@{
    Version = $manifest.core.version
    Executable = $executable
    Firmware = $firmware
    Verified = $true
} | ConvertTo-Json
