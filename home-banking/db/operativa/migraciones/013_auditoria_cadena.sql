-- Auditoría a prueba de manipulación: cada registro lleva el hash SHA-256 de su contenido encadenado con el del
-- registro anterior (orden de inserción). Modificar, borrar o intercalar un registro rompe la cadena y la
-- verificación lo detecta. Idempotente. Los registros anteriores a esta migración quedan fuera de la cadena.
SET client_min_messages = warning;

ALTER TABLE auditoria ADD COLUMN IF NOT EXISTS orden bigint;
ALTER TABLE auditoria ADD COLUMN IF NOT EXISTS hash_anterior text;
ALTER TABLE auditoria ADD COLUMN IF NOT EXISTS hash text;
CREATE INDEX IF NOT EXISTS auditoria_orden_idx ON auditoria (orden);

-- Cabeza de la cadena: una sola fila. Su bloqueo serializa las inserciones de auditoría.
CREATE TABLE IF NOT EXISTS auditoria_cadena (
  id           smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  ultimo_orden bigint NOT NULL DEFAULT 0,
  ultimo_hash  text NOT NULL DEFAULT 'GENESIS',
  actualizado  timestamptz NOT NULL DEFAULT now()
);
INSERT INTO auditoria_cadena (id) VALUES (1) ON CONFLICT DO NOTHING;

-- Texto canónico de un registro (el mismo que recalcula la verificación)
CREATE OR REPLACE FUNCTION hb_auditoria_canonico(orden bigint, id bigint, en timestamptz, usuario text, rol text, tipo text, accion text,
  api text, detalle text, resultado text, ip inet, ref_tipo text, ref_id text, hash_anterior text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT concat_ws('|', orden, id, to_char(en AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'), usuario, rol, tipo, accion,
    coalesce(api, ''), coalesce(detalle, ''), resultado, coalesce(host(ip), ''), coalesce(ref_tipo, ''), coalesce(ref_id, ''), hash_anterior)
$$;

-- SECURITY DEFINER: la aplicación no puede escribir la cabeza de la cadena; solo este trigger, al insertar
CREATE OR REPLACE FUNCTION hb_auditoria_encadenar() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c auditoria_cadena;
BEGIN
  SELECT * INTO c FROM auditoria_cadena WHERE id = 1 FOR UPDATE;   -- se libera al terminar la transacción
  NEW.orden := c.ultimo_orden + 1;
  NEW.hash_anterior := c.ultimo_hash;
  NEW.hash := encode(sha256(convert_to(hb_auditoria_canonico(NEW.orden, NEW.id, NEW.en, NEW.usuario, NEW.rol, NEW.tipo, NEW.accion,
    NEW.api, NEW.detalle, NEW.resultado, NEW.ip, NEW.ref_tipo, NEW.ref_id, NEW.hash_anterior), 'UTF8')), 'hex');
  UPDATE auditoria_cadena SET ultimo_orden = NEW.orden, ultimo_hash = NEW.hash, actualizado = now() WHERE id = 1;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS auditoria_encadenar ON auditoria;
CREATE TRIGGER auditoria_encadenar BEFORE INSERT ON auditoria FOR EACH ROW EXECUTE FUNCTION hb_auditoria_encadenar();

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hb_app') THEN
    REVOKE ALL ON auditoria_cadena FROM hb_app;
    GRANT SELECT ON auditoria_cadena TO hb_app;   -- solo lectura: la escribe el trigger
  END IF;
END $$;
