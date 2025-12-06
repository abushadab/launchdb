FROM alpine:3.19

# Install PgBouncer and dependencies
RUN apk add --no-cache \
    pgbouncer \
    postgresql-client \
    bash \
    && mkdir -p /etc/pgbouncer /var/log/pgbouncer /var/run/pgbouncer \
    && chown -R postgres:postgres /etc/pgbouncer /var/log/pgbouncer /var/run/pgbouncer

# Run as postgres user
USER postgres

# Expose PgBouncer port
EXPOSE 6432

# Health check
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
    CMD psql -h 127.0.0.1 -p 6432 -U postgres -d pgbouncer -c "SHOW POOLS" || exit 1

# Start PgBouncer in foreground
# Config files are mounted as volumes from host
CMD ["pgbouncer", "/etc/pgbouncer/pgbouncer.ini"]
