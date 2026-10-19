$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot
$binPath = Join-Path $projectRoot 'kindle/extensions/kindle-desk/bin'
New-Item -ItemType Directory -Force -Path $binPath | Out-Null
Invoke-WebRequest 'https://busybox.net/downloads/binaries/1.31.0-defconfig-multiarch-musl/busybox-armv7l' -OutFile (Join-Path $binPath 'busybox')
Write-Host 'BusyBox ARMv7 downloaded. FBInk will be copied from KMC on the Kindle by Kindle Desk Setup.'
