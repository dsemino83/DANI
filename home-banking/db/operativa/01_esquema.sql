-- Base operativa del Home Banking VALO: últimos 3 meses, particionada por mes.
-- La ejecuta el entrypoint de Postgres una sola vez, como dueño de la base.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- Empresas (clientes), cuentas asignadas y permisos por empresa
-- ---------------------------------------------------------------------------
CREATE TABLE empresa (
  id            bigserial PRIMARY KEY,
  razon_social  text        NOT NULL,
  cuit          char(11)    NOT NULL UNIQUE CHECK (cuit ~ '^[0-9]{11}$'),
  activa        boolean     NOT NULL DEFAULT true,
  creada_por    text        NOT NULL,
  creada_en     timestamptz NOT NULL DEFAULT now()
);

-- Una cuenta pertenece a una sola empresa; empresa_id NULL = sin asignar.
CREATE TABLE cuenta_empresa (
  product_number text PRIMARY KEY,
  empresa_id     bigint REFERENCES empresa(id) ON DELETE SET NULL,
  asignada_por   text,
  asignada_en    timestamptz
);
CREATE INDEX cuenta_empresa_empresa_idx ON cuenta_empresa (empresa_id);

-- usuario = preferred_username del token del SSO.
CREATE TABLE permiso_empresa (
  usuario     text   NOT NULL,
  empresa_id  bigint NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
  ver         boolean NOT NULL DEFAULT false,
  operar      boolean NOT NULL DEFAULT false,
  CHECK (NOT operar OR ver),
  PRIMARY KEY (usuario, empresa_id)
);

-- ---------------------------------------------------------------------------
-- Credencial API Banking (única, de VALO). La clave va cifrada con AES-256-GCM
-- usando la llave maestra que el backend lee de un Docker secret.
-- ---------------------------------------------------------------------------
CREATE TABLE credencial_api (
  ambiente          text PRIMARY KEY CHECK (ambiente IN ('homo', 'prod')),
  url               text NOT NULL,
  usuario           text NOT NULL,
  identification    text NOT NULL,
  terminal          text NOT NULL,
  channel           text NOT NULL DEFAULT '3',
  rsa_public_key    text NOT NULL,
  clave_cifrada     bytea NOT NULL,
  clave_iv          bytea NOT NULL,
  clave_tag         bytea NOT NULL,
  clave_cargada_por text NOT NULL,
  clave_cargada_en  timestamptz NOT NULL,
  actualizado_por   text NOT NULL,
  actualizado_en    timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Lotes de carga masiva
-- ---------------------------------------------------------------------------
CREATE TABLE lote (
  id           bigserial PRIMARY KEY,
  archivo      text NOT NULL,
  formato      text NOT NULL CHECK (formato IN ('CSV', 'XLSX', 'TXT')),
  filas        int  NOT NULL,
  validas      int  NOT NULL,
  con_error    int  NOT NULL,
  importe      numeric(18, 2) NOT NULL DEFAULT 0,
  estado       text NOT NULL CHECK (estado IN ('PREVIA', 'PENDIENTE_APROBACION', 'RECHAZADO', 'PROCESADO', 'DESCARTADO')),
  creador      text NOT NULL,
  aprobador    text,
  creado_en    timestamptz NOT NULL DEFAULT now(),
  aprobado_en  timestamptz,
  CHECK (aprobador IS NULL OR aprobador <> creador)
);

CREATE TABLE lote_fila (
  lote_id     bigint NOT NULL REFERENCES lote(id) ON DELETE CASCADE,
  fila        int    NOT NULL,
  datos       jsonb  NOT NULL,
  validacion  text   NOT NULL,
  PRIMARY KEY (lote_id, fila)
);

-- ---------------------------------------------------------------------------
-- Transferencias, historial de estados y auditoría: particionadas por mes.
-- La clave primaria incluye la columna de partición (requisito de Postgres).
-- ---------------------------------------------------------------------------
CREATE TABLE transferencia (
  id              bigserial,
  tipo            text NOT NULL CHECK (tipo IN ('INMEDIATA', 'PROPIAS', 'TERCEROS', 'MEP')),
  api             text NOT NULL,
  cuenta_origen   text NOT NULL,
  moneda          text NOT NULL,
  destino         text NOT NULL,
  titular         text,
  cuit_destino    text,
  importe         numeric(18, 2) NOT NULL CHECK (importe > 0),
  concepto        text,
  request         jsonb NOT NULL,
  creador         text NOT NULL,
  aprobador       text,
  estado          text NOT NULL CHECK (estado IN ('PENDIENTE_APROBACION', 'RECHAZADA', 'ENVIANDO', 'ENVIADA',
                                                  'PEND_AUTORIZACION', 'DEBITADA', 'RECHAZADA_BANCO', 'ERROR_API')),
  transaction_id  text,
  nro_control     text,
  respuesta       jsonb,
  lote_id         bigint,
  creado_en       timestamptz NOT NULL DEFAULT now(),
  aprobado_en     timestamptz,
  actualizado_en  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, creado_en),
  CHECK (aprobador IS NULL OR aprobador <> creador)          -- nadie aprueba lo que cargó
) PARTITION BY RANGE (creado_en);
CREATE INDEX transferencia_estado_idx  ON transferencia (estado);
CREATE INDEX transferencia_origen_idx  ON transferencia (cuenta_origen, creado_en);
CREATE INDEX transferencia_lote_idx    ON transferencia (lote_id);
CREATE INDEX transferencia_trn_idx     ON transferencia (transaction_id);

CREATE TABLE transferencia_estado (
  id                bigserial,
  transferencia_id  bigint NOT NULL,
  estado            text   NOT NULL,
  usuario           text   NOT NULL,
  detalle           text,
  en                timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, en)
) PARTITION BY RANGE (en);
CREATE INDEX transferencia_estado_trn_idx ON transferencia_estado (transferencia_id);

CREATE TABLE auditoria (
  id          bigserial,
  en          timestamptz NOT NULL DEFAULT now(),
  usuario     text NOT NULL,
  rol         text NOT NULL,
  tipo        text NOT NULL CHECK (tipo IN ('Transferencias', 'Administración', 'Accesos', 'Consultas', 'Sistema')),
  accion      text NOT NULL,
  api         text,
  detalle     text,
  resultado   text NOT NULL,
  ip          inet,
  ref_tipo    text,     -- 'transferencia' | 'lote' | 'empresa' | ...
  ref_id      text,
  PRIMARY KEY (id, en)
) PARTITION BY RANGE (en);
CREATE INDEX auditoria_usuario_idx ON auditoria (usuario, en);
CREATE INDEX auditoria_ref_idx     ON auditoria (ref_tipo, ref_id);

-- Vínculo débito informado por el banco <-> transferencia que lo originó
CREATE TABLE debito_transferencia (
  movimiento_id     text PRIMARY KEY,
  cuenta            text NOT NULL,
  transferencia_id  bigint NOT NULL,
  conciliado_en     timestamptz NOT NULL DEFAULT now()
);

-- Registro de cada pase mensual a la base histórica
CREATE TABLE pase_historico (
  id            bigserial PRIMARY KEY,
  tabla         text NOT NULL,
  periodo       date NOT NULL,
  filas         bigint,
  hash          text,
  estado        text NOT NULL CHECK (estado IN ('OK', 'ERROR', 'OMITIDO')),
  detalle       text,
  ejecutado_en  timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Inmutabilidad: auditoría e historial de estados son de solo inserción.
-- (El pase histórico no modifica filas: separa y elimina particiones enteras.)
-- ---------------------------------------------------------------------------
CREATE FUNCTION hb_solo_insercion() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'La tabla % es de solo inserción', TG_TABLE_NAME;
END $$;
CREATE TRIGGER auditoria_inmutable BEFORE UPDATE OR DELETE ON auditoria
  FOR EACH ROW EXECUTE FUNCTION hb_solo_insercion();
CREATE TRIGGER transferencia_estado_inmutable BEFORE UPDATE OR DELETE ON transferencia_estado
  FOR EACH ROW EXECUTE FUNCTION hb_solo_insercion();

-- ---------------------------------------------------------------------------
-- Nunca dos envíos al banco por la misma operación (independiente del código).
-- 1) envio_banco: una fila por transferencia, insertada y confirmada ANTES de llamar
--    a la API. La clave primaria impide un segundo envío aunque fallen todas las
--    demás validaciones. Solo inserción; queda en la base operativa para siempre
--    (el pase histórico no la toca), así que tampoco se reenvía algo archivado.
-- 2) hb_transicion_valida: la base rechaza cualquier cambio de estado fuera del
--    circuito; ninguna transferencia vuelve a PENDIENTE_APROBACION ni a ENVIANDO.
-- ---------------------------------------------------------------------------
CREATE TABLE envio_banco (
  transferencia_id  bigint PRIMARY KEY,
  api               text        NOT NULL,
  aprobador         text        NOT NULL,
  iniciado_en       timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER envio_banco_inmutable BEFORE UPDATE OR DELETE ON envio_banco
  FOR EACH ROW EXECUTE FUNCTION hb_solo_insercion();

CREATE FUNCTION hb_transicion_valida() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.estado = OLD.estado THEN RETURN NEW; END IF;
  IF (OLD.estado, NEW.estado) IN (
       ('PENDIENTE_APROBACION', 'ENVIANDO'), ('PENDIENTE_APROBACION', 'RECHAZADA'),
       ('ENVIANDO', 'ENVIADA'), ('ENVIANDO', 'PEND_AUTORIZACION'), ('ENVIANDO', 'DEBITADA'),
       ('ENVIANDO', 'ERROR_API'), ('ENVIANDO', 'RECHAZADA_BANCO'),
       ('ENVIADA', 'PEND_AUTORIZACION'), ('ENVIADA', 'DEBITADA'), ('ENVIADA', 'RECHAZADA_BANCO'), ('ENVIADA', 'ERROR_API'),
       ('PEND_AUTORIZACION', 'DEBITADA'), ('PEND_AUTORIZACION', 'RECHAZADA_BANCO')) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Transición de estado no permitida para OP-%: % -> %', OLD.id, OLD.estado, NEW.estado;
END $$;
CREATE TRIGGER transferencia_transicion BEFORE UPDATE OF estado ON transferencia
  FOR EACH ROW EXECUTE FUNCTION hb_transicion_valida();

-- ---------------------------------------------------------------------------
-- Particiones mensuales: crea las del mes pasado a +2 meses (idempotente).
-- La llama el job del pase histórico cada mes y una vez acá.
-- ---------------------------------------------------------------------------
CREATE FUNCTION hb_asegurar_particiones(desde date DEFAULT (date_trunc('month', now()) - interval '3 months')::date,
                                        hasta date DEFAULT (date_trunc('month', now()) + interval '2 months')::date)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  t text;
  m date;
BEGIN
  FOREACH t IN ARRAY ARRAY['transferencia', 'transferencia_estado', 'auditoria'] LOOP
    m := date_trunc('month', desde)::date;
    WHILE m <= hasta LOOP
      EXECUTE format('CREATE TABLE IF NOT EXISTS %I PARTITION OF %I FOR VALUES FROM (%L) TO (%L)',
                     t || '_' || to_char(m, 'YYYY_MM'), t, m, (m + interval '1 month')::date);
      m := (m + interval '1 month')::date;
    END LOOP;
  END LOOP;
END $$;

SELECT hb_asegurar_particiones();
