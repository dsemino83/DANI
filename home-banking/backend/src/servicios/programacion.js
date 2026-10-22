// Motor de los envíos programados: qué turnos corresponden a cada día y cuál está vencido.
// Todo en hora de Argentina (UTC-3 fijo: el país no usa horario de verano desde 2009).
import { invalido } from '../errores.js';

const OFFSET_MS = 3 * 3600_000;
const pad = (n) => String(n).padStart(2, '0');

// Fecha, hora y día de la semana (1 = lunes … 7 = domingo) en Argentina
export function enArgentina(d = new Date()) {
  const a = new Date(d.getTime() - OFFSET_MS);
  return {
    fecha: `${a.getUTCFullYear()}-${pad(a.getUTCMonth() + 1)}-${pad(a.getUTCDate())}`,
    hora: `${pad(a.getUTCHours())}:${pad(a.getUTCMinutes())}`,
    diaSemana: a.getUTCDay() === 0 ? 7 : a.getUTCDay(),
  };
}
// 'AAAA-MM-DD' + 'HH:MM' de Argentina → instante
export const instante = (fecha, hora) => new Date(`${fecha}T${hora}:00-03:00`);
const diaSemanaDe = (fecha) => { const d = new Date(`${fecha}T12:00:00Z`).getUTCDay(); return d === 0 ? 7 : d; };
const sumarDia = (fecha, n = 1) => new Date(new Date(`${fecha}T12:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10);
const hhmm = (t) => String(t ?? '').slice(0, 5);

// Minutos entre turnos de las frecuencias con franja (desde "hora" hasta "hora_hasta" inclusive)
export const PASO_MIN = { horaria: 60, media_hora: 30 };

// Turnos (HH:MM) de un día: diaria = uno; horaria / media_hora = cada 60 / 30 minutos dentro de la franja
export function turnosDelDia(p) {
  if (p.frecuencia === 'diaria') return [hhmm(p.hora)];
  const aMin = (t) => { const [h, m] = hhmm(t).split(':').map(Number); return h * 60 + m; };
  const turnos = [];
  for (let t = aMin(p.hora), fin = aMin(p.hora_hasta); t <= fin && t < 1440; t += PASO_MIN[p.frecuencia]) turnos.push(`${pad(Math.floor(t / 60))}:${pad(t % 60)}`);
  return turnos;
}

// ¿Ese día se envía? Dentro de inicio/fin, en un día de la semana elegido y (si corresponde) no feriado.
export function diaHabilitado(p, fecha, esFeriado = () => false) {
  if (fecha < String(p.fecha_inicio).slice(0, 10)) return false;
  if (p.fecha_fin && fecha > String(p.fecha_fin).slice(0, 10)) return false;
  if (!(p.dias_semana ?? []).map(Number).includes(diaSemanaDe(fecha))) return false;
  return !(p.saltar_feriados && esFeriado(fecha));
}

// Turno vencido a ejecutar ahora: el último del día con hora <= ahora, de hace menos de una hora y posterior
// al último ejecutado. Si el sistema estuvo caído, no manda los atrasados (solo el más reciente).
export function turnoVencido(p, ahora = new Date(), esFeriado) {
  if (!p.activa) return null;
  const { fecha } = enArgentina(ahora);
  if (!diaHabilitado(p, fecha, esFeriado)) return null;
  const vencidos = turnosDelDia(p).map((h) => ({ clave: `${fecha}T${h}`, t: instante(fecha, h) }))
    .filter((x) => x.t <= ahora && ahora - x.t < 3600_000);
  const ultimo = vencidos.at(-1);
  if (!ultimo || (p.ultimo_turno && ultimo.clave <= p.ultimo_turno)) return null;
  return ultimo.clave;
}

// Próximo envío (para mostrar en pantalla); null si no hay ninguno en el próximo año o si terminó
export function proximoTurno(p, ahora = new Date(), esFeriado) {
  if (!p.activa) return null;
  let { fecha } = enArgentina(ahora);
  for (let i = 0; i < 400; i++, fecha = sumarDia(fecha)) {
    if (p.fecha_fin && fecha > String(p.fecha_fin).slice(0, 10)) return null;
    if (!diaHabilitado(p, fecha, esFeriado)) continue;
    const t = turnosDelDia(p).map((h) => instante(fecha, h)).find((x) => x > ahora);
    if (t) return t;
  }
  return null;
}

// Validación de lo que carga el administrador
export function validarProgramacion(d) {
  const nombre = String(d.nombre ?? '').trim();
  if (!nombre) throw invalido('Falta el nombre');
  if (!['saldos', 'movimientos', 'saldos_movimientos'].includes(d.contenido)) throw invalido('Contenido inválido');
  const formato = d.formato ?? 'cuerpo';
  if (!['cuerpo', 'cuerpo_excel'].includes(formato)) throw invalido('Formato inválido: cuerpo del correo, o cuerpo + Excel adjunto');
  if (!['diaria', 'horaria', 'media_hora'].includes(d.frecuencia)) throw invalido('Frecuencia inválida: diaria, horaria o cada 30 minutos');
  const conFranja = d.frecuencia !== 'diaria';
  const hora = hhmm(d.hora), horaHasta = conFranja ? hhmm(d.horaHasta) : null;
  const esHora = (x) => /^([01]\d|2[0-3]):[0-5]\d$/.test(x);
  if (!esHora(hora)) throw invalido('Hora inválida (HH:MM)');
  if (conFranja && (!esHora(horaHasta) || horaHasta < hora)) throw invalido('"Hasta" tiene que ser una hora igual o posterior a "desde"');
  const dias = [...new Set((d.diasSemana ?? []).map(Number))].filter((x) => x >= 1 && x <= 7).sort();
  if (!dias.length) throw invalido('Elegí al menos un día de la semana');
  const esFecha = (x) => /^\d{4}-\d{2}-\d{2}$/.test(String(x ?? ''));
  if (!esFecha(d.fechaInicio)) throw invalido('Fecha de inicio inválida');
  if (d.fechaFin && (!esFecha(d.fechaFin) || d.fechaFin < d.fechaInicio)) throw invalido('La fecha de fin tiene que ser igual o posterior al inicio');
  // Destinos: primero el cliente y después sus cuentas (cuentas vacío = todas las del cliente)
  const todas = d.todasEmpresas !== false;
  const porEmpresa = new Map();
  for (const x of todas ? [] : d.destinos ?? []) {
    const id = Number(x?.empresaId);
    if (!id) continue;
    const cuentas = [...new Set((x.cuentas ?? []).map(String).filter(Boolean))].sort();
    porEmpresa.set(id, cuentas);
  }
  const destinos = [...porEmpresa].map(([empresaId, cuentas]) => ({ empresaId, cuentas }));
  if (!todas && !destinos.length) throw invalido('Elegí al menos un cliente o "todos"');
  return { nombre, contenido: d.contenido, formato, frecuencia: d.frecuencia, hora, horaHasta, dias, saltarFeriados: d.saltarFeriados !== false,
    fechaInicio: d.fechaInicio, fechaFin: d.fechaFin || null, todas, destinos, activa: d.activa !== false };
}
