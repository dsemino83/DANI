// Ayuda: manual de usuario resumido, filtrado según el perfil y los roles Crear/Aprobar de quien lo mira.
import { h, poner, card } from '../ui.js';
import { mostrarDocumento } from './documentacion.js';

const SECCIONES = [
  { t: 'Ingreso y encabezado', para: () => true, pasos: [
    'Ingresá con tu usuario corporativo de VALO. El recupero de clave y los desbloqueos se gestionan en el inicio de sesión de VALO.',
    'Solo ves las empresas y cuentas que el administrador de seguridad te habilitó.',
    'Los datos del banco se consultan una vez y se reutilizan; el encabezado muestra su hora y “↻ Actualizar datos” los vuelve a pedir.',
    'Con el botón Modo oscuro / Modo claro cambiás el tema; queda recordado en este navegador.'] },
  { t: 'Buzón de mensajes', para: (m) => m.rol !== 'administrador', pasos: [
    'Cuando otro usuario carga una operación que necesita autorización en un cliente que tenés asociado, te llega un mensaje.',
    'Con mensajes sin leer el botón ✉ Mensajes queda rojo y latiendo; un mensaje nuevo se abre solo. “Aceptar” lleva a Aprobaciones.',
    'Un mensaje queda leído al abrirlo (los demás siguen sin leer) o solo, cuando su operación ya fue autorizada o resuelta. Se ven los últimos 7 días.'] },
  { t: 'Saldos', para: (m) => m.rol !== 'administrador', pasos: [
    'Al ingresar ves el total disponible de todas tus empresas; el buscador filtra empresas y cuentas. Elegí una empresa para ver solo esa.',
    'Los débitos de hoy de cada cuenta abren Débitos realizados filtrado por esa cuenta.',
    '“Constancia” emite la constancia de CBU de la cuenta con el logo de VALO, para imprimir o guardar en PDF.'] },
  { t: 'Movimientos', para: (m) => m.rol !== 'administrador', pasos: [
    'Por defecto se muestran los movimientos del día de la cuenta elegida. Con “Histórico” elegís un rango; “↻ Consultar nuevamente” vuelve a pedirlos al banco.',
    '“Créditos por causal” y “Créditos por beneficiario” resumen los ingresos; tocá una fila para filtrar el detalle.',
    'La columna “CBU origen / Beneficiario” muestra el CBU originante en las causales 366 y 367 y el beneficiario en las demás.',
    '“Exportar a Excel” descarga todos los movimientos del período con las mismas columnas.'] },
  { t: 'Débitos realizados', para: (m) => m.rol !== 'administrador', pasos: [
    'Lista los débitos de tus cuentas del día o de un rango histórico, con filtro por cliente, cuenta y buscador.',
    'Tocá el total en pesos o en dólares para ver solo esa moneda; tocalo de nuevo para ver ambas.',
    'La ruedita ⚙ abre la auditoría del débito. La exportación a Excel lleva el logo del banco.'] },
  { t: 'Consulta de CBU', para: (m) => ['operador', 'autorizante'].includes(m.rol), pasos: [
    'Ingresá un CBU/CVU de 22 dígitos o un alias para ver titular, CUIT, moneda y si la cuenta está activa en COELSA. Es una consulta: no requiere aprobación.'] },
  { t: 'Transferir', para: (m) => m.puedeCrear, pasos: [
    'Elegí el tipo (Inmediata, Entre cuentas propias, Terceros BdV o MEP) y la cuenta origen; solo aparecen las cuentas que podés operar.',
    'Para Inmediata y MEP validá el destino en COELSA antes de enviar.',
    '“Enviar a aprobación” deja la transferencia pendiente y avisa a los autorizantes del cliente por el buzón: no se envía al banco hasta que otro usuario la apruebe.'] },
  { t: 'Carga masiva', para: (m) => m.puedeCrear, pasos: [
    'Subí un CSV, Excel o TXT con una transferencia por fila. Antes de enviar nada se muestra el detalle previo con la validación de cada fila.',
    'Confirmá las filas válidas para mandarlas a aprobación, o descartá el lote. Al aprobarse, cada fila se envía al banco por separado.'] },
  { t: 'Aprobaciones', para: (m) => m.puedeAprobar, pasos: [
    'Ves las transferencias y lotes pendientes de aprobación. Aprobar envía al banco; rechazar las descarta sin enviarlas.',
    'No podés aprobar lo que cargaste vos, aunque tengas ambos roles.',
    'En “Estado de las transferencias aprobadas” seguís el resultado en el banco: Pendiente de autorización o Debitada.'] },
  { t: 'Transferencias', para: (m) => m.rol !== 'administrador', pasos: [
    'Registro de todo lo cargado, individual y por lote, con estado, quién lo cargó y aprobó y la respuesta del banco.',
    '“Hoy” y “Base operativa” (mes en curso y el anterior) consultan la base operativa; lo anterior se consulta aparte en “Base histórica”.',
    'La ruedita ⚙ abre el historial completo de la transferencia: creación, aprobación y cada cambio de estado.'] },
  { t: 'Cartera de oficiales', para: (m) => m.rol === 'autorizante', pasos: [
    'Asigná a cada oficial los clientes de su cartera: si tiene clientes asignados, solo ve las cuentas de esos clientes.'] },
  { t: 'Envíos programados', para: (m) => m.rol === 'autorizante', pasos: [
    '1 vez al día = extracto diario (saldos y/o movimientos del día). Cada hora o cada 30 minutos = alerta de movimientos de los últimos 29:59 minutos, que solo se envía si hubo movimientos.',
    'Formato: solo en el cuerpo del correo, o cuerpo + Excel adjunto (una pestaña por cuenta, con el logo del banco).',
    'Elegí el cliente y sus cuentas, los días, inicio, fin y feriados. Cada cliente puede tener un solo extracto diario y una sola alerta activos.',
    '“Cola de envíos” muestra cada envío; los fallidos se reintentan y se pueden reintentar a mano. “Ejecutar ahora” encola una prueba.'] },
  { t: 'Auditoría', para: (m) => ['auditor', 'administrador'].includes(m.rol), pasos: [
    'Registro de solo lectura de cada acción. Filtrá por fechas, usuario, tipo o texto.',
    'La base operativa tiene el mes en curso y el mes anterior completo; el día 1 de cada mes lo más viejo pasa a la base histórica.'] },
  { t: 'Administración de seguridad', para: (m) => m.rol === 'administrador', pasos: [
    'Empresas: alta con emails (✎ edita, ✕ quita), cuentas validadas en COELSA, desactivar o eliminar.',
    'Usuarios y permisos: perfiles, roles Crear / Aprobar y permisos Ver / Operar por empresa.',
    'Credenciales API: la principal y la de Envíos programados (usuario API distinto, channel editable). La clave es de solo escritura y nunca se vuelve a mostrar.',
    'Documentación: auditoría, técnica y manual de usuario, incluidas en la aplicación.'] },
];

export async function render(main, ctx) {
  const me = ctx.me;
  poner(main, 
    card('Ayuda · manual de usuario', `Lo que podés hacer con tu perfil (${me.rol}${me.puedeCrear ? ' · Crear' : ''}${me.puedeAprobar ? ' · Aprobar' : ''}).`,
      h('p', {}, h('button', { class: 'btn chico', onclick: () => mostrarDocumento(main, 'manual', () => render(main, ctx)) }, 'Abrir el manual completo'))),
    ...SECCIONES.filter((s) => s.para(me)).map((s) => card(s.t, null, h('div', { class: 'ayuda' }, h('ol', {}, s.pasos.map((p) => h('li', {}, p)))))));
}
