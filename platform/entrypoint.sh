#!/bin/sh
set -e

# Fix ownership of PostgREST config directory
# Docker volumes mount as root, need to fix at runtime
chown -R nodejs:nodejs /etc/postgrest/projects 2>/dev/null || true

# Switch to nodejs user and run the app
exec su-exec nodejs "$@"
