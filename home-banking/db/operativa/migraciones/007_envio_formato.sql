-- Formato del envío programado: solo en el cuerpo del correo, o cuerpo + Excel adjunto. Idempotente.
SET client_min_messages = warning;
ALTER TABLE programacion_envio ADD COLUMN IF NOT EXISTS formato text NOT NULL DEFAULT 'cuerpo';
ALTER TABLE cola_envio ADD COLUMN IF NOT EXISTS formato text NOT NULL DEFAULT 'cuerpo';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'programacion_envio_formato_check') THEN
    ALTER TABLE programacion_envio ADD CONSTRAINT programacion_envio_formato_check CHECK (formato IN ('cuerpo', 'cuerpo_excel'));
  END IF;
END $$;
