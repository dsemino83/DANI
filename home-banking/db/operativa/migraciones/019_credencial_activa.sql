-- Credencial API Banking: interruptor "activa". Desactivarla corta el acceso al banco (el cliente no vuelve a hacer
-- login) sin borrar la clave ni la llave; reactivarla no requiere volver a cargarlas. Idempotente.
ALTER TABLE credencial_api ADD COLUMN IF NOT EXISTS activa boolean NOT NULL DEFAULT true;
