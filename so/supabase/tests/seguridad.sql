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
rollback;
