#!/bin/sh
# PostgREST wrapper that writes PID file before starting PostgREST
# This enables SIGHUP-based config reload without restarting the container

set -e

# Config file location (passed as argument or use default)
CONFIG_FILE="${1:-/etc/postgrest.conf}"
PID_FILE="/var/run/postgrest.pid"

# Ensure /var/run exists
mkdir -p /var/run

echo "Starting PostgREST with config: $CONFIG_FILE"

# Start PostgREST in background to capture its PID
/usr/local/bin/postgrest "$CONFIG_FILE" &
POSTGREST_PID=$!

# Write PID to file for reload scripts
echo "$POSTGREST_PID" > "$PID_FILE"
echo "PostgREST started with PID: $POSTGREST_PID (written to $PID_FILE)"

# Signal forwarding: Forward SIGTERM and SIGHUP to PostgREST child process
# This ensures proper shutdown and config reload behavior
trap 'echo "Received SIGTERM, forwarding to PostgREST..."; kill -TERM $POSTGREST_PID 2>/dev/null' TERM
trap 'echo "Received SIGHUP, forwarding to PostgREST..."; kill -HUP $POSTGREST_PID 2>/dev/null' HUP

# Wait for PostgREST process to exit
wait "$POSTGREST_PID"
EXIT_CODE=$?

echo "PostgREST exited with code: $EXIT_CODE"
exit $EXIT_CODE
