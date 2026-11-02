'use strict';
// Control de un bastanteo (JSON 1.0) contra el resumen de poder (Excel del cliente), firmante por firmante, y equivalencia
// de letras entre grupos. Lo usa revisar.js (--excel) y lo prueban valo/tests/bastanteo-excel.test.js. No toca el motor:
// lee el modelo (M.modeloBastanteo) y el Excel ya leído (M.leerClienteBastanteo) y los compara con las mismas
// categorías de error del skill.
//
// Cada firmante del Excel tiene cinco puntos; el estado de cada uno es 'ok', 'rev' (no es un error: hay que mirarlo),
// 'dif' (diferencia) o 'na' (no se controla):
//   pertenencia   ¿está en el bastanteo? ¿figura revocado en el resumen y el bastanteo lo incluye?
//   grupo         letra del resumen contra el grupo del bastanteo (con equivalencia de letras)
//   uso           INDIVIDUAL / CONJUNTA del resumen contra las reglas en las que participa
//   combinaciones A+A, A+B… del resumen contra las combinaciones mínimas que habilitan sus reglas
//   limite        solo firma individual: el límite del resumen contra el tope de la regla
// Igual que el control de resúmenes (control-resumenes-review): que el bastanteo dé más que el resumen es REV (aviso);
// que el resumen pida algo que el bastanteo no da es DIF (error).

const ORDEN_DE_TIPOS = ['ERROR DE GRUPO', 'ERROR DE PERTENENCIA', 'ERROR DE PARTICIPACIÓN', 'ERROR DE AGRUPAMIENTO', 'ERROR DE REGLA', 'ERROR DE APLICACIÓN', 'AVISO DEL EXCEL'];
// Dónde mirar primero (ver "Cómo razonar un caso" en SKILL.md). Es una pista, no un veredicto.
const ORIGEN_POR_TIPO = {
  'ERROR DE GRUPO': 'Agrupación', 'ERROR DE PERTENENCIA': 'Datos (Excel, Complif u OCR)', 'ERROR DE PARTICIPACIÓN': 'Agrupación',
  'ERROR DE AGRUPAMIENTO': 'Combinación', 'ERROR DE REGLA': 'Regla', 'ERROR DE APLICACIÓN': 'Combinación', 'AVISO DEL EXCEL': 'Datos (Excel)',
};

const digitos = v => String(v == null ? '' : v).replace(/\D/g, '');
// Persona: el CUIT/CUIL y el DNI son lo mismo (el DNI son las posiciones 3 a 10 del CUIT).
const dniDe = id => { const d = digitos(id); return d.length === 11 ? d.slice(2, 10).replace(/^0+/, '') : d.replace(/^0+/, ''); };
const palabras = (M, t) => M.normalizar(String(t || '')).replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean).sort().join(' ');
const miles = n => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const unicos = a => [...new Set(a)];

// Combinaciones mínimas de firmas que habilita una regla (null si no se pueden calcular).
//   ConjuntaIndistinta [A, B] q2 = A+A, A+B, B+B · Conjunta [A, B] q1 = A+B · Conjunta de un solo grupo = ConjuntaIndistinta.
function combosMinimos(tipo, quorum, grupos) {
  const gs = unicos(grupos).sort();
  if (!gs.length || !Number.isInteger(quorum) || quorum < 1) return null;
  if (tipo === 'Conjunta' && gs.length > 1) return [gs.flatMap(g => Array(quorum).fill(g)).sort().join('+')];
  if (quorum > 4) return null;
  const out = [];
  const rec = (desde, acum) => {
    if (acum.length === quorum) { out.push(acum.join('+')); return; }
    for (let i = desde; i < gs.length; i++) rec(i, acum.concat(gs[i]));
  };
  rec(0, []);
  return out;
}

// pares: [letra de origen, letras de destino posibles de una persona]. Devuelve el renombre origen → destino.
// consistente = false si una misma letra apunta a dos grupos distintos o dos letras al mismo grupo: no hay equivalencia.
function mapaDeLetras(pares) {
  const cand = new Map();
  pares.forEach(([l, dest]) => {
    const s = new Set(dest);
    cand.set(l, cand.has(l) ? new Set([...cand.get(l)].filter(x => s.has(x))) : s);
  });
  const mapa = {};
  let consistente = true;
  [...cand.keys()].sort().forEach(l => {
    const c = [...cand.get(l)].sort();
    if (!c.length) { consistente = false; return; }
    mapa[l] = c.includes(l) ? l : c[0];
  });
  if (new Set(Object.values(mapa)).size !== Object.keys(mapa).length) consistente = false;
  return consistente ? { mapa, consistente } : { mapa: {}, consistente };
}

// Equivalencia de letras entre dos modelos de bastanteo: renombre de las letras de B a las de A, según en qué grupo
// está la misma persona en cada uno. Sirve para comparar dos JSON que nombran distinto los mismos grupos.
function equivalenciaDeLetras(mA, mB, M) {
  const gruposDe = (m, fid) => m.pertenencias.filter(p => p.firmante_id === fid).map(p => p.grupo_id);
  const enA = new Map();
  mA.firmantes.forEach(f => { enA.set(dniDe(f.id) || `n:${palabras(M, f.nombre)}`, f); enA.set(`n:${palabras(M, f.nombre)}`, f); });
  const pares = [];
  mB.firmantes.forEach(f => {
    const fa = enA.get(dniDe(f.id)) || enA.get(`n:${palabras(M, f.nombre)}`);
    const gB = gruposDe(mB, f.id), gA = fa ? gruposDe(mA, fa.id) : [];
    if (gB.length === 1 && gA.length) pares.push([gB[0], gA]);
  });
  return mapaDeLetras(pares);
}

// Copia del JSON con las letras de los grupos renombradas (apoderados y reglas), todas a la vez (A↔B no se pisa).
function renombrarGrupos(json, mapa) {
  const copia = JSON.parse(JSON.stringify(json));
  const ren = g => { const l = String(g == null ? '' : g).trim().toUpperCase().replace(/^GRUPO\s+/, ''); return Object.prototype.hasOwnProperty.call(mapa, l) ? mapa[l] : g; };
  (copia.apoderados || []).forEach(a => { if (Array.isArray(a.grupos)) a.grupos = a.grupos.map(ren); });
  (copia.reglasFirma || []).forEach(r => { if (Array.isArray(r.grupos)) r.grupos = r.grupos.map(ren); });
  return copia;
}

// Qué reglas del modelo alcanzan a un firmante y en qué grupos participa en cada una.
function datosDeFirmante(m, fid) {
  const grupos = m.pertenencias.filter(p => p.firmante_id === fid).map(p => p.grupo_id).sort();
  const reglas = [];
  m.reglas.forEach(rg => {
    const ags = m.aplicaciones.filter(a => a.regla_id === rg.id).map(a => m.agrupamientos.find(x => x.id === a.agrupamiento_id)).filter(Boolean);
    const mios = unicos(ags.filter(a => m.participaciones.some(p => p.agrupamiento_id === a.id && p.firmante_id === fid)).map(a => a.grupo_id));
    if (mios.length) reglas.push({ regla: rg, grupos: unicos(ags.map(a => a.grupo_id)).sort(), mios });
  });
  return { grupos, reglas };
}

function compararConExcel(json, cliente, M) {
  const m = M.modeloBastanteo(json);
  const diferencias = [];
  const agregar = (tipo, nivel, detalle, firmante) => diferencias.push({ tipo, nivel, detalle, firmante: firmante || null });
  const error = (tipo, detalle, f) => agregar(tipo, 'error', detalle, f);
  const aviso = (tipo, detalle, f) => agregar(tipo, 'aviso', detalle, f);
  const P = (estado, detalle = '') => ({ estado, detalle });
  const exFirmantes = (cliente && cliente.firmantes) || [];
  const salida = { firmantes: [], diferencias, equivalenciaLetras: {} };
  const cerrar = () => {
    diferencias.sort((x, y) => (x.nivel === y.nivel ? 0 : x.nivel === 'error' ? -1 : 1) || ORDEN_DE_TIPOS.indexOf(x.tipo) - ORDEN_DE_TIPOS.indexOf(y.tipo));
    return salida;
  };

  // Datos de la empresa.
  const cuitEx = digitos(cliente && cliente.cuit), cuitJs = digitos(json.empresa && json.empresa.cuit);
  if (cuitEx && cuitJs && cuitEx !== cuitJs) aviso('AVISO DEL EXCEL', `El CUIT de la empresa del resumen (${cuitEx}) no es el del bastanteo (${cuitJs}).`);
  const razonEx = palabras(M, cliente && cliente.cliente), razonJs = palabras(M, json.empresa && json.empresa.razonSocial);
  if (razonEx && razonJs && !razonEx.split(' ').some(p => p.length >= 3 && razonJs.split(' ').includes(p)))
    aviso('AVISO DEL EXCEL', `La razón social del resumen (${cliente.cliente}) no se parece a la del bastanteo (${json.empresa.razonSocial}).`);
  if (!exFirmantes.length) {
    aviso('AVISO DEL EXCEL', 'El Excel no tiene firmantes (no se encontró la tabla): no se puede controlar firmante por firmante.');
    return cerrar();
  }

  // Cada firmante del Excel con su firmante del bastanteo: por CUIT, por DNI y, si no, por el nombre en cualquier orden.
  const porId = new Map(), porDni = new Map(), porNombre = new Map();
  m.firmantes.forEach(f => { porId.set(digitos(f.id), f); if (dniDe(f.id)) porDni.set(dniDe(f.id), f); porNombre.set(palabras(M, f.nombre), f); });
  const usados = new Set();
  const resolver = x => {
    const dni = String(x.dni || '').replace(/^0+/, '');
    const f = (x.cuit && porId.get(digitos(x.cuit))) || (dni && porDni.get(dni)) || porNombre.get(palabras(M, x.nombre)) || null;
    if (f) usados.add(f.id);
    return f;
  };
  const pares = exFirmantes.map(x => [x, resolver(x)]);

  // Equivalencia de letras: la del resumen puede nombrar con otra letra el mismo grupo.
  const eq = mapaDeLetras(pares.filter(([x, f]) => f && x.uso && x.uso.grupo).map(([x, f]) => {
    const gs = datosDeFirmante(m, f.id).grupos;
    return [x.uso.grupo, gs.length === 1 ? gs : []];
  }).filter(([, gs]) => gs.length));
  const mapa = eq.mapa;
  const aL = l => mapa[l] || l;
  Object.entries(mapa).filter(([a, b]) => a !== b).forEach(([a, b]) => { salida.equivalenciaLetras[a] = b; });
  const cambios = Object.entries(salida.equivalenciaLetras);
  if (cambios.length) aviso('ERROR DE PERTENENCIA', `Las letras de los grupos del resumen no son las del bastanteo, pero son equivalentes (por las personas de cada grupo): ${cambios.map(([a, b]) => `${a} del resumen = ${b} del bastanteo`).join(', ')}.`);

  pares.forEach(([x, f]) => {
    const nombre = x.nombre;
    const puntos = { pertenencia: P('na'), grupo: P('na'), uso: P('na'), combinaciones: P('na'), limite: P('na') };
    if (!f) {
      error('ERROR DE PERTENENCIA', `${nombre} está en el resumen (grupo ${(x.uso && x.uso.grupo) || '—'}) y no está en el bastanteo.`, nombre);
      puntos.pertenencia = P('dif', 'no está en el bastanteo');
      salida.firmantes.push({ id: digitos(x.cuit) || x.dni || `n:${nombre}`, nombre, presente: false, puntos });
      return;
    }
    const dat = datosDeFirmante(m, f.id);
    const uso = x.uso || null;
    salida.firmantes.push({ id: f.id, nombre, presente: true, puntos });

    // Pertenencia.
    if (x.revocado) {
      error('ERROR DE PERTENENCIA', `${nombre} figura como revocado en el resumen y el bastanteo lo incluye.`, nombre);
      puntos.pertenencia = P('dif', 'revocado en el resumen');
    } else puntos.pertenencia = P('ok');

    // Grupo.
    const L = uso && uso.grupo;
    if (!L) {
      puntos.grupo = P('rev', 'el resumen no indica el grupo');
      aviso('ERROR DE PERTENENCIA', `El resumen no indica el grupo de ${nombre}.`, nombre);
    } else if (dat.grupos.includes(aL(L))) puntos.grupo = P('ok');
    else {
      puntos.grupo = P('dif', `grupo ${L} en el resumen y ${dat.grupos.join('/') || '—'} en el bastanteo`);
      error('ERROR DE PERTENENCIA', `${nombre}: grupo ${L} en el resumen y ${dat.grupos.join('/') || '—'} en el bastanteo.`, nombre);
    }

    // Uso de firma.
    const tiposEx = (uso && uso.tipos) || [];
    const tiposJs = unicos(dat.reglas.map(rg => (rg.regla.tipo === 'Individual' ? 'INDIVIDUAL' : 'CONJUNTA')));
    if (!tiposEx.length) {
      puntos.uso = P('rev', 'el resumen no indica el uso de firma');
      aviso('ERROR DE REGLA', `El resumen no indica el uso de firma de ${nombre}.`, nombre);
    } else {
      const falta = tiposEx.filter(t => !tiposJs.includes(t)), sobra = tiposJs.filter(t => !tiposEx.includes(t));
      const palabra = t => (t === 'INDIVIDUAL' ? 'firma individual' : 'firma conjunta');
      if (falta.length) {
        puntos.uso = P('dif', `el resumen da ${falta.map(palabra).join(' y ')} y el bastanteo no`);
        error('ERROR DE REGLA', `${nombre}: el resumen da ${falta.map(palabra).join(' y ')} y el bastanteo no.`, nombre);
      } else if (sobra.length) {
        puntos.uso = P('rev', `el bastanteo da también ${sobra.map(palabra).join(' y ')}`);
        aviso('ERROR DE REGLA', `${nombre}: el bastanteo da también ${sobra.map(palabra).join(' y ')}; el resumen es más restrictivo.`, nombre);
      } else puntos.uso = P('ok');
    }

    // Firmas conjuntas.
    const exComb = unicos(((uso && uso.combinaciones) || []).map(c => c.split('+').map(aL).sort().join('+'))).sort();
    const sinCalcular = [];
    const jsComb = unicos(dat.reglas.filter(rg => rg.regla.tipo !== 'Individual').flatMap(rg => {
      const cs = combosMinimos(rg.regla.tipo, rg.regla.quorum, rg.grupos);
      if (!cs) { sinCalcular.push(rg.regla.id); return []; }
      return cs.filter(c => c.includes('+') && c.split('+').some(l => rg.mios.includes(l)));
    })).sort();
    sinCalcular.forEach(id => aviso('ERROR DE REGLA', `${nombre}: no se pueden calcular las combinaciones de la regla ${id} (quorum o grupos fuera de rango).`, nombre));
    if (!exComb.length && !tiposEx.includes('CONJUNTA')) puntos.combinaciones = P('ok', 'no aplica');
    else if (!exComb.length) {
      puntos.combinaciones = jsComb.length ? P('rev', 'el resumen no indica las combinaciones') : P('ok');
      if (jsComb.length) aviso('ERROR DE AGRUPAMIENTO', `El resumen no indica las combinaciones de ${nombre}; el bastanteo da ${jsComb.join(', ')}.`, nombre);
    } else {
      const falta = exComb.filter(c => !jsComb.includes(c)), sobra = jsComb.filter(c => !exComb.includes(c));
      if (falta.length) {
        puntos.combinaciones = P('dif', `el resumen da ${falta.join(', ')} y el bastanteo no`);
        error('ERROR DE AGRUPAMIENTO', `${nombre}: el resumen da ${falta.join(', ')} y el bastanteo no.`, nombre);
      } else if (sobra.length) puntos.combinaciones = P('rev', `el bastanteo da también ${sobra.join(', ')}`);
      else puntos.combinaciones = P('ok');
      if (sobra.length) aviso('ERROR DE AGRUPAMIENTO', `${nombre}: el bastanteo da también ${sobra.join(', ')} y el resumen no.`, nombre);
    }

    // Límite (solo firma individual).
    const indivs = dat.reglas.filter(rg => rg.regla.tipo === 'Individual').map(rg => rg.regla);
    if (!tiposEx.includes('INDIVIDUAL') || !indivs.length) puntos.limite = P('ok', 'no aplica');
    else {
      const exLim = uso.limite != null ? uso.limite : (x.monto_hasta > 0 ? x.monto_hasta : null);
      const txt = uso.limiteTexto || '';
      const exMon = /U\$S|USD|US\$/i.test(txt) ? 'USD' : /\$/.test(txt) ? 'ARS' : null;
      const topes = indivs.filter(r => r.monto != null);
      const lista = topes.map(r => `${r.moneda} ${miles(r.monto)}`).join(' / ');
      if (exLim != null) {
        const coincide = topes.some(r => Number(r.monto) === Number(exLim) && (!exMon || r.moneda === exMon));
        if (coincide) puntos.limite = P('ok');
        else {
          const dTxt = `${nombre}: el resumen tiene límite individual ${exMon || ''} ${miles(exLim)}`.replace('  ', ' ') + (topes.length ? ` y el bastanteo tiene tope ${lista}.` : ' y el bastanteo no tiene tope.');
          puntos.limite = P('dif', topes.length ? `límite ${miles(exLim)} en el resumen y tope ${lista} en el bastanteo` : `límite ${miles(exLim)} en el resumen y sin tope en el bastanteo`);
          error('ERROR DE REGLA', dTxt, nombre);
        }
      } else if (topes.length) {
        if (/SIN\s+L[IÍ]MITE/i.test(uso.texto || '')) {
          puntos.limite = P('dif', `el resumen dice sin límite y el bastanteo tiene tope ${lista}`);
          error('ERROR DE REGLA', `${nombre}: el resumen dice sin límite y el bastanteo tiene tope ${lista}.`, nombre);
        } else {
          puntos.limite = P('rev', `el bastanteo tiene tope ${lista} y el resumen no dice el límite`);
          aviso('ERROR DE REGLA', `${nombre}: el bastanteo tiene tope ${lista} y el resumen no dice el límite.`, nombre);
        }
      } else puntos.limite = P('ok');
    }
  });

  // Apoderados del bastanteo que no están en el resumen.
  m.firmantes.filter(f => !usados.has(f.id)).forEach(f =>
    aviso('ERROR DE PERTENENCIA', `${f.nombre} está en el bastanteo (grupo ${datosDeFirmante(m, f.id).grupos.join('/') || '—'}) y no está en el resumen.`, f.nombre));

  // Facultades marcadas con "X" en el resumen: alguna regla del bastanteo tiene que darlas. Al revés no se controla: el
  // resumen marca solo algunas facultades.
  const marcas = Object.keys((cliente && cliente.marcas) || {});
  if (marcas.length) {
    const claveDe = Object.fromEntries(M.BASTANTEO_CATALOGO.map(c => [c[0], c[2]]));
    const dadas = new Set(m.reglas.flatMap(r => r.circuitos).map(c => claveDe[c]).filter(Boolean));
    marcas.filter(k => !dadas.has(k)).forEach(k => {
      const nom = (M.BASTANTEO_CATALOGO.find(c => c[2] === k) || [])[1];
      error('ERROR DE REGLA', `La facultad ${k}${nom ? ` (${nom})` : ''} está marcada con X en el resumen y ninguna regla del bastanteo la da.`);
    });
  }
  return cerrar();
}

module.exports = { compararConExcel, equivalenciaDeLetras, renombrarGrupos, combosMinimos, mapaDeLetras, ORIGEN_POR_TIPO, ORDEN_DE_TIPOS };
