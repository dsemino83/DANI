-- SO · automatizaciones programadas por calendario, ejecutadas en el servidor aunque SO esté cerrado.
-- Flujo: pg_cron (cada 5 min) → so_disparar_automatizaciones() → si hay pendientes, pg_net llama a la Edge Function
-- so-automatizaciones con un token que vive solo en Vault → la función valida el token con so_cron_token_valido(),
-- reclama turnos con so_reclamar_automatizaciones() (lease atómico, skip locked) y genera los archivos con el
-- service role, fijando siempre el dueño de la automatización (nunca hay acceso cruzado).
-- Configuración única fuera del repositorio (no son datos versionables): los secretos de Vault
--   'so_functions_url' (https://<ref>.supabase.co) y 'so_cron_token' (aleatorio, generado en la base).

create extension if not exists pg_net with schema extensions;   -- fuera de public (asesor de seguridad)

alter table public.so_automations add column if not exists schedule jsonb;
alter table public.so_automations add column if not exists next_run_at timestamptz;
alter table public.so_automations add column if not exists lease_until timestamptz;
alter table public.so_automations add column if not exists last_run_at timestamptz;
alter table public.so_automations add column if not exists last_status text;
alter table public.so_automations add column if not exists last_error text;
alter table public.so_automations add column if not exists runs int not null default 0;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'so_automations_schedule_check') then
    alter table public.so_automations add constraint so_automations_schedule_check check (schedule is null or (
      jsonb_typeof(schedule) = 'object' and schedule ->> 'tipo' in ('diaria', 'semanal', 'mensual')
      and schedule ->> 'hora' ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' and pg_column_size(schedule) < 2048));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'so_automations_last_status_check') then
    alter table public.so_automations add constraint so_automations_last_status_check check (last_status is null or last_status in ('ok', 'failed'));
  end if;
end $$;
create index if not exists so_automations_pendientes_idx on public.so_automations (next_run_at) where enabled and schedule is not null;

-- El dueño sigue habilitado (misma regla que es_valo(), pero para un usuario dado: el servidor no tiene sesión).
create or replace function public.so_usuario_habilitado(p_user uuid) returns boolean
language sql stable security definer set search_path = public, auth as $$
  select exists (select 1 from auth.users u where u.id = p_user and (lower(u.email) like '%@valo.ar'
                 or exists (select 1 from public.permitidos p where lower(p.email) = lower(u.email))));
$$;

-- Reclama hasta p_limite turnos vencidos con un lease de 10 minutos: dos ejecuciones simultáneas nunca toman el mismo.
create or replace function public.so_reclamar_automatizaciones(p_limite int default 10) returns setof public.so_automations
language sql security definer set search_path = public as $$
  update public.so_automations a set lease_until = now() + interval '10 minutes'
   where a.id in (select id from public.so_automations
                   where enabled and schedule is not null and next_run_at <= now() and (lease_until is null or lease_until < now())
                   order by next_run_at limit least(greatest(p_limite, 1), 50) for update skip locked)
  returning a.*;
$$;

-- Cierra un turno: próxima ejecución calculada por la función (misma lógica que el navegador), sin lease.
create or replace function public.so_cerrar_turno(p_id uuid, p_proxima timestamptz, p_estado text, p_error text default null) returns void
language sql security definer set search_path = public as $$
  update public.so_automations set next_run_at = p_proxima, lease_until = null, last_run_at = now(),
         last_status = p_estado, last_error = left(p_error, 500), runs = runs + 1
   where id = p_id;
$$;

create or replace function public.so_cron_token_valido(p_token text) returns boolean
language sql stable security definer set search_path = public, vault as $$
  select coalesce(length(p_token) >= 32 and p_token = (select decrypted_secret from vault.decrypted_secrets where name = 'so_cron_token' limit 1), false);
$$;

-- Llamado por pg_cron. Sin pendientes (o sin configuración) no hace nada; p_forzar sirve para comprobar el circuito.
create or replace function public.so_disparar_automatizaciones(p_forzar boolean default false) returns bigint
language plpgsql security definer set search_path = public, vault, net as $$
declare url text; tok text;
begin
  if not p_forzar and not exists (select 1 from public.so_automations where enabled and schedule is not null and next_run_at <= now()
                                    and (lease_until is null or lease_until < now())) then return null; end if;
  select decrypted_secret into url from vault.decrypted_secrets where name = 'so_functions_url' limit 1;
  select decrypted_secret into tok from vault.decrypted_secrets where name = 'so_cron_token' limit 1;
  if url is null or tok is null then return null; end if;
  return net.http_post(url := rtrim(url, '/') || '/functions/v1/so-automatizaciones',
                       headers := jsonb_build_object('Content-Type', 'application/json', 'x-so-cron', tok),
                       body := jsonb_build_object('forzar', p_forzar), timeout_milliseconds := 60000);
end;
$$;

revoke all on function public.so_usuario_habilitado(uuid) from public, anon, authenticated;
revoke all on function public.so_reclamar_automatizaciones(int) from public, anon, authenticated;
revoke all on function public.so_cerrar_turno(uuid, timestamptz, text, text) from public, anon, authenticated;
revoke all on function public.so_cron_token_valido(text) from public, anon, authenticated;
revoke all on function public.so_disparar_automatizaciones(boolean) from public, anon, authenticated;
grant execute on function public.so_usuario_habilitado(uuid) to service_role;
grant execute on function public.so_reclamar_automatizaciones(int) to service_role;
grant execute on function public.so_cerrar_turno(uuid, timestamptz, text, text) to service_role;
grant execute on function public.so_cron_token_valido(text) to service_role;

-- Los usuarios gestionan sus automatizaciones (RLS por dueño ya existente), pero no el estado interno del ejecutor
-- (un revoke por columna no alcanza mientras exista el grant de UPDATE sobre la tabla).
create or replace function public.so_t_automatizacion() returns trigger
language plpgsql set search_path = public as $$
begin
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      new.lease_until := null; new.last_run_at := null; new.last_status := null; new.last_error := null; new.runs := 0;
    else
      new.lease_until := old.lease_until; new.last_run_at := old.last_run_at; new.last_status := old.last_status;
      new.last_error := old.last_error; new.runs := old.runs;
    end if;
    if new.artifact_id is not null and not exists (select 1 from public.so_artifacts a where a.id = new.artifact_id and a.owner_id = new.owner_id) then
      raise exception 'el artefacto no pertenece al usuario' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists so_automations_estado on public.so_automations;
create trigger so_automations_estado before insert or update on public.so_automations for each row execute function public.so_t_automatizacion();
revoke all on function public.so_t_automatizacion() from public, anon, authenticated;

do $$ begin perform cron.unschedule('so-automatizaciones'); exception when others then null; end $$;
select cron.schedule('so-automatizaciones', '*/5 * * * *', $$select public.so_disparar_automatizaciones()$$);

notify pgrst, 'reload schema';
