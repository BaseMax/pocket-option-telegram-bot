FROM oven/bun:1.3.14-alpine AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

FROM oven/bun:1.3.14-alpine AS runtime
ENV NODE_ENV=production \
    DB_PATH=/app/data/bot.sqlite \
    HEARTBEAT_PATH=/app/data/heartbeat

WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json bun.lock tsconfig.json ./
COPY src ./src
COPY docker ./docker

RUN mkdir -p /app/data && chmod +x docker/entrypoint.sh && chown -R bun:bun /app

USER bun
STOPSIGNAL SIGTERM
ENTRYPOINT ["/app/docker/entrypoint.sh"]
CMD ["bun", "run", "src/index.ts"]
