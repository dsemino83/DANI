-- SO · Correo (Gmail): cuentas conectadas por OAuth, mensajes sincronizados y borradores de respuesta.
-- Seguridad: cada usuario solo LEE lo suyo (RLS por dueño + es_valo). Escribe únicamente la Edge Function so-correo con
-- service role, fijando el dueño. El refresh token de Google vive en Vault (token_ref); nunca llega al navegador.
-- SO nunca envía correos: solo crea borradores que el usuario aprueba y manda desde Gmail.

create table if not exists public.so_mail_accounts (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null default auth.uid(),
  provider     text not null default 'gmail' check (provider in ('gmail')),
  email        text not null check (length(email) between 3 and 320),
  token_ref    uuid,                                   -- id del secreto en Vault (nunca el valor)
  scopes       text[] not null default '{}',
  status       text not null default 'conectada' check (status in ('conectada', 'error', 'desconectada')),
  last_sync_at timestamptz,
  last_error   text check (last_error is null or length(last_error) <= 500),
  created_at   timestamptz not null default now(),
  unique (owner_id, provider, email)
);

create table if not exists public.so_mails (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid not null,
  account_id      uuid not null references public.so_mail_accounts (id) on delete cascade,
  gmail_id        text not null,
  thread_id       text,
  message_id      text,
  from_addr       text,
  from_name       text,
  to_addrs        text[] not null default '{}',
  subject         text,
  snippet         text,
  body            text check (body is null or length(body) <= 20000),
  received_at     timestamptz not null,
  labels          text[] not null default '{}',
  unread          boolean not null default false,
  outbound        boolean not null default false,
  has_attachments boolean not null default false,
  created_at      timestamptz not null default now(),
  unique (account_id, gmail_id)
);
create index if not exists so_mails_owner_idx on public.so_mails (owner_id, received_at desc);
create index if not exists so_mails_thread_idx on public.so_mails (account_id, thread_id);

create table if not exists public.so_mail_drafts (
  id             uuid primary key default gen_random_uuid(),
  owner_id       uuid not null,
  account_id     uuid not null references public.so_mail_accounts (id) on delete cascade,
  mail_id        uuid references public.so_mails (id) on delete set null,
  to_addr        text,
  subject        text,
  body           text not null check (length(body) between 1 and 20000),
  status         text not null default 'creado' check (status in ('creado', 'error')),
  gmail_draft_id text,
  error          text,
  created_at     timestamptz not null default now()
);

-- Estado del flujo OAuth (anti-CSRF + PKCE). Solo lo usa la función; vence a los 10 minutos.
create table if not exists public.so_mail_oauth_state (
  state      text primary key check (length(state) >= 32),
  owner_id   uuid not null,
  verifier   text not null,
  volver     text not null,
  created_at timestamptz not null default now()
);

do $$
declare t text;
begin
  foreach t in array array['so_mail_accounts', 'so_mails', 'so_mail_drafts', 'so_mail_oauth_state'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
  foreach t in array array['so_mail_accounts', 'so_mails', 'so_mail_drafts'] loop
    execute format('drop policy if exists %I on public.%I', t || '_leer', t);
    execute format('create policy %I on public.%I for select to authenticated using (owner_id = auth.uid() and public.es_valo())', t || '_leer', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;
-- token_ref no se expone ni al dueño (no lo necesita la página).
revoke select on public.so_mail_accounts from authenticated;
grant select (id, owner_id, provider, email, scopes, status, last_sync_at, last_error, created_at) on public.so_mail_accounts to authenticated;

-- Refresh token de Google en Vault (solo service_role).
create or replace function public.so_correo_guardar_token(p_cuenta uuid, p_token text) returns void
language plpgsql security definer set search_path = public, vault as $$
declare c public.so_mail_accounts; sid uuid;
begin
  select * into c from public.so_mail_accounts where id = p_cuenta;
  if c.id is null then raise exception 'cuenta inexistente' using errcode = 'P0002'; end if;
  if coalesce(length(p_token), 0) not between 10 and 4096 then raise exception 'token inválido' using errcode = '22023'; end if;
  if c.token_ref is not null and exists (select 1 from vault.secrets where id = c.token_ref) then
    perform vault.update_secret(c.token_ref, p_token);
  else
    sid := vault.create_secret(p_token, 'so_mail:' || c.id::text, 'Token de Gmail de una cuenta de SO');
    update public.so_mail_accounts set token_ref = sid where id = c.id;
  end if;
end;
$$;
create or replace function public.so_correo_leer_token(p_cuenta uuid) returns text
language sql stable security definer set search_path = public, vault as $$
  select ds.decrypted_secret from public.so_mail_accounts c join vault.decrypted_secrets ds on ds.id = c.token_ref where c.id = p_cuenta;
$$;
create or replace function public.so_correo_borrar_token(p_cuenta uuid) returns void
language plpgsql security definer set search_path = public, vault as $$
declare ref uuid;
begin
  select token_ref into ref from public.so_mail_accounts where id = p_cuenta;
  if ref is not null then delete from vault.secrets where id = ref; end if;
  update public.so_mail_accounts set token_ref = null where id = p_cuenta;
end;
$$;
revoke all on function public.so_correo_guardar_token(uuid, text) from public, anon, authenticated;
revoke all on function public.so_correo_leer_token(uuid) from public, anon, authenticated;
revoke all on function public.so_correo_borrar_token(uuid) from public, anon, authenticated;
grant execute on function public.so_correo_guardar_token(uuid, text) to service_role;
grant execute on function public.so_correo_leer_token(uuid) to service_role;
grant execute on function public.so_correo_borrar_token(uuid) to service_role;

notify pgrst, 'reload schema';
