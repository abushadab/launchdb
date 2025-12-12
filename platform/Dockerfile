# Multi-stage Dockerfile for LaunchDB NestJS Services
# Usage: docker build --build-arg SERVICE_NAME=platform-api -t launchdb/platform-api:latest .

ARG SERVICE_NAME

# ============================================================
# Builder Stage
# ============================================================
FROM node:22-alpine3.23 AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig*.json ./
COPY nest-cli.json ./

# Copy all source code (monorepo)
COPY apps/ ./apps/
COPY libs/ ./libs/

# Install all dependencies (including dev dependencies for build)
RUN npm ci --quiet

# Build argument for which service to build
ARG SERVICE_NAME
RUN if [ -z "$SERVICE_NAME" ]; then echo "ERROR: SERVICE_NAME build arg is required" && exit 1; fi

# Build the specific service
RUN npx nest build ${SERVICE_NAME}

# ============================================================
# Production Stage
# ============================================================
FROM node:22-alpine3.23

WORKDIR /app

ARG SERVICE_NAME
ENV SERVICE_NAME=${SERVICE_NAME}

# Copy package files
COPY package*.json ./

# Create non-root user first
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Install production dependencies only (as nodejs user for correct ownership)
RUN npm ci --omit=dev --quiet && npm cache clean --force && chown -R nodejs:nodejs node_modules

# Copy built application from builder with correct ownership
COPY --from=builder --chown=nodejs:nodejs /app/dist ./dist

# NOTE: We do NOT copy node_modules from builder - use production-only deps from line 46
# This excludes dev dependencies (typescript, jest, etc.) reducing image size and CVEs

# Copy SQL migration files from builder
COPY --from=builder --chown=nodejs:nodejs /app/libs/sql ./libs/sql

# Create PostgREST config directory with correct ownership
# Platform-API needs to write project-specific PostgREST configs here
RUN mkdir -p /etc/postgrest/projects && \
    chown nodejs:nodejs /etc/postgrest/projects && \
    chmod 0750 /etc/postgrest/projects

# Install su-exec for dropping privileges in entrypoint
RUN apk add --no-cache su-exec

# Copy entrypoint script with execute permission
COPY --chmod=755 entrypoint.sh /entrypoint.sh

# Note: Container starts as root to fix volume permissions
# Entrypoint drops to nodejs user before running the app

# Set default PORT (will be overridden by docker-compose)
ENV PORT=8000

# Expose port (will be overridden by docker-compose)
EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "const http=require('http');http.get('http://localhost:'+process.env.PORT+'/health',(r)=>r.statusCode===200?process.exit(0):process.exit(1))"

# Entrypoint fixes permissions and drops to nodejs user
ENTRYPOINT ["/entrypoint.sh"]

# Start the application (exec form with sh to expand SERVICE_NAME)
CMD ["sh", "-c", "node dist/apps/${SERVICE_NAME}/main.js"]
