#!/bin/sh
set -eu
printf 'Content-Type: application/json\r\nCache-Control: no-store\r\nAccess-Control-Allow-Origin: *\r\n\r\n'
if [ "${REQUEST_METHOD:-}" != POST ]; then printf '{"ok":false,"error":"post_required"}\n'; exit 0; fi
current=$(lipc-get-prop com.lab126.appmgrd activeApp)
power=$(lipc-get-prop com.lab126.powerd state)
case "$current" in *local.kindledesk.app*) ;; *) printf '{"ok":false,"error":"not_foreground"}\n'; exit 0 ;; esac
if [ "$power" != active ]; then printf '{"ok":false,"error":"sleeping"}\n'; exit 0; fi
IFS=, read -r left top width height flash || :
for value in "$left" "$top" "$width" "$height" "$flash"; do
    case "$value" in ''|*[!0-9]*) printf '{"ok":false,"error":"invalid_region"}\n'; exit 0 ;; esac
done
[ "$width" -gt 0 ] && [ "$height" -gt 0 ] || { printf '{"ok":false,"error":"empty_region"}\n'; exit 0; }
mode=''
[ "$flash" != 1 ] || mode='-f'
if /mnt/us/extensions/kindle-desk/bin/fbink -q -W GC16 $mode -s "left=$left,top=$top,width=$width,height=$height" >/dev/null 2>&1; then
    printf '{"ok":true}\n'
else
    printf '{"ok":false,"error":"refresh_failed"}\n'
fi
