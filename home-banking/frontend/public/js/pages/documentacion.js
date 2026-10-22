// Documentación incluida en la aplicación: auditoría y técnica (solo administrador y auditor) y manual de usuario.
// El backend la sirve desde la imagen (/api/docs/:nombre); se lee en pantalla y se imprime o guarda en PDF.
import { api } from '../api.js';
import { h, poner, card, cargando, error, fechaHora } from '../ui.js';
import { markdown } from '../markdown.js';

const DOCS = [
  ['auditoria', 'Documentación para auditoría', 'Roles, segregación de funciones, controles C01–C18, auditoría, credenciales, envíos programados y base histórica.'],
  ['tecnica', 'Documentación técnica', 'Arquitectura, contenedores, SSO, APIs del Banco de Valores, modelo de datos, envíos, pase histórico y operación.'],
  ['manual', 'Manual de usuario', 'Uso de cada pantalla por perfil. Es el que ven los usuarios en Ayuda.'],
];

// Imprime solo el documento (la clase acota la hoja de estilos de impresión)
const imprimir = () => {
  document.body.classList.add('imprimiendo-doc');
  window.addEventListener('afterprint', () => document.body.classList.remove('imprimiendo-doc'), { once: true });
  window.print();
};

// Muestra un documento en "donde"; volver() regresa a la pantalla anterior
export async function mostrarDocumento(donde, nombre, volver) {
  poner(donde, cargando());
  let d;
  try { d = await api(`/docs/${nombre}`); } catch (x) { error(x); return volver?.(); }
  poner(donde, h('section', { class: 'card doc-md' },
    h('div', { class: 'fila no-imprimir' },
      volver && h('button', { class: 'btn', onclick: volver }, '← Volver'),
      h('button', { class: 'btn primario', onclick: imprimir }, 'Imprimir / guardar PDF'),
      h('span', { class: 'nota' }, `Versión del ${fechaHora(d.actualizado)}`)),
    h('article', { class: 'markdown' }, ...markdown(d.markdown))));
}

export async function render(main) {
  const lista = () => poner(main, card('Documentación', 'Incluida en la aplicación. La de auditoría y la técnica solo la ven los perfiles Administrador y Auditor; los demás usuarios ven el manual en Ayuda.',
    h('div', { class: 'docs' }, DOCS.map(([k, t, d]) => h('div', { class: 'card' }, h('h2', {}, t), h('p', { class: 'nota' }, d),
      h('button', { class: 'btn primario chico', onclick: () => mostrarDocumento(main, k, lista) }, 'Abrir'))))));
  lista();
}
