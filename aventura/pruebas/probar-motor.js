/*
 * Pruebas del motor de actividades.
 * Uso:  node aventura/pruebas/probar-motor.js
 *
 * Genera miles de actividades de todos los temas, niveles y modalidades y
 * comprueba que el contenido sea correcto (cuentas, palabras, números en
 * letras), que la respuesta correcta exista y sea única, que no se repitan
 * actividades recientes y que la dificultad y el repaso funcionen.
 */
'use strict';
const assert = require('assert');
const M = require('../motor.js');

let fallos = 0, pruebas = 0;
const SEMILLA = Number(process.env.SEMILLA || 0);
function prueba(nombre, fn) {
  pruebas++;
  try { fn(); console.log('  ✓', nombre); } catch (e) { fallos++; console.log('  ✗', nombre, '\n     ', e.message); }
}
const motorNuevo = (semilla) => M.crearMotor({ almacen: M.almacenMemoria(), semilla: semilla + SEMILLA });

// ------------------------------------------------------------------
console.log('\nNúmeros en letras');
prueba('casos conocidos', () => {
  const casos = {
    1: 'uno', 9: 'nueve', 10: 'diez', 15: 'quince', 16: 'dieciséis', 20: 'veinte', 21: 'veintiuno', 22: 'veintidós',
    23: 'veintitrés', 26: 'veintiséis', 30: 'treinta', 31: 'treinta y uno', 47: 'cuarenta y siete', 99: 'noventa y nueve',
    100: 'cien', 101: 'ciento uno', 115: 'ciento quince', 199: 'ciento noventa y nueve', 200: 'doscientos',
    347: 'trescientos cuarenta y siete', 500: 'quinientos', 527: 'quinientos veintisiete', 572: 'quinientos setenta y dos',
    700: 'setecientos', 719: 'setecientos diecinueve', 752: 'setecientos cincuenta y dos', 900: 'novecientos',
    999: 'novecientos noventa y nueve', 1000: 'mil',
  };
  for (const [n, t] of Object.entries(casos)) assert.strictEqual(M.numeroEnLetras(Number(n)), t, n);
});
prueba('todos los números del 1 al 1000 tienen escritura única', () => {
  const vistos = new Set();
  for (let n = 1; n <= 1000; n++) {
    const t = M.numeroEnLetras(n);
    assert(!vistos.has(t), 'repetido ' + t); vistos.add(t);
    assert(!/undefined|  /.test(t), n + ': ' + t);
  }
});

// ------------------------------------------------------------------
console.log('\nGenerador de números');
prueba('respeta rangos y exclusiones', () => {
  const az = M.crearAzar(7);
  for (let i = 0; i < 2000; i++) {
    const n = M.generateNumber(az, 100, 500); assert(n >= 100 && n <= 500);
    const d = M.generateDifferentNumber(az, 1, 5, [1, 2, 3, 4]); assert.strictEqual(d, 5);
    const c = M.generateNumberWithConstraints(az, { min: 500, max: 1000, condicion: (x) => x % 10 === 9 }); assert(c % 10 === 9 && c >= 500);
  }
});
prueba('distractores plausibles (572 → 527, 752…)', () => {
  const az = M.crearAzar(3);
  const d = M.distractoresNumericos(az, 572, { min: 1, max: 1000, cantidad: 2, preferir: 'digitos' });
  assert(d.every((x) => M.permutacionesDigitos(572).includes(x)), d.join());
});

// ------------------------------------------------------------------
console.log('\nContenido de cada actividad generada');

const PROHIBIDO = /undefined|NaN|\bnull\b|\[object|\{Pr\}/;
const palabrasBanco = new Set(M.PALABRAS_CQ.map((w) => w.p));

function textos(a) {
  const t = [a.consigna, a.decir, a.audio, a.pista];
  // En los dibujos, null es el hueco a completar: solo se revisan los textos.
  (a.visual || []).forEach((v) => t.push(JSON.stringify(v).replace(/(\[|,)null(?=,|\])/g, '$1_')));
  ['opciones', 'fichas', 'tarjetas', 'izquierda', 'derecha', 'grupos'].forEach((k) => (a[k] || []).forEach((o) => t.push(o.texto)));
  return t.filter(Boolean);
}

function respuestaCorrecta(a) {
  switch (a.interaccion) {
    case 'elegir': case 'escuchar': return a.respuesta;
    case 'completar': return a.respuesta;
    case 'tocar': return a.respuesta;
    case 'ordenar': return a.ordenesValidos[0];
    case 'asociar': return a.pares;
    case 'arrastrar': return a.respuesta;
  }
}
function respuestaIncorrecta(a) {
  switch (a.interaccion) {
    case 'elegir': case 'escuchar': return a.opciones.find((o) => o.id !== a.respuesta).id;
    case 'completar': return a.entrada === 'numero' ? a.respuesta + 1 : a.opciones.find((o) => o.id !== a.respuesta).id;
    case 'tocar': return a.opciones.find((o) => ![].concat(a.respuesta).includes(o.id)).id;
    case 'ordenar': return a.ordenesValidos[0].slice().reverse();
    case 'asociar': { const k = Object.keys(a.pares); const v = k.map((x) => a.pares[x]); return Object.fromEntries(k.map((x, i) => [x, v[(i + 1) % v.length]])); }
    case 'arrastrar': { const k = Object.keys(a.respuesta); return Object.fromEntries(k.map((x) => [x, a.grupos.find((g) => g.id !== a.respuesta[x]).id])); }
  }
}

function valorCorrecto(a) {
  if (a.interaccion === 'completar' && a.entrada === 'numero') return Number(a.respuesta);
  if (a.opciones && typeof a.respuesta === 'string') return a.opciones.find((o) => o.id === a.respuesta).texto;
  return null;
}

function validar(a) {
  for (const t of textos(a)) assert(!PROHIBIDO.test(t), `${a.tema}/${a.tipo}: texto roto «${t}»`);
  assert(a.consigna && a.consigna.length > 3, 'sin consigna');
  assert(M.comprobar(a, respuestaCorrecta(a)), `${a.tema}/${a.tipo}: la respuesta correcta no valida`);
  assert(!M.comprobar(a, respuestaIncorrecta(a)), `${a.tema}/${a.tipo}: una respuesta incorrecta valida`);

  if (a.opciones) {
    const ids = a.opciones.map((o) => o.id), tx = a.opciones.map((o) => o.texto);
    assert.strictEqual(new Set(ids).size, ids.length, 'ids repetidos');
    if (a.disposicion !== 'frase') assert.strictEqual(new Set(tx).size, tx.length, `${a.tema}/${a.tipo}: opciones repetidas ${tx.join(' | ')}`);
    [].concat(a.respuesta).forEach((r) => { if (typeof r === 'string') assert(ids.includes(r), 'respuesta fuera de opciones'); });
    assert(a.opciones.length >= 2, 'menos de 2 opciones');
  }
  if (a.fichas) {
    assert(a.ordenesValidos.every((o) => o.length === a.fichas.length));
    assert(!a.ordenesValidos.some((o) => o.join() === a.fichas.map((f) => f.id).join()), `${a.tema}/${a.tipo}: fichas ya ordenadas`);
    assert(a.ordenesValidos.every((o) => o.every((id) => a.fichas.some((f) => f.id === id))));
  }
  if (a.tarjetas) assert(a.tarjetas.every((t) => a.grupos.some((g) => g.id === a.respuesta[t.id])));

  // --- Matemática: la respuesta es exactamente la cuenta.
  const cuenta = (a.visual || []).find((v) => v.tipo === 'cuenta');
  const v = valorCorrecto(a);
  if (cuenta && v != null) {
    const r = cuenta.oper === '+' ? cuenta.a + cuenta.b : cuenta.oper === '-' ? cuenta.a - cuenta.b : cuenta.a * cuenta.b;
    assert.strictEqual(Number(v), r, `${cuenta.a} ${cuenta.oper} ${cuenta.b} ≠ ${v}`);
    assert(r >= 0, 'resultado negativo');
    if (cuenta.oper === '-') assert(cuenta.a >= cuenta.b, 'resta con a < b');
    assert(r <= 1000, 'resultado mayor que 1000');
  }
  if (a.tema === 'tabla2' && a.params.n && ['operacion', 'contar-grupos', 'dos-filas', 'suma-repetida', 'problema-pares', 'escuchar-tabla'].includes(a.tipo)) {
    assert.strictEqual(Number(v), 2 * a.params.n, `tabla del 2: ${a.tipo} n=${a.params.n} → ${v}`);
    assert(a.params.n >= 1 && a.params.n <= 10);
  }
  if (a.tema === 'tabla2' && a.tipo === 'falta-factor') assert.strictEqual(Number(v), a.params.n);
  if (a.tema === 'tabla2' && a.tipo === 'secuencia') {
    const it = a.visual[0].items; const i = it.indexOf(null);
    const lleno = it.map((x, k) => (k === i ? Number(v) : x));
    lleno.forEach((x, k) => { if (k) assert.strictEqual(x - lleno[k - 1], 2, 'secuencia de 2 en 2 rota: ' + lleno); });
  }
  const suma = (a.visual || []).find((x) => x.tipo === 'texto-grande' && /\+/.test(x.texto));
  if (suma && v != null) {
    const r = suma.texto.replace('= ?', '').split('+').reduce((s, x) => s + Number(x), 0);
    assert.strictEqual(Number(v), r, suma.texto);
  }

  // --- Numeración: la respuesta cumple la consigna.
  if (a.tema === 'numeracion') {
    const [min, max] = M.RANGOS[a.nivel];
    (a.firma.numeros || []).forEach((n) => assert(n >= min - 1 && n <= max, `${a.tipo}: ${n} fuera del nivel ${a.nivel}`));
    const sec = (a.visual || []).find((x) => x.tipo === 'secuencia');
    if (sec && v != null) {
      const it = sec.items; const i = it.indexOf(null);
      const lleno = it.map((x, k) => (k === i ? Number(v) : x));
      const paso = lleno[1] - lleno[0];
      lleno.forEach((x, k) => { if (k) assert.strictEqual(x - lleno[k - 1], paso, 'secuencia rota ' + lleno); });
      assert([1, 10].includes(paso), 'paso raro ' + paso);
    }
    if (a.tipo === 'mayor' || a.tipo === 'menor') {
      const nums = a.opciones.map((o) => Number(o.texto));
      assert.strictEqual(Number(v), a.tipo === 'mayor' ? Math.max(...nums) : Math.min(...nums));
    }
    if (a.tipo.startsWith('ordenar')) {
      const orden = a.ordenesValidos[0].map((id) => Number(a.fichas.find((f) => f.id === id).texto));
      orden.forEach((x, k) => { if (k) assert(a.tipo === 'ordenar-asc' ? x > orden[k - 1] : x < orden[k - 1], 'orden mal ' + orden); });
    }
    if (a.tipo === 'buscar') assert(a.consigna.includes(String(v)));
  }
  if (a.tema === 'lectura') {
    if (a.tipo === 'numero-a-palabras') assert.strictEqual(v, M.numeroEnLetras(a.visual[0].n));
    if (a.tipo === 'palabras-a-numero') assert.strictEqual(M.numeroEnLetras(Number(v)), a.visual[0].texto);
    if (a.tipo === 'escuchar-numero') assert.strictEqual(M.numeroEnLetras(Number(v)), a.audio);
    if (a.tipo === 'asociar-numeros') for (const [i, d] of Object.entries(a.pares)) {
      assert.strictEqual(M.numeroEnLetras(Number(a.izquierda.find((x) => x.id === i).texto)), a.derecha.find((x) => x.id === d).texto);
    }
  }
  if ((a.tema === 'suma' || a.tema === 'resta') && ['tocar-resultado', 'estimar'].includes(a.tipo)) {
    const calc = (t) => { const [x, y] = t.split(/ [+−] /).map(Number); assert(x >= 0 && y >= 0); return a.tema === 'suma' ? x + y : x - y; };
    if (a.tipo === 'tocar-resultado') {
      const r = Number(a.consigna.match(/dan (\d+)/)[1]);
      a.opciones.forEach((o) => assert.strictEqual([].concat(a.respuesta).includes(o.id), calc(o.texto) === r, o.texto));
    } else {
      const lim = Number(a.consigna.match(/que (\d+)/)[1]);
      assert.strictEqual(a.tarjetas.length, 4);
      a.tarjetas.forEach((t) => { assert(calc(t.texto) >= 0); assert.strictEqual(a.respuesta[t.id], calc(t.texto) > lim ? 'mas' : 'menos'); assert(calc(t.texto) !== lim); });
    }
  }
  if ((a.tema === 'suma' || a.tema === 'resta') && a.tipo === 'escuchar-problema') {
    const [x, y] = (a.pista.match(/(\d+) [+−] (\d+)/) || []).slice(1).map(Number);
    assert.strictEqual(Number(v), a.tema === 'suma' ? x + y : x - y);
  }
  if ((a.tema === 'suma' || a.tema === 'resta') && a.tipo === 'asociar-cuentas') {
    for (const [i, d] of Object.entries(a.pares)) {
      const [x, y] = a.izquierda.find((o) => o.id === i).texto.split(/ [+−] /).map(Number);
      assert.strictEqual(a.tema === 'suma' ? x + y : x - y, Number(a.derecha.find((o) => o.id === d).texto));
    }
  }
  if (a.tema === 'tabla2' && a.tipo === 'asociar-tabla') {
    for (const [i, d] of Object.entries(a.pares)) {
      const t = a.izquierda.find((o) => o.id === i).texto;
      const r = t.includes('×') ? 2 * Number(t.split('× ')[1]) : t.split(' + ').reduce((s, x) => s + Number(x), 0);
      assert.strictEqual(r, Number(a.derecha.find((o) => o.id === d).texto), t);
    }
  }
  if (a.tema === 'tabla2' && a.tipo === 'tocar-resultados') {
    a.opciones.forEach((o) => assert.strictEqual([].concat(a.respuesta).includes(o.id), Number(o.texto) % 2 === 0));
  }

  // --- CE/CI/QUE/QUI: solo palabras del banco y huecos que reconstruyen la palabra.
  if (a.tema === 'cece') {
    const pal = (a.visual || []).find((x) => x.tipo === 'palabra');
    if (pal) {
      const w = M.PALABRAS_CQ.find((x) => x.p.startsWith(pal.antes) && x.p.endsWith(pal.despues) && x.p.length === pal.antes.length + x.sil.length + pal.despues.length && x.g === v);
      assert(w, `hueco «${pal.antes}_${pal.despues}» con ${v} no forma una palabra del banco`);
      if (a.audio) assert.strictEqual(a.audio, w.p);
      // Ningún otro grupo forma otra palabra del banco con el mismo dibujo/audio.
    }
    if (a.tipo === 'bien-escrita') assert(palabrasBanco.has(v), v);
    (a.tarjetas || []).forEach((t) => {
      assert(palabrasBanco.has(t.texto));
      assert.strictEqual(M.PALABRAS_CQ.find((w) => w.p === t.texto).g, a.respuesta[t.id]);
    });
    if (a.tipo === 'tocar-grupo') {
      const g = a.params.grupo.toLowerCase();
      a.opciones.forEach((o) => {
        const tiene = o.texto.normalize('NFD').replace(/[̀-ͯ]/g, '').includes(g);
        assert.strictEqual([].concat(a.respuesta).includes(o.id), tiene, `${o.texto} / ${g}`);
      });
    }
  }
  // --- Gramática: el sustantivo y el adjetivo tocados son los del banco.
  if (a.tema === 'sustadj' && a.interaccion === 'tocar') {
    const sus = new Set(M.SUSTANTIVOS.map((s) => s.s));
    const adjs = new Set(Object.values(M.ADJ).flatMap((x) => [x.m, x.f]));
    const sel = [].concat(a.respuesta).map((id) => a.opciones.find((o) => o.id === id).texto.replace('.', ''));
    const buscaAdj = /adjetivo/.test(a.consigna);
    sel.forEach((w) => assert((buscaAdj ? adjs : sus).has(w), `${w} no es ${buscaAdj ? 'adjetivo' : 'sustantivo'}`));
    // Ninguna otra palabra de la frase es del mismo tipo (sin ambigüedad).
    const resto = a.opciones.filter((o) => ![].concat(a.respuesta).includes(o.id)).map((o) => o.texto.replace('.', ''));
    if (!buscaAdj) resto.forEach((w) => assert(!sus.has(w), 'dos sustantivos posibles: ' + w));
    else resto.forEach((w) => assert(!adjs.has(w), 'dos adjetivos posibles: ' + w));
  }
  if (a.tema === 'frases' && a.tipo === 'elegir-verbo') {
    const S = M.SUSTANTIVOS.find((s) => a.visual[0].partes[0].toLowerCase().includes(' ' + s.s));
    a.opciones.forEach((o) => assert.strictEqual(o.id === a.respuesta, S.v.includes(o.texto), `${S.s} ${o.texto}`));
  }
  if (a.tema === 'signos' && a.tipo === 'poner-signos') {
    const frase = a.visual[0].partes[1];
    assert(!/^(Cuántas|Vamos)/.test(frase), 'frase ambigua sin signos: ' + frase);
  }
  if (a.tema === 'comprension') {
    const cuento = a.visual[0].oraciones.join(' ');
    // La respuesta correcta tiene que estar en el texto (salvo verdadero/falso y ordenar).
    if (['quien', 'donde', 'color', 'que-habia'].includes(a.params.pregunta)) {
      const r = String(v).toLowerCase();
      assert(cuento.toLowerCase().includes(r), `«${r}» no está en: ${cuento}`);
      a.opciones.filter((o) => o.id !== a.respuesta).forEach((o) => assert(!cuento.toLowerCase().includes(o.texto.toLowerCase()), `distractor presente en el cuento: ${o.texto}`));
    }
    if (a.params.pregunta === 'vf') {
      const esVerdad = v === 'Verdadero';
      const f = a.visual[1].texto.replace(/\.$/, '');
      if (/^Adentro de/.test(f)) assert.strictEqual(cuento.includes(f.split(' había ')[1]), esVerdad, f);
      if (/^El cuento pasa en/.test(f)) assert.strictEqual(cuento.includes(f.replace('El cuento pasa en ', '')), esVerdad, f);
    }
  }
}

const NIVELES = [1, 2, 3];
let total = 0;
for (const tema of Object.keys(M.TEMAS)) {
  prueba(`${M.TEMAS[tema].nombre}: todas las modalidades y niveles`, () => {
    const motor = motorNuevo(1234 + tema.length);
    for (const nivel of NIVELES) {
      for (const mod of M.TEMAS[tema].modalidades) {
        if (!mod.niveles.includes(nivel)) continue;
        for (let i = 0; i < 120; i++) {
          const m = { cuento: null, preguntasCuento: [], ordenTabla: [], tablaUsados: [] };
          const a = motor.generarActividad(tema, { nivel, modalidad: mod.id, mision: m });
          validar(a); total++;
          motor.recordar(a);
        }
      }
    }
  });
}
console.log(`  (${total} actividades revisadas)`);

// ------------------------------------------------------------------
console.log('\nVariedad y anti-repetición');

prueba('misiones completas: ninguna actividad repite a una de las 30 anteriores', () => {
  const motor = motorNuevo(99);
  let n = 0, parecidas = 0; const firmas = [];
  for (let r = 0; r < 6; r++) for (const tipo of Object.keys(M.MISIONES)) {
    const m = motor.nuevaMision(tipo); let a;
    while ((a = motor.siguienteActividad(m))) {
      validar(a); n++;
      if (a.similitud) parecidas++;
      firmas.push(a.firma);
      motor.registrarResultado(m, a, { correcto: true });
    }
  }
  // Textos idénticos dentro de una ventana de 30.
  for (let i = 0; i < firmas.length; i++) for (let j = Math.max(0, i - 30); j < i; j++) {
    assert.notStrictEqual(firmas[i].texto, firmas[j].texto, 'texto repetido: ' + firmas[i].texto);
  }
  assert(parecidas / n < 0.03, `demasiadas variantes forzadas: ${parecidas}/${n}`);
  console.log(`     ${n} actividades, ${parecidas} con similitud mínima forzada`);
});

prueba('isTooSimilar detecta repeticiones', () => {
  const motor = motorNuevo(5);
  const a = motor.generarActividad('suma', { nivel: 1, modalidad: 'operacion' });
  assert(M.isTooSimilar(a, [a.firma]), 'la misma actividad debería ser similar');
  const b = motor.generarActividad('cece', { nivel: 1 });
  assert(!M.isTooSimilar(b, [a.firma]) || b.firma.estructura === a.firma.estructura);
});

prueba('cada misión usa varios tipos de interacción', () => {
  const motor = motorNuevo(24);
  for (const tipo of Object.keys(M.MISIONES)) {
    const m = motor.nuevaMision(tipo); const inter = new Set(); let a;
    while ((a = motor.siguienteActividad(m))) { inter.add(a.interaccion); motor.registrarResultado(m, a, { correcto: true }); }
    assert(inter.size >= (tipo === 'cuentos' ? 3 : 4), `${tipo}: solo ${[...inter].join(', ')}`);
  }
});

prueba('la respuesta correcta cambia de lugar (sin patrón)', () => {
  const motor = motorNuevo(8);
  const pos = [0, 0, 0]; let seguidas = 0, prev = -1;
  for (let i = 0; i < 900; i++) {
    const a = motor.generarActividad('lectura', { nivel: 2, modalidad: 'numero-a-palabras' });
    motor.recordar(a);
    pos[a.posicionCorrecta]++;
    if (a.posicionCorrecta === prev) seguidas++;
    prev = a.posicionCorrecta;
  }
  pos.forEach((p) => assert(p > 200, 'distribución desigual ' + pos));
  assert.strictEqual(seguidas, 0, 'misma posición dos veces seguidas');
});

prueba('tres días distintos → experiencias distintas', () => {
  const almacen = M.almacenMemoria();
  const dias = [11, 22, 33].map((s) => {
    const motor = M.crearMotor({ almacen, semilla: s });
    const m = motor.nuevaMision('sorpresa'); const r = []; let a;
    while ((a = motor.siguienteActividad(m))) { r.push(a.firma.texto); motor.registrarResultado(m, a, { correcto: true }); }
    return { r, tabla: m.ordenTabla.slice(0, 3).join() };
  });
  assert.notStrictEqual(dias[0].r.join(), dias[1].r.join());
  assert.notStrictEqual(dias[1].r.join(), dias[2].r.join());
  assert.notStrictEqual(dias[0].tabla, dias[1].tabla, 'la tabla del 2 empieza igual');
  const todas = dias.flatMap((d) => d.r);
  assert.strictEqual(new Set(todas).size, todas.length, 'se repitió una actividad entre días');
});

prueba('la tabla del 2 no sigue siempre la misma secuencia', () => {
  const motor = motorNuevo(4);
  const inicios = new Set();
  for (let i = 0; i < 10; i++) inicios.add(motor.nuevaMision('tabla').ordenTabla.slice(0, 3).join());
  assert(inicios.size >= 9);
});

// ------------------------------------------------------------------
console.log('\nDificultad adaptativa y repaso');

prueba('3 aciertos sin ayuda suben el nivel; 2 dificultades lo bajan', () => {
  const motor = motorNuevo(1);
  const a = { tema: 'suma', tipo: 'operacion', params: {}, esRepaso: true };
  assert.strictEqual(motor.nivelDe('suma'), 1);
  for (let i = 0; i < 3; i++) motor.registrarResultado(null, a, { correcto: true });
  assert.strictEqual(motor.nivelDe('suma'), 2);
  motor.registrarResultado(null, a, { correcto: true, pistas: 2 });
  motor.registrarResultado(null, a, { correcto: false });
  assert.strictEqual(motor.nivelDe('suma'), 1);
});
prueba('acertar con una ayuda mantiene el nivel', () => {
  const motor = motorNuevo(2);
  const a = { tema: 'resta', tipo: 'operacion', params: {}, esRepaso: true };
  for (let i = 0; i < 6; i++) motor.registrarResultado(null, a, { correcto: true, pistas: 1 });
  assert.strictEqual(motor.nivelDe('resta'), 1);
});
prueba('error en 2 × 4 → grupos, suma repetida y recién después 2 × 4', () => {
  const motor = motorNuevo(3);
  motor.fijarNivel('tabla2', 2);
  const m = motor.nuevaMision('tabla');
  const a = motor.generarActividad('tabla2', { nivel: 2, modalidad: 'operacion', params: { n: 4 }, mision: m });
  motor.recordar(a);
  motor.registrarResultado(m, a, { correcto: false });
  const sig = [motor.siguienteActividad(m), motor.siguienteActividad(m), motor.siguienteActividad(m)];
  assert.deepStrictEqual(sig.map((x) => x.tipo), ['contar-grupos', 'suma-repetida', 'operacion']);
  sig.forEach((x) => { assert.strictEqual(x.params.n, 4); assert(x.esRepaso); });
  assert.notStrictEqual(sig[2].firma.texto, a.firma.texto, 'repitió exactamente la misma consigna');
});
prueba('repaso de otros temas: mismo concepto, otra actividad', () => {
  const motor = motorNuevo(6);
  const m = motor.nuevaMision('palabras');
  const a = motor.generarActividad('cece', { nivel: 1, modalidad: 'completar-dibujo', mision: m });
  motor.recordar(a);
  motor.registrarResultado(m, a, { correcto: false });
  const r = motor.siguienteActividad(m);
  assert.strictEqual(r.tema, 'cece'); assert(r.esRepaso);
  assert.notStrictEqual(r.tipo, 'completar-dibujo');
  assert.notStrictEqual(r.firma.texto, a.firma.texto);
});
prueba('historial guardado con las claves pedidas', () => {
  const almacen = M.almacenMemoria();
  const motor = M.crearMotor({ almacen, semilla: 9 });
  const m = motor.nuevaMision('numeros'); const a = motor.siguienteActividad(m);
  motor.registrarResultado(m, a, { correcto: false, pistas: 1 });
  for (const k of ['recentActivities', 'correctAnswers', 'wrongAnswers', 'usedHints', 'topicsPracticed', 'difficultyLevel']) {
    assert(almacen.leer(k) != null, 'falta ' + k);
  }
  assert(almacen.leer('recentActivities').length >= 1);
  // Otra sesión con el mismo almacén recuerda lo reciente.
  const motor2 = M.crearMotor({ almacen, semilla: 10 });
  assert.strictEqual(motor2.estado.recentActivities[0].texto, a.firma.texto);
});

console.log(`\n${pruebas - fallos}/${pruebas} pruebas correctas`);
process.exit(fallos ? 1 : 0);
