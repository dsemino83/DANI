// Armado y envío de transferencias según el PDF del Banco de Valores.
// Solo se invoca desde la APROBACIÓN; la carga no toca el banco.
import { bdv, ErrorBanco } from './cliente.js';
import { invalido } from '../errores.js';

export const API_POR_TIPO = {
  INMEDIATA: 'transfers/immediates',
  PROPIAS: 'transfers/transferBetweenOwnAccount',
  TERCEROS: 'transfers/transferThirdPartyAccount',
  MEP: 'transfers/transferMep',
};

export const CONCEPTOS_INMEDIATAS = ['ALQUILERES', 'OPERACIONES INMOBILIARIAS', 'OPERACIONES INMOBILIARIAS HABITUALISTA',
  'BIENES REGISTRABLES HABITUALISTAS', 'BIENES REGISTRABLES NO HABITUALISTAS', 'SUSCRIPCION OBLIGACIONES NEGOCIABLES',
  'APORTES DE CAPITAL', 'REINTEGROS DE OBRAS SOCIALES Y PREPAGOS', 'SINIESTROS DE SEGUROS', 'ESTADO EXPROPIACIONES U OTROS',
  'CUOTAS', 'EXPENSAS', 'FACTURA', 'PRESTAMO', 'SEGUROS', 'HONORARIOS', 'VARIOS', 'HABERES'];
export const CONCEPTOS_TERCEROS = ['NOR', 'RFCI', 'SFCI'];
export const CODIGOS_MEP = ['DL0', 'DL1', 'DL2', 'DR0', 'DR1', 'DR2', 'D20', 'GC0', 'GC1', 'GC2'];
export const CONCEPTOS_FIJOS_MEP = ['ALQ', 'CUO', 'EXP', 'FAC', 'HAB', 'HON', 'PRE', 'SEG', 'VAR', 'OIN', 'OIH', 'BRH', 'SON',
  'ROP', 'ESE', 'ERN', 'APC', 'SIS'];

// Longitud máxima de conceptV por código MEP (diccionario de datos transferMep)
export function largoConceptoMep(codigo) {
  if (/^D[LR][0-2]$/.test(codigo)) return 30;
  if (codigo === 'GC0' || codigo === 'D20') return 100;
  return 50; // GC1, GC2
}

const productIdDe = (cuenta) => Number(cuenta.productId);
const monedaDe = (cuenta) => Number(cuenta.currencyId);

// Valida la carga y devuelve el request exacto que se enviará al aprobar.
// `origen` es la cuenta de getOwnAccounts; `d` los datos del formulario o de la fila del lote.
export function armarRequest(tipo, origen, d) {
  const importe = Number(d.importe);
  if (!(importe > 0)) throw invalido('El importe debe ser mayor a cero');
  switch (tipo) {
    case 'INMEDIATA': {
      const dest = String(d.destino ?? '').trim();
      if (!dest) throw invalido('Falta el CBU/CVU o alias destino');
      const concepto = String(d.concepto ?? 'VARIOS').toUpperCase();
      if (!CONCEPTOS_INMEDIATAS.includes(concepto)) throw invalido(`Concepto inválido para inmediatas: ${concepto}`);
      const esCbu = /^\d{22}$/.test(dest);
      return {
        destination: { cbu: esCbu ? dest : '', alias: esCbu ? '' : dest },
        origin: { currencyId: monedaDe(origen), productId: productIdDe(origen), productNumber: origen.productNumber },
        concept: concepto, amount: importe,
        ddjjIsAccountHolder: Boolean(d.ddjjTitular), reference: String(d.referencia ?? 'HOME BANKING').slice(0, 30),
        ddjjIsCtaCte: Boolean(d.ddjjCtaCte), payer: String(d.ordenante ?? ''),
      };
    }
    case 'PROPIAS':
      if (!d.destino) throw invalido('Falta la cuenta propia destino');
      return { originAccountNumber: origen.productNumber, destinationAccountNumber: String(d.destino), amount: String(importe), concept: String(d.concepto ?? '').slice(0, 30) };
    case 'TERCEROS': {
      if (!d.destino) throw invalido('Falta la cuenta destino en Banco de Valores');
      const conceptId = String(d.conceptoId ?? 'NOR');
      if (!CONCEPTOS_TERCEROS.includes(conceptId)) throw invalido('conceptId debe ser NOR, RFCI o SFCI');
      return {
        originAccountNumber: origen.productNumber, destinationAccountNumber: String(d.destino), amount: String(importe),
        concept: String(d.concepto ?? '').slice(0, 30), payer: String(d.ordenante ?? ''), isThirdRegistered: 'N', conceptId,
      };
    }
    case 'MEP': {
      const codigo = String(d.codigoMep ?? '');
      if (!CODIGOS_MEP.includes(codigo)) throw invalido(`Código MEP inválido: ${codigo}`);
      const conceptV = String(d.conceptoLibre ?? '');
      if (conceptV.length > largoConceptoMep(codigo)) throw invalido(`El concepto libre admite ${largoConceptoMep(codigo)} caracteres para ${codigo}`);
      const conCbu = /^D[LR][0-2]$|^GC[12]$/.test(codigo);
      if (conCbu && !/^\d{22}$/.test(String(d.destino ?? ''))) throw invalido('El código MEP requiere CBU destino de 22 dígitos');
      if (!/^\d{11}$/.test(String(d.cuitDestino ?? ''))) throw invalido('CUIT/CUIL destinatario inválido');
      const conceptF = /^D[LR][0-2]$/.test(codigo) ? String(d.conceptoFijo ?? 'VAR') : codigo === 'D20' ? '1' : '';
      if (/^D[LR][0-2]$/.test(codigo) && !CONCEPTOS_FIJOS_MEP.includes(conceptF)) throw invalido('Concepto fijo MEP inválido');
      return {
        transfType: codigo, amount: String(importe), currencyIdOri: String(monedaDe(origen)), productNumberOri: origen.productNumber,
        productIdOri: String(productIdDe(origen)), cbuDest: conCbu ? String(d.destino) : '', cuitDest: String(d.cuitDestino),
        productNumberDest: codigo === 'D20' ? String(d.cuentaDestino ?? '') : '', currencyIdDest: String(monedaDe(origen)),
        holder: String(d.titular ?? ''), conceptF, conceptV,
        ...(codigo.startsWith('GC') && codigo !== 'GC0' ? { inversionType: String(d.tipoInversion ?? '01'), foundsSource: String(d.origenFondos ?? 'P') } : {}),
        ...(codigo === 'D20' ? { foundsSource: String(d.origenFondos ?? '1'), pep: String(d.pep ?? 'S0'), expNum_Cause: '', courtData: '' } : {}),
        // Ojo: el ejemplo del PDF usa booleanos y el diccionario S/N; confirmar con el banco.
        ddjjIsAccountHolder: codigo === 'D20' ? false : Boolean(d.ddjjTitular),
        ddjjIsCtaCte: codigo === 'D20' ? true : Boolean(d.ddjjCtaCte),
      };
    }
    default:
      throw invalido(`Tipo de transferencia inválido: ${tipo}`);
  }
}

// Interpreta la respuesta del banco al enviar.
// immediates: nroControl presente = operó sin flujo de autorización del banco; null = queda pendiente allá.
// Demás APIs: solo transactionId; el estado final se sincroniza con getTransfersStatus.
export function estadoTrasEnvio(tipo, json) {
  if (!json?.success) return { estado: 'ERROR_API', transactionId: null, nroControl: null, detalle: json?.message?.message ?? 'success: false', codigo: json?.message?.code ?? null };
  const transactionId = json.transactionId != null ? String(json.transactionId) : null;
  const nroControl = json.nroControl != null ? String(json.nroControl) : null;
  if (tipo === 'INMEDIATA') return { estado: nroControl ? 'DEBITADA' : 'PEND_AUTORIZACION', transactionId, nroControl };
  return { estado: 'ENVIADA', transactionId, nroControl };
}

// status de getTransfersStatus: F finalizada, P pendiente, E eliminada, R rechazada
export function estadoDesdeBanco(item) {
  switch (item.status) {
    case 'F': return item.finalized === 'N' ? 'PEND_AUTORIZACION' : 'DEBITADA';
    case 'P': return 'PEND_AUTORIZACION';
    case 'E':
    case 'R': return 'RECHAZADA_BANCO';
    default: return null;
  }
}

export async function enviar(tipo, request) {
  const ruta = API_POR_TIPO[tipo];
  try {
    const json = await bdv.llamar(ruta, request);
    return { ...estadoTrasEnvio(tipo, json), respuesta: json };
  } catch (e) {
    // Timeout o corte DESPUÉS de enviar: no sabemos si el banco la ejecutó. Queda ENVIADA
    // (sin reintento automático) y se concilia con getTransfersStatus o manualmente.
    if (e instanceof ErrorBanco && e.sinRespuesta) {
      return { estado: 'ENVIADA', transactionId: null, nroControl: null, detalle: `${e.message}; verificar con getTransfersStatus antes de reintentar`, respuesta: { error: e.message } };
    }
    // El banco respondió con error, o no se pudo conectar / iniciar sesión: no se ejecutó.
    if (e instanceof ErrorBanco) return { estado: 'ERROR_API', transactionId: null, nroControl: null, detalle: e.message, respuesta: { error: e.message, http: e.http } };
    throw e;
  }
}
