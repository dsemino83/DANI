/*
 * Motor de generación automática de actividades — 2.º grado.
 *
 * No hay un banco estático de preguntas: cada actividad se arma en el momento a
 * partir de BANCOS DE DATOS verificados + PLANTILLAS + VARIABLES + REGLAS.
 * La aleatoriedad cambia la experiencia (personajes, objetos, redacción,
 * números, orden de opciones, tipo de interacción) sin tocar el objetivo
 * pedagógico ni inventar palabras, reglas o resultados.
 *
 * Funciona en el navegador (window.Motor) y en Node (require('./motor.js')).
 */
(function (raiz, fabrica) {
  const M = fabrica();
  if (typeof module === 'object' && module.exports) module.exports = M;
  else raiz.Motor = M;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ================================================================
  // 19. Semilla y generación pseudoaleatoria
  // ================================================================

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function nuevaSemilla() {
    try {
      const c = (typeof crypto !== 'undefined' && crypto.getRandomValues) ? crypto : null;
      if (c) return c.getRandomValues(new Uint32Array(1))[0];
    } catch (e) { /* sin crypto */ }
    return (Date.now() ^ Math.floor(Math.random() * 4294967296)) >>> 0;
  }

  function crearAzar(semilla) {
    const r = mulberry32(semilla >>> 0);
    const azar = {
      semilla: semilla >>> 0,
      real: r,
      entero(min, max) { return min + Math.floor(r() * (max - min + 1)); },
      elegir(lista) { return lista[Math.floor(r() * lista.length)]; },
      mezclar(lista) {
        const a = lista.slice();
        for (let i = a.length - 1; i > 0; i--) {
          const j = Math.floor(r() * (i + 1));
          [a[i], a[j]] = [a[j], a[i]];
        }
        return a;
      },
      tomar(lista, n) { return azar.mezclar(lista).slice(0, n); },
      moneda(p = 0.5) { return r() < p; },
      /** Elige según pesos: [[valor, peso], ...] */
      ponderado(pares) {
        const total = pares.reduce((s, p) => s + p[1], 0);
        let x = r() * total;
        for (const [v, w] of pares) { if ((x -= w) < 0) return v; }
        return pares[pares.length - 1][0];
      },
    };
    return azar;
  }

  // ================================================================
  // 3. Generador de números
  // ================================================================

  /** Rangos de numeración por nivel (contenido de 2.º grado: hasta 1.000). */
  const RANGOS = { 1: [1, 100], 2: [100, 500], 3: [500, 1000] };

  function generateNumber(azar, min, max) { return azar.entero(min, max); }

  function generateDifferentNumber(azar, min, max, excluded = []) {
    const ex = new Set(excluded);
    for (let i = 0; i < 200; i++) {
      const n = azar.entero(min, max);
      if (!ex.has(n)) return n;
    }
    for (let n = min; n <= max; n++) if (!ex.has(n)) return n;
    return null;
  }

  function generateNumberWithConstraints(azar, { min, max, excluded = [], condicion = () => true }) {
    const ex = new Set(excluded);
    for (let i = 0; i < 500; i++) {
      const n = azar.entero(min, max);
      if (!ex.has(n) && condicion(n)) return n;
    }
    const validos = [];
    for (let n = min; n <= max; n++) if (!ex.has(n) && condicion(n)) validos.push(n);
    return validos.length ? azar.elegir(validos) : null;
  }

  function permutacionesDigitos(n) {
    const res = new Set();
    const perm = (resto, pref) => {
      if (!resto.length) { if (pref[0] !== '0') res.add(Number(pref.join(''))); return; }
      resto.forEach((x, i) => perm(resto.filter((_, j) => j !== i), pref.concat(x)));
    };
    perm(String(n).split(''), []);
    res.delete(n);
    return [...res];
  }

  /**
   * Distractores numéricos plausibles: cifras cambiadas de lugar (572 → 527),
   * una decena o una centena de diferencia, o vecinos inmediatos.
   */
  function distractoresNumericos(azar, n, { min = 0, max = 1000, cantidad = 2, preferir = 'mixto', excluir = [] } = {}) {
    const perm = azar.mezclar(permutacionesDigitos(n));
    const decenas = azar.mezclar([n + 10, n - 10, n + 100, n - 100]);
    const vecinos = azar.mezclar([n + 1, n - 1, n + 2, n - 2]);
    let orden;
    if (preferir === 'digitos') orden = [...perm, ...decenas, ...vecinos];
    else if (preferir === 'cerca') orden = [...vecinos, ...decenas, ...perm];
    else orden = azar.mezclar([...perm.slice(0, 1), decenas[0], vecinos[0]]).concat(perm.slice(1), decenas.slice(1), vecinos.slice(1));
    const ex = new Set([n, ...excluir]);
    const res = [];
    for (const x of orden) {
      if (x >= min && x <= max && !ex.has(x)) { res.push(x); ex.add(x); }
      if (res.length === cantidad) break;
    }
    let d = 3;
    while (res.length < cantidad && d < 50) {
      for (const x of [n + d, n - d]) if (x >= min && x <= max && !ex.has(x) && res.length < cantidad) { res.push(x); ex.add(x); }
      d++;
    }
    return res;
  }

  // ================================================================
  // 5. Números en letras (hasta 1.000)
  // ================================================================

  const UNIDADES = ['cero', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve'];
  const DIEZ_A_VEINTINUEVE = {
    10: 'diez', 11: 'once', 12: 'doce', 13: 'trece', 14: 'catorce', 15: 'quince',
    16: 'dieciséis', 17: 'diecisiete', 18: 'dieciocho', 19: 'diecinueve', 20: 'veinte',
    21: 'veintiuno', 22: 'veintidós', 23: 'veintitrés', 24: 'veinticuatro', 25: 'veinticinco',
    26: 'veintiséis', 27: 'veintisiete', 28: 'veintiocho', 29: 'veintinueve',
  };
  const DECENAS = { 3: 'treinta', 4: 'cuarenta', 5: 'cincuenta', 6: 'sesenta', 7: 'setenta', 8: 'ochenta', 9: 'noventa' };
  const CENTENAS = {
    1: 'ciento', 2: 'doscientos', 3: 'trescientos', 4: 'cuatrocientos', 5: 'quinientos',
    6: 'seiscientos', 7: 'setecientos', 8: 'ochocientos', 9: 'novecientos',
  };

  function menorQueCien(n) {
    if (n < 10) return UNIDADES[n];
    if (n < 30) return DIEZ_A_VEINTINUEVE[n];
    const d = Math.floor(n / 10), u = n % 10;
    return u ? `${DECENAS[d]} y ${UNIDADES[u]}` : DECENAS[d];
  }

  function numeroEnLetras(n) {
    if (!Number.isInteger(n) || n < 0 || n > 1000) throw new RangeError('Fuera de rango: ' + n);
    if (n === 1000) return 'mil';
    if (n === 100) return 'cien';
    if (n < 100) return menorQueCien(n);
    const c = Math.floor(n / 100), r = n % 100;
    return r ? `${CENTENAS[c]} ${menorQueCien(r)}` : CENTENAS[c];
  }

  // ================================================================
  // Utilidades de texto
  // ================================================================

  const mayus1 = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const cuantos = (g) => (g === 'f' ? 'cuántas' : 'cuántos');
  const aQuien = (nombre) => (nombre.startsWith('el ') ? 'al ' + nombre.slice(3) : 'a ' + nombre);
  const concuerda = (adj, g) => (typeof adj === 'string' ? adj : adj[g]);
  const normalizar = (s) => String(s).toLowerCase().normalize('NFD')
    .replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9?!¿¡ ]/g, ' ').replace(/\s+/g, ' ').trim();

  // ================================================================
  // 10. Bancos: personajes, objetos, acciones, lugares
  // ================================================================

  const PERSONAJES = [
    { id: 'rami', nombre: 'Rami', emoji: '🧒' },
    { id: 'chispa', nombre: 'Chispa', emoji: '✨' },
    { id: 'robot2x', nombre: 'Robot 2X', emoji: '🤖' },
    { id: 'explorador', nombre: 'el explorador', emoji: '🧭' },
    { id: 'astronauta', nombre: 'la astronauta', emoji: '👩‍🚀' },
    { id: 'pirata', nombre: 'el pirata', emoji: '🏴‍☠️' },
    { id: 'robot', nombre: 'el robot Bip', emoji: '🦾' },
    { id: 'unicornio', nombre: 'el unicornio', emoji: '🦄' },
  ];
  /** Los tres personajes guía que presentan las consignas. */
  const GUIAS = PERSONAJES.slice(0, 3);

  // Qué acciones tienen sentido con cada objeto (coherencia de la historia).
  const OBJETOS = [
    { id: 'monedas', pl: 'monedas', sg: 'moneda', g: 'f', emoji: '🪙', acc: ['encontrar', 'recibir', 'ganar', 'juntar', 'guardar', 'aparecer', 'perder', 'regalar', 'usar', 'compartir'] },
    { id: 'estrellas', pl: 'estrellas', sg: 'estrella', g: 'f', emoji: '⭐', acc: ['encontrar', 'recibir', 'ganar', 'juntar', 'guardar', 'aparecer', 'perder', 'regalar', 'compartir'] },
    { id: 'gemas', pl: 'gemas', sg: 'gema', g: 'f', emoji: '💎', acc: ['encontrar', 'recibir', 'ganar', 'juntar', 'guardar', 'aparecer', 'perder', 'regalar', 'usar', 'compartir'] },
    { id: 'manzanas', pl: 'manzanas', sg: 'manzana', g: 'f', emoji: '🍎', acc: ['recibir', 'juntar', 'guardar', 'regalar', 'compartir'] },
    { id: 'libros', pl: 'libros', sg: 'libro', g: 'm', emoji: '📚', acc: ['recibir', 'juntar', 'guardar', 'regalar', 'compartir'] },
    { id: 'globos', pl: 'globos', sg: 'globo', g: 'm', emoji: '🎈', acc: ['recibir', 'inflar', 'regalar', 'perder'] },
    { id: 'juguetes', pl: 'juguetes', sg: 'juguete', g: 'm', emoji: '🧸', acc: ['recibir', 'encontrar', 'guardar', 'regalar', 'compartir'] },
    { id: 'pegatinas', pl: 'pegatinas', sg: 'pegatina', g: 'f', emoji: '🏷️', acc: ['recibir', 'ganar', 'juntar', 'guardar', 'regalar', 'usar', 'compartir'] },
    { id: 'galletas', pl: 'galletas', sg: 'galleta', g: 'f', emoji: '🍪', acc: ['recibir', 'guardar', 'regalar', 'compartir'] },
    { id: 'caracoles', pl: 'caracoles', sg: 'caracol', g: 'm', emoji: '🐚', acc: ['encontrar', 'juntar', 'guardar', 'regalar'] },
  ];
  const CONTENEDORES = ['el cofre', 'la caja', 'la mochila', 'el canasto'];

  const ACCIONES_SUMA = ['encontrar', 'recibir', 'ganar', 'juntar', 'guardar', 'aparecer', 'inflar'];
  const ACCIONES_RESTA = ['perder', 'regalar', 'usar', 'compartir'];

  /**
   * Plantillas de problemas. Cada una devuelve el enunciado y la pregunta; la
   * acción determina la operación (sumar o restar), así la historia siempre es
   * coherente con la cuenta.
   */
  function plantillaProblema(accion, { P, O, a, b, amigo, cont }) {
    const Pm = mayus1(P.nombre), cu = cuantos(O.g), Cu = mayus1(cu);
    const pl = O.pl;
    switch (accion) {
      case 'encontrar': return { texto: `${Pm} tiene ${a} ${pl} y encuentra ${b} más.`, pregunta: `¿${Cu} ${pl} tiene ahora?` };
      case 'recibir': return { texto: `${Pm} tiene ${a} ${pl}. ${mayus1(amigo.nombre)} le regala ${b} más.`, pregunta: `¿${Cu} ${pl} tiene ${P.nombre} ahora?` };
      case 'ganar': return { texto: `${Pm} tenía ${a} ${pl}. En el juego gana ${b} más.`, pregunta: `¿${Cu} ${pl} tiene ahora?` };
      case 'juntar': return { texto: `${Pm} juntó ${a} ${pl} a la mañana y ${b} a la tarde.`, pregunta: `¿${Cu} ${pl} juntó en total?` };
      case 'guardar': return { texto: `En ${cont} hay ${a} ${pl}. ${Pm} guarda ${b} más.`, pregunta: `¿${Cu} ${pl} hay ahora en ${cont}?` };
      case 'aparecer': return { texto: `En ${cont} hay ${a} ${pl}. ¡Aparecen ${b} más!`, pregunta: `¿${Cu} ${pl} hay ahora?` };
      case 'inflar': return { texto: `${Pm} tiene ${a} globos inflados e infla ${b} más.`, pregunta: '¿Cuántos globos tiene en total?' };
      case 'perder':
        if (O.id === 'globos') return { texto: `${Pm} tiene ${a} globos. Se le vuelan ${b}.`, pregunta: '¿Cuántos globos le quedan?' };
        return { texto: `${Pm} tiene ${a} ${pl}. Pierde ${b}.`, pregunta: `¿${Cu} ${pl} le quedan?` };
      case 'regalar': return { texto: `${Pm} tiene ${a} ${pl} y le regala ${b} ${aQuien(amigo.nombre)}.`, pregunta: `¿${Cu} ${pl} le quedan ${aQuien(P.nombre)}?` };
      case 'usar': return { texto: `En ${cont} había ${a} ${pl}. Se usaron ${b}.`, pregunta: `¿${Cu} ${pl} quedan en ${cont}?` };
      case 'compartir': return { texto: `${Pm} tiene ${a} ${pl} y comparte ${b} con sus amigos.`, pregunta: `¿${Cu} ${pl} le quedan?` };
      default: throw new Error('Acción desconocida ' + accion);
    }
  }

  function armarProblema(azar, operacion, a, b) {
    const acciones = operacion === '+' ? ACCIONES_SUMA : ACCIONES_RESTA;
    const pares = [];
    for (const O of OBJETOS) for (const ac of O.acc) if (acciones.includes(ac)) pares.push([O, ac]);
    const [O, accion] = azar.elegir(pares);
    const P = azar.elegir(PERSONAJES);
    const amigo = azar.elegir(PERSONAJES.filter((p) => p !== P));
    const cont = azar.elegir(CONTENEDORES);
    const t = plantillaProblema(accion, { P, O, a, b, amigo, cont });
    return { ...t, O, P, accion, rasgos: ['pj:' + P.id, 'obj:' + O.id, 'acc:' + accion] };
  }

  // Grupos de 2 en la vida real (tabla del 2 en contexto).
  const PARES = [
    { sg: 'bicicleta', pl: 'bicicletas', g: 'f', parte: 'ruedas', emoji: '🚲', parteEmoji: '⚪' },
    { sg: 'pato', pl: 'patos', g: 'm', parte: 'patas', emoji: '🦆', parteEmoji: '🦶' },
    { sg: 'conejo', pl: 'conejos', g: 'm', parte: 'orejas', emoji: '🐰', parteEmoji: '👂' },
    { sg: 'pájaro', pl: 'pájaros', g: 'm', parte: 'alas', emoji: '🐦', parteEmoji: '🪶' },
    { sg: 'robot', pl: 'robots', g: 'm', parte: 'antenas', emoji: '🤖', parteEmoji: '📡' },
    { sg: 'par de medias', pl: 'pares de medias', g: 'm', parte: 'medias', emoji: '🧦', parteEmoji: '🧦' },
    { sg: 'par de zapatillas', pl: 'pares de zapatillas', g: 'm', parte: 'zapatillas', emoji: '👟', parteEmoji: '👟' },
  ];

  // Objetos para representaciones visuales (18).
  const EMOJIS_CONTAR = ['🍎', '⭐', '🪙', '🎈', '🍪', '🧸', '💎', '🐚', '🍓', '🌼'];

  // ================================================================
  // 11. Cuentos: estructuras controladas
  // ================================================================

  const LUGARES = [
    { id: 'bosque', nombre: 'el bosque', accion: 'caminaba por el bosque', evento: 'Caminó por el bosque', en: 'En el bosque', emoji: '🌲' },
    { id: 'playa', nombre: 'la playa', accion: 'paseaba por la playa', evento: 'Paseó por la playa', en: 'En la playa', emoji: '🏖️' },
    { id: 'castillo', nombre: 'el castillo', accion: 'exploraba el castillo', evento: 'Exploró el castillo', en: 'En el castillo', emoji: '🏰' },
    { id: 'nave', nombre: 'la nave espacial', accion: 'viajaba en la nave espacial', evento: 'Viajó en la nave espacial', en: 'En la nave espacial', emoji: '🚀' },
    { id: 'jardin', nombre: 'el jardín', accion: 'jugaba en el jardín', evento: 'Jugó en el jardín', en: 'En el jardín', emoji: '🌻' },
    { id: 'montana', nombre: 'la montaña', accion: 'subía la montaña', evento: 'Subió la montaña', en: 'En la montaña', emoji: '⛰️' },
    { id: 'isla', nombre: 'la isla', accion: 'recorría la isla', evento: 'Recorrió la isla', en: 'En la isla', emoji: '🏝️' },
  ];
  const RECIPIENTES = [
    { id: 'caja', nombre: 'caja', g: 'f', emoji: '📦' },
    { id: 'cofre', nombre: 'cofre', g: 'm', emoji: '🧰' },
    { id: 'bolsa', nombre: 'bolsa', g: 'f', emoji: '👜' },
    { id: 'baul', nombre: 'baúl', g: 'm', emoji: '🧳' },
  ];
  const COLORES = [
    { id: 'azul', m: 'azul', f: 'azul', emoji: '🔵' },
    { id: 'verde', m: 'verde', f: 'verde', emoji: '🟢' },
    { id: 'rojo', m: 'rojo', f: 'roja', emoji: '🔴' },
    { id: 'amarillo', m: 'amarillo', f: 'amarilla', emoji: '🟡' },
    { id: 'violeta', m: 'violeta', f: 'violeta', emoji: '🟣' },
    { id: 'naranja', m: 'naranja', f: 'naranja', emoji: '🟠' },
  ];
  const HALLAZGOS = [
    { id: 'estrella', un: 'una estrella', el: 'la estrella', g: 'f', emoji: '⭐' },
    { id: 'llave', un: 'una llave', el: 'la llave', g: 'f', emoji: '🔑' },
    { id: 'mapa', un: 'un mapa', el: 'el mapa', g: 'm', emoji: '🗺️' },
    { id: 'moneda', un: 'una moneda de oro', el: 'la moneda de oro', g: 'f', emoji: '🪙' },
    { id: 'caracol', un: 'un caracol', el: 'el caracol', g: 'm', emoji: '🐚' },
    { id: 'pluma', un: 'una pluma', el: 'la pluma', g: 'f', emoji: '🪶' },
    { id: 'anillo', un: 'un anillo', el: 'el anillo', g: 'm', emoji: '💍' },
    { id: 'huevo', un: 'un huevo de dragón', el: 'el huevo de dragón', g: 'm', emoji: '🥚' },
  ];
  // Lo que hace antes de abrir (niveles 2 y 3). {pr} = la/lo según el recipiente.
  const PRIMERO = [
    { id: 'sacudir', frase: '{Pr} sacudió y escuchó un ruido', respuesta: '{Pr} sacudió' },
    { id: 'polvo', frase: 'Le sacó el polvo con la mano', respuesta: 'Le sacó el polvo' },
    { id: 'golpear', frase: 'Golpeó la tapa tres veces', respuesta: 'Golpeó la tapa' },
    { id: 'mirar', frase: '{Pr} miró de todos lados', respuesta: '{Pr} miró de todos lados' },
  ];
  // Razones (nivel 3) — sin pronombres ambiguos.
  const RAZONES = [
    { id: 'abuela', texto: 'era un regalo para su abuela' },
    { id: 'amigo', texto: 'era un regalo para su mejor amigo' },
    { id: 'lluvia', texto: 'empezaba a llover' },
    { id: 'valioso', texto: (g) => `era muy ${g === 'f' ? 'valiosa' : 'valioso'}` },
  ];

  function crearCuento(azar, nivel, evitar = {}) {
    const lugares = LUGARES.filter((l) => !(evitar.lugares || []).includes(l.id));
    const pjs = PERSONAJES.filter((p) => !(evitar.personajes || []).includes(p.id));
    const L = azar.elegir(lugares.length ? lugares : LUGARES);
    const P = azar.elegir(pjs.length ? pjs : PERSONAJES);
    const R = azar.elegir(RECIPIENTES);
    const C = azar.elegir(COLORES);
    const H = azar.elegir(HALLAZGOS);
    const pr = R.g === 'f' ? 'la' : 'lo';
    const un = R.g === 'f' ? 'una' : 'un';
    const color = C[R.g];
    const recip = `${un} ${R.nombre} ${color}`;
    const elRecip = `${R.g === 'f' ? 'la' : 'el'} ${R.nombre}`;
    const cuento = {
      id: [P.id, L.id, R.id, C.id, H.id].join('-'),
      P, L, R, C, H, pr, nivel, recip, elRecip,
      titulo: `El cuento ${L.id === 'nave' ? 'de la nave' : 'de' + (L.nombre.startsWith('el ') ? 'l ' + L.nombre.slice(3) : ' ' + L.nombre)}`,
      oraciones: [],
    };
    cuento.oraciones.push(`${mayus1(P.nombre)} ${L.accion}.`);
    cuento.oraciones.push(azar.elegir([`Encontró ${recip}.`, `De repente, vio ${recip}.`]));
    if (nivel >= 2) {
      cuento.primero = azar.elegir(PRIMERO);
      cuento.oraciones.push('Primero ' + cuento.primero.frase.replace('{Pr}', pr).replace(/^./, (x) => x.toLowerCase()) + '.');
    }
    const abrir = azar.elegir([
      `Cuando ${pr} abrió, encontró ${H.un}.`,
      `${mayus1(pr)} abrió con cuidado. Adentro había ${H.un}.`,
    ]);
    cuento.oraciones.push(abrir);
    if (nivel >= 3) {
      cuento.razon = azar.elegir(RAZONES);
      const rt = typeof cuento.razon.texto === 'function' ? cuento.razon.texto(H.g) : cuento.razon.texto;
      cuento.razonTexto = rt;
      cuento.oraciones.push(`Guardó ${H.el} en la mochila porque ${rt}.`);
    }
    cuento.rasgos = ['lugar:' + L.id, 'pj:' + P.id, 'hallazgo:' + H.id, 'recip:' + R.id];
    return cuento;
  }

  // ================================================================
  // 13 y 16. Sustantivos, adjetivos y frases
  // ================================================================

  const ADJ = {
    grande: { m: 'grande', f: 'grande' }, pequeno: { m: 'pequeño', f: 'pequeña' },
    rojo: { m: 'rojo', f: 'roja' }, azul: { m: 'azul', f: 'azul' }, verde: { m: 'verde', f: 'verde' },
    blanco: { m: 'blanco', f: 'blanca' }, rapido: { m: 'rápido', f: 'rápida' }, lento: { m: 'lento', f: 'lenta' },
    alto: { m: 'alto', f: 'alta' }, bajo: { m: 'bajo', f: 'baja' }, brillante: { m: 'brillante', f: 'brillante' },
    feliz: { m: 'feliz', f: 'feliz' }, dorado: { m: 'dorado', f: 'dorada' },
  };
  // Cada sustantivo trae SOLO los adjetivos y verbos que tienen sentido con él,
  // y verbos sin otros sustantivos (así la pregunta nunca es ambigua).
  const SUSTANTIVOS = [
    { id: 'perro', s: 'perro', g: 'm', emoji: '🐶', adj: ['grande', 'pequeno', 'feliz', 'rapido', 'blanco'], v: ['corre', 'salta', 'ladra', 'juega'], comp: ['en el parque', 'por la playa'], no: ['lee', 'se abre', 'maúlla', 'rebota', 'brilla'] },
    { id: 'gato', s: 'gato', g: 'm', emoji: '🐱', adj: ['grande', 'pequeno', 'blanco', 'rapido', 'feliz'], v: ['duerme', 'salta', 'juega', 'maúlla'], comp: ['en el sillón', 'en el jardín'], no: ['ladra', 'lee', 'se abre', 'rebota', 'brilla'] },
    { id: 'pelota', s: 'pelota', g: 'f', emoji: '⚽', adj: ['grande', 'pequeno', 'rojo', 'azul', 'brillante'], v: ['rebota', 'rueda'], comp: ['en el patio', 'por la calle'], no: ['ladra', 'lee', 'canta', 'duerme', 'maúlla'] },
    { id: 'arbol', s: 'árbol', g: 'm', emoji: '🌳', adj: ['grande', 'pequeno', 'alto', 'bajo', 'verde'], v: ['crece'], comp: ['en el bosque', 'en la plaza'], no: ['ladra', 'corre', 'lee', 'maúlla', 'baila'] },
    { id: 'nino', s: 'niño', g: 'm', emoji: '👦', adj: ['alto', 'bajo', 'feliz', 'rapido'], v: ['corre', 'salta', 'lee', 'canta'], comp: ['en la escuela', 'en el parque'], no: ['ladra', 'maúlla', 'ruge', 'se abre', 'rebota'] },
    { id: 'nina', s: 'niña', g: 'f', emoji: '👧', adj: ['alto', 'bajo', 'feliz', 'rapido'], v: ['corre', 'salta', 'lee', 'canta'], comp: ['en la escuela', 'en el parque'], no: ['ladra', 'maúlla', 'ruge', 'se abre', 'rebota'] },
    { id: 'libro', s: 'libro', g: 'm', emoji: '📕', adj: ['grande', 'pequeno', 'rojo', 'azul'], v: ['se cae'], comp: ['de la mesa', 'del estante'], no: ['ladra', 'corre', 'canta', 'maúlla', 'duerme'] },
    { id: 'cofre', s: 'cofre', g: 'm', emoji: '🧰', adj: ['grande', 'pequeno', 'dorado', 'brillante'], v: ['se abre'], comp: ['en la cueva', 'en la isla'], no: ['ladra', 'corre', 'canta', 'maúlla', 'lee'] },
    { id: 'dragon', s: 'dragón', g: 'm', emoji: '🐉', adj: ['grande', 'pequeno', 'verde', 'rojo', 'feliz'], v: ['vuela', 'ruge', 'duerme'], comp: ['sobre el castillo', 'en la montaña'], no: ['ladra', 'maúlla', 'se abre', 'rebota'] },
    { id: 'robot', s: 'robot', g: 'm', emoji: '🤖', adj: ['grande', 'pequeno', 'brillante', 'rapido', 'lento'], v: ['camina', 'baila', 'habla'], comp: ['en el laboratorio', 'por la calle'], no: ['ladra', 'maúlla', 'crece', 'se abre', 'ruge'] },
    { id: 'estrella', s: 'estrella', g: 'f', emoji: '⭐', adj: ['grande', 'pequeno', 'brillante', 'dorado'], v: ['brilla'], comp: ['en el cielo'], no: ['ladra', 'corre', 'lee', 'maúlla', 'canta'] },
    { id: 'tortuga', s: 'tortuga', g: 'f', emoji: '🐢', adj: ['grande', 'pequeno', 'lento', 'verde', 'feliz'], v: ['camina', 'nada', 'duerme'], comp: ['en el río', 'por la arena'], no: ['ladra', 'maúlla', 'lee', 'vuela', 'canta'] },
    { id: 'casa', s: 'casa', g: 'f', emoji: '🏠', adj: ['grande', 'pequeno', 'rojo', 'azul', 'alto', 'bajo', 'blanco'], v: [], comp: [], no: [] },
  ];
  const art = (g) => (g === 'f' ? 'la' : 'el');

  function armarFrase(azar, nivel, evitar = []) {
    const conVerbo = SUSTANTIVOS.filter((s) => s.v.length && !evitar.includes(s.id));
    const S = azar.elegir(conVerbo.length ? conVerbo : SUSTANTIVOS.filter((s) => s.v.length));
    const adjId = azar.elegir(S.adj);
    const A = concuerda(ADJ[adjId], S.g);
    const V = azar.elegir(S.v);
    const C = nivel >= 3 && S.comp.length ? azar.elegir(S.comp) : null;
    return { S, adjId, A, V, C, articulo: art(S.g) };
  }

  // ================================================================
  // 14. Interrogación y exclamación
  // ================================================================

  const COSAS_BUSCAR = ['el tesoro', 'la llave', 'el mapa', 'mi mochila', 'Chispa', 'Robot 2X', 'la nave'];
  const PREGUNTAS = [
    { id: 'donde', gen: (az) => { const x = az.elegir(COSAS_BUSCAR); return { f: `Dónde está ${x}`, sit: `quiere saber dónde está ${x}`, k: x }; } },
    { id: 'quien', gen: (az) => { const x = az.elegir(['llegó', 'ganó la carrera', 'abrió el cofre', 'encontró el mapa']); return { f: `Quién ${x}`, sit: `quiere saber quién ${x}`, k: x }; } },
    { id: 'cuando', gen: (az) => { const x = az.elegir(['la aventura', 'la carrera', 'la fiesta', 'el viaje']); return { f: `Cuándo empieza ${x}`, sit: `quiere saber cuándo empieza ${x}`, k: x }; } },
    { id: 'que-hay', gen: (az) => { const x = az.elegir(['en el cofre', 'dentro de la caja', 'detrás de la puerta', 'en la cueva']); return { f: `Qué hay ${x}`, sit: `quiere saber qué hay ${x}`, k: x }; } },
    { id: 'como', gen: (az) => { const x = az.elegir(['tu perro', 'el dragón', 'tu robot', 'la nave']); return { f: `Cómo se llama ${x}`, sit: `quiere saber cómo se llama ${x}`, k: x }; } },
    { id: 'cuantas', ambigua: true, gen: (az) => { const x = az.elegir(['estrellas', 'gemas', 'monedas']); return { f: `Cuántas ${x} hay`, sit: `quiere saber cuántas ${x} hay`, k: x }; } },
    { id: 'vamos', ambigua: true, gen: (az) => { const x = az.elegir(['al castillo', 'a la playa', 'al bosque']); return { f: `Vamos ${x}`, sit: `quiere saber si van ${x}`, k: x }; } },
  ];
  const EXCLAMACIONES = [
    { id: 'encontre', gen: (az) => { const x = az.elegir(['el tesoro', 'la llave', 'el mapa', 'mi mochila']); return { f: `Encontré ${x}`, sit: `encuentra ${x} y grita de alegría`, k: x }; } },
    { id: 'sorpresa', gen: (az) => { const x = az.elegir(['sorpresa', 'alegría', 'susto']); const s = { sorpresa: 'abre un regalo y se sorprende', 'alegría': 'recibe una buena noticia y salta de alegría', susto: 'escucha un ruido fuerte y se asusta' }[x]; return { f: `Qué ${x}`, sit: s, k: x }; } },
    { id: 'ganamos', gen: (az) => { const x = az.elegir(['la misión', 'la carrera', 'el partido']); return { f: `Ganamos ${x}`, sit: `gana ${x} con su equipo y festeja`, k: x }; } },
    { id: 'cuidado', gen: (az) => { const x = az.elegir(['el dragón', 'la ola', 'el pozo']); return { f: `Cuidado con ${x}`, sit: `ve un peligro (${x}) y avisa a sus amigos`, k: x }; } },
    { id: 'que-adj', gen: (az) => { const S = az.elegir(SUSTANTIVOS.filter((s) => ['dragon', 'arbol', 'estrella', 'tortuga', 'casa', 'robot'].includes(s.id))); const a = concuerda(ADJ[az.elegir(['grande', 'alto', 'brillante', 'pequeno'].filter((x) => S.adj.includes(x)))], S.g); return { f: `Qué ${a} es ${art(S.g)} ${S.s}`, sit: `ve ${S.g === 'f' ? 'una' : 'un'} ${S.s} y se asombra`, k: S.id }; } },
    { id: 'llegamos', gen: (az) => { const x = az.elegir(['al castillo', 'a la isla', 'a la cima']); return { f: `Llegamos ${x}`, sit: `llega ${x} después de un largo viaje y festeja`, k: x }; } },
  ];

  // ================================================================
  // 15. CE / CI / QUE / QUI — solo palabras verificadas
  // ================================================================
  // pos: índice donde empieza el grupo; sil: cómo aparece en la palabra
  // (química lleva tilde: «quí»). img: dibujo que define la palabra sin
  // ambigüedad. Sin img, la palabra solo se completa escuchándola.

  const PALABRAS_CQ = [
    // CE
    { p: 'cereza', g: 'CE', pos: 0, sil: 'ce', img: '🍒' },
    { p: 'cepillo', g: 'CE', pos: 0, sil: 'ce', img: '🪥' },
    { p: 'cena', g: 'CE', pos: 0, sil: 'ce', img: '🍽️' },
    { p: 'cerro', g: 'CE', pos: 0, sil: 'ce', img: '⛰️' },
    { p: 'cerca', g: 'CE', pos: 0, sil: 'ce' },
    { p: 'cebra', g: 'CE', pos: 0, sil: 'ce', img: '🦓' },
    { p: 'cebolla', g: 'CE', pos: 0, sil: 'ce', img: '🧅' },
    { p: 'cerdo', g: 'CE', pos: 0, sil: 'ce', img: '🐷' },
    // CI
    { p: 'cine', g: 'CI', pos: 0, sil: 'ci', img: '🎬' },
    { p: 'cielo', g: 'CI', pos: 0, sil: 'ci' },
    { p: 'cinco', g: 'CI', pos: 0, sil: 'ci', img: '5️⃣' },
    { p: 'cinturón', g: 'CI', pos: 0, sil: 'ci' },
    { p: 'circo', g: 'CI', pos: 0, sil: 'ci', img: '🎪' },
    { p: 'ciruela', g: 'CI', pos: 0, sil: 'ci' },
    { p: 'cisne', g: 'CI', pos: 0, sil: 'ci', img: '🦢' },
    { p: 'ciudad', g: 'CI', pos: 0, sil: 'ci', img: '🏙️' },
    // QUE
    { p: 'queso', g: 'QUE', pos: 0, sil: 'que', img: '🧀' },
    { p: 'quemar', g: 'QUE', pos: 0, sil: 'que' },
    { p: 'querer', g: 'QUE', pos: 0, sil: 'que' },
    { p: 'pequeño', g: 'QUE', pos: 2, sil: 'que' },
    { p: 'paquete', g: 'QUE', pos: 2, sil: 'que', img: '📦' },
    { p: 'raqueta', g: 'QUE', pos: 2, sil: 'que', img: '🎾' },
    { p: 'esqueleto', g: 'QUE', pos: 2, sil: 'que', img: '💀' },
    { p: 'parque', g: 'QUE', pos: 3, sil: 'que', img: '🏞️' },
    // QUI
    { p: 'quince', g: 'QUI', pos: 0, sil: 'qui' },
    { p: 'quinto', g: 'QUI', pos: 0, sil: 'qui' },
    { p: 'quieto', g: 'QUI', pos: 0, sil: 'qui' },
    { p: 'química', g: 'QUI', pos: 0, sil: 'quí', sinHueco: true },
    { p: 'mosquito', g: 'QUI', pos: 3, sil: 'qui', img: '🦟' },
    { p: 'máquina', g: 'QUI', pos: 2, sil: 'qui' },
    { p: 'esquina', g: 'QUI', pos: 2, sil: 'qui' },
    { p: 'mantequilla', g: 'QUI', pos: 5, sil: 'qui', img: '🧈' },
    { p: 'equipo', g: 'QUI', pos: 1, sil: 'qui' },
  ];
  const GRUPOS_CQ = ['CE', 'CI', 'QUE', 'QUI'];
  const gruposEn = (p) => GRUPOS_CQ.filter((g) => normalizar(p).includes(g.toLowerCase()));
  // «quince» tiene QUI y también CE: no sirve para clasificar ni para buscar un grupo.
  PALABRAS_CQ.forEach((w) => { w.mixta = gruposEn(w.p).length > 1; });
  // Errores que coinciden con palabras reales: nunca se usan como distractor.
  const NO_DISTRACTORES = new Set(['quena', 'kine', 'ceso', 'cene']);

  /** Errores de ortografía frecuentes para «¿cuál está bien escrita?». */
  function malEscritas(w) {
    const { p, pos, g } = w;
    const res = [];
    if (g === 'CE' || g === 'CI') {
      // c → qu, c → k
      res.push(p.slice(0, pos) + 'qu' + p.slice(pos + 1));
      res.push(p.slice(0, pos) + 'k' + p.slice(pos + 1));
    } else {
      // qu → k, qu → q
      res.push(p.slice(0, pos) + 'k' + p.slice(pos + 2));
      res.push(p.slice(0, pos) + 'q' + p.slice(pos + 2));
    }
    const reales = new Set(PALABRAS_CQ.map((x) => x.p));
    return res.filter((x) => !NO_DISTRACTORES.has(x) && !reales.has(x));
  }

  function conHueco(w) {
    return { antes: w.p.slice(0, w.pos), despues: w.p.slice(w.pos + w.sil.length) };
  }

  // ================================================================
  // Construcción de actividades
  // ================================================================
  // Una actividad es un objeto plano:
  //   tema, tipo (modalidad), nivel, interaccion, consigna, decir (lectura en voz alta),
  //   visual: [bloques a dibujar], datos de la interacción, respuesta, pista,
  //   familia/params (para repasar el mismo concepto), firma (anti-repetición).

  const op = (id, texto, extra = {}) => ({ id: String(id), texto: String(texto), ...extra });

  function opcionesNumericas(correcta, distractores) {
    return [op('c', correcta), ...distractores.map((d, i) => op('d' + i, d))];
  }

  function guiaAl(azar) { return azar.elegir(GUIAS); }

  // ---------------- NUMERACIÓN (4) ----------------

  const TEMAS_TARJETA = [
    { emoji: '🎈', nombre: 'globo' }, { emoji: '⭐', nombre: 'estrella' },
    { emoji: '🥚', nombre: 'huevo' }, { emoji: '🪨', nombre: 'piedra' }, { emoji: '🐟', nombre: 'pez' },
  ];

  function numeroNuevo(ctx, min, max, condicion) {
    return generateNumberWithConstraints(ctx.azar, { min, max, excluded: ctx.numerosRecientes, condicion });
  }

  const NUMERACION = [
    {
      id: 'buscar', familia: 'reconocer', interaccion: 'tocar', niveles: [1, 2, 3],
      generar(ctx) {
        const { azar, nivel } = ctx; const [min, max] = RANGOS[nivel];
        const n = numeroNuevo(ctx, min, max);
        const d = distractoresNumericos(azar, n, { min, max, cantidad: 5, preferir: 'mixto' });
        const T = azar.elegir(TEMAS_TARJETA);
        const P = guiaAl(azar);
        const consigna = azar.elegir([
          `Buscá el ${n}.`,
          `Tocá el ${T.nombre} que tiene el ${n}.`,
          `${P.nombre} perdió el ${n}. ¿Lo encontrás?`,
          `Encontrá el número ${n}.`,
        ]);
        return {
          consigna, decir: consigna.replace(String(n), numeroEnLetras(n)),
          opciones: opcionesNumericas(n, d).map((o) => ({ ...o, emoji: T.emoji })), respuesta: 'c', disposicion: 'grilla',
          pista: `Mirá primero la primera cifra: tiene que ser ${String(n)[0]}.`,
          firma: { clave: 'buscar:' + n, numeros: [n] },
        };
      },
    },
    {
      id: 'despues', familia: 'sucesion', interaccion: ['elegir', 'completar'], niveles: [1, 2, 3],
      generar(ctx) {
        const { azar, nivel } = ctx; const [min, max] = RANGOS[nivel];
        const cruce = azar.moneda(0.35);
        const n = numeroNuevo(ctx, min, max - 1, (x) => !cruce || x % 10 === 9);
        const r = n + 1;
        const P = guiaAl(azar);
        const consigna = azar.elegir([
          `¿Qué número viene después del ${n}?`,
          `${P.nombre} está en el ${n} y avanza uno. ¿A qué número llega?`,
          `¿Qué número sigue?`,
        ]);
        return {
          consigna, visual: [{ tipo: 'secuencia', items: [n, null] }],
          ...respuestaNumero(ctx, r, distractoresSucesion(azar, r, n, min, max)),
          pista: `Contá uno más: ${n}… ¿y después?`,
          firma: { clave: 'despues:' + n, numeros: [n] },
        };
      },
    },
    {
      id: 'antes', familia: 'sucesion', interaccion: ['elegir', 'completar'], niveles: [1, 2, 3],
      generar(ctx) {
        const { azar, nivel } = ctx; const [min, max] = RANGOS[nivel];
        const cruce = azar.moneda(0.35);
        const n = numeroNuevo(ctx, min + 1, max, (x) => !cruce || x % 10 === 0);
        const r = n - 1;
        const consigna = azar.elegir([
          `¿Qué número viene antes del ${n}?`,
          `¿Qué número está justo antes del ${n}?`,
          `Contá para atrás. ¿Qué número va antes del ${n}?`,
        ]);
        return {
          consigna, visual: [{ tipo: 'secuencia', items: [null, n] }],
          ...respuestaNumero(ctx, r, distractoresSucesion(azar, r, n, min, max)),
          pista: `Es uno menos que ${n}.`,
          firma: { clave: 'antes:' + n, numeros: [n] },
        };
      },
    },
    {
      id: 'mayor', familia: 'comparar', interaccion: 'elegir', niveles: [1, 2, 3],
      generar(ctx) { return compararNumeros(ctx, 'mayor'); },
    },
    {
      id: 'menor', familia: 'comparar', interaccion: 'elegir', niveles: [1, 2, 3],
      generar(ctx) { return compararNumeros(ctx, 'menor'); },
    },
    {
      id: 'ordenar-asc', familia: 'comparar', interaccion: 'ordenar', niveles: [1, 2, 3],
      generar(ctx) { return ordenarNumeros(ctx, 'asc'); },
    },
    {
      id: 'ordenar-desc', familia: 'comparar', interaccion: 'ordenar', niveles: [1, 2, 3],
      generar(ctx) { return ordenarNumeros(ctx, 'desc'); },
    },
    {
      id: 'falta', familia: 'sucesion', interaccion: ['completar', 'elegir'], niveles: [1, 2, 3],
      generar(ctx) {
        const { azar, nivel } = ctx; const [min, max] = RANGOS[nivel];
        const paso = nivel === 3 && azar.moneda(0.5) ? 10 : 1;
        const largo = nivel === 1 ? 4 : 5;
        const inicio = numeroNuevo(ctx, min, max - paso * (largo - 1), paso === 10 ? (x) => x % 10 === 0 : undefined);
        const items = Array.from({ length: largo }, (_, i) => inicio + i * paso);
        const hueco = azar.entero(1, largo - 1);
        const r = items[hueco];
        const vis = items.map((x, i) => (i === hueco ? null : x));
        const consigna = paso === 10
          ? azar.elegir(['Contamos de 10 en 10. ¿Qué número falta?', '¿Qué número falta en la fila?'])
          : azar.elegir(['¿Qué número falta?', 'Completá la fila de números.', '¡Se escapó un número! ¿Cuál es?']);
        return {
          consigna, visual: [{ tipo: 'secuencia', items: vis }],
          ...respuestaNumero(ctx, r, distractoresSucesion(azar, r, items[hueco - 1], min, max)),
          pista: paso === 10 ? 'Cada número tiene 10 más que el anterior.' : 'Cada número tiene 1 más que el anterior.',
          firma: { clave: 'falta:' + items.join(','), numeros: [r] },
        };
      },
    },
    {
      id: 'entre', familia: 'sucesion', interaccion: ['elegir', 'completar'], niveles: [1, 2, 3],
      generar(ctx) {
        const { azar, nivel } = ctx; const [min, max] = RANGOS[nivel];
        const r = numeroNuevo(ctx, min + 1, max - 1);
        return {
          consigna: azar.elegir([`Encontrá el número entre ${r - 1} y ${r + 1}.`, `¿Qué número está entre el ${r - 1} y el ${r + 1}?`]),
          visual: [{ tipo: 'secuencia', items: [r - 1, null, r + 1] }],
          ...respuestaNumero(ctx, r, distractoresSucesion(azar, r, r - 1, min, max)),
          pista: `Es uno más que ${r - 1}.`,
          firma: { clave: 'entre:' + r, numeros: [r] },
        };
      },
    },
  ];

  function distractoresSucesion(azar, r, n, min, max) {
    const cand = azar.mezclar([r + 1, r - 1, r + 10, r - 10, ...permutacionesDigitos(r)])
      .filter((x) => x !== r && x !== n && x >= Math.max(0, min - 1) && x <= max);
    return [...new Set(cand)].slice(0, 2);
  }

  /** Respuesta numérica: a veces se elige entre opciones, a veces se escribe. */
  function respuestaNumero(ctx, r, distractores) {
    const forzar = ctx.interaccion;
    const usarTeclado = forzar ? forzar === 'completar' : ctx.azar.moneda(ctx.nivel === 1 ? 0.3 : 0.5);
    if (usarTeclado) return { interaccion: 'completar', entrada: 'numero', respuesta: r };
    return { interaccion: 'elegir', opciones: opcionesNumericas(r, distractores), respuesta: 'c' };
  }

  function compararNumeros(ctx, modo) {
    const { azar, nivel } = ctx; const [min, max] = RANGOS[nivel];
    const n = numeroNuevo(ctx, min, max, (x) => x >= 10);
    const cant = nivel === 1 ? 1 : 2;
    const otros = distractoresNumericos(azar, n, { min, max, cantidad: cant, preferir: 'digitos' });
    const todos = [n, ...otros];
    const r = modo === 'mayor' ? Math.max(...todos) : Math.min(...todos);
    const P = guiaAl(azar);
    const cosa = azar.elegir([['cofre', '🧰'], ['cohete', '🚀'], ['globo', '🎈'], ['cartel', '🪧']]);
    const consigna = modo === 'mayor'
      ? azar.elegir(['¿Cuál es mayor?', `${P.nombre} quiere el ${cosa[0]} con el número más grande. ¿Cuál elige?`, 'Tocá el número mayor.'])
      : azar.elegir(['¿Cuál es menor?', `${P.nombre} busca el ${cosa[0]} con el número más chico. ¿Cuál es?`, 'Tocá el número menor.']);
    return {
      consigna, interaccion: 'elegir',
      opciones: todos.map((x) => op(x === r ? 'c' : 'd' + x, x, { emoji: cosa[1] })), respuesta: 'c',
      pista: 'Compará primero las cifras de la izquierda. Si son iguales, mirá la siguiente.',
      firma: { clave: modo + ':' + todos.slice().sort().join(','), numeros: todos },
    };
  }

  function ordenarNumeros(ctx, sentido) {
    const { azar, nivel } = ctx; const [min, max] = RANGOS[nivel];
    const cant = nivel === 1 ? 3 : 4;
    const base = numeroNuevo(ctx, min, max);
    const nums = [base, ...distractoresNumericos(azar, base, { min, max, cantidad: cant - 1, preferir: 'mixto' })];
    const orden = nums.slice().sort((a, b) => (sentido === 'asc' ? a - b : b - a));
    const fichas = azar.mezclar(nums).map((x) => op('n' + x, x));
    // Nunca mostrar las fichas ya ordenadas.
    if (fichas.every((f, i) => f.texto === String(orden[i]))) fichas.reverse();
    return {
      consigna: sentido === 'asc'
        ? azar.elegir(['Ordená de menor a mayor.', 'Poné los números en orden: del más chico al más grande.'])
        : azar.elegir(['Ordená de mayor a menor.', 'Poné los números en orden: del más grande al más chico.']),
      interaccion: 'ordenar', fichas, ordenesValidos: [orden.map((x) => 'n' + x)],
      etiquetas: sentido === 'asc' ? ['MENOR', 'MAYOR'] : ['MAYOR', 'MENOR'],
      pista: sentido === 'asc' ? 'Buscá primero el más chico de todos.' : 'Buscá primero el más grande de todos.',
      firma: { clave: 'ordenar:' + nums.slice().sort().join(','), numeros: nums },
    };
  }

  // ---------------- LECTURA DE NÚMEROS (5) ----------------

  const LECTURA = [
    {
      id: 'numero-a-palabras', familia: 'leer', interaccion: 'elegir', niveles: [1, 2, 3],
      generar(ctx) {
        const { azar, nivel } = ctx; const [min, max] = RANGOS[nivel];
        const n = numeroNuevo(ctx, Math.max(min, 11), max);
        const d = distractoresNumericos(azar, n, { min: 1, max: 1000, cantidad: 2, preferir: 'digitos' });
        const P = guiaAl(azar);
        return {
          consigna: azar.elegir([`¿Cómo se escribe el ${n}?`, `${P.nombre} escribió un cartel con el ${n}. ¿Qué dice?`, `Elegí cómo se lee el ${n}.`]),
          visual: [{ tipo: 'numero-grande', n }],
          interaccion: 'elegir', opciones: [op('c', numeroEnLetras(n)), ...d.map((x, i) => op('d' + i, numeroEnLetras(x)))], respuesta: 'c',
          pista: n >= 30 ? `Empieza con «${numeroEnLetras(n).split(' ')[0]}».` : 'Leelo en voz alta, despacito.',
          firma: { clave: 'leer:' + n, numeros: [n] },
        };
      },
    },
    {
      id: 'palabras-a-numero', familia: 'leer', interaccion: 'elegir', niveles: [1, 2, 3],
      generar(ctx) {
        const { azar, nivel } = ctx; const [min, max] = RANGOS[nivel];
        const n = numeroNuevo(ctx, Math.max(min, 11), max);
        const d = distractoresNumericos(azar, n, { min: 1, max: 1000, cantidad: 2, preferir: 'digitos' });
        return {
          consigna: azar.elegir(['¿Qué número es?', 'Tocá el número que dice el cartel.', 'Elegí el número escrito con cifras.']),
          visual: [{ tipo: 'cartel', texto: numeroEnLetras(n) }],
          interaccion: 'elegir', opciones: opcionesNumericas(n, d), respuesta: 'c',
          pista: 'Fijate en la primera palabra: te dice cuántas centenas o decenas hay.',
          firma: { clave: 'leer:' + n, numeros: [n] },
        };
      },
    },
    {
      id: 'escuchar-numero', familia: 'leer', interaccion: 'escuchar', niveles: [1, 2, 3],
      generar(ctx) {
        const { azar, nivel } = ctx; const [min, max] = RANGOS[nivel];
        const n = numeroNuevo(ctx, Math.max(min, 11), max);
        const d = distractoresNumericos(azar, n, { min: 1, max: 1000, cantidad: 3, preferir: 'digitos' });
        return {
          consigna: 'Escuchá y tocá el número.', audio: numeroEnLetras(n),
          interaccion: 'escuchar', opciones: opcionesNumericas(n, d), respuesta: 'c',
          pista: `Empieza con «${numeroEnLetras(n).split(' ')[0]}».`,
          firma: { clave: 'oir:' + n, numeros: [n] },
        };
      },
    },
    {
      id: 'asociar-numeros', familia: 'leer', interaccion: 'asociar', niveles: [1, 2, 3],
      generar(ctx) {
        const { azar, nivel } = ctx; const [min, max] = RANGOS[nivel];
        const n = numeroNuevo(ctx, Math.max(min, 12), max);
        const nums = [n, ...distractoresNumericos(azar, n, { min: Math.max(min, 11), max, cantidad: 2, preferir: 'digitos' })];
        return {
          consigna: 'Uní cada número con cómo se escribe.', interaccion: 'asociar',
          izquierda: azar.mezclar(nums).map((x) => op('i' + x, x)),
          derecha: azar.mezclar(nums).map((x) => op('d' + x, numeroEnLetras(x))),
          pares: Object.fromEntries(nums.map((x) => ['i' + x, 'd' + x])),
          pista: 'Empezá por el número que te resulte más fácil.',
          firma: { clave: 'asociar:' + nums.slice().sort().join(','), numeros: nums },
        };
      },
    },
  ];

  // ---------------- SUMAS Y RESTAS (6, 7) ----------------

  function numerosSuma(azar, nivel, llevar, pequenos) {
    if (pequenos) { const a = azar.entero(2, 9), b = azar.entero(1, Math.min(9, 15 - a)); return [a, b]; }
    for (let i = 0; i < 300; i++) {
      let a, b;
      if (nivel === 3 && !llevar) { a = azar.entero(110, 899); b = azar.entero(11, 99); }
      else { a = azar.entero(11, 89); b = azar.entero(llevar ? 11 : 2, 89); }
      const lleva = (a % 10) + (b % 10) >= 10;
      if (lleva !== llevar) continue;
      if (nivel === 3 && !llevar && Math.floor((a % 100) / 10) + Math.floor(b / 10) >= 10) continue;
      if (a + b > (nivel === 3 && !llevar ? 999 : 99)) continue;
      return [a, b];
    }
    return llevar ? [47, 25] : [24, 13];
  }

  function numerosResta(azar, nivel, dificil, pequenos) {
    if (pequenos) { const a = azar.entero(5, 12); return [a, azar.entero(1, a - 1)]; }
    for (let i = 0; i < 300; i++) {
      let a, b;
      if (nivel === 3 && !dificil) { a = azar.entero(120, 999); b = azar.entero(11, 99); }
      else { a = azar.entero(20, 99); b = azar.entero(dificil ? 11 : 2, a - 2); }
      const presta = (a % 10) < (b % 10);
      if (presta !== dificil) continue;
      if (nivel === 3 && !dificil && Math.floor((a % 100) / 10) < Math.floor(b / 10)) continue;
      if (a - b < 1) continue;
      return [a, b];
    }
    return dificil ? [45, 18] : [38, 12];
  }

  function distractoresCuenta(azar, a, b, oper, r) {
    const cand = [r + 1, r - 1, r + 10, r - 10, ...permutacionesDigitos(r)];
    if (oper === '+' && (a % 10) + (b % 10) >= 10) cand.push(r - 10, r - 10); // se olvidó de la que se lleva
    if (oper === '-') {
      // error típico: restar la cifra menor de la mayor en las unidades
      const u = Math.abs((a % 10) - (b % 10));
      const d = Math.floor(a / 10) - Math.floor(b / 10);
      if (d >= 0) cand.push(d * 10 + u, d * 10 + u);
    }
    const res = [];
    for (const x of azar.mezclar(cand)) if (x > 0 && x !== r && !res.includes(x)) res.push(x);
    return res.slice(0, 2);
  }

  function cuenta(oper) {
    const esSuma = oper === '+';
    const modalidades = [
      {
        id: 'operacion', interaccion: ['elegir', 'completar'], niveles: [1, 2, 3],
        generar(ctx) {
          const { azar, nivel } = ctx;
          const dificil = ctx.params?.dificil ?? (nivel === 1 ? false : nivel === 2 ? true : azar.moneda());
          const [a, b] = esSuma ? numerosSuma(azar, nivel, dificil) : numerosResta(azar, nivel, dificil);
          const r = esSuma ? a + b : a - b;
          return {
            consigna: azar.elegir(esSuma
              ? ['Resolvé la suma.', '¿Cuánto es?', '¡A sumar!']
              : ['Resolvé la resta.', '¿Cuánto es?', '¡A restar!']),
            visual: [{ tipo: 'cuenta', a, b, oper }],
            ...respuestaNumero(ctx, r, distractoresCuenta(azar, a, b, oper, r)),
            params: { dificil }, pista: pistaCuenta(a, b, oper),
            firma: { clave: `${a}${oper}${b}`, numeros: [a, b] },
          };
        },
      },
      {
        id: 'objetos', interaccion: 'elegir', niveles: [1],
        generar(ctx) {
          const { azar } = ctx;
          const [a, b] = esSuma ? numerosSuma(azar, 1, false, true) : numerosResta(azar, 1, false, true);
          const r = esSuma ? a + b : a - b;
          const e = azar.elegir(EMOJIS_CONTAR);
          return {
            consigna: esSuma ? azar.elegir(['¿Cuántos hay en total?', 'Contá todos. ¿Cuántos son?']) : azar.elegir(['Se tachan algunos. ¿Cuántos quedan?', '¿Cuántos quedan sin tachar?']),
            visual: [esSuma ? { tipo: 'objetos', grupos: [{ emoji: e, n: a }, { emoji: e, n: b }], oper: '+' } : { tipo: 'objetos', grupos: [{ emoji: e, n: a, tachados: b }], oper: '-' },
              { tipo: 'cuenta', a, b, oper }],
            interaccion: 'elegir', opciones: opcionesNumericas(r, distractoresCuenta(azar, a, b, oper, r)), respuesta: 'c',
            params: { dificil: false }, pista: esSuma ? 'Contá los primeros y seguí contando los otros.' : 'Contá solo los que no están tachados.',
            firma: { clave: `${a}${oper}${b}`, numeros: [a, b], rasgos: ['emoji:' + e] },
          };
        },
      },
      {
        id: 'bloques', interaccion: ['completar', 'elegir'], niveles: [1, 2],
        generar(ctx) {
          const { azar, nivel } = ctx;
          const dificil = ctx.params?.dificil ?? nivel === 2;
          const [a, b] = esSuma ? numerosSuma(azar, 2, dificil) : numerosResta(azar, 2, dificil);
          const r = esSuma ? a + b : a - b;
          return {
            consigna: esSuma ? azar.elegir(['Mirá las barras de 10 y los cubitos. ¿Cuánto es?', 'Juntá decenas con decenas y unidades con unidades.'])
              : azar.elegir(['Mirá las barras de 10 y los cubitos. ¿Cuánto queda?', 'Sacá decenas de decenas y unidades de unidades.']),
            visual: [{ tipo: 'bloques', numeros: esSuma ? [a, b] : [a], quitar: esSuma ? 0 : b }, { tipo: 'cuenta', a, b, oper }],
            ...respuestaNumero(ctx, r, distractoresCuenta(azar, a, b, oper, r)),
            params: { dificil }, pista: pistaCuenta(a, b, oper),
            firma: { clave: `${a}${oper}${b}`, numeros: [a, b] },
          };
        },
      },
      {
        id: 'problema', interaccion: ['elegir', 'completar'], niveles: [1, 2, 3],
        generar(ctx) {
          const { azar, nivel } = ctx;
          const dificil = ctx.params?.dificil ?? (nivel >= 2 && azar.moneda(0.6));
          const [a, b] = esSuma ? numerosSuma(azar, nivel, dificil) : numerosResta(azar, nivel, dificil);
          const r = esSuma ? a + b : a - b;
          const pr = armarProblema(azar, oper, a, b);
          return {
            consigna: pr.pregunta,
            visual: [{ tipo: 'problema', texto: pr.texto, emoji: pr.O.emoji, personaje: pr.P.emoji }],
            decir: pr.texto + ' ' + pr.pregunta,
            ...respuestaNumero(ctx, r, distractoresCuenta(azar, a, b, oper, r)),
            params: { dificil },
            pista: esSuma ? `Tiene ${a} y ${pr.accion === 'juntar' ? 'junta' : 'suma'} ${b}. ¿Es más o menos? Hacé ${a} + ${b}.` : `Tenía ${a} y se van ${b}. ¿Quedan más o menos? Hacé ${a} − ${b}.`,
            firma: { clave: `${a}${oper}${b}`, numeros: [a, b], rasgos: pr.rasgos },
          };
        },
      },
      {
        id: 'asociar-cuentas', interaccion: 'asociar', niveles: [1, 2, 3],
        generar(ctx) {
          const { azar, nivel } = ctx;
          const ops = []; const res = new Set();
          for (let i = 0; i < 60 && ops.length < 3; i++) {
            const dificil = nivel === 1 ? false : azar.moneda();
            const [a, b] = esSuma ? numerosSuma(azar, Math.min(nivel, 2), dificil) : numerosResta(azar, Math.min(nivel, 2), dificil);
            const r = esSuma ? a + b : a - b;
            if (!res.has(r)) { res.add(r); ops.push([a, b, r]); }
          }
          return {
            consigna: esSuma ? 'Uní cada suma con su resultado.' : 'Uní cada resta con su resultado.', interaccion: 'asociar',
            izquierda: azar.mezclar(ops).map(([a, b, r]) => op('i' + r, `${a} ${esSuma ? '+' : '−'} ${b}`)),
            derecha: azar.mezclar(ops).map(([, , r]) => op('d' + r, r)),
            pares: Object.fromEntries(ops.map(([, , r]) => ['i' + r, 'd' + r])),
            pista: 'Resolvé primero la cuenta que te parezca más fácil.',
            firma: { clave: 'asoc' + oper + ops.map((o) => o.join()).join('|'), numeros: ops.flatMap((o) => [o[0], o[1]]) },
          };
        },
      },
      {
        id: 'tocar-resultado', interaccion: 'tocar', niveles: [1, 2, 3],
        generar(ctx) {
          const { azar, nivel } = ctx;
          const r = azar.entero(esSuma ? 25 : 12, esSuma ? 95 : 60);
          const armar = (res) => {
            if (esSuma) { const a = azar.entero(11, res - 11); return [a, res - a]; }
            const a = azar.entero(res + 11, 99); return [a, a - res];
          };
          const buenas = []; const malas = [];
          const nb = azar.entero(2, 3);
          for (let i = 0; i < 80 && buenas.length < nb; i++) {
            const c = armar(r); if (!buenas.some((x) => x[0] === c[0])) buenas.push(c);
          }
          for (let i = 0; i < 80 && malas.length < 6 - nb; i++) {
            const rr = r + azar.elegir(nivel === 1 ? [-10, 10, -20, 20] : [-1, 1, -10, 10, 2, -2]);
            if (rr < 1 || (esSuma && rr < 23) || (!esSuma && rr > 88)) continue;
            const c = armar(rr); if (![...buenas, ...malas].some((x) => x[0] === c[0] && x[1] === c[1])) malas.push(c);
          }
          const t = ([a, b]) => `${a} ${esSuma ? '+' : '−'} ${b}`;
          return {
            consigna: `Tocá todas las ${esSuma ? 'sumas' : 'restas'} que dan ${r}.`, interaccion: 'tocar', disposicion: 'grilla',
            opciones: [...buenas.map((c, i) => op('c' + i, t(c))), ...malas.map((c, i) => op('d' + i, t(c)))],
            respuesta: buenas.map((_, i) => 'c' + i), params: {},
            pista: 'Resolvé cada cuenta de a una. Empezá por las unidades.',
            firma: { clave: 'tocar' + oper + r, numeros: [r] },
          };
        },
      },
      {
        id: 'escuchar-problema', interaccion: 'escuchar', niveles: [1, 2, 3],
        generar(ctx) {
          const { azar, nivel } = ctx;
          const dificil = ctx.params?.dificil ?? (nivel >= 2 && azar.moneda(0.5));
          const [a, b] = esSuma ? numerosSuma(azar, Math.min(nivel, 2), dificil) : numerosResta(azar, Math.min(nivel, 2), dificil);
          const r = esSuma ? a + b : a - b;
          const pr = armarProblema(azar, oper, a, b);
          return {
            consigna: 'Escuchá el problema y elegí la respuesta.', interaccion: 'escuchar',
            audio: pr.texto + ' ' + pr.pregunta,
            visual: [{ tipo: 'problema', texto: pr.texto + ' ' + pr.pregunta, emoji: pr.O.emoji, personaje: pr.P.emoji, oculto: true }],
            opciones: opcionesNumericas(r, distractoresCuenta(azar, a, b, oper, r)), respuesta: 'c',
            params: { dificil }, pista: `La cuenta es ${a} ${esSuma ? '+' : '−'} ${b}.`,
            firma: { clave: `${a}${oper}${b}`, numeros: [a, b], rasgos: pr.rasgos },
          };
        },
      },
      {
        id: 'estimar', interaccion: 'arrastrar', niveles: [2, 3],
        generar(ctx) {
          const { azar } = ctx;
          const lim = azar.elegir([30, 40, 50, 60]);
          const tarjetas = []; const usados = new Set();
          const cuentaQueDa = (r) => {
            if (esSuma) { const a = azar.entero(10, r - 10); return [a, r - a]; }
            const a = azar.entero(r + 10, 99); return [a, a - r];
          };
          for (const grupo of ['menos', 'menos', 'mas', 'mas']) {
            let r;
            const bajo = esSuma ? Math.max(lim - 18, 22) : lim - 18;
            do { r = grupo === 'menos' ? azar.entero(bajo, lim - 2) : azar.entero(lim + 2, Math.min(lim + 25, esSuma ? 98 : 85)); } while (usados.has(r));
            usados.add(r);
            const [a, b] = cuentaQueDa(r);
            tarjetas.push(op(`t${a}-${b}`, `${a} ${esSuma ? '+' : '−'} ${b}`, { grupo }));
          }
          return {
            consigna: `¿Da más o menos que ${lim}? Arrastrá cada cuenta.`, interaccion: 'arrastrar', tarjetas: azar.mezclar(tarjetas),
            grupos: [op('menos', `Menos de ${lim}`), op('mas', `Más de ${lim}`)],
            respuesta: Object.fromEntries(tarjetas.map((t) => [t.id, t.grupo])), params: {},
            pista: 'Mirá primero las decenas: te dicen más o menos cuánto da.',
            firma: { clave: 'estimar' + oper + tarjetas.map((t) => t.id).sort().join(), numeros: [] },
          };
        },
      },
    ];
    modalidades.forEach((m) => { m.familia = esSuma ? 'suma' : 'resta'; });
    return modalidades;
  }

  function pistaCuenta(a, b, oper) {
    if (oper === '+') return `Sumá primero las unidades: ${a % 10} + ${b % 10}. Después las decenas.`;
    return `Restá primero las unidades: ${a % 10} − ${b % 10}. Si no alcanza, pedí una decena.`;
  }

  // ---------------- TABLA DEL 2 Y GRUPOS IGUALES (8, 9) ----------------

  function valorTabla(ctx) {
    if (ctx.params?.n) return ctx.params.n;
    const lim = ctx.nivel === 1 ? 5 : 10;
    const orden = (ctx.mision?.ordenTabla || []).filter((x) => x <= lim);
    const usados = ctx.mision?.tablaUsados || [];
    const sig = orden.find((x) => !usados.includes(x));
    if (sig) { if (ctx.mision) ctx.mision.tablaUsados = usados.concat(sig); return sig; }
    return ctx.azar.entero(1, lim);
  }

  function distractoresTabla(azar, n) {
    const r = 2 * n;
    const cand = [r + 2, r - 2, r + 1, r - 1, n + 2, 2 + n * 10 > 20 ? r + 10 : n * 3].filter((x) => x > 0 && x !== r);
    return [...new Set(azar.mezclar(cand))].slice(0, 2);
  }

  const TABLA2 = [
    {
      id: 'operacion', familia: 'tabla', interaccion: ['elegir', 'completar'], niveles: [2, 3],
      generar(ctx) {
        const { azar } = ctx; const n = valorTabla(ctx);
        const rep = ctx.repaso;
        return {
          consigna: rep ? azar.elegir([`Ahora sí: ¿cuánto es 2 × ${n}?`, `Y ahora con el signo por: ¿2 × ${n}?`]) : azar.elegir(['¿Cuánto es?', 'Tabla del 2: resolvé.', '¡Multiplicá!']),
          visual: [{ tipo: 'cuenta', a: 2, b: n, oper: '×' }],
          ...respuestaNumero(ctx, 2 * n, distractoresTabla(azar, n)),
          params: { n }, pista: `2 × ${n} es lo mismo que ${n} grupos de 2: contá de 2 en 2.`,
          firma: { clave: 'op2x' + n, numeros: [n] },
        };
      },
    },
    {
      id: 'contar-grupos', familia: 'tabla', interaccion: ['elegir', 'completar'], niveles: [1, 2, 3],
      generar(ctx) {
        const { azar } = ctx; const n = valorTabla(ctx);
        const e = azar.elegir(EMOJIS_CONTAR);
        return {
          consigna: azar.elegir([`Hay ${n} ${n === 1 ? 'grupo' : 'grupos'} de 2. ¿Cuántos hay en total?`, '¿Cuántos hay?', 'Contá de 2 en 2. ¿Cuántos son?']),
          visual: [{ tipo: 'grupos', emoji: e, grupos: n, porGrupo: 2 }],
          ...respuestaNumero(ctx, 2 * n, distractoresTabla(azar, n)),
          params: { n }, pista: 'Contá de 2 en 2: 2, 4, 6…',
          firma: { clave: 'grupos' + n + e, numeros: [n], rasgos: ['emoji:' + e] },
        };
      },
    },
    {
      id: 'dos-filas', familia: 'tabla', interaccion: ['elegir', 'completar'], niveles: [1, 2, 3],
      generar(ctx) {
        const { azar } = ctx; const n = valorTabla(ctx);
        const e = azar.elegir(EMOJIS_CONTAR);
        return {
          consigna: azar.elegir(['¿Cuántas hay?', `Hay 2 filas de ${n}. ¿Cuántas hay en total?`]),
          visual: [{ tipo: 'filas', emoji: e, filas: 2, porFila: n }],
          ...respuestaNumero(ctx, 2 * n, distractoresTabla(azar, n)),
          params: { n }, pista: `Son ${n} + ${n}.`,
          firma: { clave: 'filas' + n + e, numeros: [n], rasgos: ['emoji:' + e] },
        };
      },
    },
    {
      id: 'suma-repetida', familia: 'tabla', interaccion: ['elegir', 'completar'], niveles: [1, 2, 3],
      generar(ctx) {
        const { azar } = ctx; const n = valorTabla(ctx);
        const doses = n <= 5 && azar.moneda();
        const texto = doses ? Array(n).fill(2).join(' + ') : `${n} + ${n}`;
        return {
          consigna: azar.elegir(['Resolvé la suma.', '¿Cuánto es?']),
          visual: [{ tipo: 'texto-grande', texto: texto + ' = ?' }],
          ...respuestaNumero(ctx, 2 * n, distractoresTabla(azar, n)),
          params: { n }, pista: doses ? 'Contá de 2 en 2.' : `Es el doble de ${n}.`,
          firma: { clave: 'sumrep' + texto, numeros: [n] },
        };
      },
    },
    {
      id: 'secuencia', familia: 'tabla', interaccion: ['completar', 'elegir'], niveles: [1, 2, 3],
      generar(ctx) {
        const { azar, nivel } = ctx;
        const maxInicio = nivel === 1 ? 1 : 6;
        const k0 = azar.entero(1, maxInicio);
        const items = Array.from({ length: 5 }, (_, i) => 2 * (k0 + i));
        const hueco = azar.entero(0, 4);
        const r = items[hueco];
        return {
          consigna: azar.elegir(['¿Qué número falta?', 'Contamos de 2 en 2. Completá.', 'Robot 2X salta de 2 en 2. ¿Dónde cae?']),
          visual: [{ tipo: 'secuencia', items: items.map((x, i) => (i === hueco ? null : x)) }],
          ...respuestaNumero(ctx, r, [r + 1, r - 1, r + 2, r - 2].filter((x) => x > 0 && !items.includes(x)).slice(0, 2)),
          params: { n: r / 2 }, pista: 'Cada número tiene 2 más que el anterior.',
          firma: { clave: 'sec2:' + items.join(',') + ':' + hueco, numeros: [r / 2] },
        };
      },
    },
    {
      id: 'falta-factor', familia: 'tabla', interaccion: 'elegir', niveles: [3],
      generar(ctx) {
        const { azar } = ctx; const n = valorTabla(ctx);
        const d = [n + 1, n - 1, 2 * n, n + 2].filter((x) => x > 0 && x !== n);
        return {
          consigna: '¿Qué número falta?',
          visual: [{ tipo: 'texto-grande', texto: `2 × ? = ${2 * n}` }],
          interaccion: 'elegir', opciones: opcionesNumericas(n, [...new Set(azar.mezclar(d))].slice(0, 2)), respuesta: 'c',
          params: { n }, pista: `¿Cuántos grupos de 2 hacen ${2 * n}? Contá de 2 en 2.`,
          firma: { clave: 'falta2x' + n, numeros: [n] },
        };
      },
    },
    {
      id: 'problema-pares', familia: 'tabla', interaccion: ['elegir', 'completar'], niveles: [2, 3],
      generar(ctx) {
        const { azar } = ctx; const n = valorTabla(ctx);
        const X = azar.elegir(PARES);
        const texto = n === 1 ? `Hay 1 ${X.sg}. ${X.sg.startsWith('par') ? 'Tiene' : 'Tiene'} 2 ${X.parte}.` : `Hay ${n} ${X.pl}. Cada ${X.sg} tiene 2 ${X.parte}.`;
        return {
          consigna: `¿Cuántas ${X.parte} hay en total?`,
          visual: [{ tipo: 'problema', texto, emoji: X.emoji, repetir: n }],
          decir: texto + ` ¿Cuántas ${X.parte} hay en total?`,
          ...respuestaNumero(ctx, 2 * n, distractoresTabla(azar, n)),
          params: { n }, pista: `Son ${n} grupos de 2: 2 × ${n}.`,
          firma: { clave: 'pares' + n + X.sg, numeros: [n], rasgos: ['obj:' + X.sg] },
        };
      },
    },
    {
      id: 'asociar-tabla', familia: 'tabla', interaccion: 'asociar', niveles: [2, 3],
      generar(ctx) {
        const { azar } = ctx;
        const ns = azar.tomar([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 3);
        const forma = (n) => azar.elegir([`2 × ${n}`, `${n} + ${n}`]);
        return {
          consigna: 'Uní cada cuenta con su resultado.', interaccion: 'asociar',
          izquierda: azar.mezclar(ns).map((n) => op('i' + n, forma(n))),
          derecha: azar.mezclar(ns).map((n) => op('d' + n, 2 * n)),
          pares: Object.fromEntries(ns.map((n) => ['i' + n, 'd' + n])),
          params: { n: ns[0] }, pista: 'Contá de 2 en 2 con los dedos.',
          firma: { clave: 'asoc2:' + ns.slice().sort().join(','), numeros: [] },
        };
      },
    },
    {
      id: 'escuchar-tabla', familia: 'tabla', interaccion: 'escuchar', niveles: [2, 3],
      generar(ctx) {
        const { azar } = ctx; const n = valorTabla(ctx);
        return {
          consigna: 'Escuchá la cuenta y tocá el resultado.', audio: `dos por ${numeroEnLetras(n)}`,
          interaccion: 'escuchar', opciones: opcionesNumericas(2 * n, distractoresTabla(azar, n)), respuesta: 'c',
          params: { n }, pista: `La cuenta es 2 × ${n}.`,
          firma: { clave: 'oir2x' + n, numeros: [n] },
        };
      },
    },
    {
      id: 'tocar-resultados', familia: 'tabla', interaccion: 'tocar', niveles: [1, 2, 3],
      generar(ctx) {
        const { azar, nivel } = ctx;
        const lim = nivel === 1 ? 10 : 20;
        const pares = azar.tomar(Array.from({ length: lim / 2 }, (_, i) => 2 * (i + 1)), 3);
        const impares = azar.tomar(Array.from({ length: lim / 2 }, (_, i) => 2 * i + 1), 3);
        return {
          consigna: 'Tocá todos los números que están en la tabla del 2.', interaccion: 'tocar', disposicion: 'grilla',
          opciones: [...pares.map((x) => op('c' + x, x)), ...impares.map((x) => op('d' + x, x))],
          respuesta: pares.map((x) => 'c' + x),
          pista: 'Están los números que decís cuando contás de 2 en 2: 2, 4, 6…',
          firma: { clave: 'tocar2:' + pares.slice().sort().join(','), numeros: [] },
        };
      },
    },
    {
      id: 'ordenar-tabla', familia: 'tabla', interaccion: 'ordenar', niveles: [1, 2, 3],
      generar(ctx) {
        const { azar, nivel } = ctx;
        const k0 = azar.entero(1, nivel === 1 ? 2 : 7);
        const nums = [0, 1, 2, 3].map((i) => 2 * (k0 + i));
        let fichas = azar.mezclar(nums).map((x) => op('n' + x, x));
        if (fichas.every((f, i) => f.texto === String(nums[i]))) fichas = fichas.reverse();
        return {
          consigna: 'Ordená los saltos de Robot 2X, de 2 en 2.', interaccion: 'ordenar',
          fichas, ordenesValidos: [nums.map((x) => 'n' + x)], etiquetas: ['MENOR', 'MAYOR'],
          pista: 'El más chico va primero. Después, siempre 2 más.',
          firma: { clave: 'ord2:' + nums.join(','), numeros: [] },
        };
      },
    },
  ];

  // ---------------- COMPRENSIÓN LECTORA (11, 12) ----------------

  function cuentoDe(ctx) {
    const { azar, nivel } = ctx;
    if (ctx.mision && ctx.mision.cuento && ctx.continuar) return ctx.mision.cuento;
    const recientes = (ctx.recientes || []).filter((r) => r.tema === 'comprension').slice(0, 6);
    const evitar = {
      lugares: recientes.flatMap((r) => r.rasgos || []).filter((x) => x.startsWith('lugar:')).map((x) => x.slice(6)),
      personajes: recientes.flatMap((r) => r.rasgos || []).filter((x) => x.startsWith('pj:')).map((x) => x.slice(3)),
    };
    const c = crearCuento(azar, nivel, evitar);
    if (ctx.mision) { ctx.mision.cuento = c; ctx.mision.preguntasCuento = []; }
    return c;
  }

  function otros(azar, lista, correcto, clave, n = 2) {
    return azar.tomar(lista.filter((x) => x[clave] !== correcto[clave]), n);
  }

  function actividadCuento(ctx, c, base) {
    if (ctx.mision && ctx.mision.cuento === c) ctx.mision.preguntasCuento.push(base.tipoPregunta);
    return {
      ...base,
      visual: [{ tipo: 'cuento', titulo: c.titulo, emoji: c.L.emoji, oraciones: c.oraciones }, ...(base.visual || [])],
      decir: c.oraciones.join(' ') + ' ' + base.consigna,
      params: { pregunta: base.tipoPregunta },
      firma: { clave: c.id + ':' + base.tipoPregunta, rasgos: c.rasgos, numeros: [] },
    };
  }

  const PREGUNTAS_CUENTO = [
    {
      id: 'quien', niveles: [1, 2, 3], interaccion: 'elegir',
      generar(ctx, c, azar) {
        const ds = otros(azar, PERSONAJES.filter((p) => !(c.P.id.startsWith('robot') && p.id.startsWith('robot'))), c.P, 'id');
        return {
          consigna: azar.elegir([`¿Quién encontró ${c.elRecip}?`, '¿De quién habla el cuento?', `¿Quién ${c.L.accion}?`]),
          interaccion: 'elegir', opciones: [op('c', mayus1(c.P.nombre), { emoji: c.P.emoji }), ...ds.map((p, i) => op('d' + i, mayus1(p.nombre), { emoji: p.emoji }))], respuesta: 'c',
          pista: 'Mirá la primera oración del cuento.',
        };
      },
    },
    {
      id: 'donde', niveles: [1, 2, 3], interaccion: 'elegir',
      generar(ctx, c, azar) {
        const ds = otros(azar, LUGARES, c.L, 'id');
        const imagen = azar.moneda();
        return {
          consigna: azar.elegir([`¿Dónde estaba ${c.P.nombre}?`, '¿En qué lugar pasa el cuento?']),
          interaccion: 'elegir', formato: imagen ? 'imagen' : 'texto',
          opciones: [op('c', mayus1(c.L.nombre), { emoji: c.L.emoji }), ...ds.map((l, i) => op('d' + i, mayus1(l.nombre), { emoji: l.emoji }))], respuesta: 'c',
          pista: 'La primera oración dice por dónde andaba.',
        };
      },
    },
    {
      id: 'color', niveles: [1, 2, 3], interaccion: 'elegir',
      generar(ctx, c, azar) {
        const ds = otros(azar, COLORES, c.C, 'id');
        return {
          consigna: `¿De qué color era ${c.elRecip}?`, interaccion: 'elegir',
          opciones: [op('c', mayus1(c.C[c.R.g]), { emoji: c.C.emoji }), ...ds.map((x, i) => op('d' + i, mayus1(x[c.R.g]), { emoji: x.emoji }))], respuesta: 'c',
          pista: `Buscá la palabra «${c.R.nombre}» en el cuento.`,
        };
      },
    },
    {
      id: 'que-encontro', niveles: [1, 2, 3], interaccion: 'elegir',
      generar(ctx, c, azar) {
        const ds = otros(azar, RECIPIENTES, c.R, 'id');
        return {
          consigna: `¿Qué encontró ${c.P.nombre} en ${c.L.nombre}?`, interaccion: 'elegir', formato: 'imagen',
          opciones: [op('c', `${c.R.g === 'f' ? 'Una' : 'Un'} ${c.R.nombre}`, { emoji: c.R.emoji }), ...ds.map((x, i) => op('d' + i, `${x.g === 'f' ? 'Una' : 'Un'} ${x.nombre}`, { emoji: x.emoji }))], respuesta: 'c',
          pista: 'Está en la segunda oración.',
        };
      },
    },
    {
      id: 'que-habia', niveles: [1, 2, 3], interaccion: 'elegir',
      generar(ctx, c, azar) {
        const ds = otros(azar, HALLAZGOS, c.H, 'id');
        return {
          consigna: azar.elegir([`¿Qué había adentro de ${c.elRecip}?`, `¿Qué encontró ${c.P.nombre} cuando abrió ${c.elRecip}?`]),
          interaccion: 'elegir', formato: azar.moneda() ? 'imagen' : 'texto',
          opciones: [op('c', mayus1(c.H.un), { emoji: c.H.emoji }), ...ds.map((x, i) => op('d' + i, mayus1(x.un), { emoji: x.emoji }))], respuesta: 'c',
          pista: 'Buscá qué pasó cuando lo abrió.',
        };
      },
    },
    {
      id: 'que-hizo', niveles: [1], interaccion: 'elegir',
      generar(ctx, c, azar) {
        const Pr = mayus1(c.pr);
        return {
          consigna: `¿Qué hizo ${c.P.nombre} con ${c.elRecip}?`, interaccion: 'elegir',
          opciones: [op('c', `${Pr} abrió`), op('d0', `${Pr} tiró al agua`), op('d1', `${Pr} pintó`)], respuesta: 'c',
          pista: 'Leé la última oración.',
        };
      },
    },
    {
      id: 'primero', niveles: [2, 3], interaccion: 'elegir',
      generar(ctx, c, azar) {
        const f = (x) => x.respuesta.replace('{Pr}', mayus1(c.pr));
        const ds = otros(azar, PRIMERO, c.primero, 'id');
        return {
          consigna: `¿Qué hizo ${c.P.nombre} antes de abrir ${c.elRecip}?`, interaccion: 'elegir',
          opciones: [op('c', f(c.primero)), ...ds.map((x, i) => op('d' + i, f(x)))], respuesta: 'c',
          pista: 'Buscá la palabra «Primero».',
        };
      },
    },
    {
      id: 'porque', niveles: [3], interaccion: 'elegir',
      generar(ctx, c, azar) {
        const t = (r) => 'Porque ' + (typeof r.texto === 'function' ? r.texto(c.H.g) : r.texto);
        const ds = otros(azar, RAZONES, c.razon, 'id');
        return {
          consigna: `¿Por qué guardó ${c.H.el} en la mochila?`, interaccion: 'elegir',
          opciones: [op('c', t(c.razon)), ...ds.map((x, i) => op('d' + i, t(x)))], respuesta: 'c',
          pista: 'Buscá la palabra «porque» en el cuento.',
        };
      },
    },
    {
      id: 'despues', niveles: [3], interaccion: 'elegir',
      generar(ctx, c, azar) {
        return {
          consigna: `¿Qué hizo ${c.P.nombre} después de encontrar ${c.H.el}?`, interaccion: 'elegir',
          opciones: [op('c', `${c.H.g === 'f' ? 'La' : 'Lo'} guardó en la mochila`), op('d0', `${c.H.g === 'f' ? 'La' : 'Lo'} dejó en ${c.L.nombre}`), op('d1', `${c.H.g === 'f' ? 'La' : 'Lo'} volvió a esconder`)], respuesta: 'c',
          pista: 'Leé la última oración.',
        };
      },
    },
    {
      id: 'vf', niveles: [1, 2, 3], interaccion: 'elegir',
      generar(ctx, c, azar) {
        const verdad = azar.moneda();
        const forma = azar.elegir(['color', 'lugar', 'hallazgo', 'quien']);
        let frase;
        if (forma === 'color') {
          const C = verdad ? c.C : otros(azar, COLORES, c.C, 'id', 1)[0];
          frase = `${mayus1(c.P.nombre)} encontró ${c.R.g === 'f' ? 'una' : 'un'} ${c.R.nombre} ${C[c.R.g]}.`;
        } else if (forma === 'lugar') {
          const L = verdad ? c.L : otros(azar, LUGARES, c.L, 'id', 1)[0];
          frase = `El cuento pasa en ${L.nombre}.`;
        } else if (forma === 'hallazgo') {
          const H = verdad ? c.H : otros(azar, HALLAZGOS, c.H, 'id', 1)[0];
          frase = `Adentro de ${c.elRecip} había ${H.un}.`;
        } else {
          const P = verdad ? c.P : otros(azar, PERSONAJES, c.P, 'id', 1)[0];
          frase = `${mayus1(P.nombre)} encontró ${c.elRecip}.`;
        }
        return {
          consigna: '¿Verdadero o falso?', visual: [{ tipo: 'frase', texto: frase }], interaccion: 'elegir',
          opciones: [op(verdad ? 'c' : 'd0', 'Verdadero', { emoji: '✅' }), op(verdad ? 'd0' : 'c', 'Falso', { emoji: '❌' })], respuesta: 'c',
          sinMezclar: true, pista: 'Volvé a leer el cuento y buscá esa parte.', tipoExtra: forma,
        };
      },
    },
    {
      id: 'completar', niveles: [1, 2, 3], interaccion: 'completar',
      generar(ctx, c, azar) {
        const forma = azar.elegir(['color', 'hallazgo', 'quien']);
        let partes, correcta, ds;
        if (forma === 'color') {
          partes = [`${mayus1(c.P.nombre)} encontró ${c.R.g === 'f' ? 'una' : 'un'} ${c.R.nombre}`, '.'];
          correcta = c.C[c.R.g]; ds = otros(azar, COLORES, c.C, 'id').map((x) => x[c.R.g]);
        } else if (forma === 'hallazgo') {
          partes = [`Adentro de ${c.elRecip} había`, '.'];
          correcta = c.H.un; ds = otros(azar, HALLAZGOS, c.H, 'id').map((x) => x.un);
        } else {
          partes = ['', ` ${c.L.accion}.`];
          correcta = mayus1(c.P.nombre); ds = otros(azar, PERSONAJES, c.P, 'id').map((x) => mayus1(x.nombre));
        }
        return {
          consigna: 'Completá la oración.', interaccion: 'completar', entrada: 'opciones',
          visual: [{ tipo: 'hueco', partes }],
          opciones: [op('c', correcta), ...ds.map((x, i) => op('d' + i, x))], respuesta: 'c',
          pista: 'La respuesta está en el cuento.', tipoExtra: forma,
        };
      },
    },
    {
      id: 'ordenar', niveles: [1, 2, 3], interaccion: 'ordenar',
      generar(ctx, c, azar) {
        const ev = [
          op('e1', c.L.evento + '.'),
          op('e2', `Encontró ${c.recip}.`),
          op('e3', `Abrió ${c.elRecip}.`),
        ];
        if (c.nivel >= 3) ev.push(op('e4', `Guardó ${c.H.el} en la mochila.`));
        let fichas = azar.mezclar(ev);
        if (fichas.every((f, i) => f.id === ev[i].id)) fichas = fichas.slice().reverse();
        return {
          consigna: 'Ordená lo que pasó en el cuento.', interaccion: 'ordenar', fichas,
          ordenesValidos: [ev.map((e) => e.id)], etiquetas: ['PRIMERO', 'AL FINAL'],
          pista: '¿Qué pasó primero: encontrar o abrir?',
        };
      },
    },
  ];

  const COMPRENSION = [{
    id: 'pregunta', familia: 'comprension', interaccion: ['elegir', 'completar', 'ordenar', 'escuchar'], niveles: [1, 2, 3],
    generar(ctx) {
      const { azar } = ctx;
      const c = cuentoDe(ctx);
      const hechas = (ctx.mision && ctx.mision.cuento === c) ? ctx.mision.preguntasCuento : [];
      let cands = PREGUNTAS_CUENTO.filter((p) => p.niveles.includes(c.nivel) && !hechas.includes(p.id));
      if (ctx.params?.evitarPregunta) cands = cands.filter((p) => p.id !== ctx.params.evitarPregunta);
      const escuchar = ctx.interaccion === 'escuchar';
      const quiero = escuchar ? 'elegir' : ctx.interaccion;
      if (quiero) { const f = cands.filter((p) => p.interaccion === quiero && !(escuchar && p.id === 'vf')); if (f.length) cands = f; }
      const P = azar.elegir(cands.length ? cands : PREGUNTAS_CUENTO.filter((p) => p.niveles.includes(c.nivel)));
      const base = P.generar(ctx, c, azar);
      base.tipoPregunta = P.id;
      const act = actividadCuento(ctx, c, base);
      if (escuchar && act.interaccion === 'elegir' && P.id !== 'vf') {
        // ESCUCHAR: el cuento se oye primero y el texto aparece solo si se pide.
        act.interaccion = 'escuchar';
        act.audio = c.oraciones.join(' ') + ' ' + base.consigna;
        act.visual[0] = { ...act.visual[0], oculto: true };
        act.consigna = 'Escuchá el cuento. ' + base.consigna;
      }
      return act;
    },
  }];

  // ---------------- SUSTANTIVOS Y ADJETIVOS (13) ----------------

  function palabrasDeFrase(fr) {
    const w = [];
    w.push(op('w0', mayus1(fr.articulo)));
    w.push(op('s', fr.S.s, { rol: 'sust' }));
    w.push(op('a', fr.A, { rol: 'adj' }));
    fr.V.split(' ').forEach((v, i) => w.push(op('v' + i, v)));
    if (fr.C) fr.C.split(' ').forEach((v, i) => w.push(op('k' + i, v, { rol: /^(el|la|los|las|de|del|en|por|sobre)$/.test(v) ? 'nexo' : 'comp' })));
    w[w.length - 1].texto += '.';
    return w;
  }

  const SUSTADJ = [
    {
      id: 'tocar-sustantivo', familia: 'gramatica', interaccion: 'tocar', niveles: [1, 2],
      generar(ctx) {
        const { azar, nivel } = ctx;
        const fr = armarFrase(azar, nivel === 1 ? 1 : 2, ctx.evitarIds);
        return {
          consigna: azar.elegir(['¿Cuál es el sustantivo? Tocalo.', 'Tocá el sustantivo: la palabra que nombra.']),
          interaccion: 'tocar', disposicion: 'frase', sinMezclar: true,
          opciones: palabrasDeFrase(fr), respuesta: 's',
          pista: '¿Quién hace la acción? Esa palabra nombra algo: es el sustantivo.',
          firma: { clave: 'frase:' + fr.S.id + fr.adjId + fr.V, rasgos: ['sust:' + fr.S.id, 'adj:' + fr.adjId], numeros: [] },
        };
      },
    },
    {
      id: 'tocar-adjetivo', familia: 'gramatica', interaccion: 'tocar', niveles: [1, 2, 3],
      generar(ctx) {
        const { azar, nivel } = ctx;
        const fr = armarFrase(azar, nivel, ctx.evitarIds);
        return {
          consigna: azar.elegir(['¿Cuál es el adjetivo? Tocalo.', `¿Cómo es ${fr.articulo} ${fr.S.s}? Tocá el adjetivo.`]),
          interaccion: 'tocar', disposicion: 'frase', sinMezclar: true,
          opciones: palabrasDeFrase(fr), respuesta: 'a',
          pista: `El adjetivo dice cómo es ${fr.articulo} ${fr.S.s}.`,
          firma: { clave: 'frase:' + fr.S.id + fr.adjId + fr.V, rasgos: ['sust:' + fr.S.id, 'adj:' + fr.adjId], numeros: [] },
        };
      },
    },
    {
      id: 'dos-sustantivos', familia: 'gramatica', interaccion: 'tocar', niveles: [3],
      generar(ctx) {
        const { azar } = ctx;
        const f1 = armarFrase(azar, 2, ctx.evitarIds);
        let f2 = armarFrase(azar, 2, [f1.S.id]);
        const pal = [
          op('a0', mayus1(f1.articulo)), op('s1', f1.S.s), op('j1', f1.A), op('v1', f1.V),
          op('y', 'y'), op('a1', f2.articulo), op('s2', f2.S.s), op('j2', f2.A), op('v2', f2.V + '.'),
        ];
        const buscaAdj = azar.moneda();
        return {
          consigna: buscaAdj ? 'Tocá los dos adjetivos.' : 'Tocá los dos sustantivos.', interaccion: 'tocar', disposicion: 'frase', sinMezclar: true,
          opciones: pal, respuesta: buscaAdj ? ['j1', 'j2'] : ['s1', 's2'],
          pista: buscaAdj ? 'Los adjetivos dicen cómo son las cosas.' : 'Los sustantivos nombran personas, animales o cosas.',
          firma: { clave: 'frase2:' + f1.S.id + f2.S.id + (buscaAdj ? 'A' : 'S'), rasgos: ['sust:' + f1.S.id, 'sust:' + f2.S.id], numeros: [] },
        };
      },
    },
    {
      id: 'clasificar', familia: 'gramatica', interaccion: 'arrastrar', niveles: [1, 2, 3],
      generar(ctx) {
        const { azar, nivel } = ctx;
        const k = nivel === 1 ? 2 : 3;
        const sus = azar.tomar(SUSTANTIVOS, k);
        const adjs = azar.tomar(Object.keys(ADJ), k).map((id) => ADJ[id].m);
        const tarjetas = azar.mezclar([...sus.map((s) => op('s' + s.id, s.s, { grupo: 'sust' })), ...adjs.map((a) => op('a' + a, a, { grupo: 'adj' }))]);
        return {
          consigna: 'Arrastrá cada palabra a su grupo.', interaccion: 'arrastrar', tarjetas,
          grupos: [op('sust', 'Sustantivos', { ayuda: 'nombran' }), op('adj', 'Adjetivos', { ayuda: 'dicen cómo es' })],
          respuesta: Object.fromEntries(tarjetas.map((t) => [t.id, t.grupo])),
          pista: 'Probá decir «el …» o «la …»: si nombra algo, es sustantivo.',
          firma: { clave: 'clas:' + tarjetas.map((t) => t.id).sort().join(','), rasgos: sus.map((s) => 'sust:' + s.id), numeros: [] },
        };
      },
    },
    {
      id: 'concordancia', familia: 'gramatica', interaccion: 'elegir', niveles: [2, 3],
      generar(ctx) {
        const { azar } = ctx;
        let fr;
        for (let i = 0; i < 30; i++) { fr = armarFrase(azar, 2, ctx.evitarIds); if (ADJ[fr.adjId].m !== ADJ[fr.adjId].f) break; }
        const bien = `${mayus1(fr.articulo)} ${fr.S.s} ${fr.A} ${fr.V}.`;
        const otroG = fr.S.g === 'f' ? 'm' : 'f';
        const malas = [];
        if (ADJ[fr.adjId].m !== ADJ[fr.adjId].f) malas.push(`${mayus1(fr.articulo)} ${fr.S.s} ${ADJ[fr.adjId][otroG]} ${fr.V}.`);
        malas.push(`${mayus1(art(otroG))} ${fr.S.s} ${fr.A} ${fr.V}.`);
        if (malas.length < 2) malas.push(`${mayus1(art(otroG))} ${fr.S.s} ${ADJ[fr.adjId][otroG]} ${fr.V}.`);
        return {
          consigna: '¿Cuál frase está bien escrita?', interaccion: 'elegir',
          opciones: [op('c', bien), ...[...new Set(malas)].filter((m) => m !== bien).slice(0, 2).map((m, i) => op('d' + i, m))], respuesta: 'c',
          pista: `¿Se dice «el ${fr.S.s}» o «la ${fr.S.s}»? El adjetivo tiene que acompañar.`,
          firma: { clave: 'conc:' + fr.S.id + fr.adjId, rasgos: ['sust:' + fr.S.id, 'adj:' + fr.adjId], numeros: [] },
        };
      },
    },
  ];

  // ---------------- FRASES (16) ----------------

  const FRASES = [
    {
      id: 'ordenar-frase', familia: 'frases', interaccion: 'ordenar', niveles: [1, 2, 3],
      generar(ctx) {
        const { azar, nivel } = ctx;
        const fr = armarFrase(azar, nivel, ctx.evitarIds);
        const piezas = [op('a', fr.articulo), op('s', fr.S.s)];
        if (nivel >= 2) piezas.push(op('j', fr.A));
        piezas.push(op('v', fr.V));
        if (fr.C) piezas.push(op('c', fr.C));
        const canon = piezas.map((p) => p.id);
        const validos = [canon];
        if (fr.C) validos.push(['c', ...canon.slice(0, -1)]); // «En el parque el perro grande corre.»
        let fichas = azar.mezclar(piezas);
        const yaOrdenada = () => validos.some((o) => o.join() === fichas.map((f) => f.id).join());
        for (let i = 0; i < 10 && yaOrdenada(); i++) fichas = azar.mezclar(piezas);
        if (yaOrdenada()) fichas = [fichas[1], fichas[0], ...fichas.slice(2)];
        return {
          consigna: azar.elegir(['Ordená las palabras para armar la frase.', 'Armá la frase con las palabras.']),
          interaccion: 'ordenar', fichas, ordenesValidos: validos, frase: true,
          pista: `Empezá por «${fr.articulo}».`,
          firma: { clave: 'ordfr:' + fr.S.id + fr.adjId + fr.V + (fr.C || ''), rasgos: ['sust:' + fr.S.id, 'adj:' + fr.adjId], numeros: [] },
        };
      },
    },
    {
      id: 'elegir-verbo', familia: 'frases', interaccion: 'completar', niveles: [1, 2, 3],
      generar(ctx) {
        const { azar, nivel } = ctx;
        const fr = armarFrase(azar, nivel, ctx.evitarIds);
        // Solo verbos que seguro NO van con este sustantivo (nunca «el niño duerme» como error).
        const ds = azar.tomar(fr.S.no, 2);
        return {
          consigna: '¿Qué palabra completa la frase?', interaccion: 'completar', entrada: 'opciones',
          visual: [{ tipo: 'hueco', partes: [`${mayus1(fr.articulo)} ${fr.S.s}${nivel >= 2 ? ' ' + fr.A : ''}`, '.'], emoji: fr.S.emoji }],
          opciones: [op('c', fr.V), ...ds.map((d, i) => op('d' + i, d))], respuesta: 'c',
          pista: `¿Qué puede hacer ${fr.articulo} ${fr.S.s}?`,
          firma: { clave: 'verbo:' + fr.S.id + fr.V, rasgos: ['sust:' + fr.S.id], numeros: [] },
        };
      },
    },
  ];

  // ---------------- ¿ ? / ¡ ! (14) ----------------

  function frasesSignos(azar) {
    const Q = azar.elegir(PREGUNTAS); const E = azar.elegir(EXCLAMACIONES);
    const q = Q.gen(azar), e = E.gen(azar);
    return { Q, E, q, e, pregunta: `¿${q.f}?`, exclamacion: `¡${e.f}!` };
  }

  const SIGNOS = [
    {
      id: 'poner-signos', familia: 'signos', interaccion: 'completar', niveles: [1, 2, 3],
      generar(ctx) {
        const { azar } = ctx;
        const esPreg = azar.moneda();
        const lista = esPreg ? PREGUNTAS.filter((p) => !p.ambigua) : EXCLAMACIONES;
        const B = azar.elegir(lista); const x = B.gen(azar);
        const P = guiaAl(azar);
        return {
          consigna: '¿Qué signos van?', interaccion: 'completar', entrada: 'opciones',
          visual: [{ tipo: 'hueco', partes: ['', x.f, ''], personaje: P.emoji, contexto: `${P.nombre} ${x.sit}.` }],
          opciones: [op(esPreg ? 'c' : 'd0', '¿ ?'), op(esPreg ? 'd0' : 'c', '¡ !')], respuesta: 'c',
          pista: esPreg ? `${P.nombre} quiere saber algo: está preguntando.` : `${P.nombre} siente algo fuerte: está exclamando.`,
          firma: { clave: 'signo:' + B.id + x.k, rasgos: ['frase:' + B.id, 'pj:' + P.id], numeros: [] },
        };
      },
    },
    {
      id: 'cual-es', familia: 'signos', interaccion: 'elegir', niveles: [1, 2, 3],
      generar(ctx) {
        const { azar } = ctx;
        const buscaPreg = azar.moneda();
        const Qs = azar.tomar(PREGUNTAS, buscaPreg ? 1 : 2).map((q) => `¿${q.gen(azar).f}?`);
        const Es = azar.tomar(EXCLAMACIONES, buscaPreg ? 2 : 1).map((e) => `¡${e.gen(azar).f}!`);
        const correcta = buscaPreg ? Qs[0] : Es[0];
        const resto = buscaPreg ? Es : Qs;
        return {
          consigna: buscaPreg ? '¿Cuál es una pregunta?' : '¿Cuál es una exclamación?', interaccion: 'elegir',
          opciones: [op('c', correcta), ...resto.map((r, i) => op('d' + i, r))], respuesta: 'c',
          pista: buscaPreg ? 'Las preguntas van entre ¿ y ?' : 'Las exclamaciones van entre ¡ y !',
          firma: { clave: 'cual:' + correcta, rasgos: ['busca:' + buscaPreg], numeros: [] },
        };
      },
    },
    {
      id: 'situacion', familia: 'signos', interaccion: 'elegir', niveles: [1, 2, 3],
      generar(ctx) {
        const { azar } = ctx;
        const s = frasesSignos(azar);
        const P = guiaAl(azar);
        const usaPreg = azar.moneda();
        const correcta = usaPreg ? s.pregunta : s.exclamacion;
        // Un distractor con el otro signo y otro con el mismo signo pero otro
        // sentido: hay que entender la situación, no solo mirar los signos.
        // «¡Qué alegría!» nunca es distractor porque encaja en muchas situaciones.
        const otraQ = `¿${azar.elegir(PREGUNTAS.filter((p) => p !== s.Q)).gen(azar).f}?`;
        const otraE = `¡${azar.elegir(EXCLAMACIONES.filter((e) => e !== s.E && e.id !== 'sorpresa')).gen(azar).f}!`;
        const ds = usaPreg ? [s.exclamacion, otraQ] : [s.pregunta, otraE];
        return {
          consigna: `${P.nombre} ${usaPreg ? s.q.sit : s.e.sit}. ¿Qué dice?`, interaccion: 'elegir',
          visual: [{ tipo: 'personaje', emoji: P.emoji }],
          opciones: [op('c', correcta), ...ds.map((d, i) => op('d' + i, d))], respuesta: 'c',
          pista: usaPreg ? 'Quiere saber algo: busca una pregunta.' : 'Siente algo muy fuerte: busca una exclamación.',
          firma: { clave: 'sit:' + correcta, rasgos: ['pj:' + P.id, 'frase:' + (usaPreg ? s.Q.id : s.E.id)], numeros: [] },
        };
      },
    },
    {
      id: 'bien-escrita', familia: 'signos', interaccion: 'elegir', niveles: [2, 3],
      generar(ctx) {
        const { azar } = ctx;
        const esPreg = azar.moneda();
        const x = esPreg ? azar.elegir(PREGUNTAS).gen(azar) : azar.elegir(EXCLAMACIONES).gen(azar);
        const [a, c] = esPreg ? ['¿', '?'] : ['¡', '!'];
        const [a2, c2] = esPreg ? ['¡', '!'] : ['¿', '?'];
        return {
          consigna: '¿Cuál está bien escrita?', interaccion: 'elegir',
          opciones: [op('c', `${a}${x.f}${c}`), op('d0', `${x.f}${c}`), op('d1', `${a}${x.f}${c2}`)].concat(azar.moneda(0.3) ? [op('d2', `${a2}${x.f}${c}`)] : []),
          respuesta: 'c',
          pista: 'En castellano, los signos van al principio y al final, y tienen que ser del mismo tipo.',
          firma: { clave: 'bien:' + x.f, rasgos: [], numeros: [] },
        };
      },
    },
    {
      id: 'clasificar-signos', familia: 'signos', interaccion: 'arrastrar', niveles: [1, 2, 3],
      generar(ctx) {
        const { azar, nivel } = ctx;
        const k = nivel === 1 ? 2 : 3;
        const qs = azar.tomar(PREGUNTAS, k).map((q, i) => op('q' + i, `¿${q.gen(azar).f}?`, { grupo: 'preg' }));
        const es = azar.tomar(EXCLAMACIONES, k).map((e, i) => op('e' + i, `¡${e.gen(azar).f}!`, { grupo: 'excl' }));
        const tarjetas = azar.mezclar([...qs, ...es]);
        return {
          consigna: 'Arrastrá cada frase a su lugar.', interaccion: 'arrastrar', tarjetas,
          grupos: [op('preg', 'Preguntas ¿?'), op('excl', 'Exclamaciones ¡!')],
          respuesta: Object.fromEntries(tarjetas.map((t) => [t.id, t.grupo])),
          pista: 'Mirá los signos del principio: ¿ o ¡.',
          firma: { clave: 'clsig:' + tarjetas.map((t) => t.texto).sort().join('|'), rasgos: [], numeros: [] },
        };
      },
    },
  ];

  // ---------------- CE / CI / QUE / QUI (15) ----------------

  function palabraCQ(ctx, filtro = () => true) {
    const { azar } = ctx;
    const recientes = new Set((ctx.recientes || []).filter((r) => r.tema === 'cece').flatMap((r) => r.rasgos || []));
    let lista = PALABRAS_CQ.filter(filtro);
    if (ctx.params?.grupo) { const f = lista.filter((w) => w.g === ctx.params.grupo); if (f.length) lista = f; }
    const frescas = lista.filter((w) => !recientes.has('pal:' + w.p));
    return azar.elegir(frescas.length ? frescas : lista);
  }

  const CECI = [
    {
      id: 'completar-dibujo', familia: 'cq', interaccion: 'completar', niveles: [1, 2, 3],
      generar(ctx) {
        const { azar } = ctx;
        const w = palabraCQ(ctx, (x) => x.img && !x.sinHueco);
        const h = conHueco(w);
        return {
          consigna: azar.elegir(['Completá el nombre del dibujo.', '¿Qué letras faltan?']), interaccion: 'completar', entrada: 'opciones',
          visual: [{ tipo: 'palabra', emoji: w.img, antes: h.antes, despues: h.despues }],
          opciones: GRUPOS_CQ.map((g) => op(g === w.g ? 'c' : 'd' + g, g)), respuesta: 'c',
          params: { grupo: w.g }, audio: w.p,
          pista: w.g.startsWith('QU') ? 'Suena fuerte, como en «casa»: se escribe con QU.' : 'Suena suave, como una S: se escribe con C.',
          firma: { clave: 'cq:' + w.p, rasgos: ['pal:' + w.p, 'grupo:' + w.g], numeros: [] },
        };
      },
    },
    {
      id: 'escuchar-grupo', familia: 'cq', interaccion: 'escuchar', niveles: [1, 2, 3],
      generar(ctx) {
        const w = palabraCQ(ctx, (x) => !x.sinHueco);
        const h = conHueco(w);
        return {
          consigna: 'Escuchá la palabra. ¿Qué letras faltan?', interaccion: 'escuchar', audio: w.p,
          visual: [{ tipo: 'palabra', antes: h.antes, despues: h.despues }],
          opciones: GRUPOS_CQ.map((g) => op(g === w.g ? 'c' : 'd' + g, g)), respuesta: 'c',
          params: { grupo: w.g },
          pista: w.g.startsWith('QU') ? 'Suena como K: se escribe con QU.' : 'Suena como S: se escribe con C.',
          firma: { clave: 'cq:' + w.p, rasgos: ['pal:' + w.p, 'grupo:' + w.g], numeros: [] },
        };
      },
    },
    {
      id: 'bien-escrita', familia: 'cq', interaccion: 'elegir', niveles: [1, 2, 3],
      generar(ctx) {
        const { azar } = ctx;
        const w = palabraCQ(ctx, (x) => malEscritas(x).length >= 2);
        const ds = azar.tomar(malEscritas(w), 2);
        return {
          consigna: '¿Cuál palabra está bien escrita?', interaccion: 'elegir',
          visual: w.img ? [{ tipo: 'emoji-grande', emoji: w.img }] : [],
          opciones: [op('c', w.p), ...ds.map((d, i) => op('d' + i, d))], respuesta: 'c',
          params: { grupo: w.g }, audio: w.p,
          pista: 'Con E o I: «ce», «ci» suenan suave; «que», «qui» suenan fuerte.',
          firma: { clave: 'cq-bien:' + w.p, rasgos: ['pal:' + w.p, 'grupo:' + w.g], numeros: [] },
        };
      },
    },
    {
      id: 'clasificar-cq', familia: 'cq', interaccion: 'arrastrar', niveles: [1, 2, 3],
      generar(ctx) {
        const { azar, nivel } = ctx;
        const grupos = nivel === 1 ? azar.elegir([['CE', 'QUE'], ['CI', 'QUI'], ['CE', 'CI'], ['QUE', 'QUI']]) : GRUPOS_CQ.slice();
        const porGrupo = nivel === 1 ? 2 : nivel === 2 ? 1 : 2;
        const tarjetas = azar.mezclar(grupos.flatMap((g) => azar.tomar(PALABRAS_CQ.filter((w) => w.g === g && !w.mixta), porGrupo)))
          .map((w) => op('w' + w.p, w.p, { grupo: w.g, emoji: w.img }));
        return {
          consigna: 'Arrastrá cada palabra al cartel que corresponde.', interaccion: 'arrastrar', tarjetas,
          grupos: grupos.map((g) => op(g, g)),
          respuesta: Object.fromEntries(tarjetas.map((t) => [t.id, t.grupo])),
          pista: 'Buscá dentro de cada palabra: ¿dice ce, ci, que o qui?',
          firma: { clave: 'clcq:' + tarjetas.map((t) => t.texto).sort().join(','), rasgos: tarjetas.map((t) => 'pal:' + t.texto), numeros: [] },
        };
      },
    },
    {
      id: 'asociar-dibujo', familia: 'cq', interaccion: 'asociar', niveles: [1, 2, 3],
      generar(ctx) {
        const { azar } = ctx;
        const ws = azar.tomar(PALABRAS_CQ.filter((w) => w.img), 3);
        return {
          consigna: 'Uní cada dibujo con su palabra.', interaccion: 'asociar',
          izquierda: azar.mezclar(ws).map((w) => op('i' + w.p, w.img, { soloEmoji: true })),
          derecha: azar.mezclar(ws).map((w) => op('d' + w.p, w.p)),
          pares: Object.fromEntries(ws.map((w) => ['i' + w.p, 'd' + w.p])),
          pista: 'Decí en voz alta el nombre del dibujo.',
          firma: { clave: 'ascq:' + ws.map((w) => w.p).sort().join(','), rasgos: ws.map((w) => 'pal:' + w.p), numeros: [] },
        };
      },
    },
    {
      id: 'tocar-grupo', familia: 'cq', interaccion: 'tocar', niveles: [1, 2, 3],
      generar(ctx) {
        const { azar } = ctx;
        const g = ctx.params?.grupo || azar.elegir(GRUPOS_CQ);
        const si = azar.tomar(PALABRAS_CQ.filter((w) => w.g === g && !w.mixta), azar.entero(2, 3));
        const no = azar.tomar(PALABRAS_CQ.filter((w) => !gruposEn(w.p).includes(g)), 6 - si.length);
        return {
          consigna: `Tocá todas las palabras que tienen ${g}.`, interaccion: 'tocar', disposicion: 'grilla',
          opciones: [...si.map((w) => op('c' + w.p, w.p)), ...no.map((w) => op('d' + w.p, w.p))],
          respuesta: si.map((w) => 'c' + w.p), params: { grupo: g },
          pista: `Leé despacio cada palabra y buscá «${g.toLowerCase()}».`,
          firma: { clave: 'tcq:' + g + si.map((w) => w.p).sort().join(','), rasgos: ['grupo:' + g], numeros: [] },
        };
      },
    },
  ];

  // ================================================================
  // Registro de temas
  // ================================================================

  const TEMAS = {
    numeracion: { nombre: 'Numeración', emoji: '🔢', modalidades: NUMERACION },
    lectura: { nombre: 'Leer números', emoji: '🔤', modalidades: LECTURA },
    suma: { nombre: 'Sumas', emoji: '➕', modalidades: cuenta('+') },
    resta: { nombre: 'Restas', emoji: '➖', modalidades: cuenta('-') },
    tabla2: { nombre: 'Tabla del 2', emoji: '✖️', modalidades: TABLA2 },
    comprension: { nombre: 'Cuentos', emoji: '📖', modalidades: COMPRENSION },
    sustadj: { nombre: 'Sustantivos y adjetivos', emoji: '🏷️', modalidades: SUSTADJ },
    frases: { nombre: 'Frases', emoji: '🧩', modalidades: FRASES },
    signos: { nombre: '¿? y ¡!', emoji: '❓', modalidades: SIGNOS },
    cece: { nombre: 'CE CI QUE QUI', emoji: '🧀', modalidades: CECI },
  };

  const MISIONES = {
    numeros: { titulo: 'Misión Números', emoji: '🔢', temas: ['numeracion', 'lectura'], guia: 'rami' },
    calculos: { titulo: 'Misión Sumas y Restas', emoji: '🧮', temas: ['suma', 'resta'], guia: 'chispa' },
    tabla: { titulo: 'Misión Tabla del 2', emoji: '🤖', temas: ['tabla2'], guia: 'robot2x' },
    cuentos: { titulo: 'Misión Cuentos', emoji: '📖', temas: ['comprension'], guia: 'chispa' },
    palabras: { titulo: 'Misión Palabras', emoji: '🔤', temas: ['sustadj', 'frases', 'signos', 'cece'], guia: 'rami' },
    sorpresa: { titulo: 'Misión Sorpresa', emoji: '🎁', temas: Object.keys(TEMAS), guia: 'robot2x' },
  };

  // 22. Cada misión combina distintos tipos de interacción.
  const SECUENCIA_INTERACCION = ['tocar', 'elegir', 'ordenar', 'completar', 'asociar', 'arrastrar', 'escuchar', 'completar'];
  const LARGO_MISION = 8;

  // ================================================================
  // 23. Control de repeticiones
  // ================================================================

  const MEMORIA = 30;
  const mismoConjunto = (a = [], b = []) => a.length === b.length && a.length > 0 && a.slice().sort().join('|') === b.slice().sort().join('|');
  const interseca = (a = [], b = []) => a.some((x) => b.includes(x));
  const comunes = (a = [], b = []) => a.filter((x) => b.includes(x)).length;

  /**
   * Cuánto se parece una actividad nueva a las recientes (0 = nada).
   * Compara tipo, números, texto, respuesta, opciones, estructura y rasgos
   * (personaje, objeto, lugar, palabra…).
   */
  function similitud(nueva, recientes, { repaso = false, continuacion = false } = {}) {
    let p = 0;
    recientes.forEach((r, i) => {
      const mismoTema = r.tema === nueva.tema;
      if (r.texto && r.texto === nueva.texto) p += 10;
      if (!repaso && nueva.clave && mismoTema && r.clave === nueva.clave) p += 8;
      if (!repaso && mismoTema && nueva.numeros.length && r.tipo === nueva.tipo && mismoConjunto(r.numeros.map(String), nueva.numeros.map(String))) p += 6;
      if (nueva.opciones.length > 1 && mismoConjunto(r.opciones, nueva.opciones)) p += 5;
      if (i === 0 && r.estructura === nueva.estructura) p += 4;
      if (!repaso && i < 3 && mismoTema && r.tipo === nueva.tipo && r.respuesta === nueva.respuesta) p += 3;
      if (!repaso && i < 5 && mismoTema && interseca(r.numeros, nueva.numeros)) p += 2;
      if (!continuacion && i < 6 && mismoTema && comunes(r.rasgos, nueva.rasgos) >= 2) p += 2;
    });
    return p;
  }

  function isTooSimilar(newQuestion, recentQuestions, opciones) {
    const f = newQuestion.firma || newQuestion;
    return similitud(f, (recentQuestions || []).map((r) => r.firma || r), opciones) > 0;
  }

  // ================================================================
  // Comprobación de respuestas
  // ================================================================

  function comprobar(act, resp) {
    switch (act.interaccion) {
      case 'elegir': case 'escuchar':
        return resp === act.respuesta;
      case 'completar':
        return act.entrada === 'numero' ? Number(resp) === act.respuesta : resp === act.respuesta;
      case 'tocar': {
        const esperado = [].concat(act.respuesta);
        return mismoConjunto([].concat(resp), esperado);
      }
      case 'ordenar':
        return act.ordenesValidos.some((o) => o.join('|') === [].concat(resp).join('|'));
      case 'asociar':
        return Object.keys(act.pares).every((k) => resp && resp[k] === act.pares[k]) && Object.keys(resp || {}).length === Object.keys(act.pares).length;
      case 'arrastrar':
        return Object.keys(act.respuesta).every((k) => resp && resp[k] === act.respuesta[k]);
      default: return false;
    }
  }

  /** Texto de la respuesta correcta (para mostrarla y para la firma). */
  function textoRespuesta(act) {
    switch (act.interaccion) {
      case 'elegir': case 'escuchar': return act.opciones.find((o) => o.id === act.respuesta).texto;
      case 'completar': return act.entrada === 'numero' ? String(act.respuesta) : act.opciones.find((o) => o.id === act.respuesta).texto;
      case 'tocar': return [].concat(act.respuesta).map((id) => act.opciones.find((o) => o.id === id).texto).join(', ');
      case 'ordenar': return act.ordenesValidos[0].map((id) => act.fichas.find((f) => f.id === id).texto).join(' → ');
      case 'asociar': return Object.entries(act.pares).map(([i, d]) => `${act.izquierda.find((x) => x.id === i).texto} = ${act.derecha.find((x) => x.id === d).texto}`).join(' · ');
      case 'arrastrar': return act.grupos.map((g) => `${g.texto}: ${act.tarjetas.filter((t) => act.respuesta[t.id] === g.id).map((t) => t.texto).join(', ')}`).join(' · ');
      default: return '';
    }
  }

  // ================================================================
  // 24. Historial en localStorage
  // ================================================================

  const PREFIJO = 'aventura2.';
  const CLAVES = ['recentActivities', 'correctAnswers', 'wrongAnswers', 'usedHints', 'topicsPracticed', 'difficultyLevel', 'motorInterno'];

  function almacenNavegador() {
    const memoria = {};
    let ls = null;
    try { ls = typeof localStorage !== 'undefined' ? localStorage : null; if (ls) { ls.setItem(PREFIJO + 't', '1'); ls.removeItem(PREFIJO + 't'); } } catch (e) { ls = null; }
    return {
      leer(k) { try { const v = ls ? ls.getItem(PREFIJO + k) : memoria[k]; return v ? JSON.parse(v) : null; } catch (e) { return null; } },
      escribir(k, v) { const s = JSON.stringify(v); try { if (ls) ls.setItem(PREFIJO + k, s); else memoria[k] = s; } catch (e) { memoria[k] = s; } },
      borrar(k) { try { if (ls) ls.removeItem(PREFIJO + k); } catch (e) { /* nada */ } delete memoria[k]; },
    };
  }

  function almacenMemoria() {
    const m = {};
    return { leer: (k) => (k in m ? JSON.parse(m[k]) : null), escribir: (k, v) => { m[k] = JSON.stringify(v); }, borrar: (k) => { delete m[k]; } };
  }

  // ================================================================
  // El motor
  // ================================================================

  function crearMotor(opciones = {}) {
    const almacen = opciones.almacen || almacenNavegador();
    const semilla = opciones.semilla != null ? opciones.semilla >>> 0 : nuevaSemilla();
    const azar = crearAzar(semilla);

    const est = {
      recentActivities: almacen.leer('recentActivities') || [],
      correctAnswers: almacen.leer('correctAnswers') || {},
      wrongAnswers: almacen.leer('wrongAnswers') || {},
      usedHints: almacen.leer('usedHints') || {},
      topicsPracticed: almacen.leer('topicsPracticed') || {},
      difficultyLevel: almacen.leer('difficultyLevel') || {},
      motorInterno: Object.assign({ rachas: {}, posiciones: [], ordenTabla: [], sesiones: 0, semillas: [], repasoPendiente: [] }, almacen.leer('motorInterno') || {}),
    };
    est.motorInterno.sesiones++;
    est.motorInterno.semillas = [semilla, ...est.motorInterno.semillas].slice(0, 10);
    guardar();

    function guardar() { CLAVES.forEach((k) => almacen.escribir(k, est[k])); }

    const nivelDe = (tema) => est.difficultyLevel[tema] || 1;

    function modalidadesPara(tema, nivel) {
      return TEMAS[tema].modalidades.filter((m) => m.niveles.includes(nivel));
    }
    const interaccionesDe = (m) => [].concat(m.interaccion);

    /** 21. Arma el contexto y genera una variante válida y no repetida. */
    function generarActividad(tema, opc = {}) {
      if (!TEMAS[tema]) throw new Error('Tema desconocido: ' + tema);
      const nivel = opc.nivel || nivelDe(tema);
      const recientes = est.recentActivities;
      const numerosRecientes = recientes.filter((r) => r.tema === tema).slice(0, 12).flatMap((r) => r.numeros || []);
      let mods = modalidadesPara(tema, nivel);
      if (opc.modalidad) { const f = mods.filter((m) => m.id === opc.modalidad); mods = f.length ? f : TEMAS[tema].modalidades.filter((m) => m.id === opc.modalidad); }
      if (opc.familia) { const f = mods.filter((m) => m.familia === opc.familia); if (f.length) mods = f; }
      if (opc.excluirModalidad && mods.length > 1) { const f = mods.filter((m) => m.id !== opc.excluirModalidad); if (f.length) mods = f; }
      const conInteraccion = opc.interaccion ? mods.filter((m) => interaccionesDe(m).includes(opc.interaccion)) : [];

      let mejor = null, mejorP = Infinity;
      const INTENTOS = 40;
      for (let intento = 0; intento < INTENTOS; intento++) {
        const usarPref = conInteraccion.length && intento < INTENTOS * 0.6;
        const pool = usarPref ? conInteraccion : mods;
        const mod = azar.elegir(pool);
        const inter = usarPref && interaccionesDe(mod).includes(opc.interaccion) && interaccionesDe(mod).length > 1 ? opc.interaccion : null;
        const ctx = {
          azar, nivel, tema, mision: opc.mision, params: opc.params, repaso: !!opc.repaso,
          interaccion: inter, recientes, numerosRecientes, continuar: opc.continuar,
          evitarIds: recientes.filter((r) => r.tema === tema).slice(0, 4).flatMap((r) => r.rasgos || []).filter((x) => x.startsWith('sust:')).map((x) => x.slice(5)),
        };
        // La comprensión anota qué preguntas se hicieron; se deshace si se descarta.
        const antes = opc.mision ? { cuento: opc.mision.cuento, preg: (opc.mision.preguntasCuento || []).slice(), tabla: (opc.mision.tablaUsados || []).slice() } : null;
        const act = finalizar(mod.generar(ctx), { tema, mod, nivel });
        const p = similitud(act.firma, recientes, { repaso: !!opc.repaso, continuacion: !!opc.continuar });
        if (p === 0) { fijarPosicion(act); return act; }
        if (p < mejorP) { mejor = { act, estadoMision: opc.mision ? { cuento: opc.mision.cuento, preg: (opc.mision.preguntasCuento || []).slice(), tabla: (opc.mision.tablaUsados || []).slice() } : null }; mejorP = p; }
        if (antes) { opc.mision.cuento = antes.cuento; opc.mision.preguntasCuento = antes.preg; opc.mision.tablaUsados = antes.tabla; }
      }
      if (mejor.estadoMision) { opc.mision.cuento = mejor.estadoMision.cuento; opc.mision.preguntasCuento = mejor.estadoMision.preg; opc.mision.tablaUsados = mejor.estadoMision.tabla; }
      mejor.act.similitud = mejorP;
      fijarPosicion(mejor.act);
      return mejor.act;
    }

    let contador = 0;
    function finalizar(a, { tema, mod, nivel }) {
      a.id = `${tema}-${Date.now().toString(36)}-${(contador++).toString(36)}`;
      a.tema = tema; a.tipo = mod.id; a.familia = mod.familia; a.nivel = nivel;
      a.interaccion = a.interaccion || [].concat(mod.interaccion)[0];
      a.params = a.params || {};
      // 17. Mezclar opciones (la posición correcta se ajusta en fijarPosicion).
      if (a.opciones && !a.sinMezclar && a.disposicion !== 'frase') a.opciones = azar.mezclar(a.opciones);
      const f = a.firma || {};
      const textoVisual = (a.visual || []).map((v) => v.texto || (v.oraciones || []).join(' ') || (v.partes || []).join('_') || (v.items || []).join(',') || (v.a != null ? `${v.a}${v.oper}${v.b}` : '') || (v.antes != null ? v.antes + '_' + v.despues : '')).join(' ');
      a.respuestaTexto = textoRespuesta(a);
      a.firma = {
        tema, tipo: a.tipo, estructura: `${tema}|${a.tipo}|${a.interaccion}|${a.params.pregunta || ''}`,
        clave: f.clave || null, numeros: (f.numeros || []).map(Number), rasgos: f.rasgos || [],
        texto: normalizar(a.consigna + ' ' + textoVisual + ' ' + (a.audio || '')),
        respuesta: normalizar(a.respuestaTexto),
        opciones: (a.opciones || a.tarjetas || a.fichas || a.derecha || []).map((o) => normalizar(o.texto)),
      };
      return a;
    }

    /** 17. La respuesta correcta no cae siempre en el mismo lugar. */
    function fijarPosicion(a) {
      if (!['elegir', 'escuchar', 'completar'].includes(a.interaccion) || !a.opciones || a.sinMezclar) return;
      const n = a.opciones.length; if (n < 2) return;
      let pos = a.opciones.findIndex((o) => o.id === a.respuesta);
      const prev = est.motorInterno.posiciones;
      const repetida = n >= 3 ? prev[0] === pos : (prev[0] === pos && prev[1] === pos);
      if (repetida) {
        const libres = [...Array(n).keys()].filter((i) => i !== pos);
        const nueva = azar.elegir(libres);
        [a.opciones[pos], a.opciones[nueva]] = [a.opciones[nueva], a.opciones[pos]];
        pos = nueva;
      }
      a.posicionCorrecta = pos;
      est.motorInterno.posiciones = [pos, ...prev].slice(0, 6);
    }

    function recordar(act) {
      est.recentActivities = [act.firma, ...est.recentActivities].slice(0, MEMORIA);
      const tp = est.topicsPracticed[act.tema] || { veces: 0 };
      est.topicsPracticed[act.tema] = { veces: tp.veces + 1, ultimaVez: new Date().toISOString() };
      guardar();
    }

    // ---------- Misiones ----------

    /** 9. Orden de la tabla del 2 distinto en cada sesión. */
    function ordenTablaNuevo() {
      const previo = est.motorInterno.ordenTabla || [];
      let orden;
      for (let i = 0; i < 20; i++) {
        orden = azar.mezclar([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
        if (orden.slice(0, 3).join() !== previo.slice(0, 3).join() && orden[0] !== previo[0]) break;
      }
      est.motorInterno.ordenTabla = orden; guardar();
      return orden;
    }

    function nuevaMision(tipo) {
      const def = MISIONES[tipo];
      if (!def) throw new Error('Misión desconocida: ' + tipo);
      const offset = azar.entero(0, SECUENCIA_INTERACCION.length - 1);
      const plan = [];
      const usos = Object.fromEntries(def.temas.map((t) => [t, 0]));
      let temasSorpresa = tipo === 'sorpresa' ? azar.mezclar(def.temas) : null;
      for (let i = 0; i < LARGO_MISION; i++) {
        const inter = SECUENCIA_INTERACCION[(offset + i) % SECUENCIA_INTERACCION.length];
        let tema;
        if (tipo === 'cuentos') tema = 'comprension';
        else if (temasSorpresa) tema = temasSorpresa[i % temasSorpresa.length];
        else {
          const conInter = def.temas.filter((t) => modalidadesPara(t, nivelDe(t)).some((m) => interaccionesDe(m).includes(inter)));
          const pool = conInter.length ? conInter : def.temas;
          const minUso = Math.min(...pool.map((t) => usos[t]));
          tema = azar.elegir(pool.filter((t) => usos[t] === minUso));
        }
        usos[tema]++;
        plan.push({ tema, interaccion: inter, continuar: tipo === 'cuentos' && i % 4 !== 0 });
      }
      return {
        id: 'mision-' + Date.now().toString(36), tipo, titulo: def.titulo, emoji: def.emoji,
        guia: PERSONAJES.find((p) => p.id === def.guia), plan, indice: 0, total: plan.length,
        repasoPendiente: est.motorInterno.repasoPendiente.filter((r) => def.temas.includes(r.tema)).slice(0, 1),
        ordenTabla: ordenTablaNuevo(), tablaUsados: [], cuento: null, preguntasCuento: [], resultados: [],
      };
    }

    function siguienteActividad(m) {
      let act;
      if (m.repasoPendiente.length) {
        const r = m.repasoPendiente.shift();
        act = generarActividad(r.tema, {
          mision: m, repaso: true, params: r.params, familia: r.familia,
          modalidad: r.modalidad, excluirModalidad: r.excluir, continuar: r.continuar,
        });
        act.esRepaso = true;
        est.motorInterno.repasoPendiente = est.motorInterno.repasoPendiente.filter((x) => x.id !== r.id);
      } else {
        if (m.indice >= m.plan.length) return null;
        const paso = m.plan[m.indice++];
        act = generarActividad(paso.tema, { mision: m, interaccion: paso.interaccion, continuar: paso.continuar && !!m.cuento });
      }
      recordar(act);
      return act;
    }

    /**
     * Registra el resultado, ajusta la dificultad (20) y programa el repaso
     * del mismo concepto con otra representación (21).
     */
    function registrarResultado(m, act, { correcto, pistas = 0, intentos = 1 }) {
      const t = act.tema;
      if (correcto) est.correctAnswers[t] = (est.correctAnswers[t] || 0) + 1;
      else est.wrongAnswers[t] = (est.wrongAnswers[t] || 0) + 1;
      if (pistas) est.usedHints[t] = (est.usedHints[t] || 0) + pistas;

      const racha = est.motorInterno.rachas[t] || { bien: 0, dificultad: 0 };
      const nivelAntes = nivelDe(t);
      if (correcto && pistas === 0) { racha.bien++; racha.dificultad = 0; }
      else if (correcto && pistas === 1) { racha.bien = 0; }
      else { racha.bien = 0; racha.dificultad++; }
      if (racha.bien >= 3 && nivelAntes < 3) { est.difficultyLevel[t] = nivelAntes + 1; racha.bien = 0; }
      if (racha.dificultad >= 2 && nivelAntes > 1) { est.difficultyLevel[t] = nivelAntes - 1; racha.dificultad = 0; }
      est.motorInterno.rachas[t] = racha;

      if (!correcto && !act.esRepaso) {
        const pasos = repasoPara(act);
        if (m) m.repasoPendiente.push(...pasos);
        // Si la sesión se corta, el repaso queda para la próxima.
        est.motorInterno.repasoPendiente = [...pasos.slice(0, 1), ...est.motorInterno.repasoPendiente].slice(0, 5);
      }
      if (m) m.resultados.push({ tema: t, tipo: act.tipo, correcto, pistas, intentos, esRepaso: !!act.esRepaso });
      guardar();
      return { nivel: nivelDe(t), subio: nivelDe(t) > nivelAntes, bajo: nivelDe(t) < nivelAntes };
    }

    function repasoPara(act) {
      const id = () => Math.random().toString(36).slice(2, 9);
      if (act.tema === 'tabla2' && act.params.n) {
        // Mismo concepto desde tres representaciones: grupos → suma repetida → operación.
        const n = act.params.n;
        const cadena = act.tipo === 'operacion'
          ? ['contar-grupos', 'suma-repetida', 'operacion']
          : ['contar-grupos', 'dos-filas', 'suma-repetida'].filter((x) => x !== act.tipo).slice(0, 2);
        return cadena.map((mod) => ({ id: id(), tema: 'tabla2', modalidad: mod, params: { n } }));
      }
      if (act.tema === 'comprension') {
        return [{ id: id(), tema: 'comprension', params: { evitarPregunta: act.params.pregunta }, continuar: true }];
      }
      return [{ id: id(), tema: act.tema, familia: act.familia, excluir: act.tipo, params: act.params }];
    }

    function reiniciar() {
      CLAVES.forEach((k) => almacen.borrar(k));
      est.recentActivities = []; est.correctAnswers = {}; est.wrongAnswers = {}; est.usedHints = {};
      est.topicsPracticed = {}; est.difficultyLevel = {};
      est.motorInterno = { rachas: {}, posiciones: [], ordenTabla: [], sesiones: 1, semillas: [semilla], repasoPendiente: [] };
      guardar();
    }

    return {
      semilla, azar, estado: est,
      generarActividad, nuevaMision, siguienteActividad, registrarResultado, comprobar, textoRespuesta,
      isTooSimilar: (a, rec, o) => isTooSimilar(a, rec || est.recentActivities, o),
      nivelDe, fijarNivel(t, n) { est.difficultyLevel[t] = Math.max(1, Math.min(3, n)); guardar(); },
      recordar, reiniciar,
      generateNumber: (min, max) => generateNumber(azar, min, max),
      generateDifferentNumber: (min, max, ex) => generateDifferentNumber(azar, min, max, ex),
      generateNumberWithConstraints: (o) => generateNumberWithConstraints(azar, o),
    };
  }

  return {
    crearMotor, crearAzar, almacenMemoria, almacenNavegador,
    numeroEnLetras, permutacionesDigitos, distractoresNumericos, malEscritas,
    generateNumber, generateDifferentNumber, generateNumberWithConstraints,
    isTooSimilar, similitud, comprobar, textoRespuesta,
    TEMAS, MISIONES, PERSONAJES, GUIAS, OBJETOS, PALABRAS_CQ, SUSTANTIVOS, ADJ, LUGARES, HALLAZGOS, RANGOS,
    SECUENCIA_INTERACCION,
  };
});
