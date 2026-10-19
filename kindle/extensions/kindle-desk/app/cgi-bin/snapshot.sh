#!/bin/sh
set -eu
. /mnt/us/extensions/kindle-desk/config.sh
printf 'Content-Type: application/json; charset=utf-8\r\nCache-Control: no-store\r\nAccess-Control-Allow-Origin: *\r\n\r\n'
if [ -z "$ENDPOINT" ]; then
    printf '{"error":"not_configured"}\n'
    exit 0
fi
case "$ENDPOINT" in http://*) ;; *) printf '{"error":"invalid_endpoint"}\n'; exit 0 ;; esac
if response=$(curl -q -fsS --connect-timeout 2 --max-time 4 --max-filesize 65536 "$ENDPOINT"); then
    printf '%s\n' "$response"
else
    printf '{"error":"offline"}\n'
fi
