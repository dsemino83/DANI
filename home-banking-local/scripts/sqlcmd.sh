# Ayudas para hablar con SQL Server dentro del contenedor "sqlserver" (se incluye con ". scripts/sqlcmd.sh").
# La clave de sa se lee del Docker secret dentro del contenedor: nunca pasa por la línea de comandos del host.
# sql_exec "<T-SQL>"            ejecuta una sentencia como sa (aborta si falla; sin encabezados)
# sql_valor "<T-SQL>"           igual, y devuelve la primera columna sin espacios
# sql_contenedor "<comando sh>" corre un comando de shell dentro del contenedor
sql_exec() {
  docker compose exec -T sqlserver sh -c 'SQLCMDPASSWORD=$(cat /run/secrets/db_owner_password) exec /opt/mssql-tools18/bin/sqlcmd -C -S localhost -U sa -b -I -h -1 -W -Q "$1"' sqlcmd "$1"
}
sql_valor() { sql_exec "SET NOCOUNT ON; $1" | grep -v '^Changed database context' | head -1 | tr -d '\r '; }
sql_contenedor() { docker compose exec -T sqlserver sh -c "$1"; }
