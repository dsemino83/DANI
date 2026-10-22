-- La cola guarda el tipo de envío de cada tarea: diaria = extracto diario; horaria o media_hora = alerta de
-- movimientos de la última media hora. Idempotente.
SET client_min_messages = warning;
ALTER TABLE cola_envio ADD COLUMN IF NOT EXISTS frecuencia text NOT NULL DEFAULT 'diaria';
UPDATE cola_envio c SET frecuencia = p.frecuencia FROM programacion_envio p
 WHERE c.programacion_id = p.id AND c.frecuencia <> p.frecuencia AND c.estado IN ('pendiente', 'procesando');
