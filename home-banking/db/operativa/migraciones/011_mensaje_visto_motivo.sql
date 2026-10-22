-- Buzón: por qué quedó visto un mensaje ('leido' = lo abrió el destinatario; 'operacion_resuelta' = la operación
-- que lo originó ya no espera autorización y se marcó solo). Idempotente.
SET client_min_messages = warning;
ALTER TABLE mensaje ADD COLUMN IF NOT EXISTS visto_motivo text;
UPDATE mensaje SET visto_motivo = 'leido' WHERE visto_en IS NOT NULL AND visto_motivo IS NULL;
