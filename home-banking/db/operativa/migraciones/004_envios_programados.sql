-- Envíos programados de correo a las empresas y feriados. Idempotente.
SET client_min_messages = warning;

-- Feriados: de fuentes públicas (sincronizados) o cargados a mano (p. ej. Día del Bancario).
CREATE TABLE IF NOT EXISTS feriado (
  fecha          date PRIMARY KEY,
  nombre         text NOT NULL,
  tipo           text,
  fuente         text NOT NULL,          -- 'argentinadatos' | 'nolaborables' | 'manual'
  actualizado_en timestamptz NOT NULL DEFAULT now()
);

-- Programación: qué se envía, a quién y cuándo (hora de Argentina, UTC-3).
CREATE TABLE IF NOT EXISTS programacion_envio (
  id              bigserial PRIMARY KEY,
  nombre          text NOT NULL,
  contenido       text NOT NULL CHECK (contenido IN ('saldos', 'movimientos', 'saldos_movimientos')),
  todas_empresas  boolean NOT NULL DEFAULT true,
  empresas        bigint[] NOT NULL DEFAULT '{}',
  frecuencia      text NOT NULL CHECK (frecuencia IN ('diaria', 'horaria')),
  hora            time NOT NULL,              -- diaria: hora del envío; horaria: primer envío del día
  hora_hasta      time,                       -- horaria: último envío del día
  dias_semana     smallint[] NOT NULL DEFAULT '{1,2,3,4,5}',   -- 1 = lunes … 7 = domingo
  saltar_feriados boolean NOT NULL DEFAULT true,
  fecha_inicio    date NOT NULL,
  fecha_fin       date,
  activa          boolean NOT NULL DEFAULT true,
  ultimo_turno    text,                       -- 'AAAA-MM-DDTHH:MM' del último turno ejecutado (evita duplicados)
  creada_por      text NOT NULL,
  creada_en       timestamptz NOT NULL DEFAULT now(),
  actualizada_por text,
  actualizada_en  timestamptz,
  CHECK (frecuencia = 'diaria' OR (hora_hasta IS NOT NULL AND hora_hasta >= hora)),
  CHECK (fecha_fin IS NULL OR fecha_fin >= fecha_inicio),
  CHECK (todas_empresas OR cardinality(empresas) > 0)
);

-- Resultado de cada envío por empresa (solo inserción).
CREATE TABLE IF NOT EXISTS envio_mail_log (
  id              bigserial PRIMARY KEY,
  programacion_id bigint REFERENCES programacion_envio(id) ON DELETE SET NULL,
  turno           text NOT NULL,
  empresa_id      bigint,
  empresa         text,
  destinatarios   text[] NOT NULL DEFAULT '{}',
  estado          text NOT NULL CHECK (estado IN ('enviado', 'error', 'omitido')),
  detalle         text,
  manual          boolean NOT NULL DEFAULT false,
  en              timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS envio_mail_log_prog_idx ON envio_mail_log (programacion_id, en DESC);

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hb_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON feriado, programacion_envio TO hb_app;
    GRANT SELECT, INSERT ON envio_mail_log TO hb_app;
    GRANT USAGE, SELECT ON SEQUENCE programacion_envio_id_seq, envio_mail_log_id_seq TO hb_app;
  END IF;
END $$;
