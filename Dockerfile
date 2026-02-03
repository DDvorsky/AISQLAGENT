FROM node:20-alpine AS builder

WORKDIR /app

# Install backend dependencies
COPY package*.json ./
RUN npm ci

# Install UI dependencies
COPY ui/package*.json ./ui/
RUN cd ui && npm ci

# Copy all source
COPY . .

# Build backend (TypeScript) - skip the ui build in npm script
RUN npx tsc

# Build UI separately
RUN cd ui && npm run build

# Production image
FROM node:20-alpine

WORKDIR /app

# Install production dependencies only
COPY package*.json ./
RUN npm ci --production

# Copy built backend
COPY --from=builder /app/dist ./dist

# Copy built UI
COPY --from=builder /app/ui/dist ./ui/dist

# Non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 -G nodejs

# Create config directory with correct ownership
RUN mkdir -p /app/config && chown -R nodejs:nodejs /app/config

USER nodejs

EXPOSE 3000

ENV NODE_ENV=production
ENV PORT=3000
ENV CONFIG_PATH=/app/config/init.json
ENV PROJECT_PATH=/project

CMD ["node", "dist/index.js"]
