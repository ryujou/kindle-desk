#!/bin/sh
set -eu
printf 'Content-Type: application/json\r\nCache-Control: no-store\r\nAccess-Control-Allow-Origin: *\r\n\r\n'
if [ "${REQUEST_METHOD:-}" != POST ]; then printf '{"ok":false,"error":"post_required"}\n'; exit 0; fi
current=$(lipc-get-prop com.lab126.appmgrd activeApp)
power=$(lipc-get-prop com.lab126.powerd state)
case "$current" in *local.kindledesk.app*) ;; *) printf '{"ok":false,"error":"not_foreground"}\n'; exit 0 ;; esac
if [ "$power" != active ]; then printf '{"ok":false,"error":"sleeping"}\n'; exit 0; fi
if /mnt/us/extensions/kindle-desk/bin/fbink -q -W GC16 -fs >/dev/null 2>&1; then
    printf '{"ok":true}\n'
else
    printf '{"ok":false,"error":"refresh_failed"}\n'
fi
