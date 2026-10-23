-- Oficiales que reciben las alertas de movimientos por chat de Teams (vía Power Automate). El check se
-- configura en "Cartera de oficiales". Es por oficial (no por cliente): si está activo, recibe por chat
-- las alertas de los clientes de su cartera. Idempotente.
SET client_min_messages = warning;
CREATE TABLE IF NOT EXISTS oficial_chat (
  oficial        text PRIMARY KEY,
  notificar      boolean NOT NULL DEFAULT false,
  actualizado_por text,
  actualizado_en timestamptz NOT NULL DEFAULT now()
);
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hb_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON oficial_chat TO hb_app;
  END IF;
END $$;
