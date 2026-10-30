-- Logins y permisos de mínimo privilegio de la base operativa. Se aplica en CADA arranque (db-init): es idempotente y
-- sincroniza la clave de cada login con su secreto (las claves vienen del entorno: $(HB_APP_PASS), etc.).
SET NOCOUNT ON;
GO
-- Logins del servidor (CHECK_POLICY = OFF: las claves las genera scripts/generar-secretos.sh, aleatorias y largas)
USE master;
GO
IF SUSER_ID(N'hb_app')   IS NULL CREATE LOGIN hb_app   WITH PASSWORD = N'$(HB_APP_PASS)',   CHECK_POLICY = OFF, DEFAULT_DATABASE = homebanking;
ALTER LOGIN hb_app   WITH PASSWORD = N'$(HB_APP_PASS)',   CHECK_POLICY = OFF;
IF SUSER_ID(N'hb_jobs')  IS NULL CREATE LOGIN hb_jobs  WITH PASSWORD = N'$(HB_JOBS_PASS)',  CHECK_POLICY = OFF, DEFAULT_DATABASE = homebanking;
ALTER LOGIN hb_jobs  WITH PASSWORD = N'$(HB_JOBS_PASS)',  CHECK_POLICY = OFF;
IF SUSER_ID(N'hb_pase')  IS NULL CREATE LOGIN hb_pase  WITH PASSWORD = N'$(HB_PASE_PASS)',  CHECK_POLICY = OFF, DEFAULT_DATABASE = homebanking;
ALTER LOGIN hb_pase  WITH PASSWORD = N'$(HB_PASE_PASS)',  CHECK_POLICY = OFF;
GO
USE homebanking;
GO
IF USER_ID(N'hb_app')  IS NULL CREATE USER hb_app  FOR LOGIN hb_app  WITH DEFAULT_SCHEMA = dbo;
IF USER_ID(N'hb_jobs') IS NULL CREATE USER hb_jobs FOR LOGIN hb_jobs WITH DEFAULT_SCHEMA = dbo;
IF USER_ID(N'hb_pase') IS NULL CREATE USER hb_pase FOR LOGIN hb_pase WITH DEFAULT_SCHEMA = dbo;
GO
-- Si la base se restauró desde un resguardo en otra instancia, los usuarios quedan huérfanos (el login se creó con otro SID): se vuelven a vincular
ALTER USER hb_app WITH LOGIN = hb_app;
ALTER USER hb_jobs WITH LOGIN = hb_jobs;
ALTER USER hb_pase WITH LOGIN = hb_pase;
GO

-- ---- hb_app: el backend. Sin DELETE en transferencias, sin UPDATE/DELETE en lo que es de solo inserción.
GRANT SELECT, INSERT, UPDATE, DELETE ON dbo.empresa            TO hb_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON dbo.usuario            TO hb_app;   -- usuarios propios (login y administración)
GRANT SELECT, INSERT, UPDATE, DELETE ON dbo.permiso_empresa    TO hb_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON dbo.cartera_oficial    TO hb_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON dbo.oficial_chat       TO hb_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON dbo.credencial_api     TO hb_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON dbo.lote               TO hb_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON dbo.lote_fila          TO hb_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON dbo.debito_transferencia TO hb_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON dbo.feriado            TO hb_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON dbo.programacion_envio TO hb_app;
GRANT SELECT, INSERT, UPDATE         ON dbo.transferencia      TO hb_app;   -- sin DELETE
GRANT SELECT, INSERT, UPDATE         ON dbo.empresa_cbu        TO hb_app;   -- sin DELETE: quitar una cuenta es pasarla a baja
GRANT SELECT, INSERT, UPDATE         ON dbo.cola_envio         TO hb_app;
GRANT SELECT, INSERT, UPDATE         ON dbo.ejecucion_envio    TO hb_app;
GRANT SELECT, INSERT, UPDATE         ON dbo.mensaje            TO hb_app;
GRANT SELECT, INSERT                 ON dbo.transferencia_estado TO hb_app;  -- solo inserción
GRANT SELECT, INSERT                 ON dbo.auditoria          TO hb_app;
GRANT SELECT, INSERT                 ON dbo.envio_banco        TO hb_app;
GRANT SELECT, INSERT                 ON dbo.referencia_usada   TO hb_app;
GRANT SELECT, INSERT                 ON dbo.envio_mail_log     TO hb_app;
GRANT SELECT                         ON dbo.pase_historico     TO hb_app;
GRANT SELECT                         ON dbo.auditoria_cadena   TO hb_app;   -- solo lectura: la escribe el trigger
GRANT EXECUTE ON dbo.hb_auditoria_canonico TO hb_app;
GRANT EXECUTE ON dbo.hb_sha256 TO hb_app;
GRANT EXECUTE ON dbo.hb_json_largo TO hb_app;

-- ---- hb_jobs: el servicio jobs (programador). Solo lo que ejecuta; SIN DELETE, SIN escritura sobre empresas, permisos,
-- credenciales, lotes ni cartera.
GRANT SELECT ON dbo.empresa            TO hb_jobs;
GRANT SELECT ON dbo.empresa_cbu        TO hb_jobs;
GRANT SELECT ON dbo.permiso_empresa    TO hb_jobs;
GRANT SELECT ON dbo.cartera_oficial    TO hb_jobs;
GRANT SELECT ON dbo.oficial_chat       TO hb_jobs;
GRANT SELECT ON dbo.credencial_api     TO hb_jobs;
GRANT SELECT ON dbo.auditoria_cadena   TO hb_jobs;
GRANT SELECT ON dbo.referencia_usada   TO hb_jobs;
GRANT SELECT, INSERT ON dbo.transferencia_estado TO hb_jobs;
GRANT SELECT, INSERT ON dbo.envio_banco          TO hb_jobs;
GRANT SELECT, INSERT ON dbo.debito_transferencia TO hb_jobs;
GRANT SELECT, INSERT ON dbo.auditoria            TO hb_jobs;
GRANT SELECT, INSERT ON dbo.mensaje              TO hb_jobs;
GRANT SELECT, INSERT ON dbo.envio_mail_log       TO hb_jobs;
GRANT SELECT, UPDATE ON dbo.transferencia        TO hb_jobs;
GRANT SELECT, UPDATE ON dbo.programacion_envio   TO hb_jobs;
GRANT SELECT, INSERT, UPDATE ON dbo.cola_envio      TO hb_jobs;
GRANT SELECT, INSERT, UPDATE ON dbo.ejecucion_envio TO hb_jobs;
GRANT SELECT, INSERT, UPDATE ON dbo.feriado         TO hb_jobs;
GRANT EXECUTE ON dbo.hb_auditoria_canonico TO hb_jobs;
GRANT EXECUTE ON dbo.hb_sha256 TO hb_jobs;
GRANT EXECUTE ON dbo.hb_json_largo TO hb_jobs;

-- ---- hb_pase: el pase mensual a la base histórica. Lee y borra lo ya copiado; el comprobante del pase, solo inserta.
GRANT SELECT, DELETE ON dbo.transferencia        TO hb_pase;
GRANT SELECT, DELETE ON dbo.transferencia_estado TO hb_pase;
GRANT SELECT, DELETE ON dbo.auditoria            TO hb_pase;
GRANT SELECT, INSERT ON dbo.auditoria            TO hb_pase;   -- el pase deja su propio registro de auditoría
GRANT SELECT, DELETE ON dbo.cola_envio           TO hb_pase;
GRANT SELECT, DELETE ON dbo.ejecucion_envio      TO hb_pase;
GRANT SELECT, DELETE ON dbo.mensaje              TO hb_pase;
GRANT SELECT, DELETE ON dbo.envio_mail_log       TO hb_pase;
GRANT SELECT, INSERT ON dbo.pase_historico       TO hb_pase;
GO
