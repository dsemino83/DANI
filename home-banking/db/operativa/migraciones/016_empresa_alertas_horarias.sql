-- Interruptor por cliente: si se apaga, la empresa queda excluida de TODAS las alertas por hora / cada 30
-- minutos (aunque la programación apunte a "todas las empresas"). El extracto diario le sigue llegando.
-- Lo maneja el autorizante desde "Envíos programados". Por defecto todos los clientes reciben alertas.
-- Idempotente.
SET client_min_messages = warning;
ALTER TABLE empresa ADD COLUMN IF NOT EXISTS alertas_horarias boolean NOT NULL DEFAULT true;
