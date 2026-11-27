# syntax=docker/dockerfile:1.7
# Gehärtetes, vorgebautes Keycloak-Image ("optimized") -> erlaubt read-only rootfs
ARG KEYCLOAK_VERSION=26.4

FROM quay.io/keycloak/keycloak:${KEYCLOAK_VERSION} AS builder
ENV KC_DB=postgres \
    KC_HEALTH_ENABLED=true \
    KC_METRICS_ENABLED=true \
    KC_HTTP_RELATIVE_PATH=/auth \
    KC_FEATURES_DISABLED=impersonation,kerberos
WORKDIR /opt/keycloak
RUN /opt/keycloak/bin/kc.sh build

FROM quay.io/keycloak/keycloak:${KEYCLOAK_VERSION}
COPY --from=builder /opt/keycloak/ /opt/keycloak/
# Material-3-Login-Theme des Portals (Realm-Einstellung loginTheme=itportal)
COPY --chown=1000:0 themes/itportal /opt/keycloak/themes/itportal
USER 1000
EXPOSE 8080 9000
ENTRYPOINT ["/opt/keycloak/bin/kc.sh"]
