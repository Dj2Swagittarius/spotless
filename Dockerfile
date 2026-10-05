# ---- build stage ----
FROM node:22-bookworm-slim AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# ---- runtime stage ----
FROM node:22-bookworm-slim AS runner
WORKDIR /app

# ffmpeg powers on-the-fly transcoding for Subsonic mobile clients
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV MUSIC_DIR=/music
ENV MUSIC_WRITE_DIR=/music-write
ENV DATA_DIR=/data
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

RUN mkdir -p /music /music-write /data && chown -R node:node /app /data
USER node

EXPOSE 3000
VOLUME ["/music", "/music-write", "/data"]

CMD ["node", "server.js"]
