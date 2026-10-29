-- Prueba de seguridad de SO sobre una base con la migración aplicada (local o rama de Supabase; nunca producción).
-- Corre dentro de una transacción que se revierte. Falla con excepción ante el primer incumplimiento.
begin;
insert into public.permitidos (email) values ('a@test.so') on conflict do nothing;

create or replace function pg_temp.como(p_uid uuid, p_email text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_uid, 'email', p_email)::text, true);
  execute 'set local role authenticated';
end $$;
create or replace function pg_temp.debe_fallar(p_sql text, p_que text) returns void language plpgsql as $$
begin
  begin execute p_sql; exception when others then return; end;
  raise exception 'DEBIÓ FALLAR: %', p_que;
end $$;

do $$
declare
  ua uuid := '00000000-0000-0000-0000-00000000000a'; ub uuid := '00000000-0000-0000-0000-00000000000b';
  uc uuid := '00000000-0000-0000-0000-00000000000c';
  pid uuid; dsid uuid; aid uuid; sid uuid; n int; j jsonb; chid uuid;
begin
  -- Dueño A crea proyecto, datasource, artefacto y datos
  perform pg_temp.como(ua, 'a@test.so');
  insert into public.so_projects (name) values ('Ventas') returning id into pid;
  insert into public.so_datasources (project_id, name, fields)
  values (pid, 'ventas', '[{"key":"monto","type":"number"},{"key":"canal","type":"text"}]') returning id into dsid;
  insert into public.so_artifacts (project_id, name, route, datasource_id, state)
  values (pid, 'Dashboard de ventas', '#/a/x', dsid, 'draft') returning id into aid;
  insert into public.so_records (datasource_id, owner_id, period, data) values (dsid, ua, '2026-01-31', '{"monto": 100, "canal": "web"}');
  perform pg_temp.debe_fallar(format($q$insert into public.so_records (datasource_id, owner_id, data) values (%L, %L, '{"otro": 1}')$q$, dsid, ua), 'campo desconocido');
  perform pg_temp.debe_fallar(format($q$insert into public.so_records (datasource_id, owner_id, data) values (%L, %L, '{"monto": "x"}')$q$, dsid, ua), 'tipo inválido');
  perform pg_temp.debe_fallar(format($q$select public.so_compartir(%L, 'b@test.so', 'USE')$q$, aid), 'compartir sin publicar');
  update public.so_artifacts set state = 'published' where id = aid;
  select version into n from public.so_artifacts where id = aid;
  if n <> 2 then raise exception 'versionado: esperaba 2, hay %', n; end if;
  sid := public.so_compartir(aid, 'B@test.so', 'VIEW');
  insert into public.so_chats (title) values ('privado') returning id into chid;
  insert into public.so_messages (chat_id, role, content) values (chid, 'user', 'nunca mostrar datos personales');
  reset role;

  -- B (no habilitado como dueño) no ve tablas privadas pero sí el artefacto compartido
  perform pg_temp.como(ub, 'b@test.so');
  select count(*) into n from public.so_artifacts; if n <> 0 then raise exception 'B ve artefactos ajenos'; end if;
  select count(*) into n from public.so_chats; if n <> 0 then raise exception 'B ve chats ajenos'; end if;
  select count(*) into n from public.so_records; if n <> 0 then raise exception 'B ve registros ajenos'; end if;
  j := public.so_shared_get(aid);
  if j ->> 'permission' <> 'VIEW' or jsonb_array_length(j -> 'records') <> 1 then raise exception 'shared_get incorrecto: %', j; end if;
  if j ? 'owner_id' or j ? 'configuration' or j ? 'datasource_id' or j ->> 'view' is null then raise exception 'shared_get expone datos privados'; end if;
  perform pg_temp.debe_fallar(format($q$select public.so_shared_add_record(%L, null, '{"monto": 5}')$q$, aid), 'VIEW no carga datos');
  perform pg_temp.debe_fallar(format($q$select public.so_compartir(%L, 'c@test.so', 'USE')$q$, aid), 'B no comparte');
  perform pg_temp.debe_fallar(format($q$select public.so_revocar(%L)$q$, sid), 'B no revoca');
  perform pg_temp.debe_fallar(format($q$insert into public.so_records (datasource_id, owner_id, data) values (%L, %L, '{"monto": 1}')$q$, dsid, ub), 'B inserta directo');
  reset role;

  -- A sube a USE (cambio de permiso auditado); B carga con idempotencia
  perform pg_temp.como(ua, 'a@test.so');
  perform public.so_compartir(aid, 'b@test.so', 'USE');
  reset role;
  perform pg_temp.como(ub, 'b@test.so');
  perform pg_temp.debe_fallar(format($q$select public.so_shared_add_record(%L, null, '{"monto": 5}')$q$, aid), 'USE sin habilitar carga');
  reset role;
  perform pg_temp.como(ua, 'a@test.so');
  update public.so_artifacts set permissions = permissions || '{"shared_input": true}' where id = aid;
  reset role;
  perform pg_temp.como(ub, 'b@test.so');
  perform public.so_shared_add_record(aid, '2026-02-28', '{"monto": 50}', 'k1');
  perform public.so_shared_add_record(aid, '2026-02-28', '{"monto": 50}', 'k1');
  perform pg_temp.debe_fallar(format($q$select public.so_shared_update_spec(%L, '{}')$q$, aid), 'USE no edita');
  reset role;

  -- C sin compartir: sin acceso
  perform pg_temp.como(uc, 'c@test.so');
  perform pg_temp.debe_fallar(format($q$select public.so_shared_get(%L)$q$, aid), 'C sin acceso');
  if jsonb_array_length(public.so_shared_list()) <> 0 then raise exception 'C ve compartidos ajenos'; end if;
  reset role;

  -- A revoca; B pierde acceso. A borra el artefacto (soft) y los datos quedan.
  perform pg_temp.como(ua, 'a@test.so');
  select count(*) into n from public.so_records where datasource_id = dsid; if n <> 2 then raise exception 'idempotencia: % registros', n; end if;
  perform public.so_revocar(sid);
  update public.so_artifacts set state = 'deleted', deleted_at = now() where id = aid;
  select count(*) into n from public.so_records where datasource_id = dsid; if n <> 2 then raise exception 'borrar artefacto borró datos'; end if;
  perform pg_temp.debe_fallar(format('delete from public.so_datasources where id = %L', dsid), 'datasource con datos no se borra');
  select count(*) into n from public.so_audit where artifact_id = aid and action like 'share.%'; if n <> 3 then raise exception 'auditoría de compartir: %', n; end if;
  perform public.so_compactar(chid);
  select (summary -> 'constraints') into j from public.so_chats where id = chid;
  if jsonb_array_length(j) <> 1 then raise exception 'compactación sin restricciones: %', j; end if;
  if public.so_compactar(chid) <> 0 then raise exception 'compactación no idempotente'; end if;
  select count(*) into n from public.so_messages where chat_id = chid; if n <> 1 then raise exception 'compactación borró historial'; end if;
  reset role;

  perform pg_temp.como(ub, 'b@test.so');
  perform pg_temp.debe_fallar(format($q$select public.so_shared_get(%L)$q$, aid), 'B revocado');
  reset role;
  raise notice 'SEGURIDAD OK';
end $$;
-- Capa UX: búsqueda global, notificaciones, estado y métricas no cruzan usuarios.
do $$
declare
  ua uuid := '00000000-0000-0000-0000-00000000000a'; ub uuid := '00000000-0000-0000-0000-00000000000b';
  pid uuid; dsid uuid; aid uuid; n int;
begin
  perform pg_temp.como(ua, 'a@test.so');
  insert into public.so_projects (name) values ('Comercial') returning id into pid;
  insert into public.so_datasources (project_id, name, fields) values (pid, 'ventas', '[{"key":"canal","type":"text"}]') returning id into dsid;
  insert into public.so_artifacts (project_id, name, route, datasource_id, state) values (pid, 'Tablero Zeta', '#', dsid, 'published') returning id into aid;
  insert into public.so_menu (artifact_id, name, route) values (aid, 'Tablero Zeta', '#');
  insert into public.so_records (datasource_id, owner_id, data) values (dsid, ua, '{"canal": "mayorista"}');
  insert into public.so_notifications (priority, title) values ('success', 'Importación terminada');
  insert into public.so_user_state (key, value) values ('resume', '{"artifactId": "x"}');
  insert into public.so_events (name, value) values ('time_to_first_value', 1200);
  perform public.so_abrir_artefacto(aid);
  select count(*) into n from public.so_buscar('zeta') where kind = 'artifact'; if n <> 1 then raise exception 'búsqueda propia: %', n; end if;
  select count(*) into n from public.so_buscar('mayorista') where kind = 'record'; if n <> 1 then raise exception 'búsqueda de registros: %', n; end if;
  select count(*) into n from public.so_buscar('comercial') where kind = 'project'; if n <> 1 then raise exception 'búsqueda de proyectos: %', n; end if;
  select open_count into n from public.so_menu where artifact_id = aid; if n <> 1 then raise exception 'recientes: %', n; end if;
  perform pg_temp.debe_fallar('update public.so_events set value = 0', 'métricas inmutables');
  reset role;

  perform pg_temp.como(ub, 'b@test.so');
  select count(*) into n from public.so_buscar('zeta'); if n <> 0 then raise exception 'B encuentra artefactos ajenos'; end if;
  select count(*) into n from public.so_buscar('mayorista'); if n <> 0 then raise exception 'B encuentra registros ajenos'; end if;
  select count(*) into n from public.so_notifications; if n <> 0 then raise exception 'B ve notificaciones ajenas'; end if;
  select count(*) into n from public.so_user_state; if n <> 0 then raise exception 'B ve estado ajeno'; end if;
  select count(*) into n from public.so_events; if n <> 0 then raise exception 'B ve métricas ajenas'; end if;
  perform public.so_abrir_artefacto(aid);
  reset role;
  select open_count into n from public.so_menu where artifact_id = aid; if n <> 1 then raise exception 'B modificó recientes ajenos'; end if;
  raise notice 'SEGURIDAD UX OK';
end $$;
-- Ingesta universal: Storage aislado, archivos, lotes, estrategias reversibles, duplicados, compartidos, APIs y secretos.
do $$
declare
  ua uuid := '00000000-0000-0000-0000-00000000000a'; ub uuid := '00000000-0000-0000-0000-00000000000b';
  pid uuid; dsid uuid; aid uuid; fid uuid := gen_random_uuid(); b1 uuid; b2 uuid; b3 uuid; rid bigint; n int; j jsonb; src uuid; t text;
  ck text := repeat('a', 64);
begin
  perform pg_temp.como(ua, 'a@test.so');
  insert into public.so_projects (name) values ('Ingesta') returning id into pid;
  insert into public.so_datasources (project_id, name, fields) values (pid, 'ventas', '[{"key":"cliente","type":"text"},{"key":"importe","type":"number"}]') returning id into dsid;
  insert into public.so_artifacts (project_id, name, route, datasource_id, state) values (pid, 'Ventas', '#', dsid, 'published') returning id into aid;
  -- Storage: solo en la propia carpeta
  insert into storage.objects (bucket_id, name) values ('so-archivos', ua::text || '/' || fid::text || '/ventas.csv');
  perform pg_temp.debe_fallar(format($q$insert into storage.objects (bucket_id, name) values ('so-archivos', %L)$q$, ub::text || '/x/y.csv'), 'subir a carpeta ajena');
  -- Archivo: ruta, nombre y tamaño validados en la base
  insert into public.so_files (id, project_id, artifact_id, original_name, safe_name, detected_type, kind, size, storage_path, checksum, status)
  values (fid, pid, aid, 'ventas.csv', 'ventas.csv', 'csv', 'table', 120, ua::text || '/' || fid::text || '/ventas.csv', ck, 'ready');
  perform pg_temp.debe_fallar(format($q$insert into public.so_files (original_name, safe_name, detected_type, kind, size, storage_path, checksum) values ('x', 'x.csv', 'csv', 'table', 1, %L, %L)$q$, ub::text || '/z/x.csv', ck), 'ruta de otro usuario');
  perform pg_temp.debe_fallar(format($q$insert into public.so_files (original_name, safe_name, detected_type, kind, size, checksum) values ('../../etc/passwd', '../etc', 'txt', 'document', 1, %L)$q$, ck), 'path traversal en nombre');
  perform pg_temp.debe_fallar(format($q$insert into public.so_files (original_name, safe_name, detected_type, kind, size, checksum) values ('g', 'g.csv', 'csv', 'table', 60000000, %L)$q$, ck), 'archivo demasiado grande');
  insert into public.so_file_chunks (file_id, ord, ref, content) values (fid, 0, '{"pagina": 1}', 'Las ventas de octubre crecieron por el canal mayorista');
  select count(*) into n from public.so_buscar_fragmentos(array[fid], 'mayorista'); if n <> 1 then raise exception 'fragmentos propios: %', n; end if;
  select count(*) into n from public.so_buscar('mayorista') where kind = 'file'; if n <> 1 then raise exception 'búsqueda de archivos: %', n; end if;
  -- Lote APPEND con linaje
  insert into public.so_import_batches (dataset_id, artifact_id, source_file_id, strategy, checksum, source_name) values (dsid, aid, fid, 'APPEND', ck, 'ventas.csv') returning id into b1;
  insert into public.so_records (datasource_id, owner_id, period, data, import_batch_id, source_ref, idempotency_key)
  values (dsid, ua, '2026-09-30', '{"cliente":"ACME","importe":100}', b1, '{"fila": 2}', b1::text || ':2'),
         (dsid, ua, '2026-09-30', '{"cliente":"Beta","importe":50}', b1, '{"fila": 3}', b1::text || ':3') ;
  select id into rid from public.so_records where import_batch_id = b1 order by id limit 1;
  j := public.so_origen_registro(rid);
  if j -> 'archivo' ->> 'nombre' <> 'ventas.csv' or (j -> 'ref' ->> 'fila')::int <> 2 then raise exception 'linaje: %', j; end if;
  -- UPSERT por clave: reemplaza ACME y deja Beta
  insert into public.so_import_batches (dataset_id, artifact_id, strategy, key_field, checksum) values (dsid, aid, 'UPSERT', 'cliente', repeat('b', 64)) returning id into b2;
  insert into public.so_records (datasource_id, owner_id, period, data, import_batch_id) values (dsid, ua, '2026-10-31', '{"cliente":"ACME","importe":130}', b2);
  if public.so_aplicar_estrategia(b2) <> 1 then raise exception 'upsert'; end if;
  select count(*) into n from public.so_records where datasource_id = dsid and superseded_by is null; if n <> 2 then raise exception 'activos tras upsert: %', n; end if;
  -- REPLACE: reversible
  insert into public.so_import_batches (dataset_id, artifact_id, strategy, checksum) values (dsid, aid, 'REPLACE', repeat('c', 64)) returning id into b3;
  insert into public.so_records (datasource_id, owner_id, period, data, import_batch_id) values (dsid, ua, '2026-11-30', '{"cliente":"Gamma","importe":7}', b3);
  perform public.so_aplicar_estrategia(b3);
  select count(*) into n from public.so_records where datasource_id = dsid and superseded_by is null; if n <> 1 then raise exception 'replace: %', n; end if;
  perform pg_temp.debe_fallar(format('select public.so_deshacer_importacion(%L)', b2), 'deshacer con dependencias posteriores');
  j := public.so_deshacer_importacion(b3);
  select count(*) into n from public.so_records where datasource_id = dsid and superseded_by is null; if n <> 2 then raise exception 'deshacer replace: % %', n, j; end if;
  -- Compartido: USE sin habilitar no importa; con habilitación sí; duplicado detectado; filas inválidas a revisión
  update public.so_artifacts set permissions = '{}' where id = aid;
  perform public.so_compartir(aid, 'b@test.so', 'USE');
  -- API: sin secretos en encabezados ni referencias forjadas; secreto solo vía Vault
  perform pg_temp.debe_fallar(format($q$insert into public.so_api_sources (dataset_id, name, base_url, headers) values (%L, 'x', 'https://api.ejemplo.com/v1', '{"Authorization": "Bearer 123"}')$q$, dsid), 'secreto en encabezados');
  perform pg_temp.debe_fallar(format($q$insert into public.so_api_sources (dataset_id, name, base_url) values (%L, 'x', 'http://169.254.169.254/latest')$q$, dsid), 'URL no https');
  perform pg_temp.debe_fallar(format($q$insert into public.so_api_sources (dataset_id, name, base_url, auth_ref) values (%L, 'x', 'https://api.ejemplo.com', gen_random_uuid())$q$, dsid), 'auth_ref forjado');
  insert into public.so_api_sources (dataset_id, artifact_id, name, base_url, auth_scheme) values (dsid, aid, 'Cotizaciones', 'https://api.ejemplo.com/v1/cotizaciones', 'bearer') returning id into src;
  perform public.so_api_guardar_secreto(src, 'token-super-secreto');
  perform pg_temp.debe_fallar(format('update public.so_api_sources set auth_ref = gen_random_uuid() where id = %L', src), 'cambiar auth_ref desde la página');
  perform pg_temp.debe_fallar(format('select public.so_api_leer_secreto(%L)', src), 'leer secreto desde la página');
  reset role;
  set local role service_role;
  if public.so_api_leer_secreto(src) <> 'token-super-secreto' then raise exception 'secreto para el servidor'; end if;
  reset role;

  perform pg_temp.como(ub, 'b@test.so');
  select count(*) into n from storage.objects; if n <> 0 then raise exception 'B ve objetos de A'; end if;
  select count(*) into n from public.so_files; if n <> 0 then raise exception 'B ve archivos de A'; end if;
  select count(*) into n from public.so_buscar_fragmentos(array[fid], 'mayorista'); if n <> 0 then raise exception 'B recupera fragmentos de A'; end if;
  select count(*) into n from public.so_import_batches; if n <> 0 then raise exception 'B ve lotes de A'; end if;
  select count(*) into n from public.so_api_sources; if n <> 0 then raise exception 'B ve APIs de A'; end if;
  if public.so_origen_registro(rid) is not null then raise exception 'B ve linaje ajeno'; end if;
  perform pg_temp.debe_fallar(format('select public.so_deshacer_importacion(%L)', b1), 'B deshace importación ajena');
  perform pg_temp.debe_fallar(format('select public.so_api_guardar_secreto(%L, %L)', src, 'x'), 'B cambia secreto ajeno');
  j := public.so_shared_get(aid);
  if (j ->> 'puede_cargar')::boolean then raise exception 'USE sin habilitar figura con carga'; end if;
  perform pg_temp.debe_fallar(format($q$select public.so_shared_importar(%L, gen_random_uuid(), 'v.csv', %L, '[]'::jsonb)$q$, aid, ck), 'USE importa sin habilitación');
  reset role;
  perform pg_temp.como(ua, 'a@test.so');
  update public.so_artifacts set permissions = '{"shared_input": true}' where id = aid;
  reset role;
  perform pg_temp.como(ub, 'b@test.so');
  j := public.so_shared_importar(aid, gen_random_uuid(), 'ventas.csv', ck, '[]'::jsonb);
  if not coalesce((j ->> 'duplicado')::boolean, false) then raise exception 'duplicado no detectado: %', j; end if;
  b1 := gen_random_uuid();
  j := public.so_shared_importar(aid, b1, 'nuevo.csv', repeat('d', 64),
         '[{"fila": 2, "period": "2026-10-01", "data": {"cliente": "Zeta", "importe": 9}}, {"fila": 3, "period": "2026-10-01", "data": {"importe": "x"}}]'::jsonb,
         '[{"fila": 4, "motivo": "fecha inválida"}]'::jsonb, true);
  if (j ->> 'aceptadas')::int <> 1 or (j ->> 'rechazadas')::int <> 2 or j ->> 'estado' <> 'partial' then raise exception 'importación parcial: %', j; end if;
  perform pg_temp.debe_fallar(format($q$select public.so_shared_importar(%L, %L, 'nuevo.csv', %L, '[]'::jsonb)$q$, aid, b1, repeat('d', 64)), 'reabrir un lote cerrado');
  reset role;
  raise notice 'SEGURIDAD INGESTA OK';
end $$;
rollback;
