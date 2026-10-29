// SO · única fuente de verdad del contexto de trabajo. La UI (filtros, selección, navegación) y Francisco (intenciones)
// leen y modifican este mismo estado; nada se duplica. Puro y sin DOM.

export function crearEstado(inicial = {}) {
  let s = { modo: 'work', proyectoId: null, artefactoId: null, vista: 'home', desde: null, hasta: null, comparar: null,
    filtro: null, seleccion: null, ...inicial };
  const subs = new Set();
  return {
    get: () => s,
    set(cambio) {
      const prev = s;
      const c = (typeof cambio === 'function' ? cambio(s) : cambio) || {};
      s = { ...s, ...c };
      // Cambiar de artefacto limpia lo que solo tenía sentido en el anterior (salvo que el cambio lo traiga explícito).
      if (prev.artefactoId !== s.artefactoId) {
        for (const k of ['desde', 'hasta', 'comparar', 'filtro', 'seleccion']) if (!(k in c)) s[k] = null;
      }
      subs.forEach((f) => f(s, prev));
      return s;
    },
    sub(f) { subs.add(f); return () => subs.delete(f); },
  };
}

// Lo que se sincroniza entre dispositivos: estable y no efímero (sin selección ni vista transitoria).
export function paraContinuidad(s) {
  return { modo: s.modo, proyectoId: s.proyectoId, artefactoId: s.artefactoId, desde: s.desde, hasta: s.hasta, filtro: s.filtro };
}

// Chips de contexto visibles junto al composer. Cada uno sabe cómo quitarse.
export function chips(s, nombres = {}) {
  const out = [];
  if (s.modo === 'work' && nombres.proyecto) out.push({ id: 'proyecto', texto: `Proyecto: ${nombres.proyecto}`, quitar: null });
  if (s.artefactoId && nombres.artefacto) out.push({ id: 'artefacto', texto: `Trabajando sobre: ${nombres.artefacto}`, quitar: { artefactoId: null } });
  if (s.desde || s.hasta) out.push({ id: 'periodo', texto: `Período: ${nombres.periodo || [s.desde, s.hasta].filter(Boolean).join(' – ')}`, quitar: { desde: null, hasta: null } });
  if (s.comparar) out.push({ id: 'comparar', texto: `Comparando con: ${nombres.comparar || s.comparar}`, quitar: { comparar: null } });
  if (s.filtro) out.push({ id: 'filtro', texto: `Solo ${s.filtro.label || s.filtro.key}: ${s.filtro.valor}`, quitar: { filtro: null } });
  if (s.seleccion) out.push({ id: 'seleccion', texto: `Selección: ${s.seleccion.etiqueta}`, quitar: { seleccion: null } });
  return out;
}

// Riesgo de cada acción → patrón de UX. bajo: ejecutar. medio: ejecutar + Deshacer. alto: vista previa breve.
export function riesgo(accion) {
  switch (accion.tipo) {
    case 'borrar_datos': return 'alto';
    case 'compartir': return accion.permiso === 'EDIT' ? 'alto' : 'medio';
    case 'crear': case 'agregar_campos': case 'grafico': case 'renombrar': case 'registrar': case 'borrar_visualizacion':
    case 'revocar': case 'proyecto_crear': case 'favorito': return 'medio';
    default: return 'bajo';
  }
}

// Texto de permisos en lenguaje de personas (el control real está en el servidor).
export function explicarPermiso(email, permiso, artefacto = 'este tablero') {
  return {
    VIEW: `${email} puede ver ${artefacto}, pero no cargar datos ni modificarlo.`,
    USE: `${email} puede usar ${artefacto} (ver y cargar datos), pero no modificarlo.`,
    EDIT: `${email} puede ver, cargar datos y modificar ${artefacto}.`,
  }[permiso] || `${email}: ${permiso}`;
}
