#!/bin/sh
set -eu
BASE=/mnt/us/extensions/kindle-desk
APP=local.kindledesk.app
APP_ROOT=/var/local/mesquite/local.kindledesk.app
STATE=/tmp/kindle-desk
BB="$BASE/bin/busybox"
HTTP_PID=''
PAUSED_PID=''
AWAKE_TICKS=0
mkdir "$STATE" || exit 1
cleanup() {
    trap - EXIT HUP INT TERM
    if [ -n "$PAUSED_PID" ]; then kill -CONT "$PAUSED_PID" 2>/dev/null || :; fi
    if [ -n "$HTTP_PID" ]; then kill "$HTTP_PID" 2>/dev/null || :; wait "$HTTP_PID" 2>/dev/null || :; fi
    current=$(lipc-get-prop com.lab126.appmgrd activeApp 2>/dev/null) || current=''
    case "$current" in *"$APP"*) lipc-set-prop com.lab126.appmgrd stop "app://$APP" || echo 'Return to library failed.' >&2 ;; esac
    rm -f "$STATE/stop"
    rmdir "$STATE"
}
trap cleanup EXIT
trap 'exit 0' HUP INT TERM
for tool in mesquite sqlite3 curl lipc-get-prop lipc-set-prop; do command -v "$tool" >/dev/null || { echo "Missing: $tool" >&2; exit 1; }; done
. "$BASE/config.sh"
chmod 0755 "$BB"
"$BB" httpd --help >/dev/null 2>&1 || { echo 'Bundled ARM HTTP helper cannot run.' >&2; exit 1; }
framework_uid=$(id -u framework)
framework_gid=$(id -g framework)
mkdir -p "$APP_ROOT/cgi-bin"
cp "$BASE/app/index.html" "$BASE/app/style.css" "$BASE/app/model.js" "$BASE/app/app.js" "$BASE/app/pet.js" "$BASE/app/companion.js" "$BASE/app/config.xml" "$APP_ROOT/"
mkdir -p "$APP_ROOT/pets"
for image in "$BASE/app/pets/"*.png; do
    [ -f "$image" ] || continue
    cp "$image" "$APP_ROOT/pets/"
    chmod 0644 "$APP_ROOT/pets/$(basename "$image")"
done
chmod 0755 "$APP_ROOT/pets"
cp "$BASE/app/cgi-bin/quota-refresh.sh" "$BASE/app/cgi-bin/pet-draw.sh" "$BASE/app/cgi-bin/companion.sh" "$BASE/app/cgi-bin/snapshot.sh" "$BASE/app/cgi-bin/exit.sh" "$BASE/app/cgi-bin/refresh.sh" "$APP_ROOT/cgi-bin/"
chmod 0755 "$APP_ROOT" "$APP_ROOT/cgi-bin" "$APP_ROOT/cgi-bin/"*.sh
chmod 0644 "$APP_ROOT/index.html" "$APP_ROOT/style.css" "$APP_ROOT/model.js" "$APP_ROOT/app.js" "$APP_ROOT/pet.js" "$APP_ROOT/companion.js" "$APP_ROOT/config.xml"
chown "$framework_uid:$framework_gid" "$APP_ROOT" "$APP_ROOT/cgi-bin" "$APP_ROOT/"*.html "$APP_ROOT/"*.css "$APP_ROOT/"*.js "$APP_ROOT/config.xml"
sqlite3 /var/local/appreg.db <<'SQL'
.timeout 3000
BEGIN IMMEDIATE;
INSERT OR IGNORE INTO interfaces(interface) VALUES('application');
INSERT OR IGNORE INTO handlerIds(handlerId) VALUES('local.kindledesk.app');
INSERT OR REPLACE INTO properties(handlerId,name,value) VALUES('local.kindledesk.app','lipcId','local.kindledesk.app');
INSERT OR REPLACE INTO properties(handlerId,name,value) VALUES('local.kindledesk.app','command','/usr/bin/mesquite -l local.kindledesk.app -c file:///var/local/mesquite/local.kindledesk.app/');
INSERT OR REPLACE INTO properties(handlerId,name,value) VALUES('local.kindledesk.app','supportedOrientation','U');
INSERT OR REPLACE INTO properties(handlerId,name,value) VALUES('local.kindledesk.app','default-chrome-style','NH');
INSERT OR REPLACE INTO properties(handlerId,name,value) VALUES('local.kindledesk.app','searchbar-mode','transient');
INSERT OR REPLACE INTO properties(handlerId,name,value) VALUES('local.kindledesk.app','unloadPolicy','unloadOnPause');
COMMIT;
SQL
"$BB" httpd -f -vv -p 127.0.0.1:18766 -h "$APP_ROOT" &
HTTP_PID=$!
sleep 1
kill -0 "$HTTP_PID"
curl -q -fsS --connect-timeout 1 --max-time 2 http://127.0.0.1:18766/index.html >/dev/null
echo 'Local CGI check:'
curl -q -sS --connect-timeout 1 --max-time 6 -o /dev/null -w 'HTTP %{http_code}\n' http://127.0.0.1:18766/cgi-bin/snapshot.sh
# Let the scriptlet/KUAL finish its return-to-Home transition before opening Mesquite.
sleep 3
[ ! -e "$STATE/stop" ] || exit 0
lipc-set-prop com.lab126.appmgrd start "app://$APP"
started=0
attempt=0
while [ "$attempt" -lt 10 ]; do
    [ ! -e "$STATE/stop" ] || exit 0
    current=$(lipc-get-prop com.lab126.appmgrd activeApp)
    case "$current" in *"$APP"*) started=1; break ;; esac
    attempt=$((attempt + 1))
    sleep 1
done
[ "$started" = 1 ] || { echo 'Mesquite did not enter the foreground.' >&2; exit 1; }
while [ ! -e "$STATE/stop" ]; do
    kill -0 "$HTTP_PID"
    current=$(lipc-get-prop com.lab126.appmgrd activeApp)
    case "$current" in *"$APP"*) ;; *) break ;; esac
    power=$(lipc-get-prop com.lab126.powerd state)
    # Mesquite keeps JS timers alive behind the screensaver on 5.16.7.
    if [ "$power" = active ]; then
        if [ -n "$PAUSED_PID" ]; then
            kill -CONT "$PAUSED_PID"
            PAUSED_PID=''
        fi
    elif [ -z "$PAUSED_PID" ]; then
        PAUSED_PID=$("$BB" pgrep -f '^/usr/bin/mesquite -l local[.]kindledesk[.]app ')
        kill -STOP "$PAUSED_PID"
    fi
    if [ "$power" = active ] && [ "$KEEP_AWAKE" = 1 ]; then
        # Reset idle time only: preventScreenSaver also disables the power button on PW4.
        if [ "$AWAKE_TICKS" = 0 ]; then
            lipc-set-prop com.lab126.powerd touchScreenSaverTimeout 1
        fi
        AWAKE_TICKS=$(((AWAKE_TICKS + 1) % 15))
    else
        AWAKE_TICKS=0
    fi
    sleep 2
done
