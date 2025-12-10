#!/bin/bash
# Add pgbouncer_auth trust rule to pg_hba.conf
# This must run AFTER PostgreSQL initializes the data directory

PG_HBA="$PGDATA/pg_hba.conf"

echo "=== Configuring pg_hba.conf for PgBouncer auth_query ==="

# Backup original
cp "$PG_HBA" "$PG_HBA.bak"

# Create new pg_hba.conf with pgbouncer_auth trust rule BEFORE scram-sha-256
# We need to insert the trust rule before the catch-all scram rule
{
    # Keep all lines except the last "host all all all" line
    head -n -1 "$PG_HBA.bak"

    # Add pgbouncer_auth trust rule (must come before catch-all)
    # Restricted to Docker network ranges only
    echo "# PgBouncer auth_query user - needs trust to query pg_shadow"
    echo "host    all             pgbouncer_auth  172.16.0.0/12           trust"
    echo "host    all             pgbouncer_auth  192.168.0.0/16          trust"
    echo ""

    # Add back the scram-sha-256 rule for Docker networks only
    echo "# All other remote connections use SCRAM-SHA-256 (Docker networks only)"
    echo "host    all             all             172.16.0.0/12           scram-sha-256"
    echo "host    all             all             192.168.0.0/16          scram-sha-256"
} > "$PG_HBA"

echo "=== Updated pg_hba.conf ==="
cat "$PG_HBA" | grep -v "^#" | grep -v "^$"
echo "=== pg_hba.conf update complete ==="
