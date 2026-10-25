-- Optimización OLTP / low-latency para Home Banking VALO (PostgreSQL 16)
-- Aplicar con una ventana controlada. En una base ya cargada, crear los índices
-- equivalentes con CREATE INDEX CONCURRENTLY desde una sesión administrativa.
--
-- Principio: indexar los patrones reales de lectura sin penalizar innecesariamente
-- las escrituras. Las tablas particionadas propagan estos índices a sus particiones.

-- Bandeja de aprobaciones: solo el subconjunto pendiente e individual.
CREATE INDEX IF NOT EXISTS transferencia_pend_aprobacion_idx
  ON transferencia (creado_en ASC, cuenta_origen, id)
  INCLUDE (referencia, tipo, api, moneda, destino, titular, importe, creador, request)
  WHERE estado = 'PENDIENTE_APROBACION' AND lote_id IS NULL;

-- Listado operativo por cuenta/fecha. id resuelve empates y habilita keyset pagination.
CREATE INDEX IF NOT EXISTS transferencia_origen_fecha_id_idx
  ON transferencia (cuenta_origen, creado_en DESC, id DESC)
  INCLUDE (referencia, tipo, api, moneda, destino, titular, importe, creador,
           aprobador, estado, transaction_id, lote_id, aprobado_en);

-- Filtro por estado + cuenta + rango temporal.
CREATE INDEX IF NOT EXISTS transferencia_estado_origen_fecha_id_idx
  ON transferencia (estado, cuenta_origen, creado_en DESC, id DESC)
  INCLUDE (referencia, tipo, api, moneda, destino, titular, importe, creador,
           aprobador, transaction_id, lote_id, aprobado_en);

-- Recuperación de ENVIANDO envejecidas: índice pequeño y selectivo.
CREATE INDEX IF NOT EXISTS transferencia_enviando_actualizado_idx
  ON transferencia (actualizado_en, id)
  WHERE estado = 'ENVIANDO';

-- Historial completo de estados de una transferencia, ya ordenado.
CREATE INDEX IF NOT EXISTS transferencia_estado_trn_en_idx
  ON transferencia_estado (transferencia_id, en DESC, id DESC)
  INCLUDE (estado, usuario, detalle);

-- Auditoría temporal + filtros más frecuentes. id estabiliza el cursor.
CREATE INDEX IF NOT EXISTS auditoria_en_id_idx
  ON auditoria (en DESC, id DESC)
  INCLUDE (usuario, rol, tipo, accion, api, resultado);

CREATE INDEX IF NOT EXISTS auditoria_usuario_en_id_idx
  ON auditoria (usuario, en DESC, id DESC)
  INCLUDE (rol, tipo, accion, api, resultado);

CREATE INDEX IF NOT EXISTS auditoria_tipo_en_id_idx
  ON auditoria (tipo, en DESC, id DESC)
  INCLUDE (usuario, rol, accion, api, resultado);

-- Búsqueda textual opcional de auditoría. pg_trgm permite acelerar ILIKE '%texto%'.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS auditoria_busqueda_trgm_idx
  ON auditoria USING gin ((accion || ' ' || coalesce(detalle, '') || ' ' || coalesce(api, '')) gin_trgm_ops);

-- Lotes pendientes de aprobación.
CREATE INDEX IF NOT EXISTS lote_pend_aprobacion_idx
  ON lote (creado_en, id)
  INCLUDE (archivo, formato, validas, importe, creador)
  WHERE estado = 'PENDIENTE_APROBACION';

-- Permisos: PK(usuario, empresa_id) ya cubre lectura por usuario.
-- Este índice cubre administración/listados inversos por empresa.
CREATE INDEX IF NOT EXISTS permiso_empresa_empresa_usuario_idx
  ON permiso_empresa (empresa_id, usuario)
  INCLUDE (ver, operar);

-- CBU activos por empresa: evita leer relaciones dadas de baja.
CREATE INDEX IF NOT EXISTS empresa_cbu_empresa_activa_idx
  ON empresa_cbu (empresa_id, product_number)
  INCLUDE (cbu, alias, titular, cuit_titular, moneda)
  WHERE estado = 'activa';

-- Estadísticas más precisas para columnas correlacionadas usadas juntas.
CREATE STATISTICS IF NOT EXISTS transferencia_estado_origen_stats
  (dependencies, mcv) ON estado, cuenta_origen FROM transferencia;

ANALYZE transferencia;
ANALYZE transferencia_estado;
ANALYZE auditoria;
ANALYZE lote;
ANALYZE empresa_cbu;
