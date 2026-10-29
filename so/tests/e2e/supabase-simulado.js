// Supabase simulado: persistente en localStorage (sobrevive recargas), multiusuario, RLS simplificada y fallas inyectables.
(function () {
  const KEY = 'fake.db';
  const TABLAS = ['so_projects','so_datasources','so_records','so_artifacts','so_artifact_versions','so_menu','so_shares','so_chats','so_messages','so_decisions','so_signals','so_obs','so_tasks','so_notifications','so_user_state','so_events'];
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || null; } catch { return null; } };
  let db = load() || Object.fromEntries(TABLAS.map((t) => [t, []]));
  db.__seq ||= 1;
  const save = () => localStorage.setItem(KEY, JSON.stringify(db));
  window.__db = () => db;
  const USERS = { a: { id: '00000000-0000-0000-0000-00000000000a', email: 'd.semino83@gmail.com' }, b: { id: '00000000-0000-0000-0000-00000000000b', email: 'ana@empresa.com' } };
  const user = () => USERS[localStorage.getItem('fake.user') || 'a'];
  const ownerTables = new Set(TABLAS.filter((t) => !['so_artifact_versions'].includes(t)));
  const fallar = (k) => (JSON.parse(localStorage.getItem('fake.fallar') || '[]')).includes(k);
  const now = () => new Date().toISOString();
  const numericId = new Set(['so_records','so_messages','so_decisions','so_signals','so_obs','so_artifact_versions','so_notifications','so_events']);
  function snap(a) { db.so_artifact_versions.push({ id: db.__seq++, artifact_id: a.id, owner_id: a.owner_id, version: a.version, snapshot: JSON.parse(JSON.stringify(a)), created_at: now() }); }
  function permiso(aid) {
    const a = db.so_artifacts.find((x) => x.id === aid && !x.deleted_at);
    if (!a) return null;
    if (a.owner_id === user().id && user().email === 'd.semino83@gmail.com') return 'OWNER';
    const s = db.so_shares.find((x) => x.artifact_id === aid && !x.revoked_at && x.grantee_email.toLowerCase() === user().email && a.state === 'published');
    return s ? s.permission : null;
  }
  function builder(table) {
    const st = { op: 'select', filters: [], row: null, single: false, maybe: false, order: [], head: false, count: false, upsert: null, limit: null };
    const visible = (r) => !ownerTables.has(table) || (table === 'so_obs' ? true : r.owner_id === user().id) || (table === 'so_user_state' && r.owner_id === user().id);
    const run = () => {
      if (fallar(`${table}.${st.op}`)) return { data: null, error: { message: 'Failed to fetch' } };
      if (user().email !== 'd.semino83@gmail.com' && ownerTables.has(table) && table !== 'so_obs') return st.op === 'select' ? { data: st.single ? null : [], error: null, count: 0 } : { data: null, error: { message: 'new row violates row-level security policy' } };
      const match = (r) => visible(r) && st.filters.every((f) => f(r));
      let data;
      if (st.op === 'insert' || st.op === 'upsert') {
        const rows = (Array.isArray(st.row) ? st.row : [st.row]);
        const out = [];
        for (const r0 of rows) {
          const r = { owner_id: user().id, ...r0 };
          if (table === 'so_records') { const ds = db.so_datasources.find((d) => d.id === r.datasource_id); r.owner_id = ds.owner_id;
            for (const k of Object.keys(r.data)) { const f = ds.fields.find((x) => x.key === k); if (!f) return { data: null, error: { message: `campo desconocido: ${k}` } }; if (f.type === 'number' && typeof r.data[k] !== 'number') return { data: null, error: { message: `el campo ${k} debe ser numérico` } }; } }
          if (st.op === 'upsert') {
            const cols = (st.upsert?.onConflict || (table === 'so_user_state' ? 'owner_id,key' : 'id')).split(',');
            const prev = db[table].find((x) => cols.every((c) => x[c] === r[c]));
            if (prev) { if (!st.upsert?.ignoreDuplicates) Object.assign(prev, r); out.push(prev); continue; }
          }
          const nuevo = { id: r.id ?? (numericId.has(table) ? db.__seq++ : crypto.randomUUID()), created_at: now(), updated_at: now(), deleted_at: null, revoked_at: null, read_at: null, ...r };
          if (table === 'so_artifacts') nuevo.version = 1;
          if (table === 'so_menu') Object.assign(nuevo, { favorite: false, open_count: 0, last_opened_at: null, status: 'available', ...r });
          if (table === 'so_tasks') nuevo.checkpoint ||= {};
          db[table].push(nuevo); out.push(nuevo);
          if (table === 'so_artifacts') snap(nuevo);
        }
        data = st.single ? out[0] : out;
      } else if (st.op === 'update') {
        data = db[table].filter(match);
        for (const r of data) {
          const antes = JSON.stringify([r.specification, r.schema, r.configuration, r.name, r.state]);
          Object.assign(r, st.row);
          if (table === 'so_artifacts' && antes !== JSON.stringify([r.specification, r.schema, r.configuration, r.name, r.state])) { r.version++; r.updated_at = now(); snap(r); }
        }
      } else if (st.op === 'delete') {
        data = db[table].filter(match); db[table] = db[table].filter((r) => !match(r));
      } else {
        data = db[table].filter(match);
        for (const o of [...st.order].reverse()) data = [...data].sort((a, b) => (a[o.c] > b[o.c] ? 1 : a[o.c] < b[o.c] ? -1 : 0) * (o.asc ? 1 : -1));
        if (st.limit) data = data.slice(0, st.limit);
      }
      save();
      const count = Array.isArray(data) ? data.length : null;
      if (st.head) return { data: null, error: null, count };
      if (st.single && st.op === 'select') data = data[0] ?? null;
      if (st.single && Array.isArray(data)) data = data[0] ?? null;
      return { data: JSON.parse(JSON.stringify(data)), error: null, count };
    };
    const b = {
      select(_c, o) { if (o?.head) st.head = true; return b; },
      insert(row) { st.op = 'insert'; st.row = row; return b; },
      upsert(row, o) { st.op = 'upsert'; st.row = row; st.upsert = o; return b; },
      update(row) { st.op = 'update'; st.row = row; return b; },
      delete() { st.op = 'delete'; return b; },
      eq(c, v) { st.filters.push((r) => r[c] === v); return b; },
      is(c, v) { st.filters.push((r) => (r[c] ?? null) === v); return b; },
      in(c, v) { st.filters.push((r) => v.includes(r[c])); return b; },
      ilike(c, v) { st.filters.push((r) => String(r[c]).toLowerCase() === v.toLowerCase()); return b; },
      order(c, o) { st.order.push({ c, asc: o?.ascending !== false }); return b; },
      limit(n) { st.limit = n; return b; },
      single() { st.single = true; return b; },
      maybeSingle() { st.single = true; return b; },
      then(res, rej) { return new Promise((r) => setTimeout(r, 5)).then(run).then(res, rej); },
    };
    return b;
  }
  const rpc = async (fn, a = {}) => {
    await new Promise((r) => setTimeout(r, 5));
    const ok = (data) => { save(); return { data: JSON.parse(JSON.stringify(data ?? null)), error: null }; };
    const err = (m) => ({ data: null, error: { message: m } });
    switch (fn) {
      case 'es_valo': return ok(user().email === 'd.semino83@gmail.com');
      case 'so_shared_list': return ok(db.so_shares.filter((s) => !s.revoked_at && s.grantee_email === user().email).map((s) => { const x = db.so_artifacts.find((y) => y.id === s.artifact_id); return { id: x.id, name: x.name, type: x.type, permission: s.permission }; }));
      case 'so_compartir': {
        if (permiso(a.p_artifact) !== 'OWNER') return err('sin permiso');
        const prev = db.so_shares.find((s) => s.artifact_id === a.p_artifact && s.grantee_email === a.p_email && !s.revoked_at);
        if (prev) { prev.permission = a.p_permission; return ok(prev.id); }
        const s = { id: crypto.randomUUID(), artifact_id: a.p_artifact, owner_id: user().id, grantee_email: a.p_email, permission: a.p_permission, created_at: now(), revoked_at: null };
        db.so_shares.push(s); return ok(s.id);
      }
      case 'so_revocar': { const s = db.so_shares.find((x) => x.id === a.p_share); if (!s || permiso(s.artifact_id) !== 'OWNER') return err('sin permiso'); s.revoked_at = now(); return ok(null); }
      case 'so_restaurar_version': {
        const v = db.so_artifact_versions.find((x) => x.artifact_id === a.p_artifact && x.version === a.p_version); const art = db.so_artifacts.find((x) => x.id === a.p_artifact);
        Object.assign(art, { name: v.snapshot.name, specification: v.snapshot.specification, schema: v.snapshot.schema, configuration: v.snapshot.configuration }); art.version++; snap(art); return ok(art.version);
      }
      case 'so_abrir_artefacto': { const m = db.so_menu.find((x) => x.artifact_id === a.p_artifact && x.owner_id === user().id); if (m) { m.open_count++; m.last_opened_at = now(); } return ok(null); }
      case 'so_buscar': {
        const qy = a.p_q.toLowerCase(); const out = [];
        for (const r of db.so_records.filter((x) => x.owner_id === user().id)) if (JSON.stringify(r.data).toLowerCase().includes(qy)) {
          const art = db.so_artifacts.find((x) => x.datasource_id === r.datasource_id && !x.deleted_at); if (art) out.push({ kind: 'record', id: String(r.id), title: JSON.stringify(r.data), subtitle: `${art.name} · ${r.period}`, artifact_id: art.id });
        }
        return ok(out);
      }
      case 'so_shared_get': {
        const p = permiso(a.p_artifact); if (!p) return err('sin acceso');
        const art = db.so_artifacts.find((x) => x.id === a.p_artifact); const ds = db.so_datasources.find((d) => d.id === art.datasource_id);
        return ok({ id: art.id, name: art.name, type: art.type, version: art.version, permission: p, specification: art.specification, schema: art.schema,
          view: { grafico: art.configuration.grafico, metrica: art.configuration.metrica }, fields: ds.fields,
          records: db.so_records.filter((r) => r.datasource_id === art.datasource_id).map((r) => ({ id: r.id, period: r.period, data: r.data, created_at: r.created_at })) });
      }
      case 'so_shared_add_record': {
        const p = permiso(a.p_artifact); if (!['OWNER', 'USE', 'EDIT'].includes(p)) return err('sin permiso para cargar datos');
        const art = db.so_artifacts.find((x) => x.id === a.p_artifact);
        const r = { id: db.__seq++, datasource_id: art.datasource_id, owner_id: art.owner_id, period: a.p_period, data: a.p_data, created_at: now() };
        db.so_records.push(r); return ok(r.id);
      }
    }
    return ok(null);
  };
  window.supabase = { createClient() {
    return {
      auth: {
        onAuthStateChange(f) { setTimeout(() => f('SIGNED_IN', { user: user() }), 10); return { data: {} }; },
        getSession: async () => ({ data: { session: { user: user() } } }), signOut: async () => ({}), signInWithPassword: async () => ({}),
      },
      from: builder, rpc,
      functions: { invoke: async () => ({ data: null, error: { message: 'x', context: { status: 503 } } }) },
    };
  } };
})();
