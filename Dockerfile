# Alternative to Nixpacks: explicit Docker build
# Railway will use this if present and you set the Builder to "DOCKERFILE"
FROM node:20-bookworm-slim AS builder

WORKDIR /app

# Install build tools for better-sqlite3 native bindings
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

# ------- Final runtime image -------
FROM node:20-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production

COPY --from=builder /app/node_modules ./node_modules
COPY . .

# Bundle bank/seed data into /app/seed/ — this directory is NOT affected by
# the volume mount at /app/data, so it's always available for init.js to copy from.
RUN cp -r /app/data /app/seed

# Default data directory; Railway should mount a volume at /app/data
ENV DATA_DIR=/app/data

EXPOSE 3000

# init.js seeds the first admin + bank, then server starts
CMD ["sh", "-c", "node scripts/init.js && node server.js"]
