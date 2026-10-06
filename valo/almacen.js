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
    if (!Array.isArray(datos.envios)) datos.envios = [];

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
      async guardarNocobisFlujo(cfg) { datos.nocobisFlujo = clonar(cfg); cambiar(); },
      async guardarPadronInventario(p) { datos.padronInventario = clonar(p); cambiar(); },
      async contarEntes() { return Object.keys(datos.entesBase || {}).length; },
      async buscarEntes(lista) { const b = datos.entesBase || {}, r = {}; lista.forEach(e => { if (b[e]) r[e] = { cuit: b[e][0], nombre: b[e][1] }; }); return r; },
      async guardarEntes(filas) { datos.entesBase = datos.entesBase || {}; filas.forEach(f => { datos.entesBase[String(f.ente)] = [f.cuit, f.nombre || '']; }); if (!guardar()) throw new Error('No entra en el almacenamiento de este navegador.'); ev.emitir(); },
      async registrarEnvio(e) { datos.envios.push(Object.assign({ id: nuevoId() }, clonar(e))); datos.envios = datos.envios.slice(-50); cambiar(); },
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
      // opciones.forzar: anula un lote que no es el último vigente, sin tocar la secuencia del cliente.
      async anularLote(loteId, cambios, opciones = {}) {
        const l = datos.lotes.find(x => x.id === loteId);
        Object.assign(l, cambios);
        const c = datos.clientes.find(x => x.id === l.clienteId);
        if (c && !opciones.forzar) c.ultimaSecuencia = l.secuenciaAnterior;
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
    const datos = { clientes: [], bancos: [], bancosMeli: [], lotes: [], carteraCfg: null, nocobisFlujo: null, envios: [], agenteNoCobis: null, padronInventario: null };
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
    // Configuración de la pestaña Cartera (columnas, estados pagos, etc.), la misma para todos.
    db.doc('maestros/carteraConfig').onSnapshot(s => {
      datos.carteraCfg = s.exists && s.data().cfg && typeof s.data().cfg === 'object' ? clonar(s.data().cfg) : null;
      emitirSiListo();
    }, alError);
    // Padrón de los inventarios de garantías (CUIT por ente, fecha de cada garantía), el mismo para todos.
    db.doc('maestros/inventarioPadron').onSnapshot(s => {
      datos.padronInventario = s.exists && s.data().padron && typeof s.data().padron === 'object' ? clonar(s.data().padron) : null;
      emitirSiListo();
    }, alError);
    // Conexión con el flujo de Power Automate para el envío NO COBIS (dirección y clave compartida).
    // Cola de envíos NO COBIS (los toma el agente de la red) y última señal del agente.
    db.collection('envios').onSnapshot(s => {
      datos.envios = s.docs.map(d => Object.assign({ id: d.id }, d.data()))
        .sort((a, b) => String(b.creado || b.fecha || '').localeCompare(String(a.creado || a.fecha || '')));
      emitirSiListo();
    }, alError);
    db.doc('maestros/agenteNoCobis').onSnapshot(s => {
      datos.agenteNoCobis = s.exists ? clonar(s.data()) : null;
      emitirSiListo();
    }, alError);
    db.doc('maestros/nocobisFlujo').onSnapshot(s => {
      datos.nocobisFlujo = s.exists ? clonar(s.data()) : null;
      emitirSiListo();
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
      async guardarNocobisFlujo(cfg) {
        await escribir(() => db.doc('maestros/nocobisFlujo').set(Object.assign(clonar(cfg), { actualizado: new Date().toISOString(), actualizadoPor: usuarioId })));
      },
      async encolarEnvio(e) {
        const id = nuevoId();
        await escribir(() => db.doc('envios/' + id).set(Object.assign(clonar(e), { estado: 'pendiente', creado: new Date().toISOString(), usuarioId })));
        return id;
      },
      async actualizarEnvio(id, cambios) { await escribir(() => db.doc('envios/' + id).update(clonar(cambios))); },
      async registrarEnvio(e) {
        const id = nuevoId();
        await escribir(() => db.doc('envios/' + id).set(Object.assign(clonar(e), { usuarioId })));
      },
      async guardarPadronInventario(p) {
        await escribir(() => db.doc('maestros/inventarioPadron').set({ padron: clonar(p), actualizado: new Date().toISOString(), actualizadoPor: usuarioId }));
      },
      async guardarCfgCartera(cfg) {
        await escribir(() => db.doc('maestros/carteraConfig').set({ cfg: clonar(cfg), actualizado: new Date().toISOString(), actualizadoPor: usuarioId }));
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
      // opciones.forzar: anula un lote que no es el último vigente, sin tocar la secuencia del cliente.
      async anularLote(loteId, cambios, opciones = {}) {
        const lote = datos.lotes.find(l => l.id === loteId);
        if (opciones.forzar) {
          await escribir(() => db.doc('lotes/' + loteId).update(Object.assign({}, cambios, { anuladoPor: usuarioId })));
          return;
        }
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

  // ============================================================ SUPABASE
  // Sitio propio (GitHub Pages) con la base en Supabase. Se arma una capa con la misma forma que la base de
  // claude.ai (doc / collection / onSnapshot / acquire) para reutilizar crearCompartido sin cambios.

  const COLECCIONES_VIVAS = ['clientes', 'lotes', 'maestros', 'envios'];
  const coleccionDe = path => String(path).split('/')[0];
  const padreDe = path => String(path).split('/').slice(0, -1).join('/');

  function errorSupabase(error) {
    if (!error) return null;
    const code = error.code === '42501' ? 'invalid_argument' : /fetch|network|Failed to/i.test(error.message || '') ? 'unavailable' : error.code;
    const e = new Error(error.message || 'Error de la base');
    e.code = code;
    return e;
  }

  function crearDbSupabase(sb) {
    const cache = new Map(); // path → data (solo colecciones vivas)
    const oyentes = new Set();
    const avisar = () => oyentes.forEach(fn => { try { fn(); } catch (e) { console.error(e); } });
    let cargado = null;

    async function leerColeccion(col) {
      const filas = [];
      for (let desde = 0; ; desde += 1000) {
        const { data, error } = await sb.from('docs').select('path,data').eq('coleccion', col).order('path').range(desde, desde + 999);
        if (error) throw errorSupabase(error);
        filas.push(...data);
        if (data.length < 1000) break;
      }
      return filas;
    }
    async function recargar() {
      const todas = await Promise.all(COLECCIONES_VIVAS.map(leerColeccion));
      cache.clear();
      todas.flat().forEach(f => cache.set(f.path, f.data));
      avisar();
    }
    function asegurar() {
      if (!cargado) {
        cargado = recargar();
        sb.channel('valo-docs')
          .on('postgres_changes', { event: '*', schema: 'public', table: 'docs' }, ev => {
            const fila = ev.eventType === 'DELETE' ? ev.old : ev.new;
            if (!fila || !fila.path || !COLECCIONES_VIVAS.includes(coleccionDe(fila.path))) return;
            if (ev.eventType === 'DELETE') cache.delete(fila.path);
            else if (fila.data) cache.set(fila.path, fila.data);
            else return recargar().catch(() => {});
            avisar();
          })
          .subscribe(estado => { if (estado === 'SUBSCRIBED') recargar().catch(() => {}); });
        // Por las dudas (reconexiones, pestaña dormida): se relee al volver a la pestaña.
        if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => { if (!document.hidden) recargar().catch(() => {}); });
      }
      return cargado;
    }
    const snapDoc = path => ({ id: path.split('/').pop(), exists: cache.has(path), data: () => clonar(cache.get(path)) });
    const docsDe = col => [...cache.keys()].filter(k => padreDe(k) === col).sort().map(snapDoc);

    function doc(path) {
      const viva = COLECCIONES_VIVAS.includes(coleccionDe(path));
      return {
        id: path.split('/').pop(), path,
        async get() {
          const { data, error } = await sb.from('docs').select('data').eq('path', path).maybeSingle();
          if (error) throw errorSupabase(error);
          return { id: path.split('/').pop(), exists: !!data, data: () => data && clonar(data.data) };
        },
        async set(d) {
          const { error } = await sb.from('docs').upsert({ path, coleccion: coleccionDe(path), data: d, actualizado: new Date().toISOString() });
          if (error) throw errorSupabase(error);
          if (viva) { cache.set(path, clonar(d)); avisar(); }
        },
        async update(cambios) {
          const { error } = await sb.rpc('doc_update', { p_path: path, p_patch: cambios });
          if (error) throw errorSupabase(error);
          if (viva && cache.has(path)) { cache.set(path, Object.assign(clonar(cache.get(path)), clonar(cambios))); avisar(); }
        },
        async delete() {
          const { error } = await sb.from('docs').delete().eq('path', path);
          if (error) throw errorSupabase(error);
          if (viva) { cache.delete(path); avisar(); }
        },
        async acquire({ holder, ttlMs }) {
          const { data, error } = await sb.rpc('adquirir', { p_path: path, p_holder: holder, p_ttl_ms: ttlMs || 15000 });
          if (error) throw errorSupabase(error);
          return { acquired: data === true };
        },
        onSnapshot(fn, alError) {
          const l = () => fn(snapDoc(path));
          oyentes.add(l);
          asegurar().then(l, e => alError && alError(e));
          return () => oyentes.delete(l);
        },
      };
    }
    function collection(col, filtros = [], orden = null) {
      const correr = docs => {
        let r = docs.filter(d => filtros.every(([f, op, v]) => op !== '==' || d.data()[f] === v));
        if (orden) r = r.sort((a, b) => String(a.data()[orden[0]] ?? '').localeCompare(String(b.data()[orden[0]] ?? '')) * (orden[1] === 'desc' ? -1 : 1));
        return { docs: r, size: r.length, empty: !r.length };
      };
      return {
        where: (f, op, v) => collection(col, filtros.concat([[f, op, v]]), orden),
        orderBy: (f, dir) => collection(col, filtros, [f, dir || 'asc']),
        async get() {
          const filas = await leerColeccion(col);
          return correr(filas.map(f => ({ id: f.path.split('/').pop(), exists: true, data: () => clonar(f.data) })));
        },
        onSnapshot(fn, alError) {
          const l = () => fn(correr(docsDe(col)));
          oyentes.add(l);
          asegurar().then(l, e => alError && alError(e));
          return () => oyentes.delete(l);
        },
        doc: id => doc(col + '/' + id),
      };
    }
    // Importación masiva (migración desde claude.ai): [{ path, data }].
    async function importar(docs, progreso) {
      for (let i = 0; i < docs.length; i += 100) {
        const lote = docs.slice(i, i + 100).map(d => ({ path: d.path, coleccion: coleccionDe(d.path), data: d.data, actualizado: new Date().toISOString() }));
        const { error } = await sb.from('docs').upsert(lote);
        if (error) throw errorSupabase(error);
        if (progreso) progreso(Math.min(i + 100, docs.length), docs.length);
      }
      await recargar();
    }
    return { doc, collection, importar };
  }

  function crearUsuarioSupabase(sb, sesion) {
    const u = sesion.user;
    return {
      async id() { return u.id; },
      async can() {
        const { data, error } = await sb.rpc('es_valo');
        return error ? null : data === true;
      },
      async profiles(ids) {
        const { data } = await sb.from('perfiles').select('id,nombre,email').in('id', ids);
        const res = {};
        (data || []).forEach(p => { res[p.id] = { id: p.id, name: p.nombre || p.email || '' }; });
        return res;
      },
    };
  }

  async function iniciarSupabase(cfg) {
    const sb = root.supabase.createClient(cfg.url, cfg.anonKey, { auth: { persistSession: true, autoRefreshToken: true } });
    const { data } = await sb.auth.getSession();
    const sesion = data && data.session;
    const cuenta = {
      async ingresar(email, clave) {
        const { error } = await sb.auth.signInWithPassword({ email: String(email).trim(), password: clave });
        if (error) throw new Error(/invalid/i.test(error.message) ? 'Correo o contraseña incorrectos.' : error.message);
      },
      async salir() { await sb.auth.signOut(); },
      // Token de la sesión actual (para que el archivo de envío informe el resultado en la base).
      async rpc(nombre, args) { const { data, error } = await sb.rpc(nombre, args); if (error) throw new Error(error.message || String(error)); return data; },
      async tokenSesion() { const { data } = await sb.auth.getSession(); return data && data.session ? data.session.access_token : ''; },
      async cambiarClave(nueva) {
        const { error } = await sb.auth.updateUser({ password: nueva });
        if (error) throw new Error(error.message);
      },
    };
    if (!sesion) return Object.assign({ modo: 'login' }, cuenta);
    const email = sesion.user.email || '';
    sb.from('perfiles').upsert({ id: sesion.user.id, email, nombre: email.split('@')[0] }).then(() => {}, () => {});
    const db = crearDbSupabase(sb);
    const api = await crearCompartido(db, crearUsuarioSupabase(sb, sesion));
    // Base de entes (tabla entes): ente → CUIT y nombre, para los inventarios de garantías.
    const entes = {
      async contarEntes() {
        const { count, error } = await sb.from('entes').select('ente', { count: 'exact', head: true });
        if (error) throw new Error(error.message);
        return count || 0;
      },
      async buscarEntes(lista) {
        const r = {};
        const unicos = [...new Set(lista.map(String))];
        for (let i = 0; i < unicos.length; i += 200) {
          const { data, error } = await sb.from('entes').select('ente,cuit,nombre').in('ente', unicos.slice(i, i + 200));
          if (error) throw new Error(error.message);
          (data || []).forEach(x => { r[x.ente] = { cuit: x.cuit, nombre: x.nombre }; });
        }
        return r;
      },
      async guardarEntes(filas, progreso) {
        const ahora = new Date().toISOString();
        for (let i = 0; i < filas.length; i += 1000) {
          const lote = filas.slice(i, i + 1000).map(f => ({ ente: String(f.ente), cuit: f.cuit, nombre: f.nombre || null, tipo: f.tipo || null, actualizado: ahora }));
          const { error } = await sb.from('entes').upsert(lote);
          if (error) throw new Error(/entes/.test(error.message) && /exist|schema cache/i.test(error.message)
            ? 'Falta la tabla de entes en la base: ejecutá la última versión de supabase/esquema.sql en el SQL Editor.' : error.message);
          if (progreso) progreso(Math.min(i + 1000, filas.length), filas.length);
        }
      },
    };
    return Object.assign(api, cuenta, entes, { proveedor: 'supabase', descargaLibre: true, email, importarDocs: db.importar });
  }

  // Elige el modo: sitio propio con Supabase; dentro de claude.ai, su base compartida; si no, el navegador.
  async function iniciar() {
    if (root.VALO_WEB) {
      const cfg = root.VALO_SUPABASE;
      if (!cfg || !cfg.url || !cfg.anonKey || !root.supabase) return { modo: 'sin-configurar' };
      return iniciarSupabase(cfg);
    }
    const claude = root.claude;
    if (!claude || typeof claude.use !== 'function') return crearLocal();
    const [db, user] = await Promise.all([claude.use('db'), claude.use('user')]);
    if (!db) return { modo: 'sin-conexion' };
    return crearCompartido(db, user);
  }

  root.ValoAlmacen = { iniciar, crearLocal };
})(typeof window !== 'undefined' ? window : globalThis);
