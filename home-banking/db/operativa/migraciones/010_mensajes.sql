-- Buzón de mensajes del Home Banking: avisos a las personas asociadas a un cliente (permiso Ver sobre la
-- empresa) cuando se carga una operación que necesita autorización. visto_en = cuando el destinatario lo leyó.
SET client_min_messages = warning;
CREATE TABLE IF NOT EXISTS mensaje (
  id          bigserial PRIMARY KEY,
  usuario     text NOT NULL,                 -- destinatario (preferred_username del SSO)
  tipo        text NOT NULL DEFAULT 'autorizacion_pendiente',
  titulo      text NOT NULL,
  texto       text NOT NULL,
  empresas    text[] NOT NULL DEFAULT '{}',  -- clientes involucrados (razón social)
  ref_tipo    text,                          -- 'transferencia' | 'lote'
  ref_id      bigint,
  creado_por  text NOT NULL,
  creado_en   timestamptz NOT NULL DEFAULT now(),
  visto_en    timestamptz
);
CREATE INDEX IF NOT EXISTS mensaje_usuario_idx ON mensaje (usuario, creado_en DESC);
CREATE INDEX IF NOT EXISTS mensaje_no_vistos_idx ON mensaje (usuario) WHERE visto_en IS NULL;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hb_app') THEN
    GRANT SELECT, INSERT, UPDATE ON mensaje TO hb_app;
    GRANT USAGE, SELECT ON SEQUENCE mensaje_id_seq TO hb_app;
  END IF;
END $$;
