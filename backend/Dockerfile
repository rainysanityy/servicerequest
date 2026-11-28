# syntax=docker/dockerfile:1.7
# -----------------------------------------------------------------------------
# Stage 1: Build (Dev-Dependencies, TypeScript-Kompilierung, Tests)
# -----------------------------------------------------------------------------
FROM docker.io/library/node:22-alpine AS build
WORKDIR /app
ENV NPM_CONFIG_UPDATE_NOTIFIER=false NPM_CONFIG_FUND=false
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci --ignore-scripts; else npm install --ignore-scripts --no-audit; fi
COPY tsconfig.json ./
COPY src ./src
COPY test ./test
RUN npm run build && npm test && npm prune --omit=dev
# Ablage für hochgeladene TLS-Zertifikate (Volume "tls"): Backend schreibt, Proxy (Gruppe 101) liest
RUN mkdir -p /out/tls && chmod 0750 /out/tls

# -----------------------------------------------------------------------------
# Stage 2: Runtime – distroless (keine Shell, kein Paketmanager), non-root
# -----------------------------------------------------------------------------
FROM gcr.io/distroless/nodejs22-debian12:nonroot
LABEL org.opencontainers.image.title="srp-backend" \
      org.opencontainers.image.description="IT-Service-Request-Portal API" \
      org.opencontainers.image.version="1.0.0"
WORKDIR /app
ENV NODE_ENV=production NODE_OPTIONS="--disable-proto=delete"
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY migrations ./migrations
COPY --from=build --chown=65532:101 /out/tls /tls
USER 65532:65532
EXPOSE 3000
CMD ["dist/server.js"]
