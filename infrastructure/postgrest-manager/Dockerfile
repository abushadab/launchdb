FROM node:22-alpine3.23

# Install bash for shell operations
RUN apk add --no-cache bash

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install --production

# Copy application code
COPY index.js ./
COPY lib/ ./lib/

# Create non-root user
RUN addgroup -g 1001 nodeuser && \
    adduser -D -u 1001 -G nodeuser nodeuser

# Change ownership
RUN chown -R nodeuser:nodeuser /app

# Expose port
EXPOSE 9000

# Switch to non-root user
USER nodeuser

CMD ["node", "index.js"]
