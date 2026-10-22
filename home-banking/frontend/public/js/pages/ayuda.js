// Ayuda: manual de usuario resumido, filtrado según el perfil y los roles Crear/Aprobar de quien lo mira.
import { h, poner, card } from '../ui.js';

const SECCIONES = [
  { t: 'Ingreso', para: () => true, pasos: [
    'Ingresá con tu usuario corporativo de VALO. El recupero de clave y los desbloqueos se gestionan en el inicio de sesión de VALO.',
    'Solo ves las empresas y cuentas que el administrador de seguridad te habilitó.',
    'Con el botón Modo oscuro / Modo claro del encabezado cambiás el tema; queda recordado en este navegador.'] },
  { t: 'Saldos', para: (m) => m.rol !== 'administrador', pasos: [
    'Al ingresar ves el total disponible de todas tus empresas. Elegí una empresa para ver sus indicadores y sus cuentas.',
    'El tag “Débitos realizados” muestra los débitos del día de cada empresa; “Ver débitos realizados” abre esa pantalla filtrada por la empresa elegida.',
    'Elegí una cuenta para ver su detalle e ir a sus movimientos del día o consultar el histórico.'] },
  { t: 'Movimientos', para: (m) => m.rol !== 'administrador', pasos: [
    'Por defecto se muestran los movimientos del día de la cuenta elegida. Con “Histórico” elegís un rango de fechas.',
    'Los resultados se paginan cada 900 líneas, igual que la API del banco.',
    '“Exportar a Excel” descarga todos los movimientos del período.'] },
  { t: 'Débitos realizados', para: (m) => m.rol !== 'administrador', pasos: [
    'Lista los débitos de tus cuentas del día o de un rango histórico, con filtro por empresa.',
    'La ruedita ⚙ abre la auditoría del débito: si salió del Home Banking ves quién lo cargó, quién lo aprobó y cada cambio de estado.'] },
  { t: 'Consulta de CBU', para: (m) => ['operador', 'autorizante'].includes(m.rol), pasos: [
    'Ingresá un CBU/CVU de 22 dígitos o un alias para ver titular, CUIT, moneda y si la cuenta está activa en COELSA. Es una consulta: no requiere aprobación.'] },
  { t: 'Transferir', para: (m) => m.puedeCrear, pasos: [
    'Elegí el tipo (Inmediata, Entre cuentas propias, Terceros BdV o MEP) y la cuenta origen; solo aparecen las cuentas que podés operar.',
    'Para Inmediata y MEP validá el destino en COELSA antes de enviar.',
    '“Enviar a aprobación” deja la transferencia pendiente: no se envía al banco hasta que otro usuario con rol Aprobar la apruebe.'] },
  { t: 'Carga masiva', para: (m) => m.puedeCrear, pasos: [
    'Subí un CSV, Excel o TXT con una transferencia por fila. Antes de enviar nada se muestra el detalle previo con la validación de cada fila.',
    'Confirmá las filas válidas para mandarlas a aprobación, o descartá el lote. Al aprobarse, cada fila se envía al banco por separado.'] },
  { t: 'Aprobaciones', para: (m) => m.puedeAprobar, pasos: [
    'Ves las transferencias y lotes pendientes de aprobación. Aprobar envía al banco; rechazar las descarta sin enviarlas.',
    'No podés aprobar lo que cargaste vos, aunque tengas ambos roles.',
    'En “Estado de las transferencias aprobadas” seguís el resultado en el banco: Pendiente de autorización o Debitada.'] },
  { t: 'Transferencias', para: (m) => m.rol !== 'administrador', pasos: [
    'Registro de todo lo cargado, individual y por lote, con estado, quién lo cargó y aprobó y la respuesta del banco.',
    '“Hoy” y “Base operativa” consultan la base operativa; lo anterior se consulta aparte en “Base histórica”.',
    'La ruedita ⚙ abre el historial completo de la transferencia: creación, aprobación y cada cambio de estado.'] },
  { t: 'Auditoría', para: (m) => ['auditor', 'administrador'].includes(m.rol), pasos: [
    'Registro de solo lectura de cada acción. Filtrá por fechas, usuario, tipo o texto.',
    'La base operativa tiene el mes en curso y el mes anterior completo; el día 1 de cada mes lo más viejo pasa a la base histórica.'] },
  { t: 'Administración de seguridad', para: (m) => m.rol === 'administrador', pasos: [
    'Empresas: dá de alta empresas, asignales cuentas sin asignar, desactivalas (suspende los permisos) o eliminalas (libera cuentas y quita permisos).',
    'Permisos: asigná los roles Crear / Aprobar y los permisos Ver / Operar por empresa a cada usuario.',
    'Credenciales API: cargá la credencial de VALO ante el banco. La clave es de solo escritura y nunca se vuelve a mostrar.'] },
];

export async function render(main, ctx) {
  const me = ctx.me;
  poner(main, 
    card('Ayuda · manual de usuario', `Lo que podés hacer con tu perfil (${me.rol}${me.puedeCrear ? ' · Crear' : ''}${me.puedeAprobar ? ' · Aprobar' : ''}).`,
      ctx.cfg?.docs?.manual && h('p', {}, h('a', { class: 'btn chico', href: ctx.cfg.docs.manual, target: '_blank', rel: 'noopener' }, 'Abrir el manual completo'))),
    ...SECCIONES.filter((s) => s.para(me)).map((s) => card(s.t, null, h('div', { class: 'ayuda' }, h('ol', {}, s.pasos.map((p) => h('li', {}, p)))))));
}
