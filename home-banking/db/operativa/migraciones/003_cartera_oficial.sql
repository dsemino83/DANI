-- Cartera de clientes por oficial (la define un aprobador). Idempotente.
SET client_min_messages = warning;
CREATE TABLE IF NOT EXISTS cartera_oficial (
  oficial      text   NOT NULL,
  empresa_id   bigint NOT NULL REFERENCES empresa(id) ON DELETE CASCADE,
  asignado_por text   NOT NULL,
  asignado_en  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (oficial, empresa_id)
);
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hb_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON cartera_oficial TO hb_app;
  END IF;
END $$;
