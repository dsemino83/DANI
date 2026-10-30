-- SO · Encargos a Claude: Francisco deriva pedidos que necesitan los conectores de la cuenta de Claude del usuario a
-- una tarea programada de Claude Code (disparador por API) y despliega el resultado. Todo por detrás.
-- Seguridad: cada usuario solo LEE lo suyo (RLS por dueño + es_valo). Escribe únicamente la Edge Function so-encargos
-- con service role, fijando el dueño. La clave del disparador vive en Vault (token_ref) y nunca llega al navegador; cada
-- encargo tiene una clave de un solo uso de la que solo se guarda el hash.

create table if not exists public.so_claude_vinculos (
  owner_id     uuid primary key,
  routine_url  text not null check (routine_url ~ '^https://api\.anthropic\.com/v1/claude_code/routines/trig_[A-Za-z0-9]{10,64}/fire$'),
  token_ref    uuid,                                   -- id del secreto en Vault (nunca el valor)
  last_fire_at timestamptz,
  last_error   text check (last_error is null or length(last_error) <= 500),
  created_at   timestamptz not null default now()
);

create table if not exists public.so_encargos (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null,
  chat_id     uuid references public.so_chats (id) on delete set null,
  pedido      text not null check (length(pedido) between 1 and 4000),
  contexto    jsonb not null default '{}'::jsonb,
  estado      text not null default 'pendiente' check (estado in ('pendiente', 'enviado', 'en_curso', 'listo', 'fallo')),
  token_hash  text,                                    -- sha256 de la clave de un solo uso (se borra al entregar)
  resultado   jsonb,
  error       text check (error is null or length(error) <= 1000),
  session_url text,
  created_at  timestamptz not null default now(),
  started_at  timestamptz,
  finished_at timestamptz
);
create index if not exists so_encargos_owner_idx on public.so_encargos (owner_id, created_at desc);

do $$
declare t text;
begin
  foreach t in array array['so_claude_vinculos', 'so_encargos'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('drop policy if exists %I on public.%I', t || '_leer', t);
    execute format('create policy %I on public.%I for select to authenticated using (owner_id = auth.uid() and public.es_valo())', t || '_leer', t);
  end loop;
end $$;
-- Ni la referencia a la clave ni el hash del encargo se exponen (la página no los necesita).
grant select (owner_id, routine_url, last_fire_at, last_error, created_at) on public.so_claude_vinculos to authenticated;
grant select (id, owner_id, chat_id, pedido, estado, resultado, error, session_url, created_at, started_at, finished_at) on public.so_encargos to authenticated;

-- Clave del disparador en Vault (solo service_role).
create or replace function public.so_claude_guardar(p_owner uuid, p_url text, p_token text) returns void
language plpgsql security definer set search_path = public, vault as $$
declare v public.so_claude_vinculos; sid uuid;
begin
  if coalesce(length(p_token), 0) not between 20 and 4096 then raise exception 'clave inválida' using errcode = '22023'; end if;
  insert into public.so_claude_vinculos (owner_id, routine_url) values (p_owner, p_url)
    on conflict (owner_id) do update set routine_url = excluded.routine_url, last_error = null;
  select * into v from public.so_claude_vinculos where owner_id = p_owner;
  if v.token_ref is not null and exists (select 1 from vault.secrets where id = v.token_ref) then
    perform vault.update_secret(v.token_ref, p_token);
  else
    sid := vault.create_secret(p_token, 'so_claude:' || p_owner::text, 'Clave del disparador de Claude de un usuario de SO');
    update public.so_claude_vinculos set token_ref = sid where owner_id = p_owner;
  end if;
end;
$$;
create or replace function public.so_claude_leer(p_owner uuid) returns table (url text, token text)
language sql stable security definer set search_path = public, vault as $$
  select v.routine_url, ds.decrypted_secret from public.so_claude_vinculos v join vault.decrypted_secrets ds on ds.id = v.token_ref where v.owner_id = p_owner;
$$;
-- Desvincular: el valor guardado se reemplaza por uno aleatorio inservible (sin DELETE en Vault) y se borra el vínculo.
create or replace function public.so_claude_borrar(p_owner uuid) returns void
language plpgsql security definer set search_path = public, vault, extensions as $$
declare ref uuid;
begin
  select token_ref into ref from public.so_claude_vinculos where owner_id = p_owner;
  if ref is not null then perform vault.update_secret(ref, encode(gen_random_bytes(32), 'hex')); end if;
  delete from public.so_claude_vinculos where owner_id = p_owner;
end;
$$;
revoke all on function public.so_claude_guardar(uuid, text, text) from public, anon, authenticated;
revoke all on function public.so_claude_leer(uuid) from public, anon, authenticated;
revoke all on function public.so_claude_borrar(uuid) from public, anon, authenticated;
grant execute on function public.so_claude_guardar(uuid, text, text) to service_role;
grant execute on function public.so_claude_leer(uuid) to service_role;
grant execute on function public.so_claude_borrar(uuid) to service_role;

notify pgrst, 'reload schema';
