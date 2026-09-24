/*
 * Misión: Dientes Limpios — ciclo de animación de referencia.
 *
 * posar(svg, t) coloca todas las piezas animables para el instante t (segundos).
 * Es determinista: la vista previa la llama en cada fotograma y el exportador
 * la usa para generar los fotogramas PNG del ciclo de cepillado.
 *
 * Todas las rotaciones usan los pivotes declarados en data-pivot del SVG.
 */
(function (global) {
  'use strict';

  var CEPILLADO_HZ = 2;      // dos pasadas cortas por segundo, como un cepillado real
  var BASE_TRONCO = -3;      // pose de reposo del SVG (grados)
  var BASE_CABEZA = -5;

  function rot(el, ang) {
    var p = el.getAttribute('data-pivot').split(',');
    return 'rotate(' + ang.toFixed(3) + ' ' + p[0] + ' ' + p[1] + ')';
  }

  function escalaY(el, s) {
    var p = el.getAttribute('data-pivot').split(',');
    return 'translate(' + p[0] + ' ' + p[1] + ') scale(1 ' + s.toFixed(3) + ') translate(' + -p[0] + ' ' + -p[1] + ')';
  }

  // Parpadeo: ojos abiertos salvo ~0,14 s cada `periodo` segundos.
  function parpadeo(t, periodo, desfase) {
    var f = ((t + desfase) % periodo) / 0.14;
    return f < 1 ? Math.abs(1 - 2 * f) * 0.9 + 0.1 : 1;
  }

  function posar(svg, t) {
    var $ = function (id) { return svg.querySelector('#' + id); };
    var w = 2 * Math.PI * CEPILLADO_HZ * t;

    // --- Niño: cepillado en pequeños círculos a lo largo de la encía ---
    // El puño describe una elipse de 4×2,5 px; antebrazo y hombro acompañan
    // con giros muy pequeños y algo desfasados para que el gesto sea orgánico.
    $('nino-mano-cepillo').setAttribute('transform',
      'translate(' + (4 * Math.sin(w)).toFixed(2) + ' ' + (2.5 * Math.cos(w)).toFixed(2) + ')');
    $('nino-antebrazo').setAttribute('transform', rot($('nino-antebrazo'), 1.6 * Math.sin(w - 0.3)));
    $('nino-brazo-cercano').setAttribute('transform', rot($('nino-brazo-cercano'), 0.7 * Math.sin(w - 0.6)));
    // Respiración y acompañamiento leve de cabeza y tronco.
    $('nino-superior').setAttribute('transform', rot($('nino-superior'), BASE_TRONCO + 0.4 * Math.sin(2 * Math.PI * t / 3)));
    $('nino-cabeza').setAttribute('transform', rot($('nino-cabeza'), BASE_CABEZA + 0.5 * Math.sin(w + 0.8)));
    $('nino-ojos').setAttribute('transform', escalaY($('nino-ojos'), parpadeo(t, 3.4, 1.2)));
    // Espuma que “respira” con cada pasada.
    var espuma = $('nino-espuma');
    espuma.setAttribute('opacity', (0.75 + 0.25 * Math.sin(w * 1.5)).toFixed(3));

    // --- Superdiente: flota, saluda y ondea la capa ---
    var flota = 10 * Math.sin(2 * Math.PI * t / 2.2);
    $('superdiente').setAttribute('transform', 'translate(1480 ' + (600 + flota).toFixed(2) + ')');
    $('sd-sombra').setAttribute('transform',
      'translate(0 ' + (-flota).toFixed(2) + ') translate(0 300) scale(' + (1 - flota / 120).toFixed(3) + ' 1) translate(0 -300)');
    $('sd-brazo-arriba').setAttribute('transform', rot($('sd-brazo-arriba'), 10 * Math.sin(2 * Math.PI * t / 0.9)));
    $('sd-capa').setAttribute('transform',
      'translate(0 -40) skewX(' + (5 * Math.sin(2 * Math.PI * t / 1.3)).toFixed(2) + ') translate(0 40)');
    $('sd-ojos').setAttribute('transform', escalaY($('sd-ojos'), parpadeo(t, 4.1, 0)));
    $('sd-destellos').setAttribute('opacity', (0.55 + 0.45 * Math.sin(2 * Math.PI * t / 1.1)).toFixed(3));
  }

  // Estado de la interfaz: cuenta atrás de 2 minutos y barra de limpieza.
  function posarUI(svg, t) {
    var total = 120, resta = Math.max(0, total - Math.floor(t));
    var txt = svg.querySelector('#ui-tiempo-texto');
    if (txt) txt.textContent = Math.floor(resta / 60) + ':' + String(resta % 60).padStart(2, '0');
    var barra = svg.querySelector('#ui-progreso-barra');
    if (barra) barra.setAttribute('width', (18 + 192 * Math.min(1, t / total)).toFixed(1));
  }

  global.DientesLimpios = { posar: posar, posarUI: posarUI, CEPILLADO_HZ: CEPILLADO_HZ };
})(typeof window !== 'undefined' ? window : globalThis);
