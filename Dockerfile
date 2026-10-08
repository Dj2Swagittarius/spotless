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

# ffmpeg powers on-the-fly transcoding for Subsonic mobile clients;
# gosu lets the entrypoint drop from root to the node user after fixing /data ownership.
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg gosu && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV MUSIC_DIR=/music
ENV MUSIC_WRITE_DIR=/music-write
ENV DATA_DIR=/data
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
COPY docker-entrypoint.sh ./docker-entrypoint.sh

# The sed guards against a CRLF checkout on Windows hosts, which would break the shebang.
RUN sed -i 's/\r$//' /app/docker-entrypoint.sh && chmod +x /app/docker-entrypoint.sh \
  && mkdir -p /music /music-write /data && chown -R node:node /app /data

EXPOSE 3000
VOLUME ["/music", "/music-write", "/data"]

# /api/health answers 200 while the database is reachable and 503 otherwise.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# The entrypoint runs as root, fixes /data ownership (PUID/PGID) and execs the app as "node".
ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["node", "server.js"]
