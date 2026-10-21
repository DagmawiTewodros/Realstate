# Builds one of the two web apps as a Next.js standalone server. Usage:
#   docker build -f ops/docker/web.Dockerfile --build-arg APP=property-web --build-arg API_URL=http://property-api:4000 -t property-web .
#   docker build -f ops/docker/web.Dockerfile --build-arg APP=gym-web --build-arg API_URL=http://gym-api:4001 -t gym-web .
# API_URL is where the web server sends /api/* (the browser never talks to the API directly). It is fixed at build time.
ARG NODE_VERSION=22

FROM node:${NODE_VERSION}-bookworm-slim AS build
ARG APP
ARG API_URL
RUN test -n "$APP" && test -n "$API_URL" || (echo "Set --build-arg APP and API_URL" && exit 1)
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @platform/shared build
ENV NEXT_TELEMETRY_DISABLED=1 PROPERTY_API_URL=${API_URL} GYM_API_URL=${API_URL}
RUN pnpm --filter "@platform/${APP}" build
RUN mkdir -p /out && cp -r "apps/${APP}/.next/standalone/." /out/ \
 && mkdir -p "/out/apps/${APP}/.next" && cp -r "apps/${APP}/.next/static" "/out/apps/${APP}/.next/static" \
 && if [ -d "apps/${APP}/public" ]; then cp -r "apps/${APP}/public" "/out/apps/${APP}/public"; fi

FROM node:${NODE_VERSION}-bookworm-slim AS runtime
ARG APP
ARG API_URL
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000 PROPERTY_API_URL=${API_URL} GYM_API_URL=${API_URL} APP_DIR=/app/apps/${APP}
WORKDIR /app
COPY --from=build --chown=node:node /out ./
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/login').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["sh", "-c", "node \"$APP_DIR/server.js\""]
