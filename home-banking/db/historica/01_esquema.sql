-- Base histórica del Home Banking VALO: lo que tiene más de 3 meses.
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
