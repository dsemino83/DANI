// Documentación (solo administrador y auditor): auditoría, técnica y manual de usuario.
import { h, poner, card } from '../ui.js';

const DOCS = [
  ['auditoria', 'Documentación para auditoría', 'Controles C01–C13, segregación de funciones, trazabilidad, retención y base histórica.'],
  ['tecnica', 'Documentación técnica', 'Arquitectura, contenedores, Keycloak, APIs del Banco de Valores, bases de datos y despliegue.'],
  ['manual', 'Manual de usuario', 'Uso de cada pantalla por perfil. Es el que ven los usuarios en Ayuda.'],
];

export async function render(main, ctx) {
  const docs = ctx.cfg?.docs ?? {};
  poner(main, card('Documentación', 'Publicada solo para los perfiles Administrador y Auditor. Los demás usuarios ven el manual en Ayuda.',
    h('div', { class: 'docs' }, DOCS.map(([k, t, d]) => h('div', { class: 'card' }, h('h2', {}, t), h('p', { class: 'nota' }, d),
      docs[k] ? h('a', { class: 'btn primario chico', href: docs[k], target: '_blank', rel: 'noopener' }, 'Abrir')
        : h('span', { class: 'bloqueado' }, 'Sin URL configurada (DOC_' + k.toUpperCase() + '_URL).'))))));
}
