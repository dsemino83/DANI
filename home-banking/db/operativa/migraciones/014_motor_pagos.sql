-- Motor de pagos: las autorizaciones ya no envían al banco en el acto, sino que dejan la transferencia
-- EN_COLA; un motor la toma (ENVIANDO) y la envía, ordenando por hora de creación y paralelizando solo
-- entre endpoints (api) distintos. Acá se agrega el estado EN_COLA y un índice para que el motor tome
-- la más vieja de cada endpoint de forma eficiente. Idempotente.
DO $$
BEGIN
  ALTER TABLE transferencia DROP CONSTRAINT IF EXISTS transferencia_estado_check;
  ALTER TABLE transferencia ADD  CONSTRAINT transferencia_estado_check CHECK (estado IN (
    'PENDIENTE_APROBACION', 'EN_COLA', 'RECHAZADA', 'ENVIANDO', 'ENVIADA',
    'PEND_AUTORIZACION', 'DEBITADA', 'RECHAZADA_BANCO', 'ERROR_API'));
END $$;

-- El motor toma la EN_COLA más vieja de cada endpoint: (api, creado_en) solo sobre las encoladas.
CREATE INDEX IF NOT EXISTS transferencia_cola_pago_idx ON transferencia (api, creado_en) WHERE estado = 'EN_COLA';

-- Nuevo circuito de estados: la autorización va a EN_COLA y el motor la pasa a ENVIANDO.
CREATE OR REPLACE FUNCTION hb_transicion_valida() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.estado = OLD.estado THEN RETURN NEW; END IF;
  IF (OLD.estado, NEW.estado) IN (
       ('PENDIENTE_APROBACION', 'EN_COLA'), ('PENDIENTE_APROBACION', 'RECHAZADA'),
       ('EN_COLA', 'ENVIANDO'),
       ('ENVIANDO', 'ENVIADA'), ('ENVIANDO', 'PEND_AUTORIZACION'), ('ENVIANDO', 'DEBITADA'),
       ('ENVIANDO', 'ERROR_API'), ('ENVIANDO', 'RECHAZADA_BANCO'),
       ('ENVIADA', 'PEND_AUTORIZACION'), ('ENVIADA', 'DEBITADA'), ('ENVIADA', 'RECHAZADA_BANCO'), ('ENVIADA', 'ERROR_API'),
       ('PEND_AUTORIZACION', 'DEBITADA'), ('PEND_AUTORIZACION', 'RECHAZADA_BANCO')) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Transición de estado no permitida para OP-%: % -> %', OLD.id, OLD.estado, NEW.estado;
END $$;
