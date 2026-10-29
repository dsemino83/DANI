-- SO / Francisco · capa de experiencia: tareas en segundo plano, notificaciones, continuidad entre dispositivos,
-- recientes/favoritos, búsqueda global (respeta RLS) y métricas de producto. Requiere 20261029120000_so_francisco.sql.

-- ===================================================== Tareas en segundo plano (amplía so_tasks)
alter table public.so_tasks add column if not exists name text;
alter table public.so_tasks add column if not exists artifact_id uuid references public.so_artifacts (id) on delete set null;
alter table public.so_tasks add column if not exists progress numeric check (progress is null or progress between 0 and 1);
alter table public.so_tasks add column if not exists needs_action text;   -- acción que necesita el usuario, si la hay
create index if not exists so_tasks_owner_idx on public.so_tasks (owner_id, updated_at desc);

-- ===================================================== Registro del menú: favoritos, recientes y frecuencia
alter table public.so_menu add column if not exists favorite boolean not null default false;
alter table public.so_menu add column if not exists last_opened_at timestamptz;
alter table public.so_menu add column if not exists open_count int not null default 0;

create or replace function public.so_abrir_artefacto(p_artifact uuid) returns void
language sql security invoker set search_path = public as $$
  update public.so_menu set last_opened_at = now(), open_count = open_count + 1 where artifact_id = p_artifact;
$$;

-- ===================================================== Notificaciones operativas (fuera del chat)
create table if not exists public.so_notifications (
  id          bigint generated always as identity primary key,
  owner_id    uuid not null default auth.uid(),
  priority    text not null check (priority in ('critical', 'action', 'success', 'info')),
  title       text not null check (length(title) <= 200),
  body        text check (length(body) <= 2000),
  group_key   text,                       -- agrupa avisos repetidos (p. ej. una importación)
  artifact_id uuid references public.so_artifacts (id) on delete set null,
  task_id     uuid references public.so_tasks (id) on delete set null,
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists so_notifications_owner_idx on public.so_notifications (owner_id, created_at desc);

-- ===================================================== Continuidad (proyecto, artefacto, filtros, primera visita)
create table if not exists public.so_user_state (
  owner_id   uuid not null default auth.uid(),
  key        text not null check (key in ('resume', 'first_seen', 'last_visit')),
  value      jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (owner_id, key)
);

-- ===================================================== Métricas de producto (trabajo resuelto, no engagement)
create table if not exists public.so_events (
  id       bigint generated always as identity primary key,
  owner_id uuid not null default auth.uid(),
  name     text not null check (name in ('time_to_first_value', 'time_to_result', 'task_completed', 'task_failed', 'retry',
                                         'abandonment', 'artifact_reuse', 'search_success', 'search_miss', 'share_success',
                                         'recovery_success', 'undo', 'preview_confirmed', 'preview_cancelled')),
  value    numeric,
  props    jsonb not null default '{}'::jsonb,
  at       timestamptz not null default now()
);
create index if not exists so_events_owner_idx on public.so_events (owner_id, name, at desc);

do $$
declare t text;
begin
  foreach t in array array['so_notifications', 'so_user_state', 'so_events'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('drop policy if exists %I on public.%I', t || '_dueno', t);
    execute format('create policy %I on public.%I for all to authenticated using (owner_id = auth.uid() and public.es_valo()) '
                   'with check (owner_id = auth.uid() and public.es_valo())', t || '_dueno', t);
  end loop;
end $$;
revoke update, delete on public.so_events from authenticated;   -- las métricas no se reescriben

-- ===================================================== Búsqueda global
-- security invoker: corre con los permisos del usuario, así que la RLS de cada tabla decide qué aparece.
-- Los tableros compartidos con el usuario se suman desde so_shared_list (sin exponer sus registros).
create or replace function public.so_buscar(p_q text, p_limit int default 20)
returns table (kind text, id text, title text, subtitle text, artifact_id uuid, updated_at timestamptz)
language plpgsql stable security invoker set search_path = public as $$
declare patron text;
begin
  if length(trim(coalesce(p_q, ''))) < 2 then return; end if;
  patron := '%' || replace(replace(replace(trim(p_q), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  return query
    (select 'artifact'::text, a.id::text, a.name, a.type, a.id, a.updated_at
       from public.so_artifacts a where a.deleted_at is null and a.name ilike patron order by a.updated_at desc limit p_limit)
    union all
    (select 'project'::text, p.id::text, p.name, 'proyecto'::text, null::uuid, p.updated_at
       from public.so_projects p where p.mode = 'work' and p.name ilike patron limit 5)
    union all
    (select 'chat'::text, c.id::text, c.title, c.mode, null::uuid, c.updated_at
       from public.so_chats c where c.title ilike patron order by c.updated_at desc limit 8)
    union all
    (select 'record'::text, r.id::text, left(r.data::text, 120), a.name || ' · ' || r.period::text, a.id, r.created_at
       from public.so_records r join public.so_artifacts a on a.datasource_id = r.datasource_id and a.deleted_at is null
      where r.data::text ilike patron order by r.created_at desc limit 8);
end;
$$;

revoke all on function public.so_buscar(text, int) from public, anon;
revoke all on function public.so_abrir_artefacto(uuid) from public, anon;
grant execute on function public.so_buscar(text, int) to authenticated;
grant execute on function public.so_abrir_artefacto(uuid) to authenticated;

notify pgrst, 'reload schema';
