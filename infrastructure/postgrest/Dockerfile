FROM alpine:3.23

# Install dependencies
# - libpq: PostgreSQL client library (required by PostgREST)
# - curl: For healthchecks
# - ca-certificates: For HTTPS connections
RUN apk add --no-cache \
    libpq \
    curl \
    ca-certificates

# Download and install PostgREST binary
ARG POSTGREST_VERSION=v14.1
ARG POSTGREST_SHA256=bdab6ab3389ca0d6c1f3b8363491674dbca71875c3f30261d92d8fecdde35277
RUN curl -fsSL "https://github.com/PostgREST/postgrest/releases/download/${POSTGREST_VERSION}/postgrest-${POSTGREST_VERSION}-linux-static-x86-64.tar.xz" \
    -o /tmp/postgrest.tar.xz && \
    echo "${POSTGREST_SHA256}  /tmp/postgrest.tar.xz" | sha256sum -c - && \
    tar -xJf /tmp/postgrest.tar.xz -C /usr/local/bin && \
    rm /tmp/postgrest.tar.xz && \
    chmod +x /usr/local/bin/postgrest

# Copy wrapper script that writes PID file
COPY postgrest-wrapper.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/postgrest-wrapper.sh

# Expose PostgREST port
EXPOSE 3000

# Use wrapper as entrypoint (writes PID file, then execs PostgREST)
ENTRYPOINT ["/usr/local/bin/postgrest-wrapper.sh"]
CMD ["/etc/postgrest.conf"]
