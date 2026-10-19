#!/bin/sh
set -eu
BASE=/mnt/us/extensions/kindle-desk
if [ -d /tmp/kindle-desk ]; then
    echo 'Kindle Desk is already running. Use Stop before reopening.' >&2
    exit 1
fi
# The launcher terminates its process group after returning to the library.
chmod 0755 "$BASE/bin/busybox"
"$BASE/bin/busybox" setsid /bin/sh "$BASE/session.sh" >/tmp/kindle-desk.log 2>&1 </dev/null &
