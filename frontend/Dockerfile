# syntax=docker/dockerfile:1.7
# -------- Stage 1: Build --------------------------------------------------
FROM docker.io/library/node:22-alpine AS build
WORKDIR /app
ENV NPM_CONFIG_UPDATE_NOTIFIER=false NPM_CONFIG_FUND=false
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci --ignore-scripts; else npm install --ignore-scripts --no-audit; fi
COPY tsconfig.json vite.config.ts index.html ./
COPY public ./public
COPY src ./src
RUN npm run build

# -------- Stage 2: Runtime (nginx unprivileged, UID 101) ------------------
FROM docker.io/nginxinc/nginx-unprivileged:1.27-alpine
LABEL org.opencontainers.image.title="srp-frontend" org.opencontainers.image.version="1.0.0"
COPY nginx.conf /etc/nginx/nginx.conf
COPY --from=build /app/dist /usr/share/nginx/html
USER 101
EXPOSE 8080
