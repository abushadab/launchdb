FROM alpine:3.19

# Install dependencies
# - libpq: PostgreSQL client library (required by PostgREST)
# - curl: For healthchecks
# - ca-certificates: For HTTPS connections
RUN apk add --no-cache \
    libpq \
    curl \
    ca-certificates

# Download and install PostgREST binary
ARG POSTGREST_VERSION=v11.2.2
RUN curl -fsSL "https://github.com/PostgREST/postgrest/releases/download/${POSTGREST_VERSION}/postgrest-${POSTGREST_VERSION}-linux-static-x64.tar.xz" \
    | tar -xJf - -C /usr/local/bin && \
    chmod +x /usr/local/bin/postgrest

# Copy wrapper script that writes PID file
COPY postgrest-wrapper.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/postgrest-wrapper.sh

# Expose PostgREST port
EXPOSE 3000

# Use wrapper as entrypoint (writes PID file, then execs PostgREST)
ENTRYPOINT ["/usr/local/bin/postgrest-wrapper.sh"]
CMD ["/etc/postgrest.conf"]
