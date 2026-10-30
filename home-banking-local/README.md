# Home Banking VALO · versión local (SQL Server, sin SSO)

Variante del Home Banking VALO pensada para correr **dentro de la red, sin exposición a internet**:

- **Sin Keycloak / SSO:** los usuarios viven en la base (SQL Server) y se administran desde la aplicación
  (*Usuarios y permisos*): claves con hash scrypt, cambio obligatorio de la clave temporal, OTP opcional por usuario,
  bloqueo por intentos fallidos, link de recupero por correo y auditoría de cada ingreso.
- **Solo local por defecto:** el sitio se publica en `127.0.0.1`. Se puede abrir a la red interna con `HB_ESCUCHA`.
- **Banco real o simulador:** con el banco real el servidor solo *sale* hacia el Banco de Valores; en modo
  `simulador` no hay ninguna salida a internet y el banco se reemplaza por datos ficticios.
- **Instalable sin internet:** `scripts/exportar-imagenes` en una PC conectada, `scripts/importar-imagenes` en el destino.

**Cómo iniciarlo, administrar usuarios y operar: [LEEME-LOCAL.md](LEEME-LOCAL.md).**

```sh
./iniciar.sh               # banco real
./iniciar.sh simulador     # sin internet
./detener.sh
```

Windows: `iniciar.ps1`, `detener.ps1` (PowerShell).

## Estructura

| Carpeta | Contenido |
| --- | --- |
| `backend/` | API (Node 22 + Fastify): usuarios y sesiones (`src/usuarios.js`, `src/auth.js`, `src/routes/sesion.js`), banco, transferencias, auditoría, jobs |
| `frontend/` | SPA (JavaScript sin build) servida por Nginx; pantalla de ingreso propia |
| `db/` | SQL Server 2025: esquema, migraciones (`002_usuarios.sql`) y logins de mínimo privilegio |
| `simulador/` | Simulador del Banco de Valores (solo modo sin internet) |
| `scripts/` | Secretos, usuarios de emergencia, imágenes sin internet, resguardos |
| `docs/` | Documentos de seguridad y continuidad (algunos describen la versión con SSO corporativo) |

## Pruebas

```sh
cd backend && npm test                                  # unitarias (sin base ni banco)
MSSQL_HOST=... MSSQL_PORT=... MSSQL_SA_PASSWORD=... sh test/e2e/correr.sh   # punta a punta contra SQL Server
```
