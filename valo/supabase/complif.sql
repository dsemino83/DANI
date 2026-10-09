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
