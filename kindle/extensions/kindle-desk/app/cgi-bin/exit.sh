#!/bin/sh
set -eu
if [ "${REQUEST_METHOD:-}" != POST ]; then
    printf 'Status: 405 Method Not Allowed\r\nContent-Type: text/plain\r\n\r\nPOST required\n'
    exit 0
fi
touch /tmp/kindle-desk/stop
printf 'Content-Type: application/json\r\nCache-Control: no-store\r\nAccess-Control-Allow-Origin: *\r\n\r\n{"ok":true}\n'
