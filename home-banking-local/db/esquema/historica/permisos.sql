-- Logins y permisos de la base histórica. Se aplica en CADA arranque (db-init): idempotente; sincroniza las claves.
SET NOCOUNT ON;
GO
USE master;
GO
IF SUSER_ID(N'hb_hist_ro') IS NULL CREATE LOGIN hb_hist_ro WITH PASSWORD = N'$(HB_HIST_RO_PASS)', CHECK_POLICY = OFF, DEFAULT_DATABASE = homebanking_hist;
ALTER LOGIN hb_hist_ro WITH PASSWORD = N'$(HB_HIST_RO_PASS)', CHECK_POLICY = OFF;
IF SUSER_ID(N'hb_pase_h') IS NULL CREATE LOGIN hb_pase_h WITH PASSWORD = N'$(HB_PASE_H_PASS)', CHECK_POLICY = OFF, DEFAULT_DATABASE = homebanking_hist;
ALTER LOGIN hb_pase_h WITH PASSWORD = N'$(HB_PASE_H_PASS)', CHECK_POLICY = OFF;
GO
USE homebanking_hist;
GO
IF USER_ID(N'hb_hist_ro') IS NULL CREATE USER hb_hist_ro FOR LOGIN hb_hist_ro WITH DEFAULT_SCHEMA = dbo;
IF USER_ID(N'hb_pase_h')  IS NULL CREATE USER hb_pase_h  FOR LOGIN hb_pase_h  WITH DEFAULT_SCHEMA = dbo;
GO
-- Si la base se restauró desde un resguardo en otra instancia, los usuarios quedan huérfanos (el login se creó con otro SID): se vuelven a vincular
ALTER USER hb_hist_ro WITH LOGIN = hb_hist_ro;
ALTER USER hb_pase_h WITH LOGIN = hb_pase_h;
GO
-- hb_hist_ro: la aplicación solo lee la base histórica
GRANT SELECT ON SCHEMA::dbo TO hb_hist_ro;
-- hb_pase_h: el pase solo inserta (y acumula su comprobante); no modifica ni borra lo ya pasado
GRANT SELECT, INSERT ON dbo.transferencia        TO hb_pase_h;
GRANT SELECT, INSERT ON dbo.transferencia_estado TO hb_pase_h;
GRANT SELECT, INSERT ON dbo.auditoria            TO hb_pase_h;
GRANT SELECT, INSERT ON dbo.cola_envio           TO hb_pase_h;
GRANT SELECT, INSERT ON dbo.ejecucion_envio      TO hb_pase_h;
GRANT SELECT, INSERT ON dbo.envio_mail_log       TO hb_pase_h;
GRANT SELECT, INSERT ON dbo.mensaje              TO hb_pase_h;
GRANT SELECT, INSERT, UPDATE ON dbo.pase_recibido TO hb_pase_h;
GO
