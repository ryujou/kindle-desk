#!/bin/sh
set -eu
if [ -d /tmp/kindle-desk ]; then
    echo 'Stop Kindle Desk first, then run uninstall again.' >&2
    exit 1
fi
sqlite3 /var/local/appreg.db <<'SQL'
.timeout 3000
BEGIN IMMEDIATE;
DELETE FROM properties WHERE handlerId='local.kindledesk.app';
DELETE FROM handlerIds WHERE handlerId='local.kindledesk.app';
COMMIT;
SQL
APP_ROOT=/var/local/mesquite/local.kindledesk.app
rm -f "$APP_ROOT/cgi-bin/quota-refresh.sh" "$APP_ROOT/index.html" "$APP_ROOT/style.css" "$APP_ROOT/model.js" "$APP_ROOT/app.js" "$APP_ROOT/companion.js" "$APP_ROOT/pet.js" "$APP_ROOT/config.xml" "$APP_ROOT/cgi-bin/snapshot.sh" "$APP_ROOT/cgi-bin/companion.sh" "$APP_ROOT/cgi-bin/pet-refresh.sh" "$APP_ROOT/cgi-bin/exit.sh" "$APP_ROOT/cgi-bin/refresh.sh"
if [ -d "$APP_ROOT/pets" ]; then rm -f "$APP_ROOT/pets/"*.png; rmdir "$APP_ROOT/pets"; fi
if [ -d "$APP_ROOT/cgi-bin" ]; then rmdir "$APP_ROOT/cgi-bin"; fi
if [ -d "$APP_ROOT" ]; then rmdir "$APP_ROOT"; fi
echo 'App registration cleared. USB files may now be deleted.'
