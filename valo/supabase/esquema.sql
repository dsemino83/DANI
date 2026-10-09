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

-- ===================================================== Cola de envíos NO COBIS (agente en la red de VALO)
-- La página guarda envios/<id> con estado 'pendiente'; el agente (nocobis-agente.ps1, en una PC de la red) lo toma
-- con tomar_envio (solo uno lo puede tomar), lo ingresa en la API y deja los resultados con estado 'terminado'.
create or replace function public.tomar_envio(p_path text, p_agente text) returns boolean
language plpgsql security invoker set search_path = public as $$
begin
  update public.docs
     set data = data || jsonb_build_object('estado', 'procesando', 'tomadoPor', p_agente, 'tomado', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')),
         actualizado = now()
   where path = p_path and coleccion = 'envios' and data ->> 'estado' = 'pendiente';
  return found;
end;
$$;
revoke all on function public.tomar_envio(text, text) from public, anon;
grant execute on function public.tomar_envio(text, text) to authenticated;

-- ===================================================== Tipo de cambio Com. A 3500 (BCRA)
-- La página no puede consultar al BCRA directo (el BCRA no lo permite desde otros sitios): esta función lo consulta
-- desde la base. Variable 5 de la API de estadísticas del BCRA = Tipo de cambio mayorista Com. A 3500 (referencia).
create extension if not exists http with schema extensions;
create or replace function public.tc_bcra(p_desde date, p_hasta date) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare r extensions.http_response; v text;
begin
  if not public.es_valo() then raise exception 'sin permiso' using errcode = '42501'; end if;
  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT', '25');
  foreach v in array array['v4.0', 'v3.0'] loop
    begin
      select * into r from extensions.http_get(format('https://api.bcra.gob.ar/estadisticas/%s/monetarias/5?desde=%s&hasta=%s', v, p_desde, p_hasta));
      if r.status = 200 then return jsonb_build_object('status', r.status, 'version', v, 'body', r.content::jsonb); end if;
    exception when others then r := null;
    end;
  end loop;
  return jsonb_build_object('status', coalesce(r.status, 0), 'error', coalesce(left(r.content, 300), 'sin respuesta del BCRA'));
end;
$$;
revoke all on function public.tc_bcra(date, date) from public, anon;
grant execute on function public.tc_bcra(date, date) to authenticated;
notify pgrst, 'reload schema';

-- ===================================================== Base de entes (CUIT) para los inventarios de garantías
-- ente = código de cliente del sistema de cartera (external_code de las bases de personas humanas y jurídicas).
-- Se carga masivamente desde Excel o de a uno desde el inventario. Solo nombre y CUIT (sin datos personales extra).
create table if not exists public.entes (
  ente           text primary key,
  cuit           text not null,
  nombre         text,
  tipo           text,
  actualizado    timestamptz not null default now(),
  actualizado_por uuid default auth.uid()
);
alter table public.entes enable row level security;
drop policy if exists entes_leer on public.entes;
drop policy if exists entes_crear on public.entes;
drop policy if exists entes_modificar on public.entes;
create policy entes_leer      on public.entes for select to authenticated using (public.es_valo());
create policy entes_crear     on public.entes for insert to authenticated with check (public.es_valo());
create policy entes_modificar on public.entes for update to authenticated using (public.es_valo()) with check (public.es_valo());
notify pgrst, 'reload schema';

-- ===================================================== Complif (poderes y actas digitalizados por OCR)
-- Credenciales en una tabla sin políticas: la página no puede leerlas. Se cargan con complif_guardar (desde la
-- página, Bastanteo → Conexión con Complif) y solo las usan las funciones de abajo, que llaman a la API con la
-- extensión http. Producción: https://api.valo.complif.com (subdominio de la organización, no api.complif.com).
create table if not exists public.complif_config (
  id              int primary key default 1 check (id = 1),
  base_url        text not null default 'https://api.valo.complif.com',
  client_id       text,
  client_secret   text,
  token           text,
  token_vence     timestamptz,
  actualizado     timestamptz not null default now(),
  actualizado_por uuid default auth.uid()
);
alter table public.complif_config enable row level security;
revoke all on public.complif_config from anon, authenticated;

create or replace function public.complif_guardar(p_base_url text, p_client_id text, p_client_secret text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.es_valo() then raise exception 'sin permiso' using errcode = '42501'; end if;
  if coalesce(p_base_url, '') !~ '^https://[a-z0-9.-]+\.complif\.com/?$' then raise exception 'La URL tiene que ser https://….complif.com'; end if;
  insert into public.complif_config as c (id, base_url, client_id, client_secret, token, token_vence, actualizado, actualizado_por)
  values (1, rtrim(p_base_url, '/'), nullif(trim(p_client_id), ''), nullif(trim(p_client_secret), ''), null, null, now(), auth.uid())
  on conflict (id) do update set base_url = excluded.base_url,
    client_id = coalesce(excluded.client_id, c.client_id),
    client_secret = coalesce(excluded.client_secret, c.client_secret),   -- vacío = deja el que estaba
    token = null, token_vence = null, actualizado = now(), actualizado_por = auth.uid();
  return public.complif_estado();
end;
$$;

create or replace function public.complif_estado() returns jsonb
language plpgsql security definer set search_path = public as $$
declare c public.complif_config;
begin
  if not public.es_valo() then raise exception 'sin permiso' using errcode = '42501'; end if;
  select * into c from public.complif_config where id = 1;
  return jsonb_build_object('base_url', c.base_url, 'client_id', left(c.client_id, 8), 'tiene_secret', c.client_secret is not null,
    'actualizado', c.actualizado);
end;
$$;

-- Token OAuth (client_credentials), guardado hasta 5 minutos antes de vencer. Uso interno.
create or replace function public.complif_token(p_forzar boolean default false) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare c public.complif_config; r extensions.http_response; j jsonb;
begin
  select * into c from public.complif_config where id = 1 for update;
  if c.client_id is null or c.client_secret is null then raise exception 'Complif: faltan las credenciales (Bastanteo → Conexión con Complif)'; end if;
  if not p_forzar and c.token is not null and c.token_vence > now() + interval '5 minutes' then return c.token; end if;
  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT', '30');
  select * into r from extensions.http_post(c.base_url || '/api/auth/v1/oauth/token',
    jsonb_build_object('client_id', c.client_id, 'client_secret', c.client_secret, 'grant_type', 'client_credentials')::text, 'application/json');
  if r.status <> 200 then
    raise exception 'Complif login HTTP %: % (si dice invalid_grant, revisar primero la URL)', r.status, left(r.content, 200);
  end if;
  j := r.content::jsonb;
  update public.complif_config set token = j->>'access_token',
    token_vence = now() + make_interval(secs => coalesce((j->>'expires_in')::int, 3600)) where id = 1;
  return j->>'access_token';
end;
$$;
revoke all on function public.complif_token(boolean) from public, anon, authenticated;

-- GET de solo lectura a /api/documents/v1… (p_ruta = ruta + consulta, ya codificada). Un 401 renueva el token una vez.
create or replace function public.complif_get(p_ruta text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare c public.complif_config; r extensions.http_response; t text; i int;
begin
  if not public.es_valo() then raise exception 'sin permiso' using errcode = '42501'; end if;
  if p_ruta !~ '^/api/documents/v1([/?]|$)' or p_ruta ~ '\s|\.\.' then raise exception 'ruta no permitida'; end if;
  select * into c from public.complif_config where id = 1;
  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT', '60');
  for i in 1..2 loop
    t := public.complif_token(i = 2);
    select * into r from extensions.http((
      'GET', c.base_url || p_ruta, array[extensions.http_header('Authorization', 'Bearer ' || t)], null, null)::extensions.http_request);
    exit when r.status <> 401;
  end loop;
  if r.status = 200 then return jsonb_build_object('status', 200, 'body', r.content::jsonb); end if;
  return jsonb_build_object('status', r.status, 'error', left(r.content, 300));
end;
$$;
revoke all on function public.complif_guardar(text, text, text) from public, anon;
revoke all on function public.complif_estado() from public, anon;
revoke all on function public.complif_get(text) from public, anon;
grant execute on function public.complif_guardar(text, text, text) to authenticated;
grant execute on function public.complif_estado() to authenticated;
grant execute on function public.complif_get(text) to authenticated;
notify pgrst, 'reload schema';
