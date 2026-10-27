# SQL Server 2025 para el Home Banking VALO: las dos bases (operativa y histórica) en una instancia, con el esquema, los
# roles de mínimo privilegio y las migraciones incluidos. La misma imagen sirve para el servidor (arranque.sh) y para la tarea de
# arranque db-init (aplicar.sh), que crea las bases, aplica las migraciones y sincroniza las claves de los roles con los secretos.
# Las claves no van en la imagen: se leen de /run/secrets.
FROM mcr.microsoft.com/mssql/server:2025-latest
USER root
COPY arranque.sh aplicar.sh /opt/hb/
COPY esquema/ /opt/hb/esquema/
# Directorios legibles/recorribles por el usuario mssql (COPY respeta los permisos del origen)
RUN chmod 755 /opt/hb/arranque.sh /opt/hb/aplicar.sh && chmod -R a+rX /opt/hb
USER mssql
ENTRYPOINT ["/opt/hb/arranque.sh"]
