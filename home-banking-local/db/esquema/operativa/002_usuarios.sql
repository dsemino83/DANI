-- Usuarios propios del Home Banking (reemplazan al SSO/Keycloak). El backend los administra desde la pestaña
-- "Usuarios y permisos": alta, perfil, roles Crear/Aprobar, habilitación, bloqueo por intentos fallidos, claves y OTP.
-- La clave se guarda como hash scrypt (nunca en claro) y el secreto OTP cifrado con la llave maestra (AES-256-GCM).
SET NOCOUNT ON;
GO

CREATE TABLE dbo.usuario (
  usuario            nvarchar(50)  NOT NULL CONSTRAINT pk_usuario PRIMARY KEY,
  nombre             nvarchar(100) NOT NULL,
  apellido           nvarchar(100) NOT NULL,
  email              nvarchar(200) NOT NULL,
  perfil             nvarchar(20)  NOT NULL CONSTRAINT ck_usuario_perfil CHECK (perfil IN (N'operador', N'autorizante', N'auditor', N'administrador')),
  crear              bit NOT NULL CONSTRAINT df_usuario_crear DEFAULT 0,      -- rol transferencias:crear
  aprobar            bit NOT NULL CONSTRAINT df_usuario_aprobar DEFAULT 0,    -- rol transferencias:aprobar
  habilitado         bit NOT NULL CONSTRAINT df_usuario_habilitado DEFAULT 1,
  clave_hash         nvarchar(300) NOT NULL,                                  -- scrypt$N$r$p$sal$hash
  debe_cambiar_clave bit NOT NULL CONSTRAINT df_usuario_cambiar DEFAULT 1,    -- clave temporal: la cambia en el próximo ingreso
  intentos_fallidos  int NOT NULL CONSTRAINT df_usuario_intentos DEFAULT 0,
  bloqueado_hasta    datetimeoffset(3) NULL,                                  -- bloqueo temporal por intentos fallidos
  otp_requerido      bit NOT NULL CONSTRAINT df_usuario_otp DEFAULT 0,
  otp_confirmado     bit NOT NULL CONSTRAINT df_usuario_otp_conf DEFAULT 0,   -- 0 con secreto cargado = enrolamiento pendiente
  otp_cifrado        varbinary(200) NULL,
  otp_iv             varbinary(12)  NULL,
  otp_tag            varbinary(16)  NULL,
  otp_ultimo_paso    bigint NULL,                                             -- último código usado (no se acepta dos veces)
  version_sesion     int NOT NULL CONSTRAINT df_usuario_version DEFAULT 1,    -- al cambiar, se cierran todas sus sesiones
  reset_hash         varbinary(32) NULL,                                      -- link por correo para elegir clave (SHA-256 del token)
  reset_vence        datetimeoffset(3) NULL,
  ultimo_ingreso     datetimeoffset(3) NULL,
  creado_en          datetimeoffset(3) NOT NULL CONSTRAINT df_usuario_creado DEFAULT SYSDATETIMEOFFSET(),
  actualizado_en     datetimeoffset(3) NOT NULL CONSTRAINT df_usuario_actualizado DEFAULT SYSDATETIMEOFFSET(),
  -- El administrador de seguridad nunca opera: no puede tener Crear ni Aprobar.
  CONSTRAINT ck_usuario_admin_no_opera CHECK (perfil <> N'administrador' OR (crear = 0 AND aprobar = 0)),
  CONSTRAINT ck_usuario_nombre CHECK (usuario = LOWER(usuario) AND LEN(usuario) >= 3)
);
CREATE UNIQUE INDEX ux_usuario_email ON dbo.usuario (email);
GO
