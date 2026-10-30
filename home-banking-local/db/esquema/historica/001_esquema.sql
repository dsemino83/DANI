-- Base histórica del Home Banking VALO (SQL Server 2025): lo anterior al corte (mes en curso + HB_RETENCION_MESES).
-- Solo lectura para la aplicación; la escribe únicamente el job del pase mensual (rol hb_pase_h, solo inserción).
-- Mismas columnas y tipos que la base operativa para copiar filas sin transformar.
SET NOCOUNT ON;
GO

CREATE TABLE dbo.transferencia (
  id             bigint NOT NULL CONSTRAINT pk_h_transferencia PRIMARY KEY,
  tipo           nvarchar(20) NOT NULL,
  api            nvarchar(128) NOT NULL,
  cuenta_origen  nvarchar(64) NOT NULL,
  moneda         nvarchar(10) NOT NULL,
  destino        nvarchar(200) NOT NULL,
  titular        nvarchar(400) NULL,
  cuit_destino   nvarchar(20) NULL,
  importe        decimal(18, 2) NOT NULL,
  concepto       nvarchar(200) NULL,
  request        nvarchar(max) NOT NULL,
  creador        nvarchar(256) NOT NULL,
  aprobador      nvarchar(256) NULL,
  estado         nvarchar(30) NOT NULL,
  transaction_id nvarchar(128) NULL,
  nro_control    nvarchar(128) NULL,
  respuesta      nvarchar(max) NULL,
  lote_id        bigint NULL,
  referencia     nvarchar(40) NOT NULL,
  creado_en      datetimeoffset(3) NOT NULL,
  aprobado_en    datetimeoffset(3) NULL,
  actualizado_en datetimeoffset(3) NOT NULL
);
CREATE INDEX h_transferencia_origen_idx ON dbo.transferencia (cuenta_origen, creado_en);
CREATE INDEX h_transferencia_trn_idx    ON dbo.transferencia (transaction_id);
CREATE INDEX h_transferencia_creado_idx ON dbo.transferencia (creado_en);

CREATE TABLE dbo.transferencia_estado (
  id               bigint NOT NULL CONSTRAINT pk_h_transferencia_estado PRIMARY KEY,
  transferencia_id bigint NOT NULL,
  estado           nvarchar(30) NOT NULL,
  usuario          nvarchar(256) NOT NULL,
  detalle          nvarchar(max) NULL,
  en               datetimeoffset(3) NOT NULL
);
CREATE INDEX h_transferencia_estado_trn_idx ON dbo.transferencia_estado (transferencia_id);
CREATE INDEX h_transferencia_estado_en_idx  ON dbo.transferencia_estado (en);

CREATE TABLE dbo.auditoria (
  id            bigint NOT NULL CONSTRAINT pk_h_auditoria PRIMARY KEY,
  en            datetimeoffset(3) NOT NULL,
  usuario       nvarchar(256) NOT NULL,
  rol           nvarchar(100) NOT NULL,
  tipo          nvarchar(30) NOT NULL,
  accion        nvarchar(400) NOT NULL,
  api           nvarchar(200) NULL,
  detalle       nvarchar(max) NULL,
  resultado     nvarchar(50) NOT NULL,
  ip            nvarchar(64) NULL,
  ref_tipo      nvarchar(30) NULL,
  ref_id        nvarchar(60) NULL,
  orden         bigint NULL,          -- cadena de hashes de la auditoría (ver esquema operativo)
  hash_anterior nvarchar(64) NULL,
  hash          nvarchar(64) NULL
);
CREATE INDEX h_auditoria_usuario_idx ON dbo.auditoria (usuario, en);
CREATE INDEX h_auditoria_ref_idx     ON dbo.auditoria (ref_tipo, ref_id);
CREATE INDEX h_auditoria_en_idx      ON dbo.auditoria (en);
CREATE INDEX h_auditoria_orden_idx   ON dbo.auditoria (orden);

-- Comprobante de cada pase recibido (copia del registrado en la operativa)
CREATE TABLE dbo.pase_recibido (
  tabla       nvarchar(60) NOT NULL,
  periodo     date NOT NULL,
  filas       bigint NOT NULL,
  hash        nvarchar(64) NOT NULL,
  recibido_en datetimeoffset(3) NOT NULL CONSTRAINT df_pase_recibido_en DEFAULT SYSDATETIMEOFFSET(),
  CONSTRAINT pk_pase_recibido PRIMARY KEY (tabla, periodo)
);

-- Envíos programados de correo: cola, ejecuciones y log, por filas
CREATE TABLE dbo.cola_envio (
  id bigint NOT NULL CONSTRAINT pk_h_cola_envio PRIMARY KEY, programacion_id bigint NULL, programacion nvarchar(400) NOT NULL, turno nvarchar(40) NOT NULL,
  empresa_id bigint NOT NULL, empresa nvarchar(400) NOT NULL, cuentas nvarchar(max) NOT NULL, contenido nvarchar(30) NOT NULL,
  responsable nvarchar(256) NOT NULL, manual bit NOT NULL, estado nvarchar(20) NOT NULL, intentos smallint NOT NULL,
  max_intentos smallint NOT NULL, disponible_en datetimeoffset(3) NOT NULL, encolada_en datetimeoffset(3) NOT NULL,
  tomada_en datetimeoffset(3) NULL, terminada_en datetimeoffset(3) NULL, destinatarios nvarchar(max) NOT NULL, detalle nvarchar(max) NULL,
  formato nvarchar(20) NOT NULL, frecuencia nvarchar(20) NOT NULL, ejecucion_id bigint NULL, consultas_banco int NOT NULL);
CREATE INDEX h_cola_envio_prog_idx ON dbo.cola_envio (programacion_id, encolada_en);

CREATE TABLE dbo.ejecucion_envio (
  id bigint NOT NULL CONSTRAINT pk_h_ejecucion_envio PRIMARY KEY, programacion_id bigint NULL, programacion nvarchar(400) NOT NULL, turno nvarchar(40) NOT NULL,
  frecuencia nvarchar(20) NOT NULL, manual bit NOT NULL, responsable nvarchar(256) NOT NULL, estado nvarchar(20) NOT NULL, tareas int NOT NULL,
  enviadas int NOT NULL, omitidas int NOT NULL, errores int NOT NULL, consultas_banco int NOT NULL, creada_en datetimeoffset(3) NOT NULL,
  terminada_en datetimeoffset(3) NULL);
CREATE INDEX h_ejecucion_envio_prog_idx ON dbo.ejecucion_envio (programacion_id, creada_en);

CREATE TABLE dbo.envio_mail_log (
  id bigint NOT NULL CONSTRAINT pk_h_envio_mail_log PRIMARY KEY, programacion_id bigint NULL, turno nvarchar(40) NOT NULL, empresa_id bigint NULL,
  empresa nvarchar(400) NULL, destinatarios nvarchar(max) NOT NULL, estado nvarchar(10) NOT NULL, detalle nvarchar(max) NULL,
  manual bit NOT NULL, en datetimeoffset(3) NOT NULL);
CREATE INDEX h_envio_mail_log_prog_idx ON dbo.envio_mail_log (programacion_id, en);

-- Buzón de mensajes (solo los ya leídos pasan a la histórica)
CREATE TABLE dbo.mensaje (
  id bigint NOT NULL CONSTRAINT pk_h_mensaje PRIMARY KEY, usuario nvarchar(256) NOT NULL, tipo nvarchar(60) NOT NULL, titulo nvarchar(400) NOT NULL,
  texto nvarchar(max) NOT NULL, empresas nvarchar(max) NOT NULL, ref_tipo nvarchar(30) NULL, ref_id bigint NULL, creado_por nvarchar(256) NOT NULL,
  creado_en datetimeoffset(3) NOT NULL, visto_en datetimeoffset(3) NULL, visto_motivo nvarchar(30) NULL);
CREATE INDEX h_mensaje_usuario_idx ON dbo.mensaje (usuario, creado_en);
GO

-- La base histórica no admite modificaciones ni borrados de lo ya pasado (ni siquiera del dueño)
CREATE TRIGGER dbo.h_auditoria_inmutable ON dbo.auditoria AFTER UPDATE, DELETE AS
BEGIN SET NOCOUNT ON; IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION; THROW 51002, N'La base histórica no admite modificaciones (auditoria)', 1; END;
GO
CREATE TRIGGER dbo.h_transferencia_inmutable ON dbo.transferencia AFTER UPDATE, DELETE AS
BEGIN SET NOCOUNT ON; IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION; THROW 51002, N'La base histórica no admite modificaciones (transferencia)', 1; END;
GO
CREATE TRIGGER dbo.h_transferencia_estado_inmutable ON dbo.transferencia_estado AFTER UPDATE, DELETE AS
BEGIN SET NOCOUNT ON; IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION; THROW 51002, N'La base histórica no admite modificaciones (transferencia_estado)', 1; END;
GO
CREATE TRIGGER dbo.h_cola_envio_inmutable ON dbo.cola_envio AFTER UPDATE, DELETE AS
BEGIN SET NOCOUNT ON; IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION; THROW 51002, N'La base histórica no admite modificaciones (cola_envio)', 1; END;
GO
CREATE TRIGGER dbo.h_ejecucion_envio_inmutable ON dbo.ejecucion_envio AFTER UPDATE, DELETE AS
BEGIN SET NOCOUNT ON; IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION; THROW 51002, N'La base histórica no admite modificaciones (ejecucion_envio)', 1; END;
GO
CREATE TRIGGER dbo.h_envio_mail_log_inmutable ON dbo.envio_mail_log AFTER UPDATE, DELETE AS
BEGIN SET NOCOUNT ON; IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION; THROW 51002, N'La base histórica no admite modificaciones (envio_mail_log)', 1; END;
GO
CREATE TRIGGER dbo.h_mensaje_inmutable ON dbo.mensaje AFTER UPDATE, DELETE AS
BEGIN SET NOCOUNT ON; IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION; THROW 51002, N'La base histórica no admite modificaciones (mensaje)', 1; END;
GO
