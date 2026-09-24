/*
 * Genera capturas PNG de todas las pantallas del juego y un mosaico resumen.
 * Uso:  cd juego && NODE_PATH="$(npm root -g)" node herramientas/capturas.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const RAIZ = path.resolve(__dirname, '..');
const SALIDA = path.join(RAIZ, 'capturas');

(async () => {
  fs.mkdirSync(SALIDA, { recursive: true });
  const nav = await chromium.launch();
  const pag = await nav.newPage({ viewport: { width: 1200, height: 900 } });
  await pag.goto('file://' + path.join(RAIZ, 'index.html'));
  await pag.evaluate(() => document.fonts.ready);

  const tomas = [['00-inicio', 'inicio', 0, 0.3, 0], ['01-mision', 'mision', 0, 0.3, 0]];
  for (let i = 0; i < 8; i++) tomas.push([`${String(i + 2).padStart(2, '0')}-paso${i + 1}`, 'paso', i, 1.1, 4]);
  tomas.push(['10-final', 'final', 0, 0.3, 0]);

  const imgs = [];
  for (const [nombre, pantalla, paso, t, tPaso] of tomas) {
    await pag.evaluate(([p, i, t, tp]) => DientesLimpios.posar(p, i, t, tp), [pantalla, paso, t, tPaso]);
    const buf = await pag.screenshot({ path: path.join(SALIDA, nombre + '.png') });
    imgs.push(buf.toString('base64'));
  }

  // Mosaico 4×3 a 1/3 de tamaño
  const w = 400, h = 300;
  const mos = await nav.newPage({ viewport: { width: w * 4 + 5 * 8, height: h * 3 + 4 * 8 } });
  await mos.setContent(`<body style="margin:0;background:#081636;display:grid;grid-template-columns:repeat(4,${w}px);gap:8px;padding:8px">${
    imgs.map((b) => `<img src="data:image/png;base64,${b}" width="${w}" height="${h}" style="border-radius:10px">`).join('')}</body>`);
  await mos.screenshot({ path: path.join(SALIDA, 'mosaico.png') });
  await nav.close();
  console.log('Capturas en', SALIDA);
})();
