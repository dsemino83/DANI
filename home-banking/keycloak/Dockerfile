# Keycloak para el realm "staff" del Home Banking cuando se maneja todo desde Docker (pruebas o
# mientras no esté el SSO de VALO). Se publica por el mismo HTTPS de la app en /auth.
# Usuarios iniciales: mgomez, lrodriguez, svillalba, admin.ti (clave temporal: se cambia al primer ingreso).
FROM quay.io/keycloak/keycloak:26.0.5
COPY realm-staff-dev.json /opt/keycloak/data/import/realm-staff-dev.json
COPY --chmod=755 iniciar.sh /opt/keycloak/bin/iniciar.sh
ENV KC_HTTP_RELATIVE_PATH=/auth \
    KC_HTTP_ENABLED=true \
    KC_PROXY_HEADERS=xforwarded \
    KC_HOSTNAME_BACKCHANNEL_DYNAMIC=true \
    KC_HEALTH_ENABLED=true
ENTRYPOINT ["/opt/keycloak/bin/iniciar.sh"]
CMD ["start-dev", "--import-realm"]
