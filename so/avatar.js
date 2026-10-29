// SO · Avatar de Francisco: FranciscoState → EmotionEngine → MotionEngine → Renderer.
// Renderer local (SVG + CSS): es el fallback siempre disponible; si existe un manifiesto de assets en caché
// (avatar/manifest.json, generado con OpenArt), se usan esas imágenes por emoción. Nunca regenera por mensaje y
// nunca bloquea el chat: todo cambio de estado es síncrono y barato. Respeta prefers-reduced-motion (CSS).

export const EMOCIONES = ['neutral', 'listening', 'thinking', 'understanding', 'happy', 'excited', 'curious', 'focused',
  'concerned', 'surprised', 'confused', 'success', 'error'];

// Evento de la aplicación → emoción (EmotionEngine).
export const MAPEO = {
  typing: 'listening', processing: 'thinking', research: 'curious', execution: 'focused', streaming: 'understanding',
  success: 'success', recoverableFailure: 'concerned', error: 'error', idle: 'neutral',
};

// Ciclo de vida: idle → listening → thinking → executing → responding → success/error → idle.
const TRANSICIONES = {
  idle: ['listening', 'thinking'], listening: ['idle', 'thinking'], thinking: ['executing', 'responding', 'error', 'idle'],
  executing: ['responding', 'success', 'error'], responding: ['success', 'error', 'idle'], success: ['idle', 'listening'],
  error: ['idle', 'listening'],
};
const FASE_A_EVENTO = { idle: 'idle', listening: 'typing', thinking: 'processing', executing: 'execution', responding: 'streaming', success: 'success', error: 'error' };

// Boca y cejas por emoción (MotionEngine: expresiones como datos; la transición la hace CSS).
const CARAS = {
  neutral:       { boca: 'M40 70 Q50 74 60 70', ceja: 0 },
  listening:     { boca: 'M41 70 Q50 75 59 70', ceja: -1 },
  thinking:      { boca: 'M42 71 L58 69', ceja: 2 },
  understanding: { boca: 'M40 69 Q50 76 60 69', ceja: -1 },
  happy:         { boca: 'M38 68 Q50 80 62 68', ceja: -2 },
  excited:       { boca: 'M38 67 Q50 84 62 67 Z', ceja: -3 },
  curious:       { boca: 'M44 71 Q50 74 56 71', ceja: 3 },
  focused:       { boca: 'M42 71 L58 71', ceja: 2 },
  concerned:     { boca: 'M40 74 Q50 68 60 74', ceja: 3 },
  surprised:     { boca: 'M46 70 Q50 78 54 70 Q50 64 46 70 Z', ceja: -4 },
  confused:      { boca: 'M40 72 Q45 68 50 72 Q55 76 60 71', ceja: 4 },
  success:       { boca: 'M37 67 Q50 82 63 67', ceja: -2 },
  error:         { boca: 'M41 75 Q50 69 59 75', ceja: 4 },
};

function svgFrancisco(modo) {
  const trabajo = modo !== 'personal';
  return `<svg viewBox="0 0 100 100" class="fr-svg" aria-hidden="true">
    <g class="fr-cuerpo">
      <path d="M18 100 Q20 80 50 78 Q80 80 82 100 Z" class="fr-ropa"/>
      ${trabajo ? '<path d="M38 80 L50 96 L62 80" class="fr-cuello"/>' : '<path d="M36 80 Q50 90 64 80" class="fr-cuello"/>'}
    </g>
    <g class="fr-cabeza">
      <circle cx="50" cy="50" r="27" class="fr-piel"/>
      <path d="M24 46 Q26 20 50 21 Q74 20 76 46 Q70 32 50 31 Q32 31 24 46 Z" class="fr-pelo"/>
      <g class="fr-cejas"><path d="M36 40 L45 39" class="fr-ceja"/><path d="M55 39 L64 40" class="fr-ceja"/></g>
      <g class="fr-ojos"><ellipse cx="41" cy="52" rx="3.2" ry="3.6" class="fr-ojo"/><ellipse cx="59" cy="52" rx="3.2" ry="3.6" class="fr-ojo"/></g>
      ${trabajo ? '<g class="fr-lentes"><circle cx="41" cy="52" r="7.5"/><circle cx="59" cy="52" r="7.5"/><path d="M48.5 52 L51.5 52"/></g>' : ''}
      <path d="" class="fr-boca"/>
    </g>
  </svg>`;
}

export function crearAvatar(nodo, { modo = 'work', manifest = null } = {}) {
  let fase = 'idle', emocion = 'neutral', tFase = null;
  nodo.classList.add('francisco');
  nodo.setAttribute('role', 'img');

  function pintarModo(m) {
    modo = m;
    nodo.dataset.modo = m;
    if (manifest?.[m]) {
      nodo.innerHTML = `<img class="fr-img" alt="" src="">`;
    } else {
      nodo.innerHTML = svgFrancisco(m);
    }
    aplicar();
  }

  function aplicar() {
    nodo.dataset.emo = emocion;
    nodo.setAttribute('aria-label', `Francisco (${emocion})`);
    const img = nodo.querySelector('.fr-img');
    if (img) {
      const src = manifest[modo][emocion] || manifest[modo].neutral;
      img.onerror = () => { manifest = null; pintarModo(modo); };   // cached → static → local fallback
      if (img.getAttribute('src') !== src) img.src = src;
      return;
    }
    const cara = CARAS[emocion] || CARAS.neutral;
    nodo.querySelector('.fr-boca')?.setAttribute('d', cara.boca);
    nodo.querySelector('.fr-cejas')?.setAttribute('transform', `translate(0 ${cara.ceja})`);
  }

  function emocionar(e) { if (EMOCIONES.includes(e) && e !== emocion) { emocion = e; aplicar(); } }

  function setFase(nueva) {
    if (nueva === fase) return;
    if (!(TRANSICIONES[fase] || []).includes(nueva) && nueva !== 'idle') fase = 'idle';
    fase = nueva;
    nodo.dataset.fase = fase;
    emocionar(MAPEO[FASE_A_EVENTO[fase]] || 'neutral');
    clearTimeout(tFase);
    if (fase === 'success' || fase === 'error') tFase = setTimeout(() => setFase('idle'), 2400);
  }

  pintarModo(modo);
  return { setFase, emocionar, setModo: pintarModo, get fase() { return fase; }, get emocion() { return emocion; } };
}
