-- VALO - EPORTFOLIO · Base compartida en Supabase.
-- Ejecutar una sola vez en el proyecto: Supabase → SQL Editor → New query → pegar todo → Run.
--
-- Modelo: igual que la base de claude.ai, cada registro es un "documento" JSON con una ruta
--   clientes/<id>, lotes/<id>, lotesTxt/<id>_cuotas_<n>, maestros/bancos, maestros/bancosMeli, maestros/carteraConfig ...
-- Acceso: solo usuarios con sesión cuyo correo termine en @valo.ar o figure en la tabla "permitidos".
-- Los usuarios los crea el administrador desde Authentication → Users → Add user (con "Auto Confirm User").

create table if not exists public.docs (
  path        text primary key,
  coleccion   text not null,
  data        jsonb not null,
  actualizado timestamptz not null default now()
);
create index if not exists docs_coleccion_idx on public.docs (coleccion);

-- Correos habilitados además de los @valo.ar.
create table if not exists public.permitidos (email text primary key);
insert into public.permitidos (email) values ('d.semino83@gmail.com') on conflict do nothing;

-- Nombre visible de cada usuario (para el historial: quién procesó cada lote).
create table if not exists public.perfiles (
  id     uuid primary key,
  email  text,
  nombre text
);

-- Bloqueos cortos para que dos usuarios no tomen la misma secuencia de un cliente al mismo tiempo.
create table if not exists public.bloqueos (
  path   text primary key,
  holder text not null,
  vence  timestamptz not null
);

-- ¿El usuario de la sesión está habilitado?
create or replace function public.es_valo() returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and (
    coalesce(lower(auth.jwt() ->> 'email') like '%@valo.ar', false)
    or exists (select 1 from public.permitidos p where lower(p.email) = lower(auth.jwt() ->> 'email'))
  );
$$;

alter table public.docs       enable row level security;
alter table public.permitidos enable row level security;
alter table public.perfiles   enable row level security;
alter table public.bloqueos   enable row level security;

drop policy if exists docs_leer on public.docs;
drop policy if exists docs_crear on public.docs;
drop policy if exists docs_modificar on public.docs;
drop policy if exists docs_borrar on public.docs;
create policy docs_leer      on public.docs for select to authenticated using (public.es_valo());
create policy docs_crear     on public.docs for insert to authenticated with check (public.es_valo());
create policy docs_modificar on public.docs for update to authenticated using (public.es_valo()) with check (public.es_valo());
create policy docs_borrar    on public.docs for delete to authenticated using (public.es_valo());

drop policy if exists perfiles_leer on public.perfiles;
drop policy if exists perfiles_propio_crear on public.perfiles;
drop policy if exists perfiles_propio_modificar on public.perfiles;
create policy perfiles_leer             on public.perfiles for select to authenticated using (public.es_valo());
create policy perfiles_propio_crear     on public.perfiles for insert to authenticated with check (id = auth.uid());
create policy perfiles_propio_modificar on public.perfiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
-- permitidos y bloqueos: sin políticas (solo desde el panel o las funciones de abajo).

-- Toma el bloqueo de una ruta si está libre, vencido o ya era de quien lo pide.
create or replace function public.adquirir(p_path text, p_holder text, p_ttl_ms integer) returns boolean
language plpgsql security definer set search_path = public as $$
declare tomado boolean;
begin
  if not public.es_valo() then raise exception 'sin permiso' using errcode = '42501'; end if;
  insert into public.bloqueos as b (path, holder, vence)
  values (p_path, p_holder, now() + make_interval(secs => p_ttl_ms / 1000.0))
  on conflict (path) do update set holder = excluded.holder, vence = excluded.vence
    where b.vence < now() or b.holder = excluded.holder
  returning true into tomado;
  return coalesce(tomado, false);
end;
$$;

-- Actualiza campos de un documento (mezcla de primer nivel), sin pisar el resto.
create or replace function public.doc_update(p_path text, p_patch jsonb) returns void
language plpgsql security invoker set search_path = public as $$
begin
  update public.docs set data = data || p_patch, actualizado = now() where path = p_path;
  if not found then raise exception 'el documento % no existe', p_path using errcode = 'P0002'; end if;
end;
$$;

revoke all on function public.adquirir(text, text, integer) from public, anon;
revoke all on function public.doc_update(text, jsonb) from public, anon;
revoke all on function public.es_valo() from public, anon;
grant execute on function public.adquirir(text, text, integer) to authenticated;
grant execute on function public.doc_update(text, jsonb) to authenticated;
grant execute on function public.es_valo() to authenticated;

-- Cambios en vivo para todos los usuarios conectados.
do $$ begin
  alter publication supabase_realtime add table public.docs;
exception when duplicate_object then null; end $$;
