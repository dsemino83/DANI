-- Envíos programados: cada ejecución (un turno de una programación, o "Ejecutar ahora") tiene un id transaccional
-- (EJ-000123) que agrupa sus tareas de la cola y lleva sus totales, incluidas las consultas hechas al banco. Idempotente.
SET client_min_messages = warning;
CREATE TABLE IF NOT EXISTS ejecucion_envio (
  id               bigserial PRIMARY KEY,
  programacion_id  bigint REFERENCES programacion_envio(id) ON DELETE SET NULL,
  programacion     text NOT NULL,
  turno            text NOT NULL,
  frecuencia       text NOT NULL,
  manual           boolean NOT NULL DEFAULT false,
  responsable      text NOT NULL,
  estado           text NOT NULL DEFAULT 'en_curso' CHECK (estado IN ('en_curso', 'terminada')),
  tareas           int NOT NULL DEFAULT 0,
  enviadas         int NOT NULL DEFAULT 0,
  omitidas         int NOT NULL DEFAULT 0,
  errores          int NOT NULL DEFAULT 0,
  consultas_banco  int NOT NULL DEFAULT 0,      -- llamadas reales al banco (sin contar las resueltas desde la caché)
  creada_en        timestamptz NOT NULL DEFAULT now(),
  terminada_en     timestamptz,
  UNIQUE (programacion_id, turno)
);
CREATE INDEX IF NOT EXISTS ejecucion_envio_prog_idx ON ejecucion_envio (programacion_id, creada_en DESC);
ALTER TABLE cola_envio ADD COLUMN IF NOT EXISTS ejecucion_id bigint;
ALTER TABLE cola_envio ADD COLUMN IF NOT EXISTS consultas_banco int NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS cola_envio_ejecucion_idx ON cola_envio (ejecucion_id);
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hb_app') THEN
    GRANT SELECT, INSERT, UPDATE ON ejecucion_envio TO hb_app;
    GRANT USAGE, SELECT ON SEQUENCE ejecucion_envio_id_seq TO hb_app;
  END IF;
END $$;
