# Base operativa con su esquema y roles incluidos: se aplican solos la primera vez que se crea el volumen.
# Las claves no van en la imagen: se leen de /run/secrets al inicializar.
# /migraciones: cambios de esquema para bases ya creadas (idempotentes); los aplica scripts/migrar-bases.sh.
FROM postgres:16.4-alpine
COPY --chmod=755 01_esquema.sql 02_roles.sh 03_migraciones.sh /docker-entrypoint-initdb.d/
COPY --chmod=644 migraciones/ /migraciones/
# --chmod=644 también deja el directorio sin permiso de entrada: el servicio db-init corre como postgres y lo necesita
RUN chmod 755 /migraciones
# aplicar.sh lo corre el servicio db-init en cada arranque
COPY --chmod=755 aplicar.sh /migraciones/aplicar.sh
