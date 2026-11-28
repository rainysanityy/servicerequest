# syntax=docker/dockerfile:1.7
FROM docker.io/nginxinc/nginx-unprivileged:1.27-alpine
LABEL org.opencontainers.image.title="srp-proxy" org.opencontainers.image.version="1.0.0"
COPY nginx.conf /etc/nginx/nginx.conf
COPY snippets/ /etc/nginx/snippets/
# envsubst-Templates (vom Entry-Point nach /etc/nginx/conf.d gerendert; conf.d ist tmpfs)
COPY templates/ /etc/nginx/templates/
ENV NGINX_ENVSUBST_OUTPUT_DIR=/etc/nginx/conf.d
# Zertifikatsauswahl + Austausch im Betrieb (läuft nach dem Rendern der Templates)
COPY --chmod=0755 entrypoint/35-tls.sh /docker-entrypoint.d/35-tls.sh
USER 101
EXPOSE 8080 8443
