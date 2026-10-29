-- Simulación mínima de lo que Supabase provee (auth, storage, vault, cron, net) para correr las migraciones y
-- seguridad.sql en un PostgreSQL local. SOLO para pruebas: nunca se aplica a un proyecto real.
create role anon; create role authenticated; create role service_role;
create schema auth; create schema extensions;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
create table public.permitidos(email text primary key);
create function public.es_valo() returns boolean language sql stable security definer set search_path=public as $$
 select auth.uid() is not null and (coalesce(lower(auth.jwt()->>'email') like '%@valo.ar',false) or exists(select 1 from public.permitidos p where lower(p.email)=lower(auth.jwt()->>'email'))) $$;
grant usage on schema public, auth to authenticated, anon; grant execute on all functions in schema auth to authenticated, anon;
alter default privileges in schema public grant all on tables to authenticated, anon;
create schema cron; create function cron.schedule(a text, b text, c text) returns bigint language sql as 'select 1::bigint'; create function cron.unschedule(a text) returns boolean language sql as 'select true';
create schema storage;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid default auth.uid());
create function storage.foldername(name text) returns text[] language sql immutable as $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
alter table storage.objects enable row level security;
grant usage on schema storage to authenticated; grant all on storage.objects to authenticated; grant execute on all functions in schema storage to authenticated;
create schema vault;
create table vault.secrets (id uuid primary key default gen_random_uuid(), name text, description text, secret text);
create function vault.create_secret(secret text, name text, description text) returns uuid language sql as $$ insert into vault.secrets (secret, name, description) values (secret, name, description) returning id $$;
create function vault.update_secret(id uuid, secret text) returns void language sql as $$ update vault.secrets s set secret = update_secret.secret where s.id = update_secret.id $$;
create view vault.decrypted_secrets as select id, name, secret as decrypted_secret from vault.secrets;
revoke all on schema vault from public;
create table public.perfiles (id uuid primary key, email text, nombre text);
grant usage on schema public to service_role;
create table if not exists auth.users (id uuid primary key, email text);
create schema if not exists net;
create table if not exists net.llamadas (id bigserial primary key, url text, headers jsonb, body jsonb, at timestamptz default now());
create or replace function net.http_post(url text, body jsonb default '{}'::jsonb, params jsonb default '{}'::jsonb, headers jsonb default '{}'::jsonb, timeout_milliseconds int default 5000)
returns bigint language sql as $$ insert into net.llamadas (url, headers, body) values (url, headers, body) returning id $$;
-- Como en Supabase: service_role ignora RLS y tiene permisos sobre las tablas de public.
alter role service_role bypassrls;
grant all on all tables in schema public to service_role; alter default privileges in schema public grant all on tables to service_role;
