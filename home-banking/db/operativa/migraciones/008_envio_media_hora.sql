-- Envíos programados: frecuencia "cada 30 minutos" (media_hora) dentro de una franja, como la horaria. Idempotente.
SET client_min_messages = warning;
ALTER TABLE programacion_envio DROP CONSTRAINT IF EXISTS programacion_envio_frecuencia_check;
ALTER TABLE programacion_envio ADD CONSTRAINT programacion_envio_frecuencia_check CHECK (frecuencia IN ('diaria', 'horaria', 'media_hora'));
