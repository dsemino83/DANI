-- Rol del servicio "jobs" (programador): mínimo privilegio, distinto de hb_app (backend) y de hb_pase (pase mensual).
-- Solo lo que el programador ejecuta: estado y conciliación con el banco, motor de pagos, cola de envíos de correo,
-- feriados, verificación de la auditoría y lectura de la credencial del banco. SIN DELETE, SIN escritura sobre
-- empresas, permisos, credenciales, lotes ni cartera. El rol lo crea 02_roles.sh (base nueva) o
-- scripts/migrar-bases.sh (existente). Idempotente: si el rol no existe, no hace nada.
SET client_min_messages = warning;
DO $$
DECLARE r text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hb_jobs') THEN RETURN; END IF;
  GRANT USAGE ON SCHEMA public TO hb_jobs;
  -- Lectura
  FOREACH r IN ARRAY ARRAY['empresa', 'empresa_cbu', 'permiso_empresa', 'cartera_oficial', 'oficial_chat', 'credencial_api',
                           'auditoria_cadena', 'referencia_usada'] LOOP
    IF to_regclass(r) IS NOT NULL THEN EXECUTE format('GRANT SELECT ON %I TO hb_jobs', r); END IF;
  END LOOP;
  -- Lectura y alta (sin UPDATE ni DELETE)
  FOREACH r IN ARRAY ARRAY['transferencia_estado', 'envio_banco', 'debito_transferencia', 'auditoria', 'mensaje', 'envio_mail_log'] LOOP
    IF to_regclass(r) IS NOT NULL THEN EXECUTE format('GRANT SELECT, INSERT ON %I TO hb_jobs', r); END IF;
  END LOOP;
  -- Lectura y cambio de estado (sin alta ni baja)
  FOREACH r IN ARRAY ARRAY['transferencia', 'programacion_envio'] LOOP
    IF to_regclass(r) IS NOT NULL THEN EXECUTE format('GRANT SELECT, UPDATE ON %I TO hb_jobs', r); END IF;
  END LOOP;
  -- Cola de envíos, ejecuciones y feriados: alta y actualización
  FOREACH r IN ARRAY ARRAY['cola_envio', 'ejecucion_envio', 'feriado'] LOOP
    IF to_regclass(r) IS NOT NULL THEN EXECUTE format('GRANT SELECT, INSERT, UPDATE ON %I TO hb_jobs', r); END IF;
  END LOOP;
  -- Secuencias de las tablas con alta
  FOR r IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND c.relkind = 'S'
              AND c.relname ~ '^(transferencia_estado|envio_banco|auditoria|mensaje|envio_mail_log|cola_envio|ejecucion_envio|feriado)_'
  LOOP
    EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE %I TO hb_jobs', r);
  END LOOP;
END $$;
