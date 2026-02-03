FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci

# Copy source and build
COPY . .
RUN npm run build

# Production image
FROM node:20-alpine

WORKDIR /app

# Install production dependencies only
COPY package*.json ./
RUN npm ci --production

# Copy built files
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/ui/dist ./ui/dist

# Create config directory
RUN mkdir -p /app/config

# Non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 -G nodejs
USER nodejs

EXPOSE 3000

ENV NODE_ENV=production
ENV PORT=3000
ENV CONFIG_PATH=/app/config/init.json
ENV PROJECT_PATH=/project

CMD ["node", "dist/index.js"]
