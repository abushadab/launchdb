#!/bin/sh
# PostgREST wrapper that writes PID file before exec'ing PostgREST
# This allows Sonnet A to send SIGHUP for config reload

set -e

PID_FILE="/var/run/postgrest.pid"

# Ensure /var/run exists
mkdir -p /var/run

# Start PostgREST in background to get its PID
/usr/bin/postgrest "$@" &
POSTGREST_PID=$!

# Write PID to file
echo "$POSTGREST_PID" > "$PID_FILE"
echo "PostgREST started with PID: $POSTGREST_PID (written to $PID_FILE)"

# Forward signals to PostgREST process
trap 'kill -TERM $POSTGREST_PID 2>/dev/null' TERM INT
trap 'kill -HUP $POSTGREST_PID 2>/dev/null' HUP

# Wait for PostgREST process
wait $POSTGREST_PID
