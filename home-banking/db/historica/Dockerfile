# Base historica con su esquema y roles incluidos: se aplican solos la primera vez que se crea el volumen.
# Las claves no van en la imagen: se leen de /run/secrets al inicializar.
FROM postgres:16.4-alpine
COPY --chmod=755 01_esquema.sql 02_roles.sh /docker-entrypoint-initdb.d/
