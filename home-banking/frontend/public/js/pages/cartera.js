// Cartera de oficiales (aprobador): qué clientes ve cada oficial. Sin clientes asignados el oficial ve
// todas las cuentas de las empresas que le habilitó el administrador; con cartera, solo las de esos clientes.
import { api } from '../api.js';
import { h, poner, card, campo, tabla, pill, toast, error, cargando } from '../ui.js';

const plano = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export async function render(main) {
  let oficiales = [], elegido = null;
  const lista = h('div', {}, cargando()), detalle = h('div', {});

  const cargar = async () => {
    oficiales = await api('/cartera/oficiales');
    dibujarLista();
    await dibujarDetalle();
  };

  const dibujarLista = () => poner(lista, tabla([
    { t: 'Oficial', v: (o) => o.usuario, cls: 'mono' }, { t: 'Nombre', v: (o) => o.nombre },
    { t: 'Ve', v: (o) => (o.clientes ? pill(`${o.clientes} cliente(s)`, 'warn') : pill('Todos sus clientes', 'ok')) },
  ], oficiales, { alClic: (o) => { elegido = o.usuario; dibujarLista(); dibujarDetalle(); }, sel: (o) => o.usuario === elegido, vacio: 'No hay oficiales (perfil operador) habilitados.' }));

  const dibujarDetalle = async () => {
    if (!elegido) return poner(detalle, card('Cartera del oficial', 'Elegí un oficial de la lista.'));
    const oficial = elegido;
    poner(detalle, cargando());
    const d = await api(`/cartera/oficiales/${encodeURIComponent(oficial)}`);
    if (elegido !== oficial) return;
    const filas = d.clientes.map((c) => ({ c, x: h('input', { type: 'checkbox', checked: c.asignada, 'aria-label': `Asignar ${c.razon_social}` }) }));
    const buscar = h('input', { type: 'search', placeholder: 'Buscar cliente por nombre o CUIT (contiene)' });
    const cuerpo = h('div', {});
    const pintar = () => poner(cuerpo, tabla([
      { t: 'Asignado', v: (f) => f.x, cls: 'c' }, { t: 'Cliente', v: (f) => f.c.razon_social }, { t: 'CUIT', v: (f) => f.c.cuit, cls: 'mono' }, { t: 'Cuentas', v: (f) => f.c.cuentas, cls: 'num' },
    ], filas.filter((f) => !buscar.value.trim() || plano(`${f.c.razon_social} ${f.c.cuit}`).includes(plano(buscar.value).trim())),
    { vacio: d.clientes.length ? 'Ningún cliente coincide con la búsqueda.' : 'No ves ningún cliente: pedile al administrador permisos sobre empresas.' }));
    buscar.addEventListener('input', pintar);
    const guardar = async (ids) => {
      try {
        const r = await api(`/cartera/oficiales/${encodeURIComponent(oficial)}`, { method: 'PUT', body: { empresas: ids } });
        toast(r.total ? `${oficial} ve solo ${r.total} cliente(s).` : `${oficial} sin cartera: ve todos sus clientes.`);
      } catch (x) { error(x); return; }
      await cargar();
    };
    pintar();
    poner(detalle, card(`Cartera de ${oficial}`, 'Tildá los clientes que atiende este oficial: solo va a ver las cuentas de esos clientes. Sin ninguno tildado ve todos los clientes que le habilitó el administrador.',
      d.fueraDeTuVista.length > 0 && h('p', { class: 'aviso' }, `También tiene asignados clientes que vos no ves (los asignó otro aprobador): ${d.fueraDeTuVista.join(', ')}. No se modifican.`),
      campo('Buscar', buscar), cuerpo,
      h('div', { class: 'fila' },
        h('button', { class: 'btn primario', onclick: () => guardar(filas.filter((f) => f.x.checked).map((f) => f.c.id)) }, 'Guardar cartera'),
        h('button', { class: 'btn', onclick: () => guardar([]) }, 'Quitar cartera (ve todos)'))));
  };

  poner(main, h('div', { class: 'grid' },
    card('Oficiales', 'Cargadores (perfil operador). Por defecto cada oficial ve todos los clientes que le habilitó el administrador; asignale una cartera para limitarlo.', lista),
    detalle));
  await cargar().catch(error);
}
