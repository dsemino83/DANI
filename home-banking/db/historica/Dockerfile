# Base historica con su esquema y roles incluidos: se aplican solos la primera vez que se crea el volumen.
# Las claves no van en la imagen: se leen de /run/secrets al inicializar.
# rol-pase.sql corre solo al crear el volumen (después de 02_roles.sh) y además queda en /migraciones para
# bases ya creadas (lo aplica scripts/migrar-bases.sh).
FROM postgres:16.4-alpine
COPY --chmod=755 01_esquema.sql 02_roles.sh /docker-entrypoint-initdb.d/
COPY --chmod=644 rol-pase.sql /docker-entrypoint-initdb.d/rol-pase.sql
COPY --chmod=644 rol-pase.sql /migraciones/rol-pase.sql
