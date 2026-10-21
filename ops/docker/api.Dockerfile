# Builds one of the two APIs. Usage:
#   docker build -f ops/docker/api.Dockerfile --build-arg APP=property-api -t property-api .
#   docker build -f ops/docker/api.Dockerfile --build-arg APP=gym-api -t gym-api .
# The image runs the API by default; run migrations with `node dist/migrate.js` and the seed with `node dist/seed.js`.
ARG NODE_VERSION=22

FROM node:${NODE_VERSION}-bookworm-slim AS build
ARG APP
RUN test -n "$APP" || (echo "Set --build-arg APP=property-api or APP=gym-api" && exit 1)
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @platform/shared --filter @platform/nest-common --filter "@platform/${APP}" build
# A self-contained folder with only production dependencies (workspace packages are copied in).
RUN pnpm --filter "@platform/${APP}" deploy --prod --legacy /out

FROM node:${NODE_VERSION}-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out ./
# Uploaded files are stored here when STORAGE_DRIVER=local; mount a volume on it.
RUN mkdir -p /data/storage && chown node:node /data/storage
ENV STORAGE_DIR=/data/storage
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--enable-source-maps", "dist/main.js"]
