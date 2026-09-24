/*
 * Genera los derivados de la escena a partir del SVG maestro:
 *   vista-previa.html            escena animada (abrir en el navegador)
 *   export/escena-base.png       pose de reposo, 1920×1080
 *   export/cepillado/f01..f08    un ciclo completo de cepillado (0,5 s a 16 fps)
 *   export/cepillado-sprites.png tira con los 8 fotogramas del niño recortado
 *
 * Uso:  NODE_PATH="$(npm root -g)" node herramientas/exportar.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const RAIZ = path.resolve(__dirname, '..');
const svg = fs.readFileSync(path.join(RAIZ, 'mision-dientes-limpios.svg'), 'utf8')
  .replace(/^<\?xml[^>]*>\s*/, '');
const anim = fs.readFileSync(path.join(RAIZ, 'animacion.js'), 'utf8');

const FOTOGRAMAS = 8;
const RECORTE_NINO = { x: 840, y: 290, width: 320, height: 620 };

const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Misión: Dientes Limpios</title>
<style>
  :root { --fondo: #1E2A44; --texto: #FFFFFF; }
  html, body { margin: 0; height: 100%; background: var(--fondo); color: var(--texto);
    font-family: system-ui, sans-serif; }
  body { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; padding: 16px; box-sizing: border-box; }
  #lienzo { width: 100%; max-width: 1600px; aspect-ratio: 16 / 9; }
  #lienzo svg { width: 100%; height: 100%; display: block; border-radius: 12px; }
  .controles { display: flex; gap: 8px; flex-wrap: wrap; justify-content: center; }
  button { font: inherit; padding: 8px 16px; border-radius: 999px; border: 0; background: #3A86FF; color: #fff; cursor: pointer; }
</style>
</head>
<body>
<div id="lienzo">${svg}</div>
<div class="controles">
  <button id="pausa">Pausa</button>
  <button id="lento">Cámara lenta</button>
  <button id="reposo">Ver pose de reposo</button>
</div>
<script>${anim}</script>
<script>
  (function () {
    var svg = document.querySelector('#lienzo svg');
    // Guardamos la pose de reposo para poder volver a ella.
    var reposo = Array.from(svg.querySelectorAll('g[id]')).map(function (g) {
      return [g, g.getAttribute('transform'), g.getAttribute('opacity')];
    });
    var t = 0, ultimo = null, velocidad = 1, parado = false;
    function paso(ahora) {
      if (ultimo !== null && !parado) t += (ahora - ultimo) / 1000 * velocidad;
      ultimo = ahora;
      if (!parado) { DientesLimpios.posar(svg, t); DientesLimpios.posarUI(svg, t); }
      requestAnimationFrame(paso);
    }
    requestAnimationFrame(paso);
    document.getElementById('pausa').onclick = function () { parado = !parado; this.textContent = parado ? 'Reanudar' : 'Pausa'; };
    document.getElementById('lento').onclick = function () { velocidad = velocidad === 1 ? 0.2 : 1; this.textContent = velocidad === 1 ? 'Cámara lenta' : 'Velocidad normal'; };
    document.getElementById('reposo').onclick = function () {
      parado = true; document.getElementById('pausa').textContent = 'Reanudar';
      reposo.forEach(function (r) {
        r[1] === null ? r[0].removeAttribute('transform') : r[0].setAttribute('transform', r[1]);
        r[2] === null ? r[0].removeAttribute('opacity') : r[0].setAttribute('opacity', r[2]);
      });
    };
  })();
</script>
</body>
</html>
`;

(async () => {
  fs.writeFileSync(path.join(RAIZ, 'vista-previa.html'), html);

  const salida = path.join(RAIZ, 'export');
  const dirFrames = path.join(salida, 'cepillado');
  fs.mkdirSync(dirFrames, { recursive: true });

  const navegador = await chromium.launch();
  const pagina = await navegador.newPage({ viewport: { width: 1920, height: 1080 } });
  await pagina.setContent(`<!DOCTYPE html><html><body style="margin:0">${svg}<script>${anim}</script></body></html>`);

  await pagina.screenshot({ path: path.join(salida, 'escena-base.png') });

  const periodo = 1 / 2; // un ciclo de cepillado (CEPILLADO_HZ = 2)
  const recortes = [];
  for (let i = 0; i < FOTOGRAMAS; i++) {
    const t = 1.2 + (i / FOTOGRAMAS) * periodo; // t=1.2 evita coincidir con un parpadeo
    await pagina.evaluate((t) => DientesLimpios.posar(document.querySelector('svg'), t), t);
    const nombre = `f${String(i + 1).padStart(2, '0')}.png`;
    await pagina.screenshot({ path: path.join(dirFrames, nombre) });
    recortes.push((await pagina.screenshot({ clip: RECORTE_NINO })).toString('base64'));
  }

  // Hoja de sprites: los 8 recortes del niño en una fila.
  const { width: w, height: h } = RECORTE_NINO;
  const hoja = await navegador.newPage({ viewport: { width: w * FOTOGRAMAS, height: h } });
  await hoja.setContent(`<body style="margin:0;display:flex">${recortes
    .map((b) => `<img src="data:image/png;base64,${b}" width="${w}" height="${h}">`).join('')}</body>`);
  await hoja.screenshot({ path: path.join(salida, 'cepillado-sprites.png') });

  await navegador.close();
  console.log('Exportado en', salida);
})();
