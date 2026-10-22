-- Cuentas de empresa con CBU, alias de COELSA, estado e historial (reemplaza a cuenta_empresa).
-- Idempotente. Las asignaciones existentes pasan como activas con CBU pendiente (se completa desde la pantalla).
SET client_min_messages = warning;
CREATE TABLE IF NOT EXISTS empresa_cbu (
  id               bigserial PRIMARY KEY,
  empresa_id       bigint REFERENCES empresa(id) ON DELETE SET NULL,
  empresa_cuit     char(11) NOT NULL,
  product_number   text NOT NULL,
  cbu              char(22) CHECK (cbu ~ '^[0-9]{22}$'),
  alias            text,
  titular          text,
  cuit_titular     text,
  moneda           text,
  coelsa_en        timestamptz,
  estado           text NOT NULL DEFAULT 'activa' CHECK (estado IN ('activa', 'baja')),
  asignada_por     text NOT NULL,
  asignada_en      timestamptz NOT NULL DEFAULT now(),
  baja_por         text,
  baja_en          timestamptz,
  CHECK (estado = 'baja' OR empresa_id IS NOT NULL),
  CHECK ((estado = 'baja') = (baja_en IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS empresa_cbu_cbu_activa    ON empresa_cbu (cbu)            WHERE estado = 'activa';
CREATE UNIQUE INDEX IF NOT EXISTS empresa_cbu_cuenta_activa ON empresa_cbu (product_number) WHERE estado = 'activa';
CREATE INDEX IF NOT EXISTS empresa_cbu_empresa_idx ON empresa_cbu (empresa_id, estado);

DO $$ BEGIN
  IF to_regclass('public.cuenta_empresa') IS NOT NULL THEN
    INSERT INTO empresa_cbu (empresa_id, empresa_cuit, product_number, asignada_por, asignada_en)
    SELECT ce.empresa_id, e.cuit, ce.product_number, coalesce(ce.asignada_por, 'migración'), coalesce(ce.asignada_en, now())
      FROM cuenta_empresa ce JOIN empresa e ON e.id = ce.empresa_id
     WHERE NOT EXISTS (SELECT 1 FROM empresa_cbu x WHERE x.product_number = ce.product_number AND x.estado = 'activa');
    DROP TABLE cuenta_empresa;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hb_app') THEN
    GRANT SELECT, INSERT, UPDATE ON empresa_cbu TO hb_app;
    GRANT USAGE, SELECT ON SEQUENCE empresa_cbu_id_seq TO hb_app;
  END IF;
END $$;
