-- Envíos programados por cliente y por cuenta, y cola de tareas (una por cliente y turno). Idempotente.
SET client_min_messages = warning;

-- Destinos: [{"empresaId": 1, "cuentas": []}]  (cuentas vacío = todas las cuentas del cliente)
ALTER TABLE programacion_envio ADD COLUMN IF NOT EXISTS destinos jsonb NOT NULL DEFAULT '[]';
UPDATE programacion_envio SET destinos = (SELECT coalesce(jsonb_agg(jsonb_build_object('empresaId', e, 'cuentas', '[]'::jsonb)), '[]') FROM unnest(empresas) e)
 WHERE destinos = '[]' AND cardinality(empresas) > 0;
-- La regla "al menos una empresa" pasa a mirar destinos (se busca por su definición, no por el nombre)
DO $$ DECLARE c text; BEGIN
  FOR c IN SELECT conname FROM pg_constraint WHERE conrelid = 'programacion_envio'::regclass AND pg_get_constraintdef(oid) LIKE '%cardinality(empresas)%' LOOP
    EXECUTE format('ALTER TABLE programacion_envio DROP CONSTRAINT %I', c);
  END LOOP;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'programacion_destinos') THEN
    ALTER TABLE programacion_envio ADD CONSTRAINT programacion_destinos CHECK (todas_empresas OR jsonb_array_length(destinos) > 0);
  END IF;
END $$;

-- Cola: el programador encola; un único trabajador toma de a una tarea (FOR UPDATE SKIP LOCKED), así los
-- procesos no se superponen. Cada tarea termina en el envío de un correo; si falla se reintenta.
CREATE TABLE IF NOT EXISTS cola_envio (
  id              bigserial PRIMARY KEY,
  programacion_id bigint REFERENCES programacion_envio(id) ON DELETE SET NULL,
  programacion    text NOT NULL,
  turno           text NOT NULL,
  empresa_id      bigint NOT NULL,
  empresa         text NOT NULL,
  cuentas         text[] NOT NULL DEFAULT '{}',   -- vacío = todas las cuentas activas del cliente
  contenido       text NOT NULL,
  responsable     text NOT NULL,                  -- aprobador cuyos permisos se aplican al enviar
  manual          boolean NOT NULL DEFAULT false,
  estado          text NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'procesando', 'enviado', 'error', 'omitido')),
  intentos        smallint NOT NULL DEFAULT 0,
  max_intentos    smallint NOT NULL DEFAULT 3,
  disponible_en   timestamptz NOT NULL DEFAULT now(),
  encolada_en     timestamptz NOT NULL DEFAULT now(),
  tomada_en       timestamptz,
  terminada_en    timestamptz,
  destinatarios   text[] NOT NULL DEFAULT '{}',
  detalle         text,
  UNIQUE (programacion_id, turno, empresa_id)      -- un turno no se encola dos veces para el mismo cliente
);
CREATE INDEX IF NOT EXISTS cola_envio_pendientes_idx ON cola_envio (disponible_en, id) WHERE estado = 'pendiente';
CREATE INDEX IF NOT EXISTS cola_envio_prog_idx ON cola_envio (programacion_id, encolada_en DESC);

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hb_app') THEN
    GRANT SELECT, INSERT, UPDATE ON cola_envio TO hb_app;
    GRANT USAGE, SELECT ON SEQUENCE cola_envio_id_seq TO hb_app;
  END IF;
END $$;
