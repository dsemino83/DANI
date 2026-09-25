/*
 * Escenarios animados de fondo (SVG + CSS, sin imágenes externas).
 * Paisajes con el estilo de películas animadas, sin personajes:
 *   cielo     — cielo de nubes de juguete (estilo Toy Story)
 *   oceano    — isla volcánica y canoa en el mar (estilo Moana)
 *   hongos    — mundo de plataformas con bloques y monedas (estilo Mario Bros)
 *   desierto  — ruta en el desierto con mesetas rojas (estilo Cars)
 *   faroles   — torre junto al lago y faroles que suben (estilo Enredados)
 *   patio     — patio de verano con árbol y montaña rusa (estilo Phineas y Ferb)
 * Cada pregunta muestra un escenario distinto a los dos anteriores.
 */
(function (raiz) {
  'use strict';
  const W = 1600, H = 900;

  // ---------- Piezas reutilizables ----------
  const nube = (x, y, s = 1, sombra = '#d6ebff') => `
    <g transform="translate(${x} ${y}) scale(${s})">
      <ellipse cx="4" cy="30" rx="96" ry="24" fill="${sombra}"/>
      <ellipse cx="0" cy="22" rx="92" ry="26" fill="#fff"/>
      <circle cx="-42" cy="6" r="32" fill="#fff"/><circle cx="4" cy="-12" r="44" fill="#fff"/><circle cx="50" cy="6" r="30" fill="#fff"/>
    </g>`;
  // Repite un grupo a lo ancho dos veces para que se desplace sin cortes.
  const bucle = (contenido, dur, extra = '') => `
    <g class="es-deriva" style="animation-duration:${dur}s" ${extra}>
      <g>${contenido}</g><g transform="translate(${W} 0)">${contenido}</g>
    </g>`;
  const palmera = (x, y, s = 1, delay = 0) => `
    <g transform="translate(${x} ${y}) scale(${s})">
      <path d="M0 0 C 6 -60 -4 -120 16 -190" stroke="#8a5a2b" stroke-width="16" fill="none" stroke-linecap="round"/>
      <path d="M0 0 C 6 -60 -4 -120 16 -190" stroke="#6d4520" stroke-width="16" stroke-dasharray="4 14" fill="none"/>
      <g class="es-mecer" style="animation-delay:${delay}s">
        <path d="M16 -190 q -70 -20 -120 30 q 60 -40 120 -30z" fill="#2f9e44"/>
        <path d="M16 -190 q 70 -24 124 24 q -64 -36 -124 -24z" fill="#37b24d"/>
        <path d="M16 -190 q -40 -60 -100 -60 q 60 10 100 60z" fill="#40c057"/>
        <path d="M16 -190 q 40 -64 104 -56 q -64 12 -104 56z" fill="#2b8a3e"/>
        <path d="M16 -190 q 10 -50 -20 -90 q 40 30 20 90z" fill="#51cf66"/>
        <circle cx="10" cy="-186" r="9" fill="#7a4a1c"/><circle cx="24" cy="-182" r="9" fill="#8a5a2b"/>
      </g>
    </g>`;
  const cactus = (x, y, s = 1) => `
    <g transform="translate(${x} ${y}) scale(${s})" fill="#3f8f3a">
      <rect x="-14" y="-120" width="28" height="120" rx="14"/>
      <path d="M-14 -60 h-22 a10 10 0 0 1 -10 -10 v-30 a10 10 0 0 1 20 0 v20 h12z"/>
      <path d="M14 -80 h22 a10 10 0 0 0 10 -10 v-24 a10 10 0 0 0 -20 0 v14 h-12z"/>
      <rect x="-4" y="-116" width="4" height="110" fill="#5aa84f" rx="2"/>
    </g>`;
  const ladrillo = (x, y, t = 60) => `
    <g transform="translate(${x} ${y})">
      <rect width="${t}" height="${t}" fill="#c8641e" stroke="#6b2f0b" stroke-width="4"/>
      <path d="M0 ${t / 2} H${t} M${t / 2} 0 V${t / 2} M${t / 4} ${t / 2} V${t} M${t * 3 / 4} ${t / 2} V${t}" stroke="#6b2f0b" stroke-width="3"/>
    </g>`;
  const bloqueOro = (x, y, t = 60, d = 0) => `
    <g transform="translate(${x} ${y})"><g class="es-salto" style="animation-delay:${d}s">
      <rect width="${t}" height="${t}" rx="6" fill="#f7b92b" stroke="#8a5300" stroke-width="4"/>
      <circle cx="8" cy="8" r="3" fill="#8a5300"/><circle cx="${t - 8}" cy="8" r="3" fill="#8a5300"/><circle cx="8" cy="${t - 8}" r="3" fill="#8a5300"/><circle cx="${t - 8}" cy="${t - 8}" r="3" fill="#8a5300"/>
      <path transform="translate(${t / 2} ${t / 2}) scale(${t / 60})" d="M0 -17 L5 -5 L18 -5 L8 3 L12 16 L0 8 L-12 16 L-8 3 L-18 -5 L-5 -5Z" fill="#fff4c2"/>
    </g></g>`;
  const moneda = (x, y, d = 0) => `
    <g transform="translate(${x} ${y})"><g class="es-flotar" style="animation-delay:${d}s"><g class="es-girar" style="animation-delay:${d}s">
      <ellipse rx="18" ry="26" fill="#ffd43b" stroke="#c78a00" stroke-width="4"/><rect x="-3" y="-13" width="6" height="26" rx="3" fill="#c78a00"/>
    </g></g></g>`;
  const tubo = (x, y, h) => `
    <g transform="translate(${x} ${y})">
      <rect x="8" y="30" width="84" height="${h}" fill="#1db34a" stroke="#0a5c22" stroke-width="5"/>
      <rect x="22" y="30" width="14" height="${h}" fill="#7be495"/>
      <rect x="0" y="0" width="100" height="36" rx="4" fill="#1db34a" stroke="#0a5c22" stroke-width="5"/>
      <rect x="14" y="6" width="14" height="24" fill="#7be495"/>
    </g>`;
  const hongo = (x, y, s = 1, color = '#e03131') => `
    <g transform="translate(${x} ${y}) scale(${s})">
      <path d="M-18 0 q -4 -34 4 -40 h28 q 8 6 4 40z" fill="#fff3d6" stroke="#5c3b1e" stroke-width="3"/>
      <path d="M-46 -34 a46 40 0 0 1 92 0 z" fill="${color}" stroke="#5c3b1e" stroke-width="3"/>
      <circle cx="-22" cy="-52" r="9" fill="#fff"/><circle cx="12" cy="-62" r="11" fill="#fff"/><circle cx="32" cy="-42" r="7" fill="#fff"/>
    </g>`;
  const farol = (x, y, s, dur, delay) => `
    <g transform="translate(${x} ${y}) scale(${s})"><g class="es-subir" style="animation-duration:${dur}s;animation-delay:-${delay}s">
      <circle r="34" fill="#ffb938" opacity=".25" filter="url(#f-brillo)"/>
      <path d="M-12 -16 h24 l4 30 h-32z" fill="#ffcf5a" stroke="#d98a1c" stroke-width="2"/>
      <rect x="-9" y="10" width="18" height="6" fill="#ff9f2e"/>
      <path d="M-7 -12 h14 l3 22 h-20z" fill="#fff1b8" opacity=".7"/>
    </g></g>`;
  const mariposa = (x, y, color, d) => `
    <g transform="translate(${x} ${y})"><g class="es-revolotear" style="animation-delay:${d}s">
      <g class="es-aletear" style="animation-delay:${d}s">
        <ellipse cx="-9" cy="-4" rx="10" ry="8" fill="${color}"/><ellipse cx="9" cy="-4" rx="10" ry="8" fill="${color}"/>
        <ellipse cx="-7" cy="6" rx="7" ry="6" fill="${color}"/><ellipse cx="7" cy="6" rx="7" ry="6" fill="${color}"/>
      </g><rect x="-1.5" y="-10" width="3" height="20" rx="1.5" fill="#333"/>
    </g></g>`;
  const pajaro = (x, y, d) => `<g transform="translate(${x} ${y})"><g class="es-planear" style="animation-delay:${d}s"><path d="M-16 0 q 8 -10 16 0 q 8 -10 16 0" stroke="#2b3a55" stroke-width="4" fill="none" stroke-linecap="round"/></g></g>`;

  // ---------- Escenarios ----------
  const ESCENAS = {
    cielo: {
      nombre: 'Cielo de juguetes',
      svg: () => `
        <defs><linearGradient id="g-cielo" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3d8fe6"/><stop offset="1" stop-color="#a6d8ff"/></linearGradient></defs>
        <rect width="${W}" height="${H}" fill="url(#g-cielo)"/>
        ${bucle([[80, 120], [460, 70], [860, 150], [1240, 90], [240, 330], [640, 290], [1040, 360], [1420, 300], [60, 560], [460, 520], [860, 590], [1260, 540]].map(([x, y], i) => nube(x, y, i % 3 === 0 ? 1.1 : 0.9)).join(''), 120)}
        ${bucle([[300, 220], [1100, 460], [700, 760]].map(([x, y]) => nube(x, y, 1.6, '#c8e3ff')).join(''), 70)}
        <g class="es-avion"><g transform="translate(0 0)">
          <path d="M0 0 L90 18 L0 36 L18 18Z" fill="#fff" stroke="#9fb7d8" stroke-width="3"/><path d="M18 18 L90 18 L22 30Z" fill="#e3edf9"/>
        </g></g>
        <g>
          <rect y="${H - 70}" width="${W}" height="70" fill="#b7793d"/>
          ${Array.from({ length: 17 }, (_, i) => `<rect x="${i * 100}" y="${H - 70}" width="4" height="70" fill="#8e5626"/>`).join('')}
          <rect y="${H - 74}" width="${W}" height="8" fill="#d69a5c"/>
        </g>`,
    },
    oceano: {
      nombre: 'Isla del océano',
      svg: () => {
        const ola = (y, color, amp, dur, op = 1) => bucle(
          `<path d="M0 ${y} ${Array.from({ length: 9 }, (_, i) => `q 50 ${-amp} 100 0 q 50 ${amp} 100 0`).join(' ').replace(/^/, '')} V ${H} H 0Z" fill="${color}" opacity="${op}" transform="scale(1 1)"/>`,
          dur);
        return `
        <defs>
          <linearGradient id="g-atard" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5ec8f2"/><stop offset=".62" stop-color="#bfeaf5"/><stop offset="1" stop-color="#ffe0a3"/></linearGradient>
          <linearGradient id="g-mar" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1fc2c9"/><stop offset="1" stop-color="#086a9c"/></linearGradient>
        </defs>
        <rect width="${W}" height="${H}" fill="url(#g-atard)"/>
        <circle cx="1270" cy="330" r="70" fill="#fff1b0"/><circle cx="1270" cy="330" r="110" fill="#fff1b0" opacity=".3" class="es-latir"/>
        ${bucle(nube(200, 150, .8) + nube(900, 110, .6) + nube(1350, 180, .7), 150)}
        <path d="M430 560 C 560 470 620 300 720 250 C 760 230 790 240 820 270 C 900 330 980 480 1150 560Z" fill="#2e8b57"/>
        <path d="M720 250 C 760 230 790 240 820 270 C 800 300 780 290 760 310 C 740 290 730 300 700 270Z" fill="#6c4a3a"/>
        <path d="M600 560 C 660 440 720 360 760 330 C 760 400 740 480 780 560Z" fill="#257a4a"/>
        <g class="es-humo"><circle cx="770" cy="220" r="26" fill="#fff" opacity=".7"/><circle cx="800" cy="195" r="20" fill="#fff" opacity=".6"/></g>
        <rect y="545" width="${W}" height="${H - 545}" fill="url(#g-mar)"/>
        <path d="M380 575 q 400 -40 820 0 q -400 22 -820 0z" fill="#f5deaa"/>
        ${palmera(470, 575, .8, 0)}${palmera(1110, 578, .7, .8)}${palmera(1170, 580, .55, 1.4)}
        ${ola(600, '#2fd0d6', 10, 26, .55)}
        <g class="es-bote"><g transform="translate(560 640)">
          <path d="M-120 20 q 120 40 240 0 l -20 18 q -100 24 -200 0z" fill="#8a4b24"/>
          <path d="M-100 22 q 100 30 200 0" stroke="#e8c07a" stroke-width="4" fill="none"/>
          <path d="M-10 18 L -10 -150" stroke="#6d3f1c" stroke-width="7"/>
          <path d="M-8 -150 C 80 -130 110 -40 60 10 C 50 -40 20 -90 -8 -150Z" fill="#f2d4a2" stroke="#b77b3f" stroke-width="3"/>
          <path d="M40 -60 q 10 -14 22 0 q -10 14 -22 0z" fill="#b77b3f" opacity=".6"/>
        </g></g>
        ${ola(700, '#16aebd', 14, 18, .85)}
        ${ola(790, '#0c8fb3', 18, 12)}
        ${[[300, 690, 0], [980, 740, 1.2], [1380, 660, .6], [700, 830, 1.8]].map(([x, y, d]) => `<path class="es-titilar" style="animation-delay:${d}s" transform="translate(${x} ${y})" d="M0 -12 L3 -3 L12 0 L3 3 L0 12 L-3 3 L-12 0 L-3 -3Z" fill="#fff"/>`).join('')}
        ${pajaro(300, 260, 0)}${pajaro(360, 230, .6)}${pajaro(1000, 200, 1.1)}`;
      },
    },
    hongos: {
      nombre: 'Reino de los hongos',
      svg: () => `
        <rect width="${W}" height="${H}" fill="#6b9dfc"/>
        ${bucle(nube(150, 140, .9, '#e8f0ff') + nube(700, 90, .7, '#e8f0ff') + nube(1200, 170, 1, '#e8f0ff'), 90)}
        <path d="M-50 780 C 100 520 330 520 480 780Z" fill="#4cc261" stroke="#1d6b2e" stroke-width="6"/>
        <path d="M380 780 C 480 620 620 620 720 780Z" fill="#3fae54" stroke="#1d6b2e" stroke-width="6"/>
        <path d="M1050 780 C 1200 480 1450 480 1650 780Z" fill="#4cc261" stroke="#1d6b2e" stroke-width="6"/>
        <g fill="#1d6b2e" opacity=".35"><circle cx="210" cy="660" r="8"/><circle cx="260" cy="700" r="6"/><circle cx="1330" cy="620" r="9"/><circle cx="1390" cy="680" r="6"/></g>
        ${tubo(170, 610, 200)}${tubo(1340, 560, 260)}
        ${ladrillo(560, 430)}${bloqueOro(620, 430, 60, 0)}${ladrillo(680, 430)}${bloqueOro(740, 430, 60, .7)}${ladrillo(800, 430)}
        ${ladrillo(1000, 300)}${ladrillo(1060, 300)}${bloqueOro(1120, 300, 60, 1.3)}
        ${moneda(590, 360, 0)}${moneda(650, 350, .3)}${moneda(710, 360, .6)}${moneda(1050, 230, .9)}${moneda(1110, 220, 1.2)}
        ${hongo(470, 780, 1.1)}${hongo(900, 780, .8, '#2f9e44')}${hongo(980, 780, 1)}
        <g class="es-flotar"><g transform="translate(840 180)"><path d="M0 -26 L8 -8 L28 -8 L12 4 L18 24 L0 12 L-18 24 L-12 4 L-28 -8 L-8 -8Z" fill="#ffe066" stroke="#c78a00" stroke-width="4"/><circle cx="-6" cy="0" r="3"/><circle cx="6" cy="0" r="3"/></g></g>
        <g>
          <rect y="780" width="${W}" height="120" fill="#c8641e"/>
          ${Array.from({ length: 27 }, (_, i) => `<rect x="${i * 60}" y="780" width="60" height="60" fill="none" stroke="#6b2f0b" stroke-width="4"/><rect x="${i * 60 - 30}" y="840" width="60" height="60" fill="none" stroke="#6b2f0b" stroke-width="4"/>`).join('')}
        </g>`,
    },
    desierto: {
      nombre: 'Ruta del desierto',
      svg: () => `
        <defs>
          <linearGradient id="g-des" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4fa8e8"/><stop offset=".55" stop-color="#ffd59a"/><stop offset="1" stop-color="#ff9f59"/></linearGradient>
          <linearGradient id="g-arena" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f0b36a"/><stop offset="1" stop-color="#d9823e"/></linearGradient>
        </defs>
        <rect width="${W}" height="${H}" fill="url(#g-des)"/>
        <circle cx="1180" cy="250" r="80" fill="#fff4c4" class="es-latir"/>
        ${bucle(nube(300, 140, .6, '#ffe8d0') + nube(1000, 100, .5, '#ffe8d0'), 160)}
        <path d="M0 520 L90 520 L110 380 L200 370 L230 520 L520 520 L540 430 L600 300 L640 300 L700 430 L720 520 L1600 520 L1600 560 L0 560Z" fill="#b8481c"/>
        <path d="M600 300 L640 300 L620 250Z" fill="#b8481c"/>
        <path d="M1050 520 L1080 330 L1110 320 L1120 260 L1150 260 L1160 320 L1200 330 L1230 520Z" fill="#c4521f"/>
        <path d="M1300 520 L1320 400 L1420 390 L1450 520Z" fill="#a83f17"/>
        <path d="M0 520 H${W} V${H} H0Z" fill="url(#g-arena)"/>
        <path d="M620 520 L980 520 L1500 ${H} L100 ${H}Z" fill="#5b5f6b"/>
        <path d="M620 520 L980 520 L1500 ${H} L100 ${H}Z" fill="none" stroke="#e9e3d6" stroke-width="6"/>
        <path class="es-ruta" d="M800 522 L800 ${H}" stroke="#ffd43b" stroke-width="14" stroke-dasharray="40 40"/>
        ${cactus(250, 700, 1.1)}${cactus(1380, 640, .8)}${cactus(470, 580, .5)}
        <g transform="translate(1200 600)">
          <rect x="-4" y="0" width="8" height="90" fill="#6b4a2b"/>
          <rect x="-70" y="-50" width="140" height="56" rx="10" fill="#2f6fbf" stroke="#fff" stroke-width="5"/>
          <text y="-13" text-anchor="middle" font-family="Trebuchet MS, sans-serif" font-weight="700" font-size="28" fill="#fff">RUTA 2</text>
        </g>
        <g class="es-rodar"><g class="es-rueda">
          <circle r="34" fill="none" stroke="#9c6b35" stroke-width="6" stroke-dasharray="14 8"/>
          <circle r="20" fill="none" stroke="#b9854b" stroke-width="5" stroke-dasharray="10 6"/>
          <path d="M-30 -10 L30 12 M-20 24 L22 -26" stroke="#9c6b35" stroke-width="4"/>
        </g></g>`,
    },
    faroles: {
      nombre: 'Lago de los faroles',
      svg: () => `
        <defs>
          <linearGradient id="g-noche" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#141a46"/><stop offset=".55" stop-color="#4b3b8f"/><stop offset="1" stop-color="#f09b6b"/></linearGradient>
          <linearGradient id="g-lago" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5a4a9e"/><stop offset="1" stop-color="#1c2155"/></linearGradient>
          <filter id="f-brillo" x="-1" y="-1" width="3" height="3"><feGaussianBlur stdDeviation="10"/></filter>
        </defs>
        <rect width="${W}" height="${H}" fill="url(#g-noche)"/>
        ${Array.from({ length: 40 }, (_, i) => `<circle class="es-titilar" style="animation-delay:${(i * 0.37) % 3}s" cx="${(i * 397) % W}" cy="${(i * 131) % 380}" r="${1.5 + (i % 3)}" fill="#fff"/>`).join('')}
        <path d="M900 600 L960 600 L960 520 L980 500 L1000 520 L1000 560 L1030 560 L1030 470 L1050 430 L1070 470 L1070 560 L1100 560 L1100 510 L1120 490 L1140 510 L1140 600 L1220 600Z" fill="#2c2458"/>
        <rect y="600" width="${W}" height="${H - 600}" fill="url(#g-lago)"/>
        ${Array.from({ length: 6 }, (_, i) => `<rect class="es-reflejo" style="animation-delay:${i * .5}s" x="${1000 + i * 30 - 80}" y="${630 + i * 34}" width="${140 - i * 12}" height="4" rx="2" fill="#ffcf5a" opacity=".45"/>`).join('')}
        <path d="M0 590 C 120 540 300 530 400 600 C 440 640 430 700 470 760 C 500 820 460 870 480 ${H} L0 ${H}Z" fill="#23304f"/>
        <path d="M0 610 C 60 560 110 570 150 610Z M120 610 C 180 540 240 560 290 610Z" fill="#1a4a3a"/>
        <g transform="translate(250 600)">
          <rect x="-50" y="-360" width="100" height="360" fill="#d9c6a0"/>
          <path d="M-50 -360 h100 v360 h-100z" fill="none" stroke="#b39c74" stroke-width="4"/>
          ${[-300, -240, -180, -120, -60].map((y) => `<path d="M-50 ${y} h100" stroke="#c4ae86" stroke-width="3"/>`).join('')}
          <path d="M-72 -360 L0 -470 L72 -360Z" fill="#7b4bb0"/><path d="M-72 -360 L0 -470 L-20 -360Z" fill="#6a3d9c"/>
          <rect x="-66" y="-372" width="132" height="16" rx="4" fill="#b39c74"/>
          <path d="M-22 -310 a22 22 0 0 1 44 0 v40 h-44z" fill="#ffcf5a" class="es-latir"/>
          <path d="M-50 -200 q 20 40 -4 90 q 30 30 10 110" stroke="#3c8a3a" stroke-width="7" fill="none"/>
        </g>
        ${[[500, 820, .9, 26, 0], [620, 900, .7, 30, 4], [760, 860, 1, 24, 8], [880, 920, .6, 32, 2], [1000, 880, .8, 28, 11], [1150, 840, .9, 25, 6], [1290, 900, .7, 31, 14], [1420, 860, .8, 27, 9], [560, 900, .5, 34, 16], [1340, 920, .5, 33, 19], [700, 920, .6, 29, 21], [1050, 930, .55, 35, 23]].map(([x, y, s, d, t]) => farol(x, y, s, d, t)).join('')}`,
    },
    patio: {
      nombre: 'Patio de verano',
      svg: () => `
        <defs><linearGradient id="g-verano" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3fa9f5"/><stop offset="1" stop-color="#bfe7ff"/></linearGradient></defs>
        <rect width="${W}" height="${H}" fill="url(#g-verano)"/>
        <g transform="translate(1360 150)"><g class="es-rayos">${Array.from({ length: 12 }, (_, i) => `<rect x="-6" y="-120" width="12" height="44" rx="6" fill="#ffd43b" transform="rotate(${i * 30})"/>`).join('')}</g><circle r="66" fill="#ffe066"/></g>
        ${bucle(nube(200, 170, .8) + nube(760, 110, .6) + nube(1100, 220, .5), 110)}
        <g transform="translate(0 -120)">
        <g stroke="#e8590c" stroke-width="8" fill="none">
          <path id="montana" d="M620 560 C 700 300 800 300 860 440 C 900 540 960 540 1000 420 C 1040 300 1120 280 1160 380 C 1200 480 1260 520 1320 560"/>
          ${[680, 740, 800, 860, 920, 980, 1040, 1100, 1160, 1220, 1280].map((x) => `<path d="M${x} 560 V${x < 800 ? 380 : x < 900 ? 470 : x < 1050 ? 440 : 400}" stroke="#adb5bd" stroke-width="5"/>`).join('')}
        </g>
        <g><rect x="-22" y="-14" width="44" height="26" rx="6" fill="#1c7ed6"/><circle cx="-12" cy="14" r="6" fill="#343a40"/><circle cx="12" cy="14" r="6" fill="#343a40"/>
          <animateMotion dur="7s" repeatCount="indefinite" rotate="auto"><mpath href="#montana"/></animateMotion></g>
        </g>
        <rect y="600" width="${W}" height="${H - 600}" fill="#6cc24a"/>
        ${Array.from({ length: 8 }, (_, i) => `<rect x="${i * 200}" y="600" width="100" height="${H - 600}" fill="#7ccf57"/>`).join('')}
        <g>
          <rect y="520" width="${W}" height="16" fill="#d9a066"/><rect y="585" width="${W}" height="16" fill="#d9a066"/>
          ${Array.from({ length: 33 }, (_, i) => `<path d="M${i * 50} 610 V470 l 20 -18 l 20 18 V610Z" fill="#f0c38a" stroke="#c18a4f" stroke-width="3"/>`).join('')}
        </g>
        <g transform="translate(360 760)">
          <path d="M-30 0 C -24 -120 -26 -220 -10 -300 L 14 -300 C 24 -220 26 -120 34 0Z" fill="#8a5a2b"/>
          <g class="es-mecer-lento">
            <circle cx="0" cy="-380" r="170" fill="#2f9e44"/><circle cx="-120" cy="-330" r="110" fill="#37b24d"/><circle cx="120" cy="-320" r="120" fill="#2b8a3e"/>
            <circle cx="-40" cy="-460" r="100" fill="#40c057"/><circle cx="60" cy="-440" r="90" fill="#37b24d"/>
            <circle cx="-60" cy="-400" r="40" fill="#51cf66" opacity=".6"/>
          </g>
        </g>
        <path d="M700 900 C 760 820 900 820 960 900Z" fill="#5aa83a"/>
        ${mariposa(620, 680, '#f06595', 0)}${mariposa(1000, 720, '#ffd43b', 1.2)}${mariposa(1300, 690, '#845ef7', 2.1)}`,
    },
  };

  const CSS = `
  #fondo { position: fixed; inset: 0; z-index: -1; overflow: hidden; background: #9fd4ff; }
  #fondo .capa { position: absolute; inset: 0; opacity: 0; transition: opacity .8s ease; }
  #fondo .capa.ver { opacity: 1; }
  #fondo svg { width: 100%; height: 100%; display: block; }
  #fondo [class^="es-"], #fondo [class*=" es-"] { transform-box: fill-box; }
  .es-deriva { animation: es-deriva linear infinite; }
  @keyframes es-deriva { to { transform: translateX(-${W}px); } }
  .es-mecer { transform-origin: 50% 100%; animation: es-mecer 3.4s ease-in-out infinite alternate; }
  @keyframes es-mecer { from { transform: rotate(-4deg); } to { transform: rotate(4deg); } }
  .es-mecer-lento { transform-origin: 50% 100%; animation: es-mecer-l 5s ease-in-out infinite alternate; }
  @keyframes es-mecer-l { from { transform: rotate(-1.2deg); } to { transform: rotate(1.2deg); } }
  .es-flotar { animation: es-flotar 2.4s ease-in-out infinite alternate; }
  @keyframes es-flotar { to { transform: translateY(-14px); } }
  .es-girar { transform-origin: 50% 50%; animation: es-girar 1.6s linear infinite; }
  @keyframes es-girar { 0%, 100% { transform: scaleX(1); } 50% { transform: scaleX(.12); } }
  .es-salto { animation: es-salto 3s ease-in-out infinite; }
  @keyframes es-salto { 0%, 80%, 100% { transform: translateY(0); } 88% { transform: translateY(-12px); } }
  .es-subir { animation: es-subir linear infinite; opacity: 0; }
  @keyframes es-subir { 0% { transform: translate(0, 0); opacity: 0; } 10% { opacity: 1; } 50% { transform: translate(18px, -500px); } 90% { opacity: 1; } 100% { transform: translate(-10px, -1000px); opacity: 0; } }
  .es-titilar { animation: es-titilar 2.6s ease-in-out infinite; }
  @keyframes es-titilar { 50% { opacity: .2; } }
  .es-latir { transform-origin: 50% 50%; animation: es-latir 4s ease-in-out infinite; }
  @keyframes es-latir { 50% { transform: scale(1.08); opacity: .85; } }
  .es-bote { animation: es-bote 4s ease-in-out infinite; }
  @keyframes es-bote { 0%, 100% { transform: translate(0, 0) rotate(-2deg); } 50% { transform: translate(60px, 8px) rotate(2deg); } }
  .es-humo { animation: es-humo 6s ease-in-out infinite; }
  @keyframes es-humo { 0% { transform: translateY(10px); opacity: 0; } 30% { opacity: 1; } 100% { transform: translate(30px, -60px); opacity: 0; } }
  .es-ruta { animation: es-ruta 1s linear infinite; }
  @keyframes es-ruta { to { stroke-dashoffset: -80; } }
  .es-rodar { animation: es-rodar 9s linear infinite; }
  @keyframes es-rodar { 0% { transform: translate(-100px, 760px); } 25% { transform: translate(300px, 735px); } 50% { transform: translate(800px, 770px); } 75% { transform: translate(1250px, 740px); } 100% { transform: translate(1700px, 765px); } }
  .es-rueda { transform-origin: 50% 50%; animation: es-rueda 1.2s linear infinite; }
  @keyframes es-rueda { to { transform: rotate(360deg); } }
  .es-avion { animation: es-avion 16s ease-in-out infinite; }
  @keyframes es-avion { 0% { transform: translate(-150px, 420px) rotate(-6deg); } 50% { transform: translate(800px, 240px) rotate(4deg); } 100% { transform: translate(1750px, 380px) rotate(-4deg); } }
  .es-reflejo { animation: es-reflejo 3s ease-in-out infinite alternate; }
  @keyframes es-reflejo { to { transform: translateX(30px); opacity: .15; } }
  .es-rayos { transform-origin: 50% 50%; animation: es-rueda 30s linear infinite; }
  .es-revolotear { animation: es-revolotear 7s ease-in-out infinite; }
  @keyframes es-revolotear { 0%, 100% { transform: translate(0, 0); } 25% { transform: translate(60px, -40px); } 50% { transform: translate(120px, 10px); } 75% { transform: translate(50px, 40px); } }
  .es-aletear { transform-origin: 50% 50%; animation: es-aletear .25s ease-in-out infinite alternate; }
  @keyframes es-aletear { to { transform: scaleX(.3); } }
  .es-planear { animation: es-planear 5s ease-in-out infinite alternate; }
  @keyframes es-planear { to { transform: translate(120px, -30px); } }
  @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) #fondo::after { content: ''; position: absolute; inset: 0; background: rgba(10, 8, 30, .45); } }
  :root[data-theme="dark"] #fondo::after { content: ''; position: absolute; inset: 0; background: rgba(10, 8, 30, .45); }
  @media (prefers-reduced-motion: reduce) { #fondo * { animation: none !important; } }
  `;

  const IDS = Object.keys(ESCENAS);
  let fondo = null, capas = null, actual = 0;
  const historial = [];

  function preparar() {
    if (fondo) return;
    const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    fondo = document.createElement('div'); fondo.id = 'fondo'; fondo.setAttribute('aria-hidden', 'true');
    capas = [document.createElement('div'), document.createElement('div')];
    capas.forEach((c) => { c.className = 'capa'; fondo.appendChild(c); });
    document.body.prepend(fondo);
  }

  /** Muestra un escenario (o uno al azar distinto de los dos últimos). */
  function mostrar(id) {
    preparar();
    if (!id || !ESCENAS[id]) {
      const libres = IDS.filter((x) => !historial.slice(-2).includes(x));
      id = libres[Math.floor(Math.random() * libres.length)];
    }
    if (historial[historial.length - 1] === id && capas[actual].innerHTML) return id;
    historial.push(id);
    const sig = 1 - actual;
    capas[sig].innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMax slice" xmlns="http://www.w3.org/2000/svg">${ESCENAS[id].svg()}</svg>`;
    capas[sig].dataset.escenario = id;
    capas[sig].classList.add('ver'); capas[actual].classList.remove('ver');
    const vieja = capas[actual];
    setTimeout(() => { if (!vieja.classList.contains('ver')) vieja.innerHTML = ''; }, 900);
    actual = sig;
    return id;
  }

  raiz.Escenarios = { mostrar, lista: IDS, nombres: Object.fromEntries(IDS.map((i) => [i, ESCENAS[i].nombre])) };
})(typeof self !== 'undefined' ? self : this);
