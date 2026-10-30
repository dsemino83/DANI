-- Base operativa del Home Banking VALO (SQL Server 2025). Línea base: estado final de todo el esquema.
-- La aplica db/aplicar.sh una sola vez (queda registrada en hb_migracion). Cambios futuros: archivos 002_*.sql, 003_*.sql...
-- Convenciones: texto = nvarchar; fechas con zona = datetimeoffset(3); listas y JSON = nvarchar(max) con ISJSON;
-- booleanos = bit; identificadores = bigint IDENTITY.
SET NOCOUNT ON;
GO

-- Cantidad de elementos de una lista guardada como JSON (reemplaza a cardinality() de los arreglos)
CREATE FUNCTION dbo.hb_json_largo(@j nvarchar(max)) RETURNS int AS
BEGIN
  RETURN (SELECT COUNT(*) FROM OPENJSON(@j));
END;
GO

-- ---------------------------------------------------------------------------
-- Empresas (clientes), cuentas asignadas y permisos por empresa
-- ---------------------------------------------------------------------------
CREATE TABLE dbo.empresa (
  id               bigint IDENTITY(1,1) NOT NULL CONSTRAINT pk_empresa PRIMARY KEY,
  razon_social     nvarchar(400) NOT NULL,
  cuit             nchar(11)     NOT NULL CONSTRAINT uq_empresa_cuit UNIQUE CONSTRAINT ck_empresa_cuit CHECK (cuit LIKE REPLICATE(N'[0-9]', 11)),
  activa           bit           NOT NULL CONSTRAINT df_empresa_activa DEFAULT 1,
  creada_por       nvarchar(256) NOT NULL,
  creada_en        datetimeoffset(3) NOT NULL CONSTRAINT df_empresa_creada DEFAULT SYSDATETIMEOFFSET(),
  emails           nvarchar(max) NOT NULL CONSTRAINT df_empresa_emails DEFAULT N'[]',   -- contactos de la empresa (lista JSON)
  alertas_horarias bit           NOT NULL CONSTRAINT df_empresa_alertas DEFAULT 1,       -- si se apaga: sin alertas por hora / cada 30 min (el extracto diario sigue)
  CONSTRAINT ck_empresa_emails CHECK (ISJSON(emails) = 1 AND dbo.hb_json_largo(emails) <= 20)
);
GO

-- Cuentas (CBU) de cada empresa, con historial: quitar una cuenta no borra la fila, la pasa a estado 'baja'.
-- La base garantiza que un CBU (y una cuenta) tenga a lo sumo UNA relación activa con una empresa.
CREATE TABLE dbo.empresa_cbu (
  id             bigint IDENTITY(1,1) NOT NULL CONSTRAINT pk_empresa_cbu PRIMARY KEY,
  empresa_id     bigint NULL CONSTRAINT fk_empresa_cbu_empresa REFERENCES dbo.empresa(id) ON DELETE SET NULL,
  empresa_cuit   nchar(11) NOT NULL,                 -- copia: se conserva aunque la empresa se elimine
  product_number nvarchar(64) NOT NULL,
  cbu            nchar(22) NULL CONSTRAINT ck_empresa_cbu_cbu CHECK (cbu LIKE REPLICATE(N'[0-9]', 22)),   -- NULL solo en asignaciones anteriores a COELSA
  alias          nvarchar(200) NULL,
  titular        nvarchar(400) NULL,
  cuit_titular   nvarchar(20) NULL,
  moneda         nvarchar(10) NULL,
  coelsa_en      datetimeoffset(3) NULL,
  estado         nvarchar(10) NOT NULL CONSTRAINT df_empresa_cbu_estado DEFAULT N'activa' CONSTRAINT ck_empresa_cbu_estado CHECK (estado IN (N'activa', N'baja')),
  asignada_por   nvarchar(256) NOT NULL,
  asignada_en    datetimeoffset(3) NOT NULL CONSTRAINT df_empresa_cbu_asignada DEFAULT SYSDATETIMEOFFSET(),
  baja_por       nvarchar(256) NULL,
  baja_en        datetimeoffset(3) NULL,
  CONSTRAINT ck_empresa_cbu_empresa CHECK (estado = N'baja' OR empresa_id IS NOT NULL),
  CONSTRAINT ck_empresa_cbu_baja CHECK ((estado = N'baja' AND baja_en IS NOT NULL) OR (estado <> N'baja' AND baja_en IS NULL))
);
CREATE UNIQUE INDEX empresa_cbu_cbu_activa    ON dbo.empresa_cbu (cbu)            WHERE estado = N'activa' AND cbu IS NOT NULL;
CREATE UNIQUE INDEX empresa_cbu_cuenta_activa ON dbo.empresa_cbu (product_number) WHERE estado = N'activa';
CREATE INDEX empresa_cbu_empresa_idx ON dbo.empresa_cbu (empresa_id, estado);
GO

-- usuario = preferred_username del token del SSO.
CREATE TABLE dbo.permiso_empresa (
  usuario    nvarchar(256) NOT NULL,
  empresa_id bigint NOT NULL CONSTRAINT fk_permiso_empresa REFERENCES dbo.empresa(id) ON DELETE CASCADE,
  ver        bit NOT NULL CONSTRAINT df_permiso_ver DEFAULT 0,
  operar     bit NOT NULL CONSTRAINT df_permiso_operar DEFAULT 0,
  CONSTRAINT ck_permiso_operar CHECK (operar = 0 OR ver = 1),
  CONSTRAINT pk_permiso_empresa PRIMARY KEY (usuario, empresa_id)
);

-- Cartera de cada oficial (cargador), definida por un aprobador: si un oficial tiene clientes asignados,
-- solo ve las cuentas de esos clientes (dentro de sus permisos por empresa). Sin filas = ve todas.
CREATE TABLE dbo.cartera_oficial (
  oficial      nvarchar(256) NOT NULL,
  empresa_id   bigint NOT NULL CONSTRAINT fk_cartera_empresa REFERENCES dbo.empresa(id) ON DELETE CASCADE,
  asignado_por nvarchar(256) NOT NULL,
  asignado_en  datetimeoffset(3) NOT NULL CONSTRAINT df_cartera_asignado DEFAULT SYSDATETIMEOFFSET(),
  CONSTRAINT pk_cartera_oficial PRIMARY KEY (oficial, empresa_id)
);

-- Oficiales que reciben las alertas de movimientos por chat de Teams (Power Automate).
CREATE TABLE dbo.oficial_chat (
  oficial         nvarchar(256) NOT NULL CONSTRAINT pk_oficial_chat PRIMARY KEY,
  notificar       bit NOT NULL CONSTRAINT df_oficial_chat_notificar DEFAULT 0,
  actualizado_por nvarchar(256) NULL,
  actualizado_en  datetimeoffset(3) NOT NULL CONSTRAINT df_oficial_chat_act DEFAULT SYSDATETIMEOFFSET()
);
GO

-- ---------------------------------------------------------------------------
-- Credencial API Banking de VALO: una por ambiente y uso (principal | envios, la exclusiva de los envíos programados de
-- correo). La clave va cifrada con AES-256-GCM con la llave maestra que el backend lee de un Docker secret.
-- activa = 0 corta el acceso al banco sin borrar la clave.
-- ---------------------------------------------------------------------------
CREATE TABLE dbo.credencial_api (
  ambiente          nvarchar(10) NOT NULL CONSTRAINT ck_credencial_ambiente CHECK (ambiente IN (N'homo', N'prod')),
  uso               nvarchar(20) NOT NULL CONSTRAINT df_credencial_uso DEFAULT N'principal' CONSTRAINT ck_credencial_uso CHECK (uso IN (N'principal', N'envios')),
  url               nvarchar(400) NOT NULL,
  usuario           nvarchar(256) NOT NULL,
  identification    nvarchar(20) NOT NULL,
  terminal          nvarchar(100) NOT NULL,
  channel           nvarchar(10) NOT NULL CONSTRAINT df_credencial_channel DEFAULT N'3',
  rsa_public_key    nvarchar(max) NOT NULL,                          -- vacía si el banco entrega la clave ya cifrada
  clave_ya_cifrada  bit NOT NULL CONSTRAINT df_credencial_ya DEFAULT 0, -- 1: la clave guardada es el texto cifrado RSA (base64) y se envía tal cual
  clave_cifrada     varbinary(max) NOT NULL,
  clave_iv          varbinary(64) NOT NULL,
  clave_tag         varbinary(64) NOT NULL,
  clave_cargada_por nvarchar(256) NOT NULL,
  clave_cargada_en  datetimeoffset(3) NOT NULL,
  actualizado_por   nvarchar(256) NOT NULL,
  actualizado_en    datetimeoffset(3) NOT NULL CONSTRAINT df_credencial_act DEFAULT SYSDATETIMEOFFSET(),
  activa            bit NOT NULL CONSTRAINT df_credencial_activa DEFAULT 1,
  CONSTRAINT pk_credencial_api PRIMARY KEY (ambiente, uso)
);
GO

-- ---------------------------------------------------------------------------
-- Lotes de carga masiva
-- ---------------------------------------------------------------------------
CREATE TABLE dbo.lote (
  id          bigint IDENTITY(1,1) NOT NULL CONSTRAINT pk_lote PRIMARY KEY,
  archivo     nvarchar(400) NOT NULL,
  formato     nvarchar(10) NOT NULL CONSTRAINT ck_lote_formato CHECK (formato IN (N'CSV', N'XLSX', N'TXT')),
  filas       int NOT NULL,
  validas     int NOT NULL,
  con_error   int NOT NULL,
  importe     decimal(18, 2) NOT NULL CONSTRAINT df_lote_importe DEFAULT 0,
  estado      nvarchar(30) NOT NULL CONSTRAINT ck_lote_estado CHECK (estado IN (N'PREVIA', N'PENDIENTE_APROBACION', N'RECHAZADO', N'PROCESADO', N'DESCARTADO')),
  creador     nvarchar(256) NOT NULL,
  aprobador   nvarchar(256) NULL,
  creado_en   datetimeoffset(3) NOT NULL CONSTRAINT df_lote_creado DEFAULT SYSDATETIMEOFFSET(),
  aprobado_en datetimeoffset(3) NULL,
  CONSTRAINT ck_lote_aprobador CHECK (aprobador IS NULL OR aprobador <> creador)
);

CREATE TABLE dbo.lote_fila (
  lote_id    bigint NOT NULL CONSTRAINT fk_lote_fila_lote REFERENCES dbo.lote(id) ON DELETE CASCADE,
  fila       int NOT NULL,
  datos      nvarchar(max) NOT NULL CONSTRAINT ck_lote_fila_datos CHECK (ISJSON(datos) = 1),
  validacion nvarchar(max) NOT NULL,
  CONSTRAINT pk_lote_fila PRIMARY KEY (lote_id, fila)
);
GO

-- ---------------------------------------------------------------------------
-- Transferencias, historial de estados y auditoría. Lo anterior al corte (mes en curso + HB_RETENCION_MESES) pasa
-- por filas a la base histórica el día 1 de cada mes (job del pase) y se borra de acá solo después de verificarlo.
-- ---------------------------------------------------------------------------
CREATE TABLE dbo.transferencia (
  id             bigint IDENTITY(1,1) NOT NULL CONSTRAINT pk_transferencia PRIMARY KEY,
  tipo           nvarchar(20) NOT NULL CONSTRAINT ck_transferencia_tipo CHECK (tipo IN (N'INMEDIATA', N'PROPIAS', N'TERCEROS', N'MEP')),
  api            nvarchar(128) NOT NULL,
  cuenta_origen  nvarchar(64) NOT NULL,
  moneda         nvarchar(10) NOT NULL,
  destino        nvarchar(200) NOT NULL,
  titular        nvarchar(400) NULL,
  cuit_destino   nvarchar(20) NULL,
  importe        decimal(18, 2) NOT NULL CONSTRAINT ck_transferencia_importe CHECK (importe > 0),
  concepto       nvarchar(200) NULL,
  request        nvarchar(max) NOT NULL CONSTRAINT ck_transferencia_request CHECK (ISJSON(request) = 1),
  creador        nvarchar(256) NOT NULL,
  aprobador      nvarchar(256) NULL,
  estado         nvarchar(30) NOT NULL CONSTRAINT ck_transferencia_estado CHECK (estado IN (N'PENDIENTE_APROBACION', N'EN_COLA', N'RECHAZADA', N'ENVIANDO', N'ENVIADA',
                                                                                              N'PEND_AUTORIZACION', N'DEBITADA', N'RECHAZADA_BANCO', N'ERROR_API')),
  transaction_id nvarchar(128) NULL,
  nro_control    nvarchar(128) NULL,
  respuesta      nvarchar(max) NULL CONSTRAINT ck_transferencia_respuesta CHECK (respuesta IS NULL OR ISJSON(respuesta) = 1),
  lote_id        bigint NULL,
  referencia     nvarchar(40) NOT NULL,                       -- ID de la operación (único, ver referencia_usada)
  creado_en      datetimeoffset(3) NOT NULL CONSTRAINT df_transferencia_creado DEFAULT SYSDATETIMEOFFSET(),
  aprobado_en    datetimeoffset(3) NULL,
  actualizado_en datetimeoffset(3) NOT NULL CONSTRAINT df_transferencia_act DEFAULT SYSDATETIMEOFFSET(),
  CONSTRAINT ck_transferencia_aprobador CHECK (aprobador IS NULL OR aprobador <> creador)   -- nadie aprueba lo que cargó
);
CREATE INDEX transferencia_estado_idx    ON dbo.transferencia (estado);
CREATE INDEX transferencia_cola_pago_idx ON dbo.transferencia (api, creado_en) WHERE estado = N'EN_COLA';   -- motor de pagos
CREATE INDEX transferencia_origen_idx    ON dbo.transferencia (cuenta_origen, creado_en);
CREATE INDEX transferencia_creado_idx    ON dbo.transferencia (creado_en);
CREATE INDEX transferencia_lote_idx      ON dbo.transferencia (lote_id);
CREATE INDEX transferencia_trn_idx       ON dbo.transferencia (transaction_id);

CREATE TABLE dbo.transferencia_estado (
  id               bigint IDENTITY(1,1) NOT NULL CONSTRAINT pk_transferencia_estado PRIMARY KEY,
  transferencia_id bigint NOT NULL,
  estado           nvarchar(30) NOT NULL,
  usuario          nvarchar(256) NOT NULL,
  detalle          nvarchar(max) NULL,
  en               datetimeoffset(3) NOT NULL CONSTRAINT df_transferencia_estado_en DEFAULT SYSDATETIMEOFFSET()
);
CREATE INDEX transferencia_estado_trn_idx ON dbo.transferencia_estado (transferencia_id);
CREATE INDEX transferencia_estado_en_idx  ON dbo.transferencia_estado (en);

-- Auditoría: cada registro lleva el SHA-256 de su contenido encadenado con el del anterior (ver más abajo).
-- El id lo asigna el trigger auditoria_encadenar (INSTEAD OF INSERT) desde una secuencia, porque el id forma parte del hash.
CREATE SEQUENCE dbo.seq_auditoria AS bigint START WITH 1 INCREMENT BY 1 CACHE 100;
CREATE TABLE dbo.auditoria (
  id            bigint NOT NULL CONSTRAINT df_auditoria_id DEFAULT 0 CONSTRAINT pk_auditoria PRIMARY KEY,
  en            datetimeoffset(3) NOT NULL CONSTRAINT df_auditoria_en DEFAULT SYSDATETIMEOFFSET(),
  usuario       nvarchar(256) NOT NULL,
  rol           nvarchar(100) NOT NULL,
  tipo          nvarchar(30) NOT NULL CONSTRAINT ck_auditoria_tipo CHECK (tipo IN (N'Transferencias', N'Administración', N'Accesos', N'Consultas', N'Sistema')),
  accion        nvarchar(400) NOT NULL,
  api           nvarchar(200) NULL,
  detalle       nvarchar(max) NULL,
  resultado     nvarchar(50) NOT NULL,
  ip            nvarchar(64) NULL,
  ref_tipo      nvarchar(30) NULL,     -- 'transferencia' | 'lote' | 'empresa' | ...
  ref_id        nvarchar(60) NULL,
  orden         bigint NULL,
  hash_anterior nvarchar(64) NULL,
  hash          nvarchar(64) NULL
);
CREATE INDEX auditoria_usuario_idx ON dbo.auditoria (usuario, en);
CREATE INDEX auditoria_ref_idx     ON dbo.auditoria (ref_tipo, ref_id);
CREATE INDEX auditoria_en_idx      ON dbo.auditoria (en);
CREATE INDEX auditoria_orden_idx   ON dbo.auditoria (orden);

-- Cabeza de la cadena: una sola fila. Su bloqueo serializa las inserciones de auditoría.
CREATE TABLE dbo.auditoria_cadena (
  id           smallint NOT NULL CONSTRAINT df_cadena_id DEFAULT 1 CONSTRAINT pk_auditoria_cadena PRIMARY KEY CONSTRAINT ck_cadena_id CHECK (id = 1),
  ultimo_orden bigint NOT NULL CONSTRAINT df_cadena_orden DEFAULT 0,
  ultimo_hash  nvarchar(64) NOT NULL CONSTRAINT df_cadena_hash DEFAULT N'GENESIS',
  actualizado  datetimeoffset(3) NOT NULL CONSTRAINT df_cadena_act DEFAULT SYSDATETIMEOFFSET()
);
INSERT INTO dbo.auditoria_cadena (id) VALUES (1);

-- Vínculo débito informado por el banco <-> transferencia que lo originó
CREATE TABLE dbo.debito_transferencia (
  movimiento_id    nvarchar(128) NOT NULL CONSTRAINT pk_debito_transferencia PRIMARY KEY,
  cuenta           nvarchar(64) NOT NULL,
  transferencia_id bigint NOT NULL,
  conciliado_en    datetimeoffset(3) NOT NULL CONSTRAINT df_debito_conciliado DEFAULT SYSDATETIMEOFFSET()
);

-- Registro de cada pase mensual a la base histórica
CREATE TABLE dbo.pase_historico (
  id           bigint IDENTITY(1,1) NOT NULL CONSTRAINT pk_pase_historico PRIMARY KEY,
  tabla        nvarchar(60) NOT NULL,
  periodo      date NOT NULL,
  filas        bigint NULL,
  hash         nvarchar(64) NULL,
  estado       nvarchar(10) NOT NULL CONSTRAINT ck_pase_estado CHECK (estado IN (N'OK', N'ERROR', N'OMITIDO')),
  detalle      nvarchar(max) NULL,
  ejecutado_en datetimeoffset(3) NOT NULL CONSTRAINT df_pase_ejecutado DEFAULT SYSDATETIMEOFFSET()
);

-- Nunca dos envíos al banco por la misma operación (independiente del código).
-- envio_banco: una fila por transferencia, insertada y confirmada ANTES de llamar a la API. La clave primaria impide un
-- segundo envío aunque fallen todas las demás validaciones. Solo inserción; no pasa a la histórica.
CREATE TABLE dbo.envio_banco (
  transferencia_id bigint NOT NULL CONSTRAINT pk_envio_banco PRIMARY KEY,
  api              nvarchar(128) NOT NULL,
  aprobador        nvarchar(256) NOT NULL,
  iniciado_en      datetimeoffset(3) NOT NULL CONSTRAINT df_envio_iniciado DEFAULT SYSDATETIMEOFFSET()
);

-- ID de operación: una transferencia por ID, para siempre. Solo inserción y fuera del pase histórico.
CREATE TABLE dbo.referencia_usada (
  referencia       nvarchar(40) NOT NULL CONSTRAINT pk_referencia_usada PRIMARY KEY
                   CONSTRAINT ck_referencia_formato CHECK (REGEXP_LIKE(referencia, N'^[A-Z0-9][A-Z0-9._/-]{0,39}$', 'c')),
  transferencia_id bigint NOT NULL CONSTRAINT uq_referencia_transferencia UNIQUE,
  creador          nvarchar(256) NOT NULL,
  creado_en        datetimeoffset(3) NOT NULL CONSTRAINT df_referencia_creado DEFAULT SYSDATETIMEOFFSET()
);
GO

-- ---------------------------------------------------------------------------
-- Envíos programados de correo a las empresas, feriados, cola, ejecuciones y buzón de mensajes
-- ---------------------------------------------------------------------------
-- Feriados: de fuentes públicas (sincronizados) o cargados a mano (p. ej. Día del Bancario).
CREATE TABLE dbo.feriado (
  fecha          date NOT NULL CONSTRAINT pk_feriado PRIMARY KEY,
  nombre         nvarchar(400) NOT NULL,
  tipo           nvarchar(100) NULL,
  fuente         nvarchar(50) NOT NULL,          -- 'argentinadatos' | 'nolaborables' | 'manual' | 'respaldo' | 'base'
  actualizado_en datetimeoffset(3) NOT NULL CONSTRAINT df_feriado_act DEFAULT SYSDATETIMEOFFSET()
);

-- Programación: qué se envía, a quién y cuándo (hora de Argentina, UTC-3).
CREATE TABLE dbo.programacion_envio (
  id              bigint IDENTITY(1,1) NOT NULL CONSTRAINT pk_programacion_envio PRIMARY KEY,
  nombre          nvarchar(400) NOT NULL,
  contenido       nvarchar(30) NOT NULL CONSTRAINT ck_programacion_contenido CHECK (contenido IN (N'saldos', N'movimientos', N'saldos_movimientos')),
  todas_empresas  bit NOT NULL CONSTRAINT df_programacion_todas DEFAULT 1,
  empresas        nvarchar(max) NOT NULL CONSTRAINT df_programacion_empresas DEFAULT N'[]' CONSTRAINT ck_programacion_empresas CHECK (ISJSON(empresas) = 1),
  frecuencia      nvarchar(20) NOT NULL CONSTRAINT ck_programacion_frecuencia CHECK (frecuencia IN (N'diaria', N'horaria', N'media_hora')),
  hora            time(0) NOT NULL,              -- diaria: hora del envío; horaria: primer envío del día
  hora_hasta      time(0) NULL,                  -- horaria: último envío del día
  dias_semana     nvarchar(100) NOT NULL CONSTRAINT df_programacion_dias DEFAULT N'[1,2,3,4,5]' CONSTRAINT ck_programacion_dias CHECK (ISJSON(dias_semana) = 1),   -- 1 = lunes … 7 = domingo
  saltar_feriados bit NOT NULL CONSTRAINT df_programacion_feriados DEFAULT 1,
  fecha_inicio    date NOT NULL,
  fecha_fin       date NULL,
  activa          bit NOT NULL CONSTRAINT df_programacion_activa DEFAULT 1,
  ultimo_turno    nvarchar(40) NULL,             -- 'AAAA-MM-DDTHH:MM' del último turno ejecutado (evita duplicados)
  creada_por      nvarchar(256) NOT NULL,
  creada_en       datetimeoffset(3) NOT NULL CONSTRAINT df_programacion_creada DEFAULT SYSDATETIMEOFFSET(),
  actualizada_por nvarchar(256) NULL,
  actualizada_en  datetimeoffset(3) NULL,
  destinos        nvarchar(max) NOT NULL CONSTRAINT df_programacion_destinos DEFAULT N'[]' CONSTRAINT ck_programacion_destinos_json CHECK (ISJSON(destinos) = 1),   -- [{"empresaId": 1, "cuentas": []}]
  formato         nvarchar(20) NOT NULL CONSTRAINT df_programacion_formato DEFAULT N'cuerpo' CONSTRAINT ck_programacion_formato CHECK (formato IN (N'cuerpo', N'cuerpo_excel')),
  CONSTRAINT ck_programacion_horas CHECK (frecuencia = N'diaria' OR (hora_hasta IS NOT NULL AND hora_hasta >= hora)),
  CONSTRAINT ck_programacion_fechas CHECK (fecha_fin IS NULL OR fecha_fin >= fecha_inicio),
  CONSTRAINT programacion_destinos CHECK (todas_empresas = 1 OR (destinos <> N'[]' AND destinos <> N''))
);

-- Resultado de cada envío por empresa (solo inserción).
CREATE TABLE dbo.envio_mail_log (
  id              bigint IDENTITY(1,1) NOT NULL CONSTRAINT pk_envio_mail_log PRIMARY KEY,
  programacion_id bigint NULL CONSTRAINT fk_mail_log_prog REFERENCES dbo.programacion_envio(id) ON DELETE SET NULL,
  turno           nvarchar(40) NOT NULL,
  empresa_id      bigint NULL,
  empresa         nvarchar(400) NULL,
  destinatarios   nvarchar(max) NOT NULL CONSTRAINT df_mail_log_dest DEFAULT N'[]' CONSTRAINT ck_mail_log_dest CHECK (ISJSON(destinatarios) = 1),
  estado          nvarchar(10) NOT NULL CONSTRAINT ck_mail_log_estado CHECK (estado IN (N'enviado', N'error', N'omitido')),
  detalle         nvarchar(max) NULL,
  manual          bit NOT NULL CONSTRAINT df_mail_log_manual DEFAULT 0,
  en              datetimeoffset(3) NOT NULL CONSTRAINT df_mail_log_en DEFAULT SYSDATETIMEOFFSET()
);
CREATE INDEX envio_mail_log_prog_idx ON dbo.envio_mail_log (programacion_id, en DESC);

-- Cada ejecución (un turno de una programación, o "Ejecutar ahora") tiene un id transaccional (EJ-000123) que agrupa
-- sus tareas de la cola y lleva sus totales.
CREATE TABLE dbo.ejecucion_envio (
  id              bigint IDENTITY(1,1) NOT NULL CONSTRAINT pk_ejecucion_envio PRIMARY KEY,
  programacion_id bigint NULL CONSTRAINT fk_ejecucion_prog REFERENCES dbo.programacion_envio(id) ON DELETE SET NULL,
  programacion    nvarchar(400) NOT NULL,
  turno           nvarchar(40) NOT NULL,
  frecuencia      nvarchar(20) NOT NULL,
  manual          bit NOT NULL CONSTRAINT df_ejecucion_manual DEFAULT 0,
  responsable     nvarchar(256) NOT NULL,
  estado          nvarchar(20) NOT NULL CONSTRAINT df_ejecucion_estado DEFAULT N'en_curso' CONSTRAINT ck_ejecucion_estado CHECK (estado IN (N'en_curso', N'terminada')),
  tareas          int NOT NULL CONSTRAINT df_ejecucion_tareas DEFAULT 0,
  enviadas        int NOT NULL CONSTRAINT df_ejecucion_enviadas DEFAULT 0,
  omitidas        int NOT NULL CONSTRAINT df_ejecucion_omitidas DEFAULT 0,
  errores         int NOT NULL CONSTRAINT df_ejecucion_errores DEFAULT 0,
  consultas_banco int NOT NULL CONSTRAINT df_ejecucion_consultas DEFAULT 0,   -- llamadas reales al banco (sin contar las resueltas desde la caché)
  creada_en       datetimeoffset(3) NOT NULL CONSTRAINT df_ejecucion_creada DEFAULT SYSDATETIMEOFFSET(),
  terminada_en    datetimeoffset(3) NULL
);
CREATE UNIQUE INDEX ejecucion_envio_turno_uq ON dbo.ejecucion_envio (programacion_id, turno) WHERE programacion_id IS NOT NULL;
CREATE INDEX ejecucion_envio_prog_idx ON dbo.ejecucion_envio (programacion_id, creada_en DESC);

-- Cola: el programador encola; un único trabajador toma de a una tarea (UPDLOCK, READPAST), así los procesos no se
-- superponen. Cada tarea termina en el envío de un correo; si falla se reintenta.
CREATE TABLE dbo.cola_envio (
  id              bigint IDENTITY(1,1) NOT NULL CONSTRAINT pk_cola_envio PRIMARY KEY,
  programacion_id bigint NULL CONSTRAINT fk_cola_prog REFERENCES dbo.programacion_envio(id) ON DELETE SET NULL,
  programacion    nvarchar(400) NOT NULL,
  turno           nvarchar(40) NOT NULL,
  empresa_id      bigint NOT NULL,
  empresa         nvarchar(400) NOT NULL,
  cuentas         nvarchar(max) NOT NULL CONSTRAINT df_cola_cuentas DEFAULT N'[]' CONSTRAINT ck_cola_cuentas CHECK (ISJSON(cuentas) = 1),   -- vacío = todas las cuentas activas del cliente
  contenido       nvarchar(30) NOT NULL,
  responsable     nvarchar(256) NOT NULL,                  -- aprobador cuyos permisos se aplican al enviar
  manual          bit NOT NULL CONSTRAINT df_cola_manual DEFAULT 0,
  estado          nvarchar(20) NOT NULL CONSTRAINT df_cola_estado DEFAULT N'pendiente' CONSTRAINT ck_cola_estado CHECK (estado IN (N'pendiente', N'procesando', N'enviado', N'error', N'omitido')),
  intentos        smallint NOT NULL CONSTRAINT df_cola_intentos DEFAULT 0,
  max_intentos    smallint NOT NULL CONSTRAINT df_cola_max DEFAULT 3,
  disponible_en   datetimeoffset(3) NOT NULL CONSTRAINT df_cola_disponible DEFAULT SYSDATETIMEOFFSET(),
  encolada_en     datetimeoffset(3) NOT NULL CONSTRAINT df_cola_encolada DEFAULT SYSDATETIMEOFFSET(),
  tomada_en       datetimeoffset(3) NULL,
  terminada_en    datetimeoffset(3) NULL,
  destinatarios   nvarchar(max) NOT NULL CONSTRAINT df_cola_dest DEFAULT N'[]' CONSTRAINT ck_cola_dest CHECK (ISJSON(destinatarios) = 1),
  detalle         nvarchar(max) NULL,
  formato         nvarchar(20) NOT NULL CONSTRAINT df_cola_formato DEFAULT N'cuerpo',
  frecuencia      nvarchar(20) NOT NULL CONSTRAINT df_cola_frecuencia DEFAULT N'diaria',   -- diaria = extracto; horaria / media_hora = alerta de movimientos
  ejecucion_id    bigint NULL,
  consultas_banco int NOT NULL CONSTRAINT df_cola_consultas DEFAULT 0
);
CREATE UNIQUE INDEX cola_envio_turno_uq ON dbo.cola_envio (programacion_id, turno, empresa_id) WHERE programacion_id IS NOT NULL;  -- un turno no se encola dos veces para el mismo cliente
CREATE INDEX cola_envio_pendientes_idx ON dbo.cola_envio (disponible_en, id) WHERE estado = N'pendiente';
CREATE INDEX cola_envio_prog_idx ON dbo.cola_envio (programacion_id, encolada_en DESC);
CREATE INDEX cola_envio_ejecucion_idx ON dbo.cola_envio (ejecucion_id);

-- Buzón de mensajes: avisos a las personas asociadas a un cliente (permiso Ver) cuando se carga una operación que necesita
-- autorización. visto_en = cuando el destinatario lo leyó.
CREATE TABLE dbo.mensaje (
  id          bigint IDENTITY(1,1) NOT NULL CONSTRAINT pk_mensaje PRIMARY KEY,
  usuario     nvarchar(256) NOT NULL,                 -- destinatario (preferred_username del SSO)
  tipo        nvarchar(60) NOT NULL CONSTRAINT df_mensaje_tipo DEFAULT N'autorizacion_pendiente',
  titulo      nvarchar(400) NOT NULL,
  texto       nvarchar(max) NOT NULL,
  empresas    nvarchar(max) NOT NULL CONSTRAINT df_mensaje_empresas DEFAULT N'[]' CONSTRAINT ck_mensaje_empresas CHECK (ISJSON(empresas) = 1),   -- clientes involucrados (razón social)
  ref_tipo    nvarchar(30) NULL,                      -- 'transferencia' | 'lote'
  ref_id      bigint NULL,
  creado_por  nvarchar(256) NOT NULL,
  creado_en   datetimeoffset(3) NOT NULL CONSTRAINT df_mensaje_creado DEFAULT SYSDATETIMEOFFSET(),
  visto_en    datetimeoffset(3) NULL,
  visto_motivo nvarchar(30) NULL                      -- 'leido' | 'operacion_resuelta'
);
CREATE INDEX mensaje_usuario_idx ON dbo.mensaje (usuario, creado_en DESC);
CREATE INDEX mensaje_no_vistos_idx ON dbo.mensaje (usuario) WHERE visto_en IS NULL;
GO

-- ---------------------------------------------------------------------------
-- Inmutabilidad: auditoría, historial de estados, envio_banco y referencia_usada son de solo inserción.
-- La aplicación ni siquiera tiene permiso de UPDATE/DELETE (ver roles); el trigger es la segunda barrera y cubre también
-- al dueño. Solo el rol del pase (hb_pase) puede BORRAR auditoría y estados, y únicamente después de copiarlos a la
-- histórica. El ROLLBACK deshace la sentencia (un THROW dentro de un trigger no la revierte solo).
-- ---------------------------------------------------------------------------
CREATE TRIGGER dbo.auditoria_inmutable ON dbo.auditoria AFTER UPDATE, DELETE AS
BEGIN
  SET NOCOUNT ON;
  IF EXISTS (SELECT 1 FROM inserted) OR USER_NAME() <> N'hb_pase'
  BEGIN
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    THROW 51000, N'La tabla auditoria es de solo inserción', 1;
  END;
END;
GO
CREATE TRIGGER dbo.transferencia_estado_inmutable ON dbo.transferencia_estado AFTER UPDATE, DELETE AS
BEGIN
  SET NOCOUNT ON;
  IF EXISTS (SELECT 1 FROM inserted) OR USER_NAME() <> N'hb_pase'
  BEGIN
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    THROW 51000, N'La tabla transferencia_estado es de solo inserción', 1;
  END;
END;
GO
CREATE TRIGGER dbo.envio_banco_inmutable ON dbo.envio_banco AFTER UPDATE, DELETE AS
BEGIN
  SET NOCOUNT ON;
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW 51000, N'La tabla envio_banco es de solo inserción', 1;
END;
GO
CREATE TRIGGER dbo.referencia_usada_inmutable ON dbo.referencia_usada AFTER UPDATE, DELETE AS
BEGIN
  SET NOCOUNT ON;
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW 51000, N'La tabla referencia_usada es de solo inserción', 1;
END;
GO

-- Circuito de estados: ninguna transferencia retrocede ni salta etapas
-- (PENDIENTE_APROBACION → EN_COLA → ENVIANDO → final).
CREATE TRIGGER dbo.transferencia_transicion ON dbo.transferencia AFTER UPDATE AS
BEGIN
  SET NOCOUNT ON;
  IF NOT UPDATE(estado) RETURN;
  DECLARE @malo nvarchar(400);
  SELECT TOP (1) @malo = CONCAT(N'Transición de estado no permitida para OP-', d.id, N': ', d.estado, N' -> ', i.estado)
    FROM inserted i JOIN deleted d ON d.id = i.id
   WHERE i.estado <> d.estado
     AND NOT EXISTS (SELECT 1 FROM (VALUES
       (N'PENDIENTE_APROBACION', N'EN_COLA'), (N'PENDIENTE_APROBACION', N'RECHAZADA'),
       (N'EN_COLA', N'ENVIANDO'),
       (N'ENVIANDO', N'ENVIADA'), (N'ENVIANDO', N'PEND_AUTORIZACION'), (N'ENVIANDO', N'DEBITADA'),
       (N'ENVIANDO', N'ERROR_API'), (N'ENVIANDO', N'RECHAZADA_BANCO'),
       (N'ENVIADA', N'PEND_AUTORIZACION'), (N'ENVIADA', N'DEBITADA'), (N'ENVIADA', N'RECHAZADA_BANCO'), (N'ENVIADA', N'ERROR_API'),
       (N'PEND_AUTORIZACION', N'DEBITADA'), (N'PEND_AUTORIZACION', N'RECHAZADA_BANCO')) v(de, a)
       WHERE v.de = d.estado AND v.a = i.estado);
  IF @malo IS NOT NULL
  BEGIN
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    THROW 51001, @malo, 1;
  END;
END;
GO

-- ---------------------------------------------------------------------------
-- Auditoría a prueba de manipulación: hash SHA-256 de cada registro encadenado con el del anterior (orden de inserción).
-- Modificar, borrar o intercalar un registro rompe la cadena y la verificación (servicios/integridad.js) lo detecta.
-- ---------------------------------------------------------------------------
-- Texto canónico de un registro (el mismo que recalcula la verificación)
CREATE FUNCTION dbo.hb_auditoria_canonico(@orden bigint, @id bigint, @en datetimeoffset(3), @usuario nvarchar(256), @rol nvarchar(100), @tipo nvarchar(30),
  @accion nvarchar(400), @api nvarchar(200), @detalle nvarchar(max), @resultado nvarchar(50), @ip nvarchar(64), @ref_tipo nvarchar(30), @ref_id nvarchar(60),
  @hash_anterior nvarchar(64)) RETURNS nvarchar(max) AS
BEGIN
  RETURN CONCAT_WS(N'|', @orden, @id, CONVERT(varchar(27), CAST(@en AT TIME ZONE 'UTC' AS datetime2(6)), 126), @usuario, @rol, @tipo, @accion,
    COALESCE(@api, N''), COALESCE(@detalle, N''), @resultado, COALESCE(@ip, N''), COALESCE(@ref_tipo, N''), COALESCE(@ref_id, N''), @hash_anterior);
END;
GO
-- SHA-256 en hexadecimal minúscula del texto codificado en UTF-8
CREATE FUNCTION dbo.hb_sha256(@texto nvarchar(max)) RETURNS nvarchar(64) AS
BEGIN
  RETURN LOWER(CONVERT(varchar(64), HASHBYTES('SHA2_256', CONVERT(varbinary(max), CAST(@texto AS varchar(max)) COLLATE Latin1_General_100_CI_AS_SC_UTF8)), 2));
END;
GO
-- INSTEAD OF INSERT: asigna id y encadena. Se ejecuta con los permisos del dueño (cadena de propiedad): la aplicación no puede
-- escribir la cabeza de la cadena (auditoria_cadena), solo este trigger al insertar.
CREATE TRIGGER dbo.auditoria_encadenar ON dbo.auditoria INSTEAD OF INSERT AS
BEGIN
  SET NOCOUNT ON;
  DECLARE @n int = (SELECT COUNT(*) FROM inserted);
  IF @n = 0 RETURN;
  SELECT IDENTITY(int, 1, 1) AS rn, en, usuario, rol, tipo, accion, api, detalle, resultado, ip, ref_tipo, ref_id
    INTO #nuevas FROM inserted;
  DECLARE @orden bigint, @prev nvarchar(64);
  SELECT @orden = ultimo_orden, @prev = ultimo_hash FROM dbo.auditoria_cadena WITH (UPDLOCK, HOLDLOCK) WHERE id = 1;   -- se libera al terminar la transacción
  DECLARE @i int = 1, @id bigint, @en datetimeoffset(3), @usuario nvarchar(256), @rol nvarchar(100), @tipo nvarchar(30), @accion nvarchar(400), @api nvarchar(200),
          @detalle nvarchar(max), @resultado nvarchar(50), @ip nvarchar(64), @ref_tipo nvarchar(30), @ref_id nvarchar(60), @hash nvarchar(64);
  WHILE @i <= @n
  BEGIN
    SELECT @en = en, @usuario = usuario, @rol = rol, @tipo = tipo, @accion = accion, @api = api, @detalle = detalle, @resultado = resultado,
           @ip = ip, @ref_tipo = ref_tipo, @ref_id = ref_id FROM #nuevas WHERE rn = @i;
    SET @id = NEXT VALUE FOR dbo.seq_auditoria;
    SET @orden += 1;
    SET @hash = dbo.hb_sha256(dbo.hb_auditoria_canonico(@orden, @id, @en, @usuario, @rol, @tipo, @accion, @api, @detalle, @resultado, @ip, @ref_tipo, @ref_id, @prev));
    INSERT INTO dbo.auditoria (id, en, usuario, rol, tipo, accion, api, detalle, resultado, ip, ref_tipo, ref_id, orden, hash_anterior, hash)
    VALUES (@id, @en, @usuario, @rol, @tipo, @accion, @api, @detalle, @resultado, @ip, @ref_tipo, @ref_id, @orden, @prev, @hash);
    SET @prev = @hash;
    SET @i += 1;
  END;
  UPDATE dbo.auditoria_cadena SET ultimo_orden = @orden, ultimo_hash = @prev, actualizado = SYSDATETIMEOFFSET() WHERE id = 1;
END;
GO
