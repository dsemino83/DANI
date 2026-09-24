/*
 * Interfaz del juego: dibuja lo que genera el motor (motor.js) y maneja las
 * siete formas de interacción: tocar, elegir, ordenar, completar, asociar,
 * arrastrar y escuchar.
 */
(function () {
  'use strict';
  const motor = Motor.crearMotor();
  const $ = (s) => document.querySelector(s);
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const az = motor.azar;

  // ---------------- Voz ----------------
  let voz = null;
  function elegirVoz() {
    if (!('speechSynthesis' in window)) return;
    const vs = speechSynthesis.getVoices();
    voz = vs.find((v) => /es[-_]AR/i.test(v.lang)) || vs.find((v) => /es[-_](419|MX|US)/i.test(v.lang)) || vs.find((v) => /^es/i.test(v.lang)) || null;
  }
  if ('speechSynthesis' in window) { elegirVoz(); speechSynthesis.onvoiceschanged = elegirVoz; }
  function decir(texto) {
    if (!('speechSynthesis' in window) || !texto) return false;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(texto.replace(/×/g, ' por ').replace(/−/g, ' menos '));
    u.lang = voz ? voz.lang : 'es-AR'; if (voz) u.voice = voz; u.rate = 0.9; u.pitch = 1.05;
    speechSynthesis.speak(u);
    return true;
  }

  // ---------------- Pantallas ----------------
  function mostrar(id) {
    document.querySelectorAll('.pantalla').forEach((p) => p.classList.toggle('activa', p.id === id));
    window.scrollTo(0, 0);
  }

  const COLORES_MISION = { numeros: 'var(--c3)', calculos: 'var(--c1)', tabla: 'var(--c2)', cuentos: 'var(--c5)', palabras: 'var(--c6)', sorpresa: 'var(--c4)' };
  const DESCRIPCION = {
    numeros: 'Buscar, ordenar y leer números hasta 1.000',
    calculos: 'Sumas, restas y problemas',
    tabla: 'Grupos de 2 y la tabla del 2',
    cuentos: 'Leer cuentos cortos y responder',
    palabras: 'Sustantivos, adjetivos, ¿? ¡! y CE CI QUE QUI',
    sorpresa: 'Un poco de todo',
  };
  function pintarInicio() {
    const cont = $('#lista-misiones'); cont.innerHTML = '';
    for (const [id, m] of Object.entries(Motor.MISIONES)) {
      const b = el('button', 'mision');
      b.style.setProperty('--c', COLORES_MISION[id]);
      b.innerHTML = `<span class="em">${m.emoji}</span><b class="mayusculable">${esc(m.titulo)}</b><small>${esc(DESCRIPCION[id])}</small>`;
      b.onclick = () => empezarMision(id);
      cont.appendChild(b);
    }
    if (window.Escenarios) Escenarios.mostrar();
    const g = az.elegir(Motor.GUIAS);
    $('#saludo').textContent = az.elegir([
      `¡Hola! Soy ${g.nombre}. ¿Qué misión jugamos hoy?`,
      `${g.nombre} te espera. ¡Elegí una misión!`,
      '¡Hoy las preguntas son nuevas! ¿Empezamos?',
    ]);
  }

  // ---------------- Misión ----------------
  let mision = null, act = null, estado = null;

  function empezarMision(tipo) {
    mision = motor.nuevaMision(tipo);
    $('#titulo-mision').textContent = `${mision.emoji} ${mision.titulo}`;
    mostrar('actividad');
    siguiente();
  }

  function pintarProgreso() {
    const p = $('#progreso'); p.innerHTML = '';
    const hechos = mision.resultados.filter((r) => !r.esRepaso);
    for (let i = 0; i < mision.total; i++) {
      const r = hechos[i];
      const d = el('i', r ? (r.correcto ? 'hecho' : 'fallo') : (i === hechos.length ? 'ahora' : ''));
      p.appendChild(d);
    }
  }

  function siguiente() {
    act = motor.siguienteActividad(mision);
    if (!act) return terminar();
    estado = { errores: 0, pistas: 0, terminado: false, pistaVista: false };
    // Cada pregunta, un escenario animado distinto de los dos anteriores.
    if (window.Escenarios) Escenarios.mostrar();
    pintarProgreso();
    $('#nivel').textContent = `${Motor.TEMAS[act.tema].emoji} Nivel ${act.nivel}`;
    $('#cartel-repaso').innerHTML = act.esRepaso ? '<span class="repaso-cartel mayusculable">🔁 Repasamos lo mismo de otra forma</span>' : '';
    const guia = az.elegir(Motor.GUIAS);
    $('#guia').textContent = act.tema === 'tabla2' ? '🤖' : guia.emoji;
    $('#consigna').textContent = act.consigna;
    $('#aviso').className = 'aviso';
    $('#btn-seguir').hidden = true;
    $('#btn-pista').hidden = false;
    pintarEscena();
    pintarZona();
    if (act.interaccion === 'escuchar') setTimeout(() => decir(act.audio), 350);
  }

  // ---------------- Escena (representaciones visuales) ----------------
  const OPER = { '+': '+', '-': '−', '×': '×' };
  function pintarEscena() {
    const e = $('#escena'); e.innerHTML = '';
    for (const v of act.visual || []) e.appendChild(bloque(v));
  }

  function bloque(v) {
    switch (v.tipo) {
      case 'cuenta': return el('div', 'caja cuenta', `${v.a} ${OPER[v.oper]} ${v.b} = <span class="incognita">?</span>`);
      case 'secuencia': {
        const d = el('div', 'secuencia');
        v.items.forEach((x) => d.appendChild(el('div', 'n' + (x == null ? ' hueco incognita-sec' : ''), x == null ? '?' : x)));
        return d;
      }
      case 'objetos': {
        const d = el('div', 'caja objetos');
        v.grupos.forEach((g, i) => {
          if (i) d.appendChild(el('span', 'op', OPER[v.oper]));
          const gr = el('div', 'grupo');
          for (let k = 0; k < g.n; k++) gr.appendChild(el('span', k >= g.n - (g.tachados || 0) ? 'tachado' : '', g.emoji));
          d.appendChild(gr);
        });
        return d;
      }
      case 'grupos': {
        const d = el('div', 'caja grupos');
        for (let k = 0; k < v.grupos; k++) d.appendChild(el('span', 'g', v.emoji.repeat(v.porGrupo)));
        return d;
      }
      case 'filas': {
        const d = el('div', 'caja filas');
        for (let k = 0; k < v.filas; k++) d.appendChild(el('div', '', v.emoji.repeat(v.porFila)));
        return d;
      }
      case 'bloques': {
        const d = el('div', 'caja bloques');
        v.numeros.forEach((n) => {
          const col = el('div', 'col'); const num = el('div', 'num');
          for (let k = 0; k < Math.floor(n / 10); k++) { const b = el('div', 'barra10'); b.innerHTML = '<i></i>'.repeat(10); num.appendChild(b); }
          const cub = el('div', 'cubos'); for (let k = 0; k < n % 10; k++) cub.appendChild(el('div', 'cubo')); num.appendChild(cub);
          col.appendChild(num); col.appendChild(el('div', 'etq', n)); d.appendChild(col);
        });
        if (v.quitar) d.appendChild(el('div', 'col', `<div class="etq mayusculable">Sacá ${v.quitar}</div>`));
        return d;
      }
      case 'texto-grande': return el('div', 'caja cuenta', esc(v.texto).replace('?', '<span class="incognita">?</span>'));
      case 'numero-grande': return el('div', 'caja grande', v.n);
      case 'cartel': return el('div', 'cartel mayusculable', esc(v.texto));
      case 'emoji-grande': return el('div', 'emoji-grande', v.emoji);
      case 'personaje': return el('div', 'emoji-grande', v.emoji);
      case 'frase': return el('div', 'caja frase-vf mayusculable', esc(v.texto));
      case 'problema': {
        const d = el('div', 'caja problema');
        const texto = el('div', 'mayusculable', esc(v.texto));
        d.appendChild(el('div', 'dib', `${v.personaje || ''}${v.emoji}${v.repetir ? `<div class="rep">${v.emoji.repeat(Math.min(v.repetir, 10))}</div>` : ''}`));
        d.appendChild(v.oculto ? ocultable(texto, 'Ver el problema escrito') : texto);
        return d;
      }
      case 'cuento': {
        const d = el('div', 'caja cuento');
        const cuerpo = el('div');
        cuerpo.appendChild(el('h3', 'mayusculable', `<span>${v.emoji}</span>${esc(v.titulo)}`));
        cuerpo.appendChild(el('p', 'mayusculable', v.oraciones.map(esc).join(' ')));
        d.appendChild(v.oculto ? ocultable(cuerpo, 'Ver el cuento escrito') : cuerpo);
        return d;
      }
      case 'hueco': {
        const d = el('div', 'caja');
        if (v.contexto) d.appendChild(el('div', 'contexto mayusculable', `${v.personaje || ''} ${esc(v.contexto)}`));
        const f = el('div', 'frase-vf mayusculable');
        const [a, b, c] = v.partes;
        f.innerHTML = c === undefined
          ? `${v.emoji ? v.emoji + ' ' : ''}${esc(a)} <span class="hueco-txt">&nbsp;</span>${esc(b)}`
          : `<span class="hueco-txt">&nbsp;</span>${esc(b)}<span class="hueco-txt">&nbsp;</span>`;
        d.appendChild(f);
        return d;
      }
      case 'palabra': {
        const d = el('div', 'palabra');
        if (v.emoji) d.appendChild(el('span', 'emoji-grande', v.emoji));
        d.appendChild(el('span', 'mayusculable', `${esc(v.antes)}<span class="hueco-txt">&nbsp;</span>${esc(v.despues)}`));
        return d;
      }
      default: return el('div');
    }
  }

  function ocultable(contenido, etiqueta) {
    const w = el('div');
    const b = el('button', 'oculto-btn mayusculable', '👀 ' + etiqueta);
    contenido.hidden = true;
    b.onclick = () => { contenido.hidden = false; b.remove(); };
    w.append(b, contenido);
    return w;
  }

  function llenarHueco(texto) {
    const h = document.querySelectorAll('#escena .incognita, #escena .incognita-sec');
    if (h.length) h.forEach((x) => { x.textContent = texto; });
    const ht = document.querySelectorAll('#escena .hueco-txt');
    if (ht.length) {
      if (ht.length === 2 && /^[¿¡]/.test(texto)) { ht[0].textContent = texto[0]; ht[1].textContent = texto[texto.length - 1]; }
      else ht[0].textContent = act.tema === 'cece' ? texto.toLowerCase() : texto;
    }
  }

  // ---------------- Zona de interacción ----------------
  function pintarZona() {
    const z = $('#zona'); z.innerHTML = '';
    if (act.interaccion === 'escuchar') {
      const b = el('button', 'escuchar-btn mayusculable', '🔊 Escuchar otra vez');
      b.onclick = () => decir(act.audio);
      z.appendChild(b);
      if (!('speechSynthesis' in window)) z.appendChild(el('div', 'contexto', `(Sin audio en este navegador: «${esc(act.audio)}»)`));
    }
    const f = {
      elegir: zonaElegir, escuchar: zonaElegir, tocar: zonaTocar, ordenar: zonaOrdenar,
      completar: act.entrada === 'numero' ? zonaTeclado : zonaElegir, asociar: zonaAsociar, arrastrar: zonaArrastrar,
    }[act.interaccion];
    f(z);
  }

  function claseOpcion(o) {
    let c = 'opcion mayusculable';
    if (/^\d+$/.test(o.texto)) c += ' numero';
    if (act.formato === 'imagen' && o.emoji) c += ' img';
    return c;
  }
  function contenidoOpcion(o) {
    if (o.soloEmoji) return `<span class="em" style="font-size:40px">${o.texto}</span>`;
    return `${o.emoji ? `<span class="em">${o.emoji}</span>` : ''}<span>${esc(o.texto)}</span>`;
  }
  const esLarga = (ops) => ops.some((o) => o.texto.length > 22);

  // ELEGIR / ESCUCHAR / COMPLETAR con opciones
  function zonaElegir(z) {
    const g = el('div', 'opciones' + (esLarga(act.opciones) ? ' largas' : ''));
    act.opciones.forEach((o) => {
      const b = el('button', claseOpcion(o), contenidoOpcion(o));
      b.dataset.id = o.id;
      b.onclick = () => {
        if (estado.terminado) return;
        if (Motor.comprobar(act, o.id)) {
          b.classList.add('bien'); llenarHueco(o.texto); acierto();
        } else {
          b.classList.add('mal', 'temblor'); b.disabled = true; error();
        }
      };
      g.appendChild(b);
    });
    z.appendChild(g);
  }

  // TOCAR: una o varias respuestas (grilla o palabras de una frase)
  function zonaTocar(z) {
    const esperadas = [].concat(act.respuesta);
    const encontradas = new Set();
    const g = el('div', act.disposicion === 'frase' ? 'frase-tocable' : 'opciones');
    act.opciones.forEach((o) => {
      const b = el('button', claseOpcion(o), contenidoOpcion(o));
      b.dataset.id = o.id;
      b.onclick = () => {
        if (estado.terminado || encontradas.has(o.id)) return;
        if (esperadas.includes(o.id)) {
          b.classList.add('bien'); encontradas.add(o.id);
          if (encontradas.size === esperadas.length) acierto();
        } else { b.classList.add('mal', 'temblor'); b.disabled = true; error(); }
      };
      g.appendChild(b);
    });
    if (esperadas.length > 1) z.appendChild(el('div', 'contexto mayusculable', `Hay ${esperadas.length} para encontrar.`));
    z.appendChild(g);
  }

  // ORDENAR: se tocan las fichas en orden; tocar una ubicada la devuelve
  function zonaOrdenar(z) {
    const largas = act.fichas.some((f) => f.texto.length > 14);
    const puestas = [];
    const ran = el('div', 'ranuras' + (largas ? ' largas' : ''));
    const fich = el('div', 'fichas' + (largas ? ' largas' : ''));
    if (act.etiquetas) z.appendChild(el('div', 'etiqueta-orden mayusculable', `${act.etiquetas[0]} → ${act.etiquetas[1]}`));
    z.append(ran, fich);
    const botones = {};
    function pintar() {
      ran.innerHTML = '';
      for (let i = 0; i < act.fichas.length; i++) {
        const id = puestas[i];
        const r = el('button', 'ranura mayusculable' + (id ? ' llena' : ''), id ? esc(act.fichas.find((f) => f.id === id).texto) : (largas ? `${i + 1}.` : '·'));
        if (id) r.onclick = () => { if (estado.terminado) return; puestas.splice(i, 1); botones[id].hidden = false; pintar(); };
        ran.appendChild(r);
      }
    }
    act.fichas.forEach((f) => {
      const b = el('button', claseOpcion(f), esc(f.texto));
      b.dataset.id = f.id;
      botones[f.id] = b;
      b.onclick = () => {
        if (estado.terminado) return;
        puestas.push(f.id); b.hidden = true; pintar();
        if (puestas.length === act.fichas.length) {
          if (Motor.comprobar(act, puestas)) { if (act.frase) mostrarFraseArmada(puestas); acierto(); }
          else {
            ran.classList.add('temblor'); error();
            setTimeout(() => { ran.classList.remove('temblor'); if (estado.terminado) return; puestas.length = 0; Object.values(botones).forEach((x) => { x.hidden = false; }); pintar(); }, 700);
          }
        }
      };
      fich.appendChild(b);
    });
    pintar();
  }
  function mostrarFraseArmada(ids) {
    const t = ids.map((id) => act.fichas.find((f) => f.id === id).texto).join(' ');
    $('#escena').appendChild(el('div', 'caja frase-vf mayusculable', esc(t.charAt(0).toUpperCase() + t.slice(1)) + '.'));
  }

  // COMPLETAR con teclado numérico
  function zonaTeclado(z) {
    let valor = '';
    const pant = el('div', 'pantallita', '&nbsp;');
    const tec = el('div', 'teclado');
    const pintar = () => { pant.innerHTML = valor || '&nbsp;'; llenarHueco(valor || '?'); };
    [1, 2, 3, 4, 5, 6, 7, 8, 9, '⌫', 0, 'OK'].forEach((k) => {
      const b = el('button', k === 'OK' ? 'ok' : '', k);
      b.onclick = () => {
        if (estado.terminado) return;
        if (k === '⌫') valor = valor.slice(0, -1);
        else if (k === 'OK') {
          if (!valor) return;
          if (Motor.comprobar(act, valor)) { pant.style.color = 'var(--bien)'; return acierto(); }
          pant.classList.add('temblor'); error();
          setTimeout(() => { pant.classList.remove('temblor'); if (!estado.terminado) { valor = ''; pintar(); } }, 500);
          return;
        } else if (valor.length < 4) valor += k;
        pintar();
      };
      tec.appendChild(b);
    });
    z.append(pant, tec);
  }

  // ASOCIAR: tocar uno de la izquierda y su pareja de la derecha
  function zonaAsociar(z) {
    const cont = el('div', 'asociar');
    const izq = el('div', 'col'), der = el('div', 'col');
    let sel = null, hechos = 0;
    const total = Object.keys(act.pares).length;
    const bi = {};
    act.izquierda.forEach((o) => {
      const b = el('button', claseOpcion(o), contenidoOpcion(o)); bi[o.id] = b; b.dataset.id = o.id;
      b.onclick = () => {
        if (estado.terminado || b.dataset.ok) return;
        Object.values(bi).forEach((x) => x.classList.remove('elegida'));
        sel = o.id; b.classList.add('elegida');
      };
      izq.appendChild(b);
    });
    act.derecha.forEach((o) => {
      const b = el('button', claseOpcion(o), contenidoOpcion(o));
      b.dataset.id = o.id;
      b.onclick = () => {
        if (estado.terminado || b.dataset.ok) return;
        if (!sel) { bi[act.izquierda[0].id].classList.add('temblor'); setTimeout(() => bi[act.izquierda[0].id].classList.remove('temblor'), 400); return; }
        if (act.pares[sel] === o.id) {
          hechos++;
          const c = 'par' + hechos;
          bi[sel].classList.remove('elegida'); bi[sel].classList.add(c, 'emparejada'); b.classList.add(c, 'emparejada');
          bi[sel].dataset.ok = b.dataset.ok = '1'; sel = null;
          if (hechos === total) acierto();
        } else { b.classList.add('temblor'); setTimeout(() => b.classList.remove('temblor'), 400); error(); }
      };
      der.appendChild(b);
    });
    cont.append(izq, der);
    z.appendChild(cont);
  }

  // ARRASTRAR: con el dedo o el mouse (también sirve tocar la tarjeta y después el cesto)
  function zonaArrastrar(z) {
    const pool = el('div', 'fichas');
    const cestos = el('div', 'cestos');
    const dom = {};
    let sel = null, ubicadas = 0;
    act.grupos.forEach((g) => {
      const c = el('div', 'cesto');
      c.dataset.grupo = g.id;
      c.innerHTML = `<h4 class="mayusculable">${esc(g.texto)}${g.ayuda ? `<small>${esc(g.ayuda)}</small>` : ''}</h4>`;
      c.onclick = () => { if (sel) soltar(sel, g.id); };
      dom[g.id] = c; cestos.appendChild(c);
    });
    function soltar(id, grupo) {
      const b = pool.querySelector(`[data-id="${CSS.escape(id)}"]`);
      if (!b || estado.terminado) return;
      b.classList.remove('elegida'); sel = null;
      if (act.respuesta[id] === grupo) {
        b.classList.add('bien'); b.onpointerdown = null; b.onclick = null; dom[grupo].appendChild(b); ubicadas++;
        if (ubicadas === act.tarjetas.length) acierto();
      } else { b.classList.add('temblor'); setTimeout(() => b.classList.remove('temblor'), 400); error(); }
    }
    act.tarjetas.forEach((t) => {
      const b = el('button', claseOpcion(t), contenidoOpcion(t));
      b.dataset.id = t.id;
      b.onclick = () => { pool.querySelectorAll('.elegida').forEach((x) => x.classList.remove('elegida')); sel = t.id; b.classList.add('elegida'); };
      b.onpointerdown = (ev) => {
        if (estado.terminado) return;
        const x0 = ev.clientX, y0 = ev.clientY; let fantasma = null, sobre = null;
        const mover = (e) => {
          if (!fantasma && Math.hypot(e.clientX - x0, e.clientY - y0) < 8) return;
          if (!fantasma) { fantasma = b.cloneNode(true); fantasma.classList.add('arrastrando'); fantasma.style.width = b.offsetWidth + 'px'; document.body.appendChild(fantasma); b.style.opacity = '.3'; }
          fantasma.style.left = e.clientX + 'px'; fantasma.style.top = e.clientY + 'px';
          const debajo = document.elementFromPoint(e.clientX, e.clientY);
          const c = debajo && debajo.closest('.cesto');
          if (sobre && sobre !== c) sobre.classList.remove('sobre');
          sobre = c; if (c) c.classList.add('sobre');
          e.preventDefault();
        };
        const fin = () => {
          window.removeEventListener('pointermove', mover); window.removeEventListener('pointerup', fin);
          if (!fantasma) return;
          fantasma.remove(); b.style.opacity = '';
          if (sobre) { sobre.classList.remove('sobre'); soltar(t.id, sobre.dataset.grupo); }
          b.dataset.arrastrado = '1'; setTimeout(() => { delete b.dataset.arrastrado; }, 0);
        };
        window.addEventListener('pointermove', mover, { passive: false }); window.addEventListener('pointerup', fin);
      };
      pool.appendChild(b);
    });
    pool.style.touchAction = 'none';
    z.append(pool, cestos);
  }

  // ---------------- Aciertos, errores y pistas ----------------
  const FELICITAR = ['¡Muy bien!', '¡Genial!', '¡Excelente!', '¡Lo lograste!', '¡Bravo!', '¡Increíble!', '¡Sos un crack!', '¡Perfecto!'];
  const ANIMAR = ['¡Casi! Probá otra vez.', 'Mmm… mirá de nuevo.', '¡Vos podés! Intentá otra vez.', 'No pasa nada, probá otra.'];

  function aviso(tipo, html) { const a = $('#aviso'); a.className = 'aviso ver ' + tipo; a.innerHTML = html; }

  function acierto() {
    if (estado.terminado) return;
    estado.terminado = true;
    const r = motor.registrarResultado(mision, act, { correcto: estado.errores === 0, pistas: estado.pistas, intentos: estado.errores + 1 });
    const frase = az.elegir(FELICITAR);
    aviso('bien', `<span class="mayusculable">${frase}${r.subio ? ' ⬆️ ¡Subiste al nivel ' + r.nivel + '!' : ''}</span>`);
    decir(frase);
    confeti();
    finActividad();
  }

  function error() {
    estado.errores++;
    if (estado.errores >= 3 || quedaUnaSola()) return revelar();
    aviso('casi', `<span class="mayusculable">${az.elegir(ANIMAR)}</span>`);
    if (estado.errores === 2 && !estado.pistaVista) mostrarPista();
  }
  function quedaUnaSola() {
    if (!['elegir', 'escuchar'].includes(act.interaccion) && act.entrada !== 'opciones') return false;
    return document.querySelectorAll('#zona .opcion:not(:disabled)').length <= 1;
  }

  function revelar() {
    estado.terminado = true;
    motor.registrarResultado(mision, act, { correcto: false, pistas: estado.pistas, intentos: estado.errores });
    aviso('casi', `<span class="mayusculable">La respuesta era: <b>${esc(act.respuestaTexto)}</b>. ¡La próxima sale!</span>`);
    if (act.opciones && typeof act.respuesta === 'string') {
      document.querySelectorAll('#zona .opcion').forEach((b) => { b.disabled = true; });
      const o = act.opciones.find((x) => x.id === act.respuesta);
      if (o) llenarHueco(o.texto);
    }
    if (act.entrada === 'numero') llenarHueco(String(act.respuesta));
    finActividad();
  }

  function mostrarPista() {
    if (estado.terminado) return;
    estado.pistas++; estado.pistaVista = true;
    aviso('pista', `💡 <span class="mayusculable">${esc(act.pista)}</span>`);
    decir(act.pista);
  }

  function finActividad() {
    $('#btn-pista').hidden = true;
    $('#btn-seguir').hidden = false;
    $('#btn-seguir').focus({ preventScroll: true });
  }

  function confeti() {
    const c = el('div', 'confeti');
    const cosas = ['⭐', '✨', '🎉', '💫', '🌟'];
    for (let i = 0; i < 18; i++) {
      const s = el('i', '', az.elegir(cosas));
      s.style.left = Math.round(Math.random() * 100) + 'vw'; s.style.animationDelay = (Math.random() * 0.4) + 's';
      c.appendChild(s);
    }
    document.body.appendChild(c);
    setTimeout(() => c.remove(), 1900);
  }

  function terminar() {
    const res = mision.resultados.filter((r) => !r.esRepaso);
    const bien = res.filter((r) => r.correcto).length;
    const est = bien >= res.length - 1 ? 3 : bien >= res.length / 2 ? 2 : 1;
    $('#fin-estrellas').textContent = '⭐'.repeat(est) + '☆'.repeat(3 - est);
    $('#fin-guia').textContent = mision.guia.emoji;
    $('#fin-titulo').textContent = az.elegir(['¡Misión cumplida!', '¡Lo hiciste!', '¡Misión completa!']);
    $('#fin-texto').textContent = `${mision.guia.nombre} dice: ¡acertaste ${bien} de ${res.length} a la primera! ${est === 3 ? '¡Sos una estrella!' : 'Cada misión trae preguntas nuevas.'}`;
    mostrar('fin');
    decir($('#fin-titulo').textContent);
  }

  // ---------------- Panel para adultos ----------------
  function pintarAdultos() {
    const e = motor.estado;
    const filas = Object.entries(Motor.TEMAS).map(([id, t]) => {
      const tp = e.topicsPracticed[id];
      return `<tr><td>${t.emoji} ${esc(t.nombre)}</td><td>${motor.nivelDe(id)}</td><td>${e.correctAnswers[id] || 0}</td><td>${e.wrongAnswers[id] || 0}</td><td>${e.usedHints[id] || 0}</td><td>${tp ? tp.veces : 0}</td></tr>`;
    }).join('');
    $('#tabla-progreso').innerHTML = `<tr><th>Tema</th><th>Nivel</th><th>Bien</th><th>A repasar</th><th>Pistas</th><th>Actividades</th></tr>${filas}`;
    const sel = $('#prev-tema');
    if (!sel.options.length) Object.entries(Motor.TEMAS).forEach(([id, t]) => sel.add(new Option(`${t.emoji} ${t.nombre}`, id)));
  }
  function generarMuestras() {
    const tema = $('#prev-tema').value, nivel = Number($('#prev-nivel').value);
    const ol = $('#muestras'); ol.innerHTML = '';
    const falsa = { cuento: null, preguntasCuento: [], ordenTabla: [], tablaUsados: [] };
    const recientes = [];
    for (let i = 0; i < 8; i++) {
      const a = motor.generarActividad(tema, { nivel, mision: falsa });
      recientes.push(a);
      const vis = (a.visual || []).map((v) => v.texto || (v.oraciones || []).join(' ') || (v.items ? v.items.map((x) => (x == null ? '__' : x)).join(', ') : '') || (v.a != null ? `${v.a} ${OPER[v.oper]} ${v.b}` : '') || (v.antes != null ? `${v.emoji || ''} ${v.antes}__${v.despues}` : '') || (v.partes ? v.partes.join(' __ ') : '')).filter(Boolean).join(' · ');
      ol.appendChild(el('li', '', `<b>[${esc(a.tipo)} · ${esc(a.interaccion)}]</b> ${esc(a.consigna)} ${vis ? '<i>' + esc(vis) + '</i>' : ''} → <span class="r">${esc(a.respuestaTexto)}</span>`));
    }
  }

  // ---------------- Eventos ----------------
  $('#btn-leer').onclick = () => decir(act ? (act.decir || act.consigna) : '');
  $('#btn-pista').onclick = () => { if (!estado.pistaVista) mostrarPista(); else aviso('pista', `💡 <span class="mayusculable">${esc(act.pista)}</span>`); };
  $('#btn-seguir').onclick = () => { if ('speechSynthesis' in window) speechSynthesis.cancel(); document.querySelectorAll('.confeti').forEach((c) => c.remove()); siguiente(); };
  $('#btn-salir').onclick = () => { pintarInicio(); mostrar('inicio'); };
  $('#btn-otra').onclick = () => empezarMision(mision.tipo);
  $('#btn-volver').onclick = () => { pintarInicio(); mostrar('inicio'); };
  $('#btn-adultos').onclick = () => { pintarAdultos(); mostrar('adultos'); };
  $('#btn-adultos-volver').onclick = () => { pintarInicio(); mostrar('inicio'); };
  $('#btn-prev').onclick = generarMuestras;
  $('#btn-reiniciar').onclick = () => { if (confirm('¿Borrar niveles, historial y respuestas guardadas?')) { motor.reiniciar(); pintarAdultos(); } };
  $('#btn-letras').onclick = () => {
    document.body.classList.toggle('mayus');
    try { localStorage.setItem('aventura2.mayus', document.body.classList.contains('mayus') ? '1' : '0'); } catch (e) { /* sin almacenamiento */ }
  };
  try { if (localStorage.getItem('aventura2.mayus') === '0') document.body.classList.remove('mayus'); } catch (e) { /* sin almacenamiento */ }

  pintarInicio();
  // Para capturas y pruebas automáticas.
  window.Aventura = { motor, empezarMision, get actividad() { return act; }, get mision() { return mision; }, mostrar, pintarAdultos, generarMuestras };
})();
