#!/bin/sh
set -e

: "${SCRIPT_REF:?SCRIPT_REF env required}"

gsutil cp "$SCRIPT_REF" /tmp/run.sh
chmod +x /tmp/run.sh

exec bash /tmp/run.sh "$@"
