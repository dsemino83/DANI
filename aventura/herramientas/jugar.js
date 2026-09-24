/*
 * Juega todas las misiones en Chromium (respondiendo bien y, a veces, mal),
 * verifica que no haya errores y guarda capturas de cada tipo de interacción.
 * Uso:  NODE_PATH="$(npm root -g)" node aventura/herramientas/jugar.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const RAIZ = path.resolve(__dirname, '..');
const SALIDA = path.join(RAIZ, 'capturas');

async function responder(pag, bien) {
  const a = await pag.evaluate(() => {
    const x = window.Aventura.actividad;
    return { interaccion: x.interaccion, entrada: x.entrada, respuesta: x.respuesta, opciones: x.opciones, ordenes: x.ordenesValidos, pares: x.pares, tarjetas: x.tarjetas };
  });
  const clic = (sel) => pag.click(sel);
  const id = (v) => `#zona [data-id="${v}"]`;
  if (!bien) {
    // Un error a propósito (para ver el aviso, la pista y el repaso).
    if (a.opciones && typeof a.respuesta === 'string') {
      const mal = a.opciones.find((o) => o.id !== a.respuesta);
      await clic(id(mal.id));
    } else if (a.entrada === 'numero') {
      for (const d of String(a.respuesta + 1)) await clic(`#zona .teclado button:text-is("${d}")`);
      await clic('#zona .teclado .ok');
    }
    await pag.waitForTimeout(700);
    // Con dos opciones, un error ya muestra la respuesta.
    if (await pag.isVisible('#btn-seguir')) return;
  }
  switch (a.interaccion) {
    case 'elegir': case 'escuchar': await clic(id(a.respuesta)); break;
    case 'completar':
      if (a.entrada === 'numero') { for (const d of String(a.respuesta)) await clic(`#zona .teclado button:text-is("${d}")`); await clic('#zona .teclado .ok'); }
      else await clic(id(a.respuesta));
      break;
    case 'tocar': for (const r of [].concat(a.respuesta)) await clic(id(r)); break;
    case 'ordenar': for (const r of a.ordenes[0]) await clic(id(r)); break;
    case 'asociar': for (const [i, d] of Object.entries(a.pares)) { await clic(id(i)); await clic(id(d)); } break;
    case 'arrastrar':
      for (const t of a.tarjetas) { await clic(id(t.id)); await clic(`#zona .cesto[data-grupo="${a.respuesta[t.id]}"]`); }
      break;
  }
}

(async () => {
  fs.mkdirSync(SALIDA, { recursive: true });
  const nav = await chromium.launch();
  const errores = [];
  const tomadas = new Set();
  for (const [ancho, alto, sufijo] of [[1000, 900, ''], [390, 844, '-movil']]) {
    const pag = await nav.newPage({ viewport: { width: ancho, height: alto } });
    pag.on('pageerror', (e) => errores.push(e.message));
    // La fuente de Google puede no cargar sin red: no es un error del juego.
    pag.on('console', (m) => { if (m.type() === 'error' && !/fonts\.g|ERR_CERT|ERR_NAME|ERR_INTERNET/.test(m.text())) errores.push(m.text()); });
    await pag.goto('file://' + path.join(RAIZ, 'index.html'));
    await pag.waitForTimeout(400);
    await pag.screenshot({ path: path.join(SALIDA, `00-inicio${sufijo}.png`) });
    const misiones = sufijo ? ['sorpresa', 'palabras'] : ['numeros', 'calculos', 'tabla', 'cuentos', 'palabras', 'sorpresa'];
    let jugadas = 0;
    for (const m of misiones) {
      await pag.evaluate((x) => window.Aventura.empezarMision(x), m);
      for (let k = 0; k < 20; k++) {
        if (!(await pag.isVisible('#actividad'))) break;
        const info = await pag.evaluate(() => ({ t: window.Aventura.actividad.tema, i: window.Aventura.actividad.interaccion }));
        const clave = `${info.i}${sufijo}`;
        await pag.waitForTimeout(350);
        if (await pag.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)) errores.push(`desborde horizontal a ${ancho}px en ${info.t}/${info.i}`);
        if (!tomadas.has(clave)) { tomadas.add(clave); await pag.screenshot({ path: path.join(SALIDA, `${String(tomadas.size).padStart(2, '0')}-${info.i}-${info.t}${sufijo}.png`), fullPage: true }); }
        await responder(pag, jugadas % 5 !== 3);
        jugadas++;
        await pag.waitForSelector('#btn-seguir:not([hidden])', { timeout: 4000 });
        await pag.click('#btn-seguir');
      }
      if (!(await pag.isVisible('#fin'))) errores.push('La misión ' + m + ' no terminó');
    }
    await pag.screenshot({ path: path.join(SALIDA, `99-final${sufijo}.png`) });
    if (!sufijo) {
      await pag.evaluate(() => { window.Aventura.pintarAdultos(); window.Aventura.mostrar('adultos'); document.querySelector('#prev-tema').value = 'suma'; document.querySelector('#prev-nivel').value = '3'; window.Aventura.generarMuestras(); });
      await pag.screenshot({ path: path.join(SALIDA, '98-adultos.png'), fullPage: true });
      const hScroll = await pag.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      if (hScroll) errores.push('scroll horizontal');
    } else {
      const hScroll = await pag.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      if (hScroll) errores.push('scroll horizontal en móvil');
    }
    console.log(`${ancho}px: ${jugadas} actividades jugadas`);
    await pag.close();
  }
  await nav.close();
  if (errores.length) { console.log('ERRORES:\n' + [...new Set(errores)].join('\n')); process.exit(1); }
  console.log('Sin errores. Capturas en', SALIDA);
})();
