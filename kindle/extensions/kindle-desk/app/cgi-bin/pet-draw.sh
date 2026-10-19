#!/bin/sh
set -eu
printf 'Content-Type: application/json\r\nCache-Control: no-store\r\nAccess-Control-Allow-Origin: *\r\n\r\n'
[ "${REQUEST_METHOD:-}" = POST ] || { printf '{"ok":false}\n'; exit 0; }
current=$(lipc-get-prop com.lab126.appmgrd activeApp)
power=$(lipc-get-prop com.lab126.powerd state)
case "$current" in *local.kindledesk.app*) ;; *) printf '{"ok":false}\n'; exit 0 ;; esac
[ "$power" = active ] || { printf '{"ok":false}\n'; exit 0; }
IFS=, read -r asset row frame left top width height
case "$asset" in ''|*[!a-zA-Z0-9_-]*) printf '{"ok":false}\n'; exit 0 ;; esac
for value in "$row" "$frame" "$left" "$top" "$width" "$height"; do
 case "$value" in ''|*[!0-9]*) printf '{"ok":false}\n'; exit 0 ;; esac
done
file="/mnt/us/extensions/kindle-desk/native-frames-fs-dark/$asset/$row-$frame.png"
[ -f "$file" ] || { printf '{"ok":false,"error":"missing_frame"}\n'; exit 0; }
if /mnt/us/extensions/kindle-desk/bin/fbink -q -V -W A2 -w -g "file=$file,x=$left,y=$top,w=$width,h=$height"; then
 printf '{"ok":true}\n'
else
 printf '{"ok":false,"error":"draw_failed"}\n'
fi
