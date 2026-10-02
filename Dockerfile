# Simple multi-stage Dockerfile for production
FROM node:20-alpine AS base

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
FROM base AS deps
RUN npm ci --omit=dev --ignore-scripts

# Build
FROM base AS builder
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build

# Production image
FROM base AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Copy built assets
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

# Non-root user
USER node

EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/api/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "server.js"]