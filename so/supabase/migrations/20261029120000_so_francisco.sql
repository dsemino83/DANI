-- SO / Francisco · esquema base (versionado; se aplica con la herramienta de migraciones de Supabase).
-- Modelo: User → Project → WorkArtifact → DataSource → Records. Tablas con prefijo so_ en public (PostgREST).
-- Seguridad: RLS por dueño (owner_id = auth.uid()) + habilitación por public.es_valo(). Lo compartido se lee y escribe
-- solo por funciones security definer que validan usuario + artefacto + permiso + datasource + operación en cada llamada.
-- Borrar un artefacto (soft delete) NO borra sus datos: los registros cuelgan del datasource, con FK restrict.

create extension if not exists pgcrypto;

-- ===================================================== Proyectos y memoria
create table if not exists public.so_projects (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null default auth.uid(),
  name        text not null check (length(name) between 1 and 120),
  mode        text not null default 'work' check (mode in ('work', 'personal')),
  memory      jsonb not null default '{}'::jsonb,   -- ProjectMemory: objetivo, restricciones, arquitectura, fuentes, pendientes
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists so_projects_owner_idx on public.so_projects (owner_id);

-- ===================================================== Fuentes de datos (persistencia histórica)
create table if not exists public.so_datasources (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null default auth.uid(),
  project_id  uuid not null references public.so_projects (id) on delete restrict,
  name        text not null check (length(name) between 1 and 120),
  -- [{ "key": "monto", "label": "Monto", "type": "number" | "text" | "date" }]
  fields      jsonb not null default '[]'::jsonb check (jsonb_typeof(fields) = 'array'),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists so_datasources_owner_idx on public.so_datasources (owner_id);
create index if not exists so_datasources_project_idx on public.so_datasources (project_id);

create table if not exists public.so_records (
  id              bigint generated always as identity primary key,
  datasource_id   uuid not null references public.so_datasources (id) on delete restrict,
  owner_id        uuid not null,
  period          date not null default current_date,
  data            jsonb not null check (jsonb_typeof(data) = 'object'),
  idempotency_key text,
  created_by      uuid default auth.uid(),
  created_at      timestamptz not null default now(),
  unique (datasource_id, idempotency_key)
);
create index if not exists so_records_ds_period_idx on public.so_records (datasource_id, period);
create index if not exists so_records_owner_idx on public.so_records (owner_id);

-- ===================================================== WorkArtifacts, versiones y menú
create table if not exists public.so_artifacts (
  id               uuid primary key default gen_random_uuid(),
  owner_id         uuid not null default auth.uid(),
  project_id       uuid not null references public.so_projects (id) on delete restrict,
  name             text not null check (length(name) between 1 and 120),
  type             text not null default 'dashboard' check (type in ('dashboard', 'tool', 'form', 'report')),
  version          int not null default 1,
  route            text not null,
  menu             jsonb not null default '{}'::jsonb,
  specification    jsonb not null default '{}'::jsonb,
  datasource_id    uuid references public.so_datasources (id) on delete restrict,
  schema           jsonb not null default '{}'::jsonb,
  permissions      jsonb not null default '{}'::jsonb,
  sharing          jsonb not null default '{}'::jsonb,
  configuration    jsonb not null default '{}'::jsonb,
  state            text not null default 'draft' check (state in ('draft', 'published', 'archived', 'deleted')),
  deployment_state text not null default 'pending' check (deployment_state in ('pending', 'available', 'failed')),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz
);
create index if not exists so_artifacts_owner_idx on public.so_artifacts (owner_id);
create index if not exists so_artifacts_project_idx on public.so_artifacts (project_id);
create index if not exists so_artifacts_ds_idx on public.so_artifacts (datasource_id);

create table if not exists public.so_artifact_versions (
  id          bigint generated always as identity primary key,
  artifact_id uuid not null references public.so_artifacts (id) on delete cascade,
  owner_id    uuid not null,
  version     int not null,
  snapshot    jsonb not null,
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now(),
  unique (artifact_id, version)
);

create table if not exists public.so_menu (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null default auth.uid(),
  artifact_id uuid not null unique references public.so_artifacts (id) on delete cascade,
  name        text not null,
  icon        text not null default 'chart',
  route       text not null,
  ord         int not null default 0,
  visibility  text not null default 'owner' check (visibility in ('owner', 'shared', 'hidden')),
  permissions jsonb not null default '{}'::jsonb,
  status      text not null default 'available' check (status in ('available', 'hidden', 'removed'))
);
create index if not exists so_menu_owner_idx on public.so_menu (owner_id);

-- ===================================================== Compartir (VIEW | USE | EDIT). Nunca comparte chat ni memoria.
create table if not exists public.so_shares (
  id            uuid primary key default gen_random_uuid(),
  artifact_id   uuid not null references public.so_artifacts (id) on delete cascade,
  owner_id      uuid not null default auth.uid(),
  grantee_email text not null check (grantee_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  permission    text not null default 'USE' check (permission in ('VIEW', 'USE', 'EDIT')),
  created_at    timestamptz not null default now(),
  revoked_at    timestamptz
);
create unique index if not exists so_shares_activo_uq on public.so_shares (artifact_id, lower(grantee_email)) where revoked_at is null;
create index if not exists so_shares_email_idx on public.so_shares (lower(grantee_email)) where revoked_at is null;

-- ===================================================== Chat, contexto y decisiones
create table if not exists public.so_chats (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid not null default auth.uid(),
  project_id      uuid references public.so_projects (id) on delete set null,
  mode            text not null default 'work' check (mode in ('work', 'personal')),
  title           text not null default 'Conversación',
  summary         jsonb not null default '{}'::jsonb,  -- objectives, decisions, constraints, preferences, state, references, pendingWork
  compacted_until bigint not null default 0,           -- último so_messages.id incluido en el resumen
  compacted_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists so_chats_owner_idx on public.so_chats (owner_id, updated_at desc);

create table if not exists public.so_messages (
  id         bigint generated always as identity primary key,
  chat_id    uuid not null references public.so_chats (id) on delete cascade,
  owner_id   uuid not null default auth.uid(),
  role       text not null check (role in ('user', 'assistant', 'system')),
  content    text not null check (length(content) <= 100000),
  meta       jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists so_messages_chat_idx on public.so_messages (chat_id, id);

create table if not exists public.so_decisions (
  id          bigint generated always as identity primary key,
  owner_id    uuid not null default auth.uid(),
  project_id  uuid references public.so_projects (id) on delete cascade,
  chat_id     uuid references public.so_chats (id) on delete set null,
  artifact_id uuid references public.so_artifacts (id) on delete set null,
  decision    text not null check (length(decision) <= 2000),
  created_at  timestamptz not null default now()
);
create index if not exists so_decisions_owner_idx on public.so_decisions (owner_id, project_id);

-- ===================================================== Aprendizaje adaptativo (señales → ranking)
create table if not exists public.so_skills (
  name        text primary key,
  version     int not null default 1,
  description text not null
);
insert into public.so_skills (name, description) values
  ('FranciscoIntent',   'Interpreta la intención y resuelve referencias contextuales'),
  ('FranciscoContext',  'Compila el contexto mínimo por pedido'),
  ('FranciscoCompact',  'Compacta chats cada 3 horas sin borrar historial'),
  ('FranciscoArtifact', 'Crea, modifica, publica y versiona WorkArtifacts'),
  ('FranciscoData',     'Persistencia histórica en Supabase'),
  ('FranciscoSecurity', 'Compartir, revocar y validar permisos'),
  ('FranciscoUI',       'Avatar y estados de la interfaz')
on conflict (name) do nothing;

create table if not exists public.so_signals (
  id          bigint generated always as identity primary key,
  owner_id    uuid not null default auth.uid(),
  skill       text not null references public.so_skills (name),
  signal      text not null check (signal in ('acceptance', 'correction', 'rejection', 'reuse', 'retry', 'preference',
                                              'strategy', 'latency', 'tokens', 'error', 'success')),
  inferred    boolean not null default false,  -- inferidas: solo ranking/preferencia
  artifact_id uuid references public.so_artifacts (id) on delete set null,
  meta        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists so_signals_owner_idx on public.so_signals (owner_id, skill);

-- ===================================================== Tareas largas y automatizaciones
create table if not exists public.so_tasks (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid not null default auth.uid(),
  kind            text not null,
  status          text not null default 'queued' check (status in ('queued', 'running', 'waiting', 'completed', 'failed', 'cancelled')),
  risk            text not null default 'R1' check (risk in ('R0', 'R1', 'R2', 'R3')),
  idempotency_key text,
  input           jsonb not null default '{}'::jsonb,
  checkpoint      jsonb not null default '{}'::jsonb,
  result          jsonb,
  error           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (owner_id, idempotency_key)
);

create table if not exists public.so_automations (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null default auth.uid(),
  artifact_id uuid references public.so_artifacts (id) on delete cascade,
  name        text not null,
  trigger     jsonb not null,
  conditions  jsonb not null default '[]'::jsonb,
  action      jsonb not null,
  enabled     boolean not null default true,
  created_at  timestamptz not null default now()
);

-- ===================================================== Auditoría y observabilidad
create table if not exists public.so_audit (
  id          bigint generated always as identity primary key,
  owner_id    uuid,
  actor_id    uuid default auth.uid(),
  actor_email text default (auth.jwt() ->> 'email'),
  action      text not null,
  artifact_id uuid,
  detail      jsonb not null default '{}'::jsonb,
  at          timestamptz not null default now()
);
create index if not exists so_audit_owner_idx on public.so_audit (owner_id, at desc);

create table if not exists public.so_obs (
  id           bigint generated always as identity primary key,
  request_id   text not null,
  user_id      uuid default auth.uid(),
  project_id   uuid,
  model        text,
  skills       text[] not null default '{}',
  capabilities text[] not null default '{}',
  tokens       int,
  latency_ms   int,
  retries      int not null default 0,
  result       text,
  error        text,
  at           timestamptz not null default now()
);
create index if not exists so_obs_user_idx on public.so_obs (user_id, at desc);

-- ===================================================== Funciones de acceso
create or replace function public.so_email() returns text
language sql stable set search_path = public as $$ select lower(auth.jwt() ->> 'email') $$;

-- Permiso efectivo del usuario de la sesión sobre un artefacto: OWNER, EDIT, USE, VIEW o null.
create or replace function public.so_permiso(p_artifact uuid) returns text
language sql stable security definer set search_path = public as $$
  select case
    when auth.uid() is null then null
    when exists (select 1 from public.so_artifacts a where a.id = p_artifact and a.owner_id = auth.uid() and a.deleted_at is null)
      and public.es_valo() then 'OWNER'
    else (select s.permission from public.so_shares s join public.so_artifacts a on a.id = s.artifact_id
           where s.artifact_id = p_artifact and s.revoked_at is null and a.deleted_at is null and a.state = 'published'
             and lower(s.grantee_email) = public.so_email())
  end;
$$;

-- ===================================================== RLS por dueño
do $$
declare t text;
begin
  foreach t in array array['so_projects', 'so_datasources', 'so_records', 'so_artifacts', 'so_artifact_versions', 'so_menu',
                           'so_shares', 'so_chats', 'so_messages', 'so_decisions', 'so_signals', 'so_tasks', 'so_automations',
                           'so_audit', 'so_obs', 'so_skills'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
  foreach t in array array['so_projects', 'so_datasources', 'so_records', 'so_artifacts', 'so_menu', 'so_chats', 'so_messages',
                           'so_decisions', 'so_signals', 'so_tasks', 'so_automations'] loop
    execute format('drop policy if exists %I on public.%I', t || '_dueno', t);
    execute format('create policy %I on public.%I for all to authenticated using (owner_id = auth.uid() and public.es_valo()) '
                   'with check (owner_id = auth.uid() and public.es_valo())', t || '_dueno', t);
  end loop;
end $$;

-- Versiones, auditoría y compartidos: solo lectura para el dueño; se escriben por triggers o funciones.
drop policy if exists so_artifact_versions_leer on public.so_artifact_versions;
create policy so_artifact_versions_leer on public.so_artifact_versions for select to authenticated using (owner_id = auth.uid() and public.es_valo());
drop policy if exists so_audit_leer on public.so_audit;
create policy so_audit_leer on public.so_audit for select to authenticated using (owner_id = auth.uid() and public.es_valo());
drop policy if exists so_shares_leer on public.so_shares;
create policy so_shares_leer on public.so_shares for select to authenticated using (owner_id = auth.uid() and public.es_valo());
drop policy if exists so_obs_propio on public.so_obs;
create policy so_obs_propio on public.so_obs for select to authenticated using (user_id = auth.uid());
drop policy if exists so_obs_crear on public.so_obs;
create policy so_obs_crear on public.so_obs for insert to authenticated with check (user_id = auth.uid() and public.es_valo());
drop policy if exists so_skills_leer on public.so_skills;
create policy so_skills_leer on public.so_skills for select to authenticated using (public.es_valo());
revoke insert, update, delete on public.so_artifact_versions, public.so_audit, public.so_shares, public.so_skills from authenticated;
revoke update, delete on public.so_obs from authenticated;

-- ===================================================== Integridad entre tablas del mismo dueño
create or replace function public.so_t_mismo_dueno() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'so_records' then
    select d.owner_id into new.owner_id from public.so_datasources d where d.id = new.datasource_id;
    if new.owner_id is null then raise exception 'datasource inexistente' using errcode = '23503'; end if;
    perform public.so_validar_registro(new.datasource_id, new.data);
  elsif tg_table_name in ('so_datasources', 'so_artifacts') then
    if not exists (select 1 from public.so_projects p where p.id = new.project_id and p.owner_id = new.owner_id) then
      raise exception 'el proyecto no pertenece al usuario' using errcode = '42501';
    end if;
    if tg_table_name = 'so_artifacts' then   -- anidado: so_datasources no tiene datasource_id
      if new.datasource_id is not null
         and not exists (select 1 from public.so_datasources d where d.id = new.datasource_id and d.owner_id = new.owner_id) then
        raise exception 'el datasource no pertenece al usuario' using errcode = '42501';
      end if;
    end if;
  elsif tg_table_name = 'so_messages' then
    if not exists (select 1 from public.so_chats c where c.id = new.chat_id and c.owner_id = new.owner_id) then
      raise exception 'el chat no pertenece al usuario' using errcode = '42501';
    end if;
  elsif tg_table_name = 'so_menu' then
    if not exists (select 1 from public.so_artifacts a where a.id = new.artifact_id and a.owner_id = new.owner_id) then
      raise exception 'el artefacto no pertenece al usuario' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

-- Valida un registro contra los campos del datasource (claves conocidas y tipos).
create or replace function public.so_validar_registro(p_ds uuid, p_data jsonb) returns void
language plpgsql stable security definer set search_path = public as $$
declare f jsonb; k text; v jsonb; tipo text;
begin
  if jsonb_typeof(p_data) <> 'object' then raise exception 'registro inválido' using errcode = '22023'; end if;
  for k, v in select * from jsonb_each(p_data) loop
    f := null;
    select x into f from public.so_datasources d, jsonb_array_elements(d.fields) x where d.id = p_ds and x ->> 'key' = k;
    if f is null then raise exception 'campo desconocido: %', k using errcode = '22023'; end if;
    tipo := coalesce(f ->> 'type', 'text');
    if v = 'null'::jsonb then continue; end if;
    if tipo = 'number' and jsonb_typeof(v) <> 'number' then raise exception 'el campo % debe ser numérico', k using errcode = '22023'; end if;
    if tipo in ('text', 'date') and jsonb_typeof(v) <> 'string' then raise exception 'el campo % debe ser texto', k using errcode = '22023'; end if;
    if tipo = 'text' and length(v #>> '{}') > 2000 then raise exception 'el campo % es demasiado largo', k using errcode = '22023'; end if;
  end loop;
end;
$$;

drop trigger if exists so_records_dueno on public.so_records;
create trigger so_records_dueno before insert or update on public.so_records for each row execute function public.so_t_mismo_dueno();
drop trigger if exists so_datasources_dueno on public.so_datasources;
create trigger so_datasources_dueno before insert or update on public.so_datasources for each row execute function public.so_t_mismo_dueno();
drop trigger if exists so_artifacts_dueno on public.so_artifacts;
create trigger so_artifacts_dueno before insert or update on public.so_artifacts for each row execute function public.so_t_mismo_dueno();
drop trigger if exists so_messages_dueno on public.so_messages;
create trigger so_messages_dueno before insert on public.so_messages for each row execute function public.so_t_mismo_dueno();
drop trigger if exists so_menu_dueno on public.so_menu;
create trigger so_menu_dueno before insert or update on public.so_menu for each row execute function public.so_t_mismo_dueno();

-- ===================================================== Versionado y auditoría de artefactos
create or replace function public.so_t_artefacto() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    if (new.specification, new.schema, new.configuration, new.name, new.datasource_id, new.state)
       is distinct from (old.specification, old.schema, old.configuration, old.name, old.datasource_id, old.state) then
      new.version := old.version + 1;
    end if;
    new.updated_at := now();
  end if;
  return new;
end;
$$;
create or replace function public.so_t_artefacto_despues() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or new.version <> old.version then
    insert into public.so_artifact_versions (artifact_id, owner_id, version, snapshot)
    values (new.id, new.owner_id, new.version, to_jsonb(new) - 'owner_id')
    on conflict (artifact_id, version) do nothing;
  end if;
  insert into public.so_audit (owner_id, action, artifact_id, detail)
  values (new.owner_id,
          case when tg_op = 'INSERT' then 'artifact.create'
               when new.state is distinct from old.state then 'artifact.' || new.state
               else 'artifact.update' end,
          new.id, jsonb_build_object('version', new.version, 'state', new.state));
  return null;
end;
$$;
drop trigger if exists so_artifacts_version on public.so_artifacts;
create trigger so_artifacts_version before update on public.so_artifacts for each row execute function public.so_t_artefacto();
drop trigger if exists so_artifacts_audit on public.so_artifacts;
create trigger so_artifacts_audit after insert or update on public.so_artifacts for each row execute function public.so_t_artefacto_despues();

-- Restaura una versión anterior (rollback) como una versión nueva.
create or replace function public.so_restaurar_version(p_artifact uuid, p_version int) returns int
language plpgsql security invoker set search_path = public as $$
declare s jsonb; v int;
begin
  select snapshot into s from public.so_artifact_versions where artifact_id = p_artifact and version = p_version;
  if s is null then raise exception 'versión inexistente' using errcode = 'P0002'; end if;
  update public.so_artifacts set name = s ->> 'name', specification = s -> 'specification', schema = s -> 'schema',
         configuration = s -> 'configuration'
   where id = p_artifact returning version into v;
  if v is null then raise exception 'sin permiso' using errcode = '42501'; end if;
  return v;
end;
$$;

-- ===================================================== Compartir / revocar (solo el dueño; auditado)
create or replace function public.so_compartir(p_artifact uuid, p_email text, p_permission text default 'USE') returns uuid
language plpgsql security definer set search_path = public as $$
declare a public.so_artifacts; sid uuid; em text := lower(trim(p_email)); perm text := upper(coalesce(p_permission, 'USE'));
begin
  if public.so_permiso(p_artifact) is distinct from 'OWNER' then raise exception 'sin permiso' using errcode = '42501'; end if;
  if perm not in ('VIEW', 'USE', 'EDIT') then raise exception 'permiso inválido' using errcode = '22023'; end if;
  if em !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'correo inválido' using errcode = '22023'; end if;
  if em = public.so_email() then raise exception 'no hace falta compartir con uno mismo' using errcode = '22023'; end if;
  select * into a from public.so_artifacts where id = p_artifact;
  if a.state <> 'published' then raise exception 'publicá el artefacto antes de compartirlo' using errcode = '22023'; end if;
  update public.so_shares set permission = perm where artifact_id = p_artifact and lower(grantee_email) = em and revoked_at is null
  returning id into sid;
  if sid is null then
    insert into public.so_shares (artifact_id, owner_id, grantee_email, permission) values (p_artifact, a.owner_id, em, perm) returning id into sid;
    insert into public.so_audit (owner_id, action, artifact_id, detail) values (a.owner_id, 'share.grant', p_artifact, jsonb_build_object('email', em, 'permission', perm));
  else
    insert into public.so_audit (owner_id, action, artifact_id, detail) values (a.owner_id, 'share.permission', p_artifact, jsonb_build_object('email', em, 'permission', perm));
  end if;
  return sid;
end;
$$;

create or replace function public.so_revocar(p_share uuid) returns void
language plpgsql security definer set search_path = public as $$
declare s public.so_shares;
begin
  select * into s from public.so_shares where id = p_share and revoked_at is null;
  if s.id is null or public.so_permiso(s.artifact_id) is distinct from 'OWNER' then raise exception 'sin permiso' using errcode = '42501'; end if;
  update public.so_shares set revoked_at = now() where id = p_share;
  insert into public.so_audit (owner_id, action, artifact_id, detail) values (s.owner_id, 'share.revoke', s.artifact_id, jsonb_build_object('email', s.grantee_email));
end;
$$;

-- ===================================================== Acceso compartido (ruta /so/shared/:artifactId)
-- Devuelve SOLO el artefacto y sus datos: nunca chat, memoria, otros artefactos, ni configuración privada.
create or replace function public.so_shared_list() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'type', a.type, 'permission', s.permission) order by a.name), '[]'::jsonb)
    from public.so_shares s join public.so_artifacts a on a.id = s.artifact_id
   where s.revoked_at is null and a.deleted_at is null and a.state = 'published' and lower(s.grantee_email) = public.so_email();
$$;

create or replace function public.so_shared_get(p_artifact uuid, p_desde date default null, p_hasta date default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare perm text := public.so_permiso(p_artifact); a public.so_artifacts; d public.so_datasources; recs jsonb;
begin
  if perm is null then raise exception 'sin acceso' using errcode = '42501'; end if;
  select * into a from public.so_artifacts where id = p_artifact;
  select * into d from public.so_datasources where id = a.datasource_id;
  select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'period', r.period, 'data', r.data, 'created_at', r.created_at) order by r.period, r.id), '[]'::jsonb)
    into recs from public.so_records r
   where r.datasource_id = a.datasource_id and (p_desde is null or r.period >= p_desde) and (p_hasta is null or r.period <= p_hasta);
  return jsonb_build_object('id', a.id, 'name', a.name, 'type', a.type, 'version', a.version, 'permission', perm,
                            'specification', a.specification, 'schema', a.schema,
                            'view', jsonb_build_object('grafico', a.configuration -> 'grafico', 'metrica', a.configuration -> 'metrica'),
                            'fields', coalesce(d.fields, '[]'::jsonb), 'records', recs);
end;
$$;

create or replace function public.so_shared_add_record(p_artifact uuid, p_period date, p_data jsonb, p_key text default null) returns bigint
language plpgsql security definer set search_path = public as $$
declare perm text := public.so_permiso(p_artifact); a public.so_artifacts; rid bigint;
begin
  if perm not in ('OWNER', 'EDIT', 'USE') or perm is null then raise exception 'sin permiso para cargar datos' using errcode = '42501'; end if;
  select * into a from public.so_artifacts where id = p_artifact;
  if a.datasource_id is null then raise exception 'el artefacto no tiene datos persistentes' using errcode = '22023'; end if;
  insert into public.so_records (datasource_id, owner_id, period, data, idempotency_key)
  values (a.datasource_id, a.owner_id, coalesce(p_period, current_date), p_data, nullif(p_key, ''))
  on conflict (datasource_id, idempotency_key) do nothing returning id into rid;
  if rid is not null then
    insert into public.so_audit (owner_id, action, artifact_id, detail) values (a.owner_id, 'record.add', p_artifact, jsonb_build_object('record', rid, 'via', perm));
  end if;
  return rid;
end;
$$;

create or replace function public.so_shared_update_spec(p_artifact uuid, p_specification jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare perm text := public.so_permiso(p_artifact); v int;
begin
  if perm not in ('OWNER', 'EDIT') or perm is null then raise exception 'sin permiso para editar' using errcode = '42501'; end if;
  if jsonb_typeof(p_specification) <> 'object' then raise exception 'especificación inválida' using errcode = '22023'; end if;
  update public.so_artifacts set specification = p_specification where id = p_artifact returning version into v;
  return v;
end;
$$;

-- ===================================================== Compactación de chats (cada 3 horas, incremental e idempotente)
-- Determinista (sin LLM): conserva objetivos, decisiones, restricciones, preferencias, estado, referencias y pendientes.
-- No borra mensajes: "clear context" ≠ borrar datos persistidos.
create or replace function public.so_compactar(p_chat uuid default null) returns int
language plpgsql security definer set search_path = public as $$
declare c record; ultimo bigint; n int := 0; pedidos jsonb; decis jsonb; refs jsonb; pend jsonb; prefs jsonb; restr jsonb;
begin
  for c in select * from public.so_chats ch
            where (p_chat is null or ch.id = p_chat)
              and (auth.uid() is null or ch.owner_id = auth.uid())   -- el cron (sin sesión) compacta todo; un usuario, solo lo suyo
              and exists (select 1 from public.so_messages m where m.chat_id = ch.id and m.id > ch.compacted_until) loop
    select max(id) into ultimo from public.so_messages where chat_id = c.id;
    select coalesce(jsonb_agg(left(content, 300) order by id), '[]') into pedidos from (
      select id, content from public.so_messages where chat_id = c.id and role = 'user' and id > c.compacted_until order by id desc limit 8) u;
    select coalesce(jsonb_agg(decision order by id), '[]') into decis from (
      select id, decision from public.so_decisions where chat_id = c.id order by id desc limit 20) dd;
    select coalesce(jsonb_agg(distinct m.meta ->> 'artifactId'), '[]') into refs
      from public.so_messages m where m.chat_id = c.id and m.meta ? 'artifactId';
    select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'kind', t.kind, 'status', t.status)), '[]') into pend
      from public.so_tasks t where t.owner_id = c.owner_id and t.status in ('queued', 'running', 'waiting');
    select coalesce(jsonb_agg(distinct s.meta ->> 'value') filter (where s.meta ? 'value'), '[]') into prefs
      from public.so_signals s where s.owner_id = c.owner_id and s.signal = 'preference' and not s.inferred;
    select coalesce(jsonb_agg(left(content, 300) order by id), '[]') into restr from (
      select id, content from public.so_messages where chat_id = c.id and role = 'user'
         and content ~* '(no quiero|nunca|siempre|sin |solo |sólo |obligatori|restric)' order by id desc limit 10) r;
    update public.so_chats set
      summary = jsonb_build_object(
        'objectives', coalesce(c.summary -> 'objectives', '[]'::jsonb) || pedidos,
        'decisions', decis, 'constraints', restr, 'confirmedPreferences', prefs,
        'state', jsonb_build_object('lastMessageId', ultimo, 'mode', c.mode),
        'references', refs, 'pendingWork', pend),
      compacted_until = ultimo, compacted_at = now()
    where id = c.id and compacted_until < ultimo;   -- idempotente
    n := n + 1;
  end loop;
  -- recorta objetivos acumulados (los últimos 30) para que el resumen no crezca sin límite
  update public.so_chats set summary = jsonb_set(summary, '{objectives}',
         (select coalesce(jsonb_agg(x order by i), '[]') from (select x, i from jsonb_array_elements(summary -> 'objectives') with ordinality e(x, i)
            order by i desc limit 30) z))
   where (auth.uid() is null or owner_id = auth.uid()) and jsonb_array_length(coalesce(summary -> 'objectives', '[]')) > 30;
  return n;
end;
$$;

-- ===================================================== Permisos de ejecución
revoke all on function public.so_permiso(uuid) from public, anon;
revoke all on function public.so_email() from public, anon;
revoke all on function public.so_compartir(uuid, text, text) from public, anon;
revoke all on function public.so_revocar(uuid) from public, anon;
revoke all on function public.so_shared_list() from public, anon;
revoke all on function public.so_shared_get(uuid, date, date) from public, anon;
revoke all on function public.so_shared_add_record(uuid, date, jsonb, text) from public, anon;
revoke all on function public.so_shared_update_spec(uuid, jsonb) from public, anon;
revoke all on function public.so_restaurar_version(uuid, int) from public, anon;
revoke all on function public.so_compactar(uuid) from public, anon;
revoke all on function public.so_validar_registro(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.so_t_mismo_dueno() from public, anon, authenticated;
revoke all on function public.so_t_artefacto() from public, anon, authenticated;
revoke all on function public.so_t_artefacto_despues() from public, anon, authenticated;
grant execute on function public.so_permiso(uuid) to authenticated;
grant execute on function public.so_compartir(uuid, text, text) to authenticated;
grant execute on function public.so_revocar(uuid) to authenticated;
grant execute on function public.so_shared_list() to authenticated;
grant execute on function public.so_shared_get(uuid, date, date) to authenticated;
grant execute on function public.so_shared_add_record(uuid, date, jsonb, text) to authenticated;
grant execute on function public.so_shared_update_spec(uuid, jsonb) to authenticated;
grant execute on function public.so_restaurar_version(uuid, int) to authenticated;
grant execute on function public.so_compactar(uuid) to authenticated;
grant execute on function public.so_email() to authenticated;

-- ===================================================== Programación de la compactación
create extension if not exists pg_cron;
do $$ begin
  perform cron.unschedule('so-compactar-chats');
exception when others then null; end $$;
select cron.schedule('so-compactar-chats', '0 */3 * * *', $$select public.so_compactar(null)$$);

notify pgrst, 'reload schema';
