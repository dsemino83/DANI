-- Emails de contacto de cada empresa (uno o más). Idempotente: se puede aplicar más de una vez.
SET client_min_messages = warning;
ALTER TABLE empresa ADD COLUMN IF NOT EXISTS emails text[] NOT NULL DEFAULT '{}';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'empresa_emails_max') THEN
    ALTER TABLE empresa ADD CONSTRAINT empresa_emails_max CHECK (cardinality(emails) <= 20);
  END IF;
END $$;
