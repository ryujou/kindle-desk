#!/bin/sh
set -eu
BASE=/mnt/us/extensions/kindle-desk
FBINK=/var/local/kmc/kindlehf/bin/fbink
mkdir -p "$BASE/bin"
[ -f "$BASE/config.sh" ] || { echo 'Create config.sh from config.example.sh and set ENDPOINT first.' >&2; exit 1; }
[ -f "$BASE/bin/busybox" ] || { echo 'Run tools/prepare-device.ps1 on the PC before copying files.' >&2; exit 1; }
[ -x "$FBINK" ] || { echo 'This setup requires the KMC kindlehf FBInk build. Check your jailbreak and firmware.' >&2; exit 1; }
cp "$FBINK" "$BASE/bin/fbink"
chmod 0755 "$BASE/bin/busybox" "$BASE/bin/fbink"
"$BASE/bin/busybox" httpd --help >/dev/null 2>&1
"$BASE/bin/fbink" --version
echo 'Kindle Desk is ready. Open Kindle Desk from the library.'
