# Multi-stage Dockerfile for LaunchDB NestJS Services
# Usage: docker build --build-arg SERVICE_NAME=platform-api -t launchdb/platform-api:latest .

ARG SERVICE_NAME

# ============================================================
# Builder Stage
# ============================================================
FROM node:20-alpine AS builder

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
FROM node:20-alpine

WORKDIR /app

ARG SERVICE_NAME
ENV SERVICE_NAME=${SERVICE_NAME}

# Copy package files
COPY package*.json ./

# Install production dependencies only
RUN npm ci --only=production --quiet && npm cache clean --force

# Create non-root user first
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Copy built application from builder with correct ownership
COPY --from=builder --chown=nodejs:nodejs /app/dist ./dist

# Copy node_modules from builder with correct ownership
COPY --from=builder --chown=nodejs:nodejs /app/node_modules ./node_modules

# Copy SQL migration files from builder
COPY --from=builder --chown=nodejs:nodejs /app/libs/sql ./libs/sql

USER nodejs

# Expose port (will be overridden by docker-compose)
EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "const http=require('http');http.get('http://localhost:'+process.env.PORT+'/health',(r)=>r.statusCode===200?process.exit(0):process.exit(1))"

# Start the application
CMD node dist/apps/${SERVICE_NAME}/main.js
