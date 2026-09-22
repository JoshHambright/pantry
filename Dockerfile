# One image serves both halves: the API also serves the built web app, so a Pi
# runs two containers total (this and Postgres) instead of three plus a proxy.

FROM node:22-alpine AS build
WORKDIR /app
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json tsconfig.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

# Drop dev dependencies from the tree we are about to copy into the runtime.
RUN pnpm --filter @pantry/api --filter @pantry/shared --prod deploy /out


FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Run as a non-root user; nothing here needs to write to the filesystem.
RUN addgroup -S pantry && adduser -S pantry -G pantry

COPY --from=build --chown=pantry:pantry /out/node_modules ./node_modules
COPY --from=build --chown=pantry:pantry /out/dist ./dist
COPY --from=build --chown=pantry:pantry /app/apps/api/drizzle ./drizzle
COPY --from=build --chown=pantry:pantry /app/apps/web/dist ./web

USER pantry
ENV WEB_DIST=/app/web
ENV PORT=8080
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=4s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]
