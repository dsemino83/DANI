// Supabase simulado: persistente en localStorage (sobrevive recargas), multiusuario, RLS simplificada y fallas inyectables.
(function () {
  const KEY = 'fake.db';
  const TABLAS = ['so_projects','so_datasources','so_records','so_artifacts','so_artifact_versions','so_menu','so_shares','so_chats','so_messages','so_decisions','so_signals','so_obs','so_tasks','so_notifications','so_user_state','so_events',
    'so_files','so_file_chunks','so_data_inputs','so_api_sources','so_import_batches','so_ingest_log','so_automations','so_file_templates','so_mail_accounts','so_mails','so_mail_drafts'];
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || null; } catch { return null; } };
  let db = load() || Object.fromEntries(TABLAS.map((t) => [t, []]));
  for (const t of TABLAS) db[t] ||= [];
  db.__seq ||= 1;
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch { window.__sinCuota = true; } };   // el simulador persiste en localStorage
  window.__db = () => db;
  const USERS = { a: { id: '00000000-0000-0000-0000-00000000000a', email: 'd.semino83@gmail.com' }, b: { id: '00000000-0000-0000-0000-00000000000b', email: 'ana@empresa.com' } };
  const user = () => USERS[localStorage.getItem('fake.user') || 'a'];
  const ownerTables = new Set(TABLAS.filter((t) => !['so_artifact_versions'].includes(t)));
  const fallar = (k) => (JSON.parse(localStorage.getItem('fake.fallar') || '[]')).includes(k);
  const now = () => new Date().toISOString();
  // Igual que so_events_name_check (20261030140000_so_archivos_formatos.sql).
  const EVENTOS = ['time_to_first_value', 'time_to_result', 'task_completed', 'task_failed', 'retry', 'abandonment', 'artifact_reuse', 'search_success', 'search_miss',
    'share_success', 'recovery_success', 'undo', 'preview_confirmed', 'preview_cancelled', 'download', 'pin_to_workspace'];
  const numericId = new Set(['so_records','so_messages','so_decisions','so_signals','so_obs','so_artifact_versions','so_notifications','so_events','so_file_chunks','so_ingest_log']);
  function snap(a) { db.so_artifact_versions.push({ id: db.__seq++, artifact_id: a.id, owner_id: a.owner_id, version: a.version, snapshot: JSON.parse(JSON.stringify(a)), created_at: now() }); }
  function permiso(aid) {
    const a = db.so_artifacts.find((x) => x.id === aid && !x.deleted_at);
    if (!a) return null;
    if (a.owner_id === user().id && user().email === 'd.semino83@gmail.com') return 'OWNER';
    const s = db.so_shares.find((x) => x.artifact_id === aid && !x.revoked_at && x.grantee_email.toLowerCase() === user().email && a.state === 'published');
    return s ? s.permission : null;
  }
  function builder(tabla) {
    const table = tabla === 'so_espacios' ? 'so_projects' : tabla;   // la vista so_espacios es so_projects con RLS (memory → memoria)
    const st = { op: 'select', filters: [], row: null, single: false, maybe: false, order: [], head: false, count: false, upsert: null, limit: null };
    const visible = (r) => !ownerTables.has(table) || (table === 'so_obs' ? true : r.owner_id === user().id) || (table === 'so_user_state' && r.owner_id === user().id);
    const run = () => {
      (window.__consultas ||= {})[`${table}.${st.op}`] = (window.__consultas[`${table}.${st.op}`] || 0) + 1;   // para medir consultas
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
            if (prev) { if (!st.upsert?.ignoreDuplicates) { Object.assign(prev, r); out.push(prev); } continue; }
          }
          const nuevo = { id: r.id ?? (numericId.has(table) ? db.__seq++ : crypto.randomUUID()), created_at: now(), updated_at: now(), deleted_at: null, revoked_at: null, read_at: null, ...r };
          if (table === 'so_artifacts') nuevo.version = 1;
          if (table === 'so_files' && nuevo.storage_path && !nuevo.storage_path.startsWith(`${user().id}/${nuevo.id}/`)) return { data: null, error: { message: 'violates check constraint' } };
          if (table === 'so_files') Object.assign(nuevo, { version: nuevo.version || 1, retention: nuevo.retention || 'temporary', meta: nuevo.meta || {} });
          if (table === 'so_import_batches') Object.assign(nuevo, { status: 'importing', rows_accepted: 0, rows_rejected: 0, rows_superseded: 0, errors: [], started_at: now(), user_id: user().id, ...r });
          if (table === 'so_api_sources' && r.auth_ref) return { data: null, error: { message: 'la credencial se guarda solo con so_api_guardar_secreto' } };
          if (table === 'so_api_sources') Object.assign(nuevo, { status: 'draft', auth_scheme: r.auth_scheme || 'none', parameters: {}, headers: {}, response_mapping: {}, retry_policy: { max: 2 }, timeout_ms: 10000, last_sync_at: null, ...r });
          if (table === 'so_menu') Object.assign(nuevo, { favorite: false, open_count: 0, last_opened_at: null, status: 'available', ord: 0, size: 'M', preview: null, ...r });
          if (table === 'so_automations') Object.assign(nuevo, { enabled: true, schedule: null, next_run_at: null, runs: 0, ...r });   // defaults de las migraciones
          if (table === 'so_menu' && !['S', 'M', 'L'].includes(nuevo.size)) return { data: null, error: { message: 'violates check constraint so_menu_size_check' } };
          if (table === 'so_tasks') nuevo.checkpoint ||= {};
          if (table === 'so_tasks' && r.idempotency_key && db.so_tasks.some((x) => x.owner_id === nuevo.owner_id && x.idempotency_key === r.idempotency_key)) return { data: null, error: { message: 'duplicate key value violates unique constraint' } };
          if (table === 'so_files') { nuevo.origin ||= 'upload'; if (!['upload', 'generated', 'export', 'api', 'connector'].includes(nuevo.origin)) return { data: null, error: { message: 'violates check constraint so_files_origin_check' } }; }
          if (table === 'so_files' && !r.version_of) { const prev = db.so_files.filter((f) => f.owner_id === nuevo.owner_id && f.safe_name.toLowerCase() === nuevo.safe_name.toLowerCase() && (f.project_id ?? null) === (nuevo.project_id ?? null) && f.checksum !== nuevo.checksum).sort((x, y) => y.version - x.version)[0]; if (prev) { nuevo.version_of = prev.id; nuevo.version = prev.version + 1; } }
          if (table === 'so_file_templates' && !['xlsx', 'csv', 'json', 'xml', 'pdf', 'docx', 'pptx', 'rtf', 'txt', 'md', 'png', 'jpg', 'webp'].includes(r.formato)) return { data: null, error: { message: 'violates check constraint' } };
          if (table === 'so_events' && !EVENTOS.includes(r.name)) { (window.__eventosRechazados ||= []).push(r.name); return { data: null, error: { message: 'violates check constraint so_events_name_check' } }; }
          db[table].push(nuevo); out.push(nuevo);
          if (table === 'so_artifacts') snap(nuevo);
        }
        data = st.single ? out[0] : out;
      } else if (st.op === 'update') {
        data = db[table].filter(match);
        if (table === 'so_menu' && st.row.size && !['S', 'M', 'L'].includes(st.row.size)) return { data: null, error: { message: 'violates check constraint so_menu_size_check' } };
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
        if (st.rango) data = data.slice(st.rango[0], st.rango[1] + 1);
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
      neq(c, v) { st.filters.push((r) => r[c] !== v); return b; },
      not(c, op, v) {   // como PostgREST: not.is.null, not.in.(a,b), not.eq.x
        const lista = op === 'in' ? String(v).replace(/^\(|\)$/g, '').split(',').map((z) => z.trim()) : null;
        st.filters.push((r) => (lista ? !lista.includes(String(r[c])) : (r[c] ?? null) !== v)); return b; },
      in(c, v) { st.filters.push((r) => v.includes(r[c])); return b; },
      ilike(c, v) { st.filters.push((r) => String(r[c]).toLowerCase() === v.toLowerCase()); return b; },
      order(c, o) { st.order.push({ c, asc: o?.ascending !== false }); return b; },
      limit(n) { st.limit = n; return b; },
      range(a, z) { st.rango = [a, z]; return b; },
      single() { st.single = true; return b; },
      maybeSingle() { st.single = true; return b; },
      then(res, rej) { return new Promise((r) => setTimeout(r, 5)).then(run).then(res, rej); },
    };
    return b;
  }
  // so-correo simulado: "Google" aprueba al instante y la casilla tiene unos mails de ejemplo (como la Edge Function, la
  // página no escribe estas tablas: lo hace el servidor fijando el dueño).
  const fnCorreo = async (b = {}) => {
    await new Promise((r) => setTimeout(r, 5));
    const u = user(); const ok = (data) => { save(); return { data, error: null }; };
    const err = (m) => ({ data: null, error: { message: m, context: { json: async () => ({ error: m }) } } });
    if (b.accion === 'iniciar') {
      if (!/^http:\/\/localhost/.test(b.volver || '')) return err('origen no permitido');
      if (!db.so_mail_accounts.some((c) => c.owner_id === u.id && c.status !== 'desconectada')) db.so_mail_accounts.push({ id: crypto.randomUUID(), owner_id: u.id, provider: 'gmail', email: u.email, status: 'conectada', last_sync_at: null, last_error: null, created_at: now(), scopes: [] });
      return ok({ url: `${b.volver}#/correo?ok=1` });
    }
    const c = db.so_mail_accounts.find((x) => x.owner_id === u.id && x.status !== 'desconectada');
    if (!c) return err('No tenés una casilla conectada.');
    if (b.accion === 'sincronizar') {
      const dia = (d, h) => new Date(Date.now() - d * 864e5 + h * 36e5).toISOString();
      const ej = [['g1', 't1', 'ana@cliente.com', 'Ana Pérez', 'Cotización', dia(3, 0), false, true], ['g2', 't1', u.email, null, 'Re: Cotización', dia(3, 2), true, false],
        ['g3', 't2', 'luis@cliente.com', 'Luis Gómez', 'Reclamo de entrega', dia(1, 0), false, true], ['g4', 't3', 'no-reply@banco.com', 'Banco', 'Resumen de cuenta', dia(1, 1), false, false],
        ['g5', 't4', 'ana@cliente.com', 'Ana Pérez', 'Nuevo pedido', dia(0, -2), false, true]];
      let nuevos = 0;
      for (const [g, t, de, nom, asu, at, out, unread] of ej) if (!db.so_mails.some((m) => m.account_id === c.id && m.gmail_id === g)) {
        db.so_mails.push({ id: crypto.randomUUID(), owner_id: u.id, account_id: c.id, gmail_id: g, thread_id: t, message_id: `<${g}@x>`, from_addr: de, from_name: nom, to_addrs: [], subject: asu, snippet: `Texto de ${asu}`, body: '', received_at: at, labels: out ? ['SENT'] : ['INBOX', ...(unread ? ['UNREAD'] : [])], unread, outbound: out, has_attachments: false, created_at: now() }); nuevos++;
      }
      c.last_sync_at = now();
      return ok({ email: c.email, revisados: ej.length, nuevos });
    }
    if (b.accion === 'borrador') {
      const m = db.so_mails.find((x) => x.id === b.mail && x.owner_id === u.id);
      if (!m) return err('no encontré ese mail');
      db.so_mail_drafts.push({ id: crypto.randomUUID(), owner_id: u.id, account_id: c.id, mail_id: m.id, to_addr: m.from_addr, subject: m.subject, body: b.texto, status: 'creado', gmail_draft_id: 'd' + db.__seq++, created_at: now() });
      return ok({ borrador: 'd', para: m.from_addr, asunto: m.subject });
    }
    if (b.accion === 'desconectar') { db.so_mails = db.so_mails.filter((m) => m.account_id !== c.id); c.status = 'desconectada'; return ok({ desconectada: c.email }); }
    return err('acción desconocida');
  };
  const rpc = async (fn, a = {}) => {
    await new Promise((r) => setTimeout(r, 5));
    const ok = (data) => { save(); return { data: JSON.parse(JSON.stringify(data ?? null)), error: null }; };
    const err = (m) => ({ data: null, error: { message: m } });
    switch (fn) {
      case 'es_valo': return ok(user().email === 'd.semino83@gmail.com');
      case 'so_usuario_habilitado': return ok(Object.values(USERS).some((u) => u.id === a.p_user && u.email === 'd.semino83@gmail.com'));
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
        for (const f of db.so_files.filter((x) => x.owner_id === user().id)) if (f.original_name.toLowerCase().includes(qy) || db.so_file_chunks.some((k) => k.file_id === f.id && k.content.toLowerCase().includes(qy)))
          out.push({ kind: 'file', id: f.id, title: f.original_name, subtitle: `${f.detected_type} · v${f.version}`, artifact_id: f.artifact_id });
        return ok(out);
      }
      case 'so_aplicar_estrategia': {
        const b = db.so_import_batches.find((x) => x.id === a.p_batch); let n = 0;
        for (const r of db.so_records.filter((x) => x.datasource_id === b.dataset_id && !x.superseded_by && x.import_batch_id !== b.id)) {
          if (b.strategy === 'REPLACE' || b.strategy === 'UPSERT' && db.so_records.some((y) => y.import_batch_id === b.id && y.data[b.key_field] === r.data[b.key_field])) { r.superseded_by = b.id; n++; }
        }
        b.rows_superseded = n; return ok(n);
      }
      case 'so_deshacer_importacion': {
        const b = db.so_import_batches.find((x) => x.id === a.p_batch && x.owner_id === user().id); if (!b) return err('lote inexistente o sin permiso');
        const antes = db.so_records.length; db.so_records = db.so_records.filter((r) => r.import_batch_id !== b.id);
        let reac = 0; for (const r of db.so_records) if (r.superseded_by === b.id) { r.superseded_by = null; reac++; }
        b.status = 'undone'; return ok({ quitadas: antes - db.so_records.length, reactivadas: reac });
      }
      case 'so_origen_registro': {
        const r = db.so_records.find((x) => x.id === a.p_record && x.owner_id === user().id); if (!r) return ok(null);
        const b = db.so_import_batches.find((x) => x.id === r.import_batch_id); const f = b && db.so_files.find((x) => x.id === b.source_file_id); const api = b && db.so_api_sources.find((x) => x.id === b.api_source_id);
        return ok({ registro: r.id, periodo: r.period, cargado: r.created_at, activo: !r.superseded_by, ref: r.source_ref, dataset: db.so_datasources.find((d) => d.id === r.datasource_id).name,
          lote: b ? { id: b.id, estrategia: b.strategy, origen: b.source_type, nombre: b.source_name, fecha: b.started_at, estado: b.status } : null,
          archivo: f ? { id: f.id, nombre: f.original_name, version: f.version } : null, api: api ? { nombre: api.name, host: new URL(api.base_url).hostname } : null, por: user().email });
      }
      case 'so_api_guardar_secreto': { const s = db.so_api_sources.find((x) => x.id === a.p_source && x.owner_id === user().id); if (!s) return err('sin permiso'); s.auth_ref = crypto.randomUUID(); (db.__vault ||= {})[s.auth_ref] = '***'; return ok(null); }
      case 'so_buscar_fragmentos': {
        const qs = String(a.p_q).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/\W+/).filter((w) => w.length > 3);
        return ok(db.so_file_chunks.filter((k) => a.p_files.includes(k.file_id) && k.owner_id === user().id)
          .map((k) => ({ ...k, rank: qs.filter((w) => k.content.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').includes(w)).length })).sort((x, y) => y.rank - x.rank).slice(0, a.p_limit || 6));
      }
      case 'so_shared_importar': {
        const p = permiso(a.p_artifact); const art = db.so_artifacts.find((x) => x.id === a.p_artifact);
        if (!(p === 'OWNER' || p === 'EDIT' || p === 'USE' && art.permissions?.shared_input)) return err('sin permiso para cargar datos');
        let b = db.so_import_batches.find((x) => x.id === a.p_lote);
        if (!b) {
          if (!a.p_forzar && db.so_import_batches.some((x) => x.dataset_id === art.datasource_id && x.checksum === a.p_checksum && ['importing', 'ready', 'partial'].includes(x.status))) return ok({ duplicado: true });
          b = { id: a.p_lote, owner_id: art.owner_id, dataset_id: art.datasource_id, artifact_id: art.id, user_id: user().id, source_type: 'shared', strategy: 'APPEND', checksum: a.p_checksum, source_name: a.p_nombre, status: 'importing', rows_accepted: 0, rows_rejected: 0, rows_received: 0, errors: [], started_at: now() };
          db.so_import_batches.push(b);
        }
        for (const f of a.p_filas) { db.so_records.push({ id: db.__seq++, datasource_id: art.datasource_id, owner_id: art.owner_id, period: f.period, data: f.data, import_batch_id: b.id, source_ref: { fila: f.fila }, idempotency_key: `${b.id}:${f.fila}`, superseded_by: null, created_at: now() }); b.rows_accepted++; }
        b.rows_rejected += (a.p_rechazadas || []).length; b.errors.push(...(a.p_rechazadas || []));
        if (a.p_final) b.status = b.rows_rejected ? 'partial' : 'ready';
        return ok({ lote: b.id, aceptadas: b.rows_accepted, rechazadas: b.rows_rejected, estado: b.status });
      }
      case 'so_shared_get': {
        const p = permiso(a.p_artifact); if (!p) return err('sin acceso');
        const art = db.so_artifacts.find((x) => x.id === a.p_artifact); const ds = db.so_datasources.find((d) => d.id === art.datasource_id);
        return ok({ id: art.id, name: art.name, type: art.type, version: art.version, permission: p, puede_cargar: p === 'OWNER' || p === 'EDIT' || p === 'USE' && !!art.permissions?.shared_input, specification: art.specification, schema: art.schema,
          view: { grafico: art.configuration.grafico, metrica: art.configuration.metrica }, fields: ds.fields,
          records: db.so_records.filter((r) => r.datasource_id === art.datasource_id && !r.superseded_by).map((r) => ({ id: r.id, period: r.period, data: r.data, created_at: r.created_at })) });
      }
      case 'so_shared_add_record': {
        const p = permiso(a.p_artifact); const art0 = db.so_artifacts.find((x) => x.id === a.p_artifact);
        if (!(p === 'OWNER' || p === 'EDIT' || p === 'USE' && art0?.permissions?.shared_input)) return err('sin permiso para cargar datos');
        const art = db.so_artifacts.find((x) => x.id === a.p_artifact);
        const r = { id: db.__seq++, datasource_id: art.datasource_id, owner_id: art.owner_id, period: a.p_period, data: a.p_data, created_at: now() };
        db.so_records.push(r); return ok(r.id);
      }
    }
    return ok(null);
  };
  const SUPA = location.origin + '/fake-supa';
  const fnApi = async (body) => {
    const src = db.so_api_sources.find((s) => s.id === body.sourceId && s.owner_id === user().id);
    const err = (status, cuerpo) => ({ data: null, error: { message: 'x', context: { status, json: async () => cuerpo } } });
    if (!src) return err(404, { error: 'fuente_no_encontrada' });
    if (fallar('so-api')) return err(502, { error: 'api', mensaje: 'la API respondió 503' });
    const u = new URL(src.base_url);
    if (u.hostname === 'privada.ejemplo.com' && !src.auth_ref) return err(409, { error: 'falta_credencial', mensaje: 'Esta API necesita una credencial.' });
    const r = await fetch(`/fake-api${u.pathname}`);
    if (!r.ok) return err(502, { error: 'api', mensaje: `la API respondió ${r.status}` });
    const json = await r.json();
    const filas = json.data;
    if (body.accion === 'probar') { src.status = 'ok'; save(); return { data: { ok: true, ruta: 'data', total: filas.length, columnas: Object.keys(filas[0]), muestra: filas.slice(0, 5) }, error: null }; }
    if (src.last_sync_at && Date.now() - Date.parse(src.last_sync_at) < 60000) return err(429, { error: 'muy_seguido', mensaje: 'Se actualizó hace menos de un minuto.' });
    const m = src.response_mapping; const ds = db.so_datasources.find((d) => d.id === src.dataset_id);
    const lote = { id: crypto.randomUUID(), owner_id: user().id, dataset_id: ds.id, artifact_id: src.artifact_id, api_source_id: src.id, source_type: 'api', strategy: 'APPEND', source_name: src.name, status: 'ready', rows_accepted: 0, rows_rejected: 0, rows_superseded: 0, errors: [], started_at: now() };
    db.so_import_batches.push(lote);
    let nuevas = 0;
    for (const [i, f] of filas.entries()) {
      const data = {}; for (const a of m.asignaciones) data[a.campo] = typeof f[a.columna] === 'number' ? f[a.columna] : Number(f[a.columna]) || f[a.columna];
      const period = m.fecha ? String(f[m.fecha]).slice(0, 10) : now().slice(0, 10);
      const key = `api:${src.id}:${period}:${JSON.stringify(data)}`;
      if (db.so_records.some((x) => x.datasource_id === ds.id && x.idempotency_key === key)) continue;
      db.so_records.push({ id: db.__seq++, datasource_id: ds.id, owner_id: ds.owner_id, period, data, import_batch_id: lote.id, source_ref: { item: i + 1 }, idempotency_key: key, superseded_by: null, created_at: now() });
      nuevas++;
    }
    lote.rows_accepted = nuevas; src.last_sync_at = now(); src.status = 'ok'; save();
    return { data: { ok: true, lote: lote.id, recibidas: filas.length, nuevas, repetidas: filas.length - nuevas, rechazadas: 0 }, error: null };
  };
  window.supabase = { createClient() {
    return {
      auth: {
        onAuthStateChange(f) { setTimeout(() => f('SIGNED_IN', { user: user() }), 10); return { data: {} }; },
        getSession: async () => ({ data: { session: { user: user(), access_token: user().id } } }), signOut: async () => ({}), signInWithPassword: async () => ({}),
      },
      from: builder, rpc,
      functions: { invoke: async (nombre, { body } = {}) => (nombre === 'so-api' ? fnApi(body) : nombre === 'so-correo' ? fnCorreo(body) : { data: null, error: { message: 'x', context: { status: 503 } } }) },
      storage: { from: () => ({
        upload: async (path, body, op = {}) => { const r = await fetch(`${SUPA}/storage/v1/object/so-archivos/${path}`, { method: 'POST', body, headers: { Authorization: `Bearer ${user().id}`, 'x-upsert': String(!!op.upsert) } }); return r.ok ? { data: { path }, error: null } : { data: null, error: { message: String(r.status) } }; },
        download: async (path) => { if (fallar('storage.download')) return { data: null, error: { message: 'no' } }; const r = await fetch(`${SUPA}/storage/v1/object/so-archivos/${path}`, { headers: { Authorization: `Bearer ${user().id}` } }); return r.ok ? { data: await r.blob(), error: null } : { data: null, error: { message: String(r.status) } }; },
        // Como RLS de storage.objects: solo se firma lo que está en la carpeta del usuario. El token expira.
        createSignedUrl: async (path, segundos = 60, op = {}) => {
          if (!String(path).startsWith(`${user().id}/`)) return { data: null, error: { message: 'Object not found' } };
          const token = btoa(JSON.stringify({ u: user().id, p: path, exp: Date.now() + segundos * 1000 }));
          return { data: { signedUrl: `${SUPA}/storage/v1/object/sign/so-archivos/${path}?token=${encodeURIComponent(token)}${op.download ? `&download=${encodeURIComponent(op.download)}` : ''}` }, error: null };
        },
      }) },
    };
  } };
})();
