-- Base histórica del Home Banking VALO: lo anterior al corte (mes en curso + HB_RETENCION_MESES).
-- Solo lectura para la aplicación; la escribe únicamente el job del pase mensual.
-- Mismas columnas que la base operativa para copiar filas sin transformar.

CREATE TABLE transferencia (
  id              bigint      NOT NULL,
  tipo            text        NOT NULL,
  api             text        NOT NULL,
  cuenta_origen   text        NOT NULL,
  moneda          text        NOT NULL,
  destino         text        NOT NULL,
  titular         text,
  cuit_destino    text,
  importe         numeric(18, 2) NOT NULL,
  concepto        text,
  request         jsonb       NOT NULL,
  creador         text        NOT NULL,
  aprobador       text,
  estado          text        NOT NULL,
  transaction_id  text,
  nro_control     text,
  respuesta       jsonb,
  lote_id         bigint,
  referencia      text        NOT NULL,
  creado_en       timestamptz NOT NULL,
  aprobado_en     timestamptz,
  actualizado_en  timestamptz NOT NULL,
  PRIMARY KEY (id, creado_en)
) PARTITION BY RANGE (creado_en);
CREATE INDEX h_transferencia_origen_idx ON transferencia (cuenta_origen, creado_en);
CREATE INDEX h_transferencia_trn_idx    ON transferencia (transaction_id);

CREATE TABLE transferencia_estado (
  id                bigint      NOT NULL,
  transferencia_id  bigint      NOT NULL,
  estado            text        NOT NULL,
  usuario           text        NOT NULL,
  detalle           text,
  en                timestamptz NOT NULL,
  PRIMARY KEY (id, en)
) PARTITION BY RANGE (en);
CREATE INDEX h_transferencia_estado_trn_idx ON transferencia_estado (transferencia_id);

CREATE TABLE auditoria (
  id         bigint      NOT NULL,
  en         timestamptz NOT NULL,
  usuario    text        NOT NULL,
  rol        text        NOT NULL,
  tipo       text        NOT NULL,
  accion     text        NOT NULL,
  api        text,
  detalle    text,
  resultado  text        NOT NULL,
  ip         inet,
  ref_tipo   text,
  ref_id     text,
  PRIMARY KEY (id, en)
) PARTITION BY RANGE (en);
CREATE INDEX h_auditoria_usuario_idx ON auditoria (usuario, en);
CREATE INDEX h_auditoria_ref_idx     ON auditoria (ref_tipo, ref_id);

-- Comprobante de cada pase recibido (copia del registrado en la operativa)
CREATE TABLE pase_recibido (
  tabla        text NOT NULL,
  periodo      date NOT NULL,
  filas        bigint NOT NULL,
  hash         text NOT NULL,
  recibido_en  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tabla, periodo)
);

CREATE FUNCTION hb_solo_lectura() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'La base histórica no admite modificaciones (%)', TG_TABLE_NAME;
END $$;
CREATE TRIGGER h_auditoria_inmutable BEFORE UPDATE OR DELETE ON auditoria
  FOR EACH ROW EXECUTE FUNCTION hb_solo_lectura();
CREATE TRIGGER h_transferencia_inmutable BEFORE UPDATE OR DELETE ON transferencia
  FOR EACH ROW EXECUTE FUNCTION hb_solo_lectura();
CREATE TRIGGER h_transferencia_estado_inmutable BEFORE UPDATE OR DELETE ON transferencia_estado
  FOR EACH ROW EXECUTE FUNCTION hb_solo_lectura();

-- Envíos programados de correo: cola y log, por filas (el job del pase también las crea si faltan).
CREATE TABLE cola_envio (
  id bigint PRIMARY KEY, programacion_id bigint, programacion text NOT NULL, turno text NOT NULL,
  empresa_id bigint NOT NULL, empresa text NOT NULL, cuentas text[] NOT NULL, contenido text NOT NULL,
  responsable text NOT NULL, manual boolean NOT NULL, estado text NOT NULL, intentos smallint NOT NULL,
  max_intentos smallint NOT NULL, disponible_en timestamptz NOT NULL, encolada_en timestamptz NOT NULL,
  tomada_en timestamptz, terminada_en timestamptz, destinatarios text[] NOT NULL, detalle text);
CREATE INDEX h_cola_envio_prog_idx ON cola_envio (programacion_id, encolada_en);
CREATE TABLE envio_mail_log (
  id bigint PRIMARY KEY, programacion_id bigint, turno text NOT NULL, empresa_id bigint, empresa text,
  destinatarios text[] NOT NULL, estado text NOT NULL, detalle text, manual boolean NOT NULL, en timestamptz NOT NULL);
CREATE INDEX h_envio_mail_log_prog_idx ON envio_mail_log (programacion_id, en);
CREATE TRIGGER h_cola_envio_inmutable BEFORE UPDATE OR DELETE ON cola_envio
  FOR EACH ROW EXECUTE FUNCTION hb_solo_lectura();
CREATE TRIGGER h_envio_mail_log_inmutable BEFORE UPDATE OR DELETE ON envio_mail_log
  FOR EACH ROW EXECUTE FUNCTION hb_solo_lectura();
