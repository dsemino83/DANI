-- Índices de lectura para la base histórica (PostgreSQL 16).
-- Histórica es read-mostly: priorizamos rangos temporales y keyset pagination.

CREATE INDEX IF NOT EXISTS h_transferencia_fecha_id_idx
  ON transferencia (creado_en DESC, id DESC)
  INCLUDE (referencia, tipo, api, cuenta_origen, moneda, destino, titular, importe,
           creador, aprobador, estado, transaction_id, lote_id, aprobado_en);

CREATE INDEX IF NOT EXISTS h_transferencia_origen_fecha_id_idx
  ON transferencia (cuenta_origen, creado_en DESC, id DESC)
  INCLUDE (referencia, tipo, api, moneda, destino, titular, importe, creador,
           aprobador, estado, transaction_id, lote_id, aprobado_en);

CREATE INDEX IF NOT EXISTS h_transferencia_estado_origen_fecha_id_idx
  ON transferencia (estado, cuenta_origen, creado_en DESC, id DESC)
  INCLUDE (referencia, tipo, api, moneda, destino, titular, importe, creador,
           aprobador, transaction_id, lote_id, aprobado_en);

CREATE INDEX IF NOT EXISTS h_transferencia_estado_trn_en_idx
  ON transferencia_estado (transferencia_id, en DESC, id DESC)
  INCLUDE (estado, usuario, detalle);

CREATE INDEX IF NOT EXISTS h_auditoria_en_id_idx
  ON auditoria (en DESC, id DESC)
  INCLUDE (usuario, rol, tipo, accion, api, resultado);

CREATE INDEX IF NOT EXISTS h_auditoria_usuario_en_id_idx
  ON auditoria (usuario, en DESC, id DESC)
  INCLUDE (rol, tipo, accion, api, resultado);

CREATE INDEX IF NOT EXISTS h_auditoria_tipo_en_id_idx
  ON auditoria (tipo, en DESC, id DESC)
  INCLUDE (usuario, rol, accion, api, resultado);

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS h_auditoria_busqueda_trgm_idx
  ON auditoria USING gin ((accion || ' ' || coalesce(detalle, '') || ' ' || coalesce(api, '')) gin_trgm_ops);

ANALYZE transferencia;
ANALYZE transferencia_estado;
ANALYZE auditoria;
