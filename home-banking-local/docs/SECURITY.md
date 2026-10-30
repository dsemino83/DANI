# Seguridad — Home Banking VALO

Resumen del modelo de seguridad **implementado** en el código y la configuración. Lo que depende de
infraestructura externa está marcado como tal (ver `docs/ESTADO-CONTROLES.md`).

## Principios

- **La autorización es siempre server-side.** Nunca se confía en datos del frontend para decidir acceso.
- **El frontend nunca habla con la base de datos.** Solo con el backend (BFF) vía `/api`, detrás de Nginx.
- **Mínimo privilegio** en roles de base de datos, capacidades de contenedor y redes.
- **Secretos fuera de la imagen y del repo**: por archivo (`*_FILE` / Docker secrets).

## Autenticación e identidad

- OIDC contra Keycloak (realm `staff`). El backend valida el JWT (emisor, audiencia, firma vía JWKS) en
  `backend/src/auth.js`. Access token corto; PKCE S256 obligatorio en el cliente público.
- El administrador puede exigir OTP (TOTP) por usuario. Ver `docs/seguridad-iam-keycloak.md`.

## Autorización

- RBAC por rol (operador / autorizante / auditor / administrador) + permiso **por empresa**
  (`permiso_empresa`), aplicado server-side (`exigirRol`, `exigirCrear`, `exigirAprobar`, permisos por cuenta).
- **Doble control**: el creador de una transferencia no puede aprobarla; la aprobación es de otro usuario.
- **Idempotencia financiera**: identificador lógico de operación, `envio_banco` (una sola salida por
  operación), `referencia_usada` (ids únicos) y una máquina de estados con trigger en la base. Doble click /
  refresh / retry no generan una segunda operación.
- **Resultado incierto ⇒ sin reintento automático** (timeout después de enviar: se concilia con
  getTransfersStatus, nunca se reenvía solo).

## Resiliencia del Banco de Valores

- Timeouts en todas las llamadas; separación lectura/envío; sesión compartida con renovación coordinada.
- **Circuit breaker**: con el circuito abierto no sale ninguna transferencia; la prueba de recuperación es
  siempre una lectura. Solo cuentan fallos de disponibilidad (los 4xx no abren el circuito).

## Transporte y cabeceras (Nginx)

- TLS 1.2/1.3. HSTS. CSP estricta (solo scripts propios; `connect-src` al propio origen y al SSO).
- `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`,
  `Cross-Origin-Opener-Policy`. `server_tokens off`.
- Rate limiting por IP en Nginx + límite por usuario en el backend.
- `/api/metrics` **no** se expone al público (Nginx responde 404; Prometheus lo consulta por red interna).

## Logs y datos sensibles

- Nunca se registran tokens, cookies ni `Authorization` (redactados en el logger). CBU/CUIT/cuentas
  enmascarados en las URLs de los logs. La cookie de sesión del banco vive solo en memoria del backend.
- Las métricas y trazas (OTEL) no incluyen datos financieros ni credenciales.

## Hardening de contenedores

- `cap_drop: [ALL]`, `read_only` + tmpfs donde aplica, `mem_limit`/`pids_limit`, `restart`.
- Segmentación de redes: `publica` (frontend), `app`, `datos`, `salida`. Las bases y los servicios internos
  no se exponen al público.

## Auditoría

- Cadena de auditoría con hash encadenado; verificación de integridad (job diario + acción manual en el panel).

## Qué requiere infraestructura (no afirmado como "producción")

Vault/HSM reales, SIEM real, WAF, SQL Server HA, Keycloak HA, multi-región y DR con copia externa inmutable
**no** están desplegados: están documentados/preparados. Ver `docs/ESTADO-CONTROLES.md`,
`docs/VAULT-HSM.md`, `docs/SIEM.md`, `docs/HA-MULTIRREGION.md`, `docs/DISASTER-RECOVERY.md`.
