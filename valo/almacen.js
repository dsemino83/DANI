// Almacenamiento del Conversor VALO.
// - Modo "compartido": base de datos compartida de la página publicada en claude.ai (capacidad db).
//   Todos los usuarios ven los mismos clientes, secuencias, bancos e historial, en vivo.
// - Modo "local": el navegador (localStorage), para el archivo abierto fuera de claude.ai.
(function (root) {
  'use strict';

  const clonar = x => JSON.parse(JSON.stringify(x));
  const nuevoId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const TROZO = 60000; // caracteres por documento de TXT (los documentos admiten hasta 256 KiB)

  function trozos(texto) {
    const partes = [];
    for (let i = 0; i < texto.length; i += TROZO) partes.push(texto.slice(i, i + TROZO));
    return partes.length ? partes : [''];
  }

  // Emisor simple de cambios.
  function emisor() {
    const fns = [];
    return { on: fn => fns.push(fn), emitir: () => fns.forEach(fn => { try { fn(); } catch (e) { console.error(e); } }) };
  }

  // ================================================================ LOCAL

  function crearLocal() {
    const CLAVE = 'valo-conversor-v1';
    const ev = emisor();
    let datos;
    try {
      const txt = localStorage.getItem(CLAVE);
      const e = txt && JSON.parse(txt);
      if (e && Array.isArray(e.clientes) && Array.isArray(e.bancos) && Array.isArray(e.lotes)) datos = e;
    } catch (err) { /* sin almacenamiento: se trabaja en memoria */ }
    if (!datos) datos = { version: 1, clientes: [], bancos: clonar(root.VALO_BANCOS_INICIALES || []), lotes: [] };
    if (!Array.isArray(datos.bancosMeli)) datos.bancosMeli = clonar(root.VALO_BANCOS_MELI_INICIALES || []);

    function guardar() {
      try { localStorage.setItem(CLAVE, JSON.stringify(datos)); return true; } catch (err) { return false; }
    }
    const cambiar = () => { const ok = guardar(); ev.emitir(); return ok; };

    return {
      modo: 'local',
      get datos() { return datos; },
      bancosCargados: true,
      puedeEscribir: true,
      usuarioId: null,
      alCambiar: ev.on,
      guardarDisponible: guardar,
      async crearCliente(c) { const n = Object.assign({ id: nuevoId() }, c); datos.clientes.push(n); cambiar(); return n; },
      async actualizarCliente(id, cambios) { Object.assign(datos.clientes.find(c => c.id === id), cambios); cambiar(); },
      async borrarCliente(id) { datos.clientes = datos.clientes.filter(c => c.id !== id); cambiar(); },
      async guardarBancos(lista) { datos.bancos = clonar(lista); cambiar(); },
      async bancosOriginales() { return clonar(root.VALO_BANCOS_INICIALES || []); },
      async guardarBancosMeli(lista) { datos.bancosMeli = clonar(lista); cambiar(); },
      async registrarLote(clienteId, construir) {
        const c = datos.clientes.find(x => x.id === clienteId);
        const r = construir(clonar(c));
        const lote = Object.assign({}, r.lote, { txtCuotas: r.txtCuotas, txtCreditos: r.txtCreditos });
        datos.lotes.push(lote);
        Object.assign(c, r.cambiosCliente);
        let aviso = null;
        if (!guardar()) {
          delete lote.txtCuotas; delete lote.txtCreditos;
          aviso = guardar() ? 'Sin espacio para guardar los CSV en el historial: descargalos ahora.'
            : 'No se pudo guardar en este navegador. Descargá los CSV ahora.';
        }
        ev.emitir();
        return { lote, aviso };
      },
      async anularLote(loteId, cambios) {
        const l = datos.lotes.find(x => x.id === loteId);
        Object.assign(l, cambios);
        const c = datos.clientes.find(x => x.id === l.clienteId);
        if (c) c.ultimaSecuencia = l.secuenciaAnterior;
        cambiar();
      },
      async leerTxt(lote) {
        return lote.txtCuotas && lote.txtCreditos ? { cuotas: lote.txtCuotas, creditos: lote.txtCreditos } : null;
      },
      async nombres() { return {}; },
      exportar() { return clonar(datos); },
      async importar(nuevo) { datos = nuevo; cambiar(); },
    };
  }

  // =========================================================== COMPARTIDO

  async function crearCompartido(db, user) {
    const ev = emisor();
    const holder = 'pestana-' + nuevoId();
    const usuarioId = user ? await user.id() : null;
    const puede = user ? await user.can('data.write') : null;
    const datos = { clientes: [], bancos: [], bancosMeli: [], lotes: [] };
    const listo = { clientes: false, bancos: false, lotes: false, bancosMeli: false };
    const api = {
      modo: 'compartido',
      datos,
      bancosCargados: false,
      puedeEscribir: puede, // true / false / null (no informado: se decide al escribir)
      usuarioId,
      alCambiar: ev.on,
      error: null,
    };
    const alError = e => { api.error = e; ev.emitir(); };
    const emitirSiListo = () => { if (listo.clientes && listo.bancos && listo.lotes && listo.bancosMeli) ev.emitir(); };

    db.collection('clientes').onSnapshot(s => {
      datos.clientes = s.docs.map(d => Object.assign({ id: d.id }, d.data()))
        .sort((a, b) => String(a.creado || '').localeCompare(String(b.creado || '')));
      listo.clientes = true; emitirSiListo();
    }, alError);
    db.collection('lotes').orderBy('fecha', 'asc').onSnapshot(s => {
      datos.lotes = s.docs.map(d => Object.assign({ id: d.id }, d.data()));
      listo.lotes = true; emitirSiListo();
    }, alError);
    db.doc('maestros/bancosMeli').onSnapshot(s => {
      datos.bancosMeli = s.exists && Array.isArray(s.data().lista) ? clonar(s.data().lista) : [];
      listo.bancosMeli = true; emitirSiListo();
    }, alError);
    db.doc('maestros/bancos').onSnapshot(s => {
      datos.bancos = s.exists && Array.isArray(s.data().lista) ? clonar(s.data().lista) : [];
      api.bancosCargados = s.exists;
      listo.bancos = true; emitirSiListo();
    }, alError);

    // Reintenta una vez los cortes transitorios.
    async function escribir(fn) {
      try { return await fn(); } catch (e) {
        if (e && e.code === 'unavailable') { await new Promise(r => setTimeout(r, 400 + Math.random() * 600)); return fn(); }
        throw traducir(e);
      }
    }
    function traducir(e) {
      const code = e && e.code;
      if (code === 'invalid_argument' && api.puedeEscribir !== true) { api.puedeEscribir = false; ev.emitir(); return new Error('Tu acceso a esta página es de solo lectura: pedile al dueño que te comparta como Colaborador o Editor.'); }
      if (code === 'quota_exceeded') return new Error('La base compartida está llena (' + (e.message || 'límite alcanzado') + ').');
      if (code === 'resource_exhausted') return new Error('Demasiadas operaciones seguidas. Esperá unos segundos y probá de nuevo.');
      if (code === 'revoked' || code === 'not_granted') return new Error('Se perdió el acceso a la base compartida. Recargá la página.');
      return e instanceof Error ? e : new Error((e && e.message) || String(e));
    }

    async function conBloqueo(clienteId, fn) {
      const ref = db.doc('clientes/' + clienteId);
      const r = await escribir(() => ref.acquire({ holder, ttlMs: 15000 }));
      if (!r.acquired) throw new Error('Otro usuario está procesando un lote de este cliente en este momento. Esperá unos segundos y probá de nuevo.');
      const snap = await ref.get();
      if (!snap.exists) throw new Error('El cliente ya no existe.');
      return fn(ref, Object.assign({ id: clienteId }, snap.data()));
    }

    Object.assign(api, {
      async crearCliente(c) {
        const id = nuevoId();
        const cuerpo = Object.assign({}, c, { creadoPor: usuarioId });
        await escribir(() => db.doc('clientes/' + id).set(cuerpo));
        return Object.assign({ id }, cuerpo);
      },
      async actualizarCliente(id, cambios) { await escribir(() => db.doc('clientes/' + id).update(cambios)); },
      async borrarCliente(id) { await escribir(() => db.doc('clientes/' + id).delete()); },
      async guardarBancos(lista) {
        await escribir(() => db.doc('maestros/bancos').set({ lista: clonar(lista), actualizado: new Date().toISOString(), actualizadoPor: usuarioId }));
      },
      async guardarBancosMeli(lista) {
        await escribir(() => db.doc('maestros/bancosMeli').set({ lista: clonar(lista), actualizado: new Date().toISOString(), actualizadoPor: usuarioId }));
      },
      async bancosOriginales() {
        const s = await db.doc('maestros/bancosOriginales').get();
        return s.exists && Array.isArray(s.data().lista) ? clonar(s.data().lista) : null;
      },
      // construir(clienteFresco) → { lote, txtCuotas, txtCreditos, cambiosCliente }; se ejecuta con el cliente bloqueado
      // y releído de la base, así dos usuarios no pueden tomar la misma secuencia.
      async registrarLote(clienteId, construir) {
        return conBloqueo(clienteId, async (ref, fresco) => {
          const r = construir(fresco);
          const lote = Object.assign({}, r.lote, { usuarioId });
          const pCu = trozos(r.txtCuotas), pCr = trozos(r.txtCreditos);
          for (let i = 0; i < pCu.length; i++) await escribir(() => db.doc(`lotesTxt/${lote.id}_cuotas_${i}`).set({ texto: pCu[i] }));
          for (let i = 0; i < pCr.length; i++) await escribir(() => db.doc(`lotesTxt/${lote.id}_creditos_${i}`).set({ texto: pCr[i] }));
          lote.txtPartes = { cuotas: pCu.length, creditos: pCr.length };
          const { id, ...cuerpo } = lote;
          await escribir(() => db.doc('lotes/' + id).set(cuerpo));
          await escribir(() => ref.update(r.cambiosCliente));
          return { lote, aviso: null };
        });
      },
      async anularLote(loteId, cambios) {
        const lote = datos.lotes.find(l => l.id === loteId);
        await conBloqueo(lote.clienteId, async ref => {
          const vigentes = (await db.collection('lotes').where('clienteId', '==', lote.clienteId).get()).docs
            .map(d => Object.assign({ id: d.id }, d.data())).filter(l => !l.anulado)
            .sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)));
          if (!vigentes.length || vigentes[vigentes.length - 1].id !== loteId) throw new Error('Solo se puede anular el último lote vigente del cliente (alguien procesó otro lote).');
          await escribir(() => db.doc('lotes/' + loteId).update(Object.assign({}, cambios, { anuladoPor: usuarioId })));
          await escribir(() => ref.update({ ultimaSecuencia: lote.secuenciaAnterior }));
        });
      },
      async leerTxt(lote) {
        if (!lote.txtPartes) return null;
        const leer = async (tipo, n) => {
          let t = '';
          for (let i = 0; i < n; i++) {
            const s = await db.doc(`lotesTxt/${lote.id}_${tipo}_${i}`).get();
            if (!s.exists) return null;
            t += s.data().texto;
          }
          return t;
        };
        const cuotas = await leer('cuotas', lote.txtPartes.cuotas);
        const creditos = await leer('creditos', lote.txtPartes.creditos);
        return cuotas != null && creditos != null ? { cuotas, creditos } : null;
      },
      async nombres(ids) {
        if (!user || !ids.length) return {};
        const ps = await user.profiles(ids);
        const res = {};
        Object.keys(ps).forEach(id => { res[id] = ps[id].name || ''; });
        return res;
      },
    });
    return api;
  }

  // Elige el modo: dentro de claude.ai usa la base compartida; fuera, el navegador.
  async function iniciar() {
    const claude = root.claude;
    if (!claude || typeof claude.use !== 'function') return crearLocal();
    const [db, user] = await Promise.all([claude.use('db'), claude.use('user')]);
    if (!db) return { modo: 'sin-conexion' };
    return crearCompartido(db, user);
  }

  root.ValoAlmacen = { iniciar, crearLocal };
})(typeof window !== 'undefined' ? window : globalThis);
