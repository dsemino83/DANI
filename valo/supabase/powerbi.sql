-- ===================================================== Power BI sin Power Automate
-- Supabase ejecuta la consulta DAX en el modelo con la API REST de Power BI (executeQueries), con una aplicación de
-- Microsoft Entra (service principal, client_credentials). Credenciales en una tabla sin políticas (la página no puede
-- leerlas); se cargan desde Cartera → Conexión con Power BI. Requisitos del lado de Microsoft: powerautomate/POWERBI.md.
create table if not exists public.pbi_config (
  id              int primary key default 1 check (id = 1),
  tenant_id       text,
  client_id       text,
  client_secret   text,
  group_id        text,
  dataset_id      text,
  token           text,
  token_vence     timestamptz,
  actualizado     timestamptz not null default now(),
  actualizado_por uuid default auth.uid()
);
alter table public.pbi_config enable row level security;
revoke all on public.pbi_config from anon, authenticated;

create or replace function public.pbi_estado() returns jsonb
language plpgsql security definer set search_path = public as $$
declare c public.pbi_config;
begin
  if not public.es_valo() then raise exception 'sin permiso' using errcode = '42501'; end if;
  select * into c from public.pbi_config where id = 1;
  return jsonb_build_object('listo', c.tenant_id is not null and c.client_id is not null and c.client_secret is not null and c.group_id is not null and c.dataset_id is not null,
    'tenant_id', c.tenant_id, 'client_id', left(c.client_id, 8), 'tiene_secret', c.client_secret is not null,
    'group_id', c.group_id, 'dataset_id', c.dataset_id, 'actualizado', c.actualizado);
end;
$$;

-- Vacío = deja el valor que estaba.
create or replace function public.pbi_guardar(p_tenant_id text, p_client_id text, p_client_secret text, p_group_id text, p_dataset_id text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.es_valo() then raise exception 'sin permiso' using errcode = '42501'; end if;
  insert into public.pbi_config as c (id, tenant_id, client_id, client_secret, group_id, dataset_id, actualizado, actualizado_por)
  values (1, nullif(trim(p_tenant_id), ''), nullif(trim(p_client_id), ''), nullif(trim(p_client_secret), ''), nullif(trim(p_group_id), ''), nullif(trim(p_dataset_id), ''), now(), auth.uid())
  on conflict (id) do update set
    tenant_id = coalesce(excluded.tenant_id, c.tenant_id), client_id = coalesce(excluded.client_id, c.client_id),
    client_secret = coalesce(excluded.client_secret, c.client_secret), group_id = coalesce(excluded.group_id, c.group_id),
    dataset_id = coalesce(excluded.dataset_id, c.dataset_id), token = null, token_vence = null, actualizado = now(), actualizado_por = auth.uid();
  return public.pbi_estado();
end;
$$;

-- Token de Entra ID (client_credentials, scope de Power BI), guardado hasta 5 minutos antes de vencer. Uso interno.
create or replace function public.pbi_token(p_forzar boolean default false) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare c public.pbi_config; r extensions.http_response; j jsonb;
begin
  select * into c from public.pbi_config where id = 1 for update;
  if c.tenant_id is null or c.client_id is null or c.client_secret is null then raise exception 'Power BI: faltan las credenciales (Cartera → Conexión con Power BI)'; end if;
  if not p_forzar and c.token is not null and c.token_vence > now() + interval '5 minutes' then return c.token; end if;
  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT', '30');
  select * into r from extensions.http_post('https://login.microsoftonline.com/' || c.tenant_id || '/oauth2/v2.0/token',
    'grant_type=client_credentials&client_id=' || extensions.urlencode(c.client_id) || '&client_secret=' || extensions.urlencode(c.client_secret)
      || '&scope=' || extensions.urlencode('https://analysis.windows.net/powerbi/api/.default'), 'application/x-www-form-urlencoded');
  if r.status <> 200 then raise exception 'Power BI login HTTP %: %', r.status, left(r.content, 300); end if;
  j := r.content::jsonb;
  update public.pbi_config set token = j->>'access_token', token_vence = now() + make_interval(secs => coalesce((j->>'expires_in')::int, 3600)) where id = 1;
  return j->>'access_token';
end;
$$;
revoke all on function public.pbi_token(boolean) from public, anon, authenticated;

-- Ejecuta una consulta DAX en el modelo. Devuelve { status, rows } (filas de la primera tabla) o { status, error }.
create or replace function public.pbi_consulta(p_dax text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare c public.pbi_config; r extensions.http_response; t text; i int; j jsonb;
begin
  if not public.es_valo() then raise exception 'sin permiso' using errcode = '42501'; end if;
  select * into c from public.pbi_config where id = 1;
  if c.group_id is null or c.dataset_id is null then raise exception 'Power BI: falta el área de trabajo o el modelo (Cartera → Conexión con Power BI)'; end if;
  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT', '120');
  for i in 1..2 loop
    t := public.pbi_token(i = 2);
    select * into r from extensions.http((
      'POST', 'https://api.powerbi.com/v1.0/myorg/groups/' || c.group_id || '/datasets/' || c.dataset_id || '/executeQueries',
      array[extensions.http_header('Authorization', 'Bearer ' || t)], 'application/json',
      jsonb_build_object('queries', jsonb_build_array(jsonb_build_object('query', p_dax)), 'serializerSettings', jsonb_build_object('includeNulls', true))::text
    )::extensions.http_request);
    exit when r.status <> 401;
  end loop;
  if r.status <> 200 then return jsonb_build_object('status', r.status, 'error', left(r.content, 500)); end if;
  j := r.content::jsonb;
  if j->'results'->0 ? 'error' then return jsonb_build_object('status', 400, 'error', left((j->'results'->0->'error')::text, 500)); end if;
  return jsonb_build_object('status', 200, 'rows', coalesce(j->'results'->0->'tables'->0->'rows', '[]'::jsonb));
end;
$$;
revoke all on function public.pbi_estado() from public, anon;
revoke all on function public.pbi_guardar(text, text, text, text, text) from public, anon;
revoke all on function public.pbi_consulta(text) from public, anon;
grant execute on function public.pbi_estado() to authenticated;
grant execute on function public.pbi_guardar(text, text, text, text, text) to authenticated;
grant execute on function public.pbi_consulta(text) to authenticated;
notify pgrst, 'reload schema';
