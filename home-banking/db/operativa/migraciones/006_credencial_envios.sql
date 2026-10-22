-- Credencial API adicional, exclusiva de los envíos programados de correo (uso = 'envios').
-- La principal (uso = 'principal') la usa el resto del Home Banking. Idempotente.
SET client_min_messages = warning;

ALTER TABLE credencial_api ADD COLUMN IF NOT EXISTS uso text NOT NULL DEFAULT 'principal';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'credencial_api_uso_check') THEN
    ALTER TABLE credencial_api ADD CONSTRAINT credencial_api_uso_check CHECK (uso IN ('principal', 'envios'));
  END IF;
  -- Una credencial por ambiente y uso (antes: una por ambiente)
  IF EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ALL (c.conkey)
              WHERE c.conrelid = 'credencial_api'::regclass AND c.contype = 'p' AND cardinality(c.conkey) = 1) THEN
    ALTER TABLE credencial_api DROP CONSTRAINT credencial_api_pkey;
    ALTER TABLE credencial_api ADD CONSTRAINT credencial_api_pkey PRIMARY KEY (ambiente, uso);
  END IF;
END $$;
