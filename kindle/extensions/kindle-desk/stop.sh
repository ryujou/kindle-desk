#!/bin/sh
set -eu
if [ -d /tmp/kindle-desk ]; then
    touch /tmp/kindle-desk/stop
else
    echo 'Kindle Desk is not running.'
fi
