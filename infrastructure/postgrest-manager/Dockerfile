FROM node:22-alpine3.23

# Install Docker CLI for container management
RUN apk add --no-cache docker-cli bash

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install --production

# Copy application code
COPY index.js ./
COPY lib/ ./lib/

# Expose port
EXPOSE 9000

# Note: Running as root is required for Docker socket access
# The container is isolated and only accessible via internal network
# Protected by X-Internal-Key authentication
CMD ["node", "index.js"]
