#!/bin/sh
set -e

# Switch to nodejs user and run the app
exec su-exec nodejs "$@"
