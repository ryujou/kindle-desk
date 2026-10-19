#!/bin/sh
set -eu
. /mnt/us/extensions/kindle-desk/config.sh
printf 'Content-Type: application/json; charset=utf-8\r\nCache-Control: no-store\r\n\r\n'
case "${REQUEST_METHOD:-GET}" in GET|POST) ;; *) printf '{"error":"method"}\n'; exit 0 ;; esac
case "$ENDPOINT" in http://*/snapshot) ;; *) printf '{"error":"not_configured"}\n'; exit 0 ;; esac
if response=$(curl -q -fsS -X "${REQUEST_METHOD:-GET}" --connect-timeout 2 --max-time 4 "${ENDPOINT%/snapshot}/quota-refresh"); then
    printf '%s\n' "$response"
else
    printf '{"error":"offline"}\n'
fi
