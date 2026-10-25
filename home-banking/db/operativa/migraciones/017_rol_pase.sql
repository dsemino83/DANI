-- Rol del pase mensual a la base histórica (job): reemplaza al superusuario "postgres" en el servicio jobs.
-- Es dueño solo de las tablas particionadas (DETACH/DROP de particiones exige ser dueño) y tiene lo mínimo
-- sobre las demás. El rol lo crea 02_roles.sh (base nueva) o scripts/migrar-bases.sh (base existente), con su
-- clave del secreto db_jobs_password. Idempotente: si el rol no existe, no hace nada.
SET client_min_messages = warning;
DO $$
DECLARE r record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hb_pase') THEN RETURN; END IF;
  GRANT USAGE, CREATE ON SCHEMA public TO hb_pase;   -- CREATE: hb_asegurar_particiones crea particiones
  FOR r IN SELECT c.oid::regclass::text AS t FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
              AND c.relname ~ '^(transferencia|transferencia_estado|auditoria)(_[0-9]{4}_[0-9]{2})?$'
  LOOP
    EXECUTE format('ALTER TABLE %s OWNER TO hb_pase', r.t);
  END LOOP;
  -- Tablas que se pasan por filas: lee y borra lo ya copiado. El comprobante del pase, solo inserta.
  FOR r IN SELECT unnest(ARRAY['cola_envio', 'ejecucion_envio', 'mensaje', 'envio_mail_log']) AS t LOOP
    IF to_regclass(r.t) IS NOT NULL THEN EXECUTE format('GRANT SELECT, DELETE ON %I TO hb_pase', r.t); END IF;
  END LOOP;
  GRANT SELECT, INSERT ON pase_historico TO hb_pase;
  GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO hb_pase;
END $$;
