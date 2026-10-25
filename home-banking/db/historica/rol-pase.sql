-- Rol del pase mensual en la base histórica (reemplaza al superusuario "postgres" en el servicio jobs):
-- dueño de las tablas (el pase crea particiones/tablas, agrega columnas y triggers de inmutabilidad) y nada más.
-- Lo crea 02_roles.sh (base nueva) o scripts/migrar-bases.sh (existente). Idempotente: sin el rol, no hace nada.
SET client_min_messages = warning;
DO $$
DECLARE r record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hb_pase_h') THEN RETURN; END IF;
  GRANT USAGE, CREATE ON SCHEMA public TO hb_pase_h;
  FOR r IN SELECT c.oid::regclass::text AS t FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
  LOOP
    EXECUTE format('ALTER TABLE %s OWNER TO hb_pase_h', r.t);
  END LOOP;
END $$;
