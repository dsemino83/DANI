-- SO / Francisco · ingesta universal: archivos (Storage privado + metadatos), contenido indexado, DatasetRegistry,
-- entradas de datos por artefacto, lotes de importación con linaje y reversión, fuentes API con secretos en Vault.
-- Requiere 20261029120000_so_francisco.sql y 20261029180000_so_ux.sql.

-- ===================================================== Storage: bucket privado, aislado por usuario
insert into storage.buckets (id, name, public, file_size_limit)
values ('so-archivos', 'so-archivos', false, 52428800)          -- 50 MB por archivo (límite del plan)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

drop policy if exists so_archivos_leer on storage.objects;
drop policy if exists so_archivos_subir on storage.objects;
drop policy if exists so_archivos_modificar on storage.objects;
drop policy if exists so_archivos_borrar on storage.objects;
-- Ruta obligatoria: <auth.uid()>/<fileId>/<nombre-saneado>. Nadie lee la carpeta de otro (tampoco quien recibe un tablero).
create policy so_archivos_leer on storage.objects for select to authenticated
  using (bucket_id = 'so-archivos' and (storage.foldername(name))[1] = auth.uid()::text and public.es_valo());
create policy so_archivos_subir on storage.objects for insert to authenticated
  with check (bucket_id = 'so-archivos' and (storage.foldername(name))[1] = auth.uid()::text and public.es_valo());
create policy so_archivos_modificar on storage.objects for update to authenticated
  using (bucket_id = 'so-archivos' and (storage.foldername(name))[1] = auth.uid()::text and public.es_valo());
create policy so_archivos_borrar on storage.objects for delete to authenticated
  using (bucket_id = 'so-archivos' and (storage.foldername(name))[1] = auth.uid()::text and public.es_valo());

-- ===================================================== Archivos (metadatos; el binario vive en Storage)
create table if not exists public.so_files (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null default auth.uid(),
  project_id    uuid references public.so_projects (id) on delete set null,
  artifact_id   uuid references public.so_artifacts (id) on delete set null,
  chat_id       uuid references public.so_chats (id) on delete set null,
  message_id    bigint references public.so_messages (id) on delete set null,
  original_name text not null check (length(original_name) between 1 and 255),
  safe_name     text not null check (safe_name ~ '^[A-Za-z0-9][A-Za-z0-9._ -]{0,180}$' and safe_name !~ '\.\.'),
  mime_type     text,                                   -- declarado por el navegador (no confiable)
  detected_type text not null,                          -- detectado por firma de bytes
  kind          text not null check (kind in ('document', 'table', 'image', 'presentation', 'other')),
  size          bigint not null check (size >= 0 and size <= 52428800),
  storage_path  text unique,
  checksum      text not null check (checksum ~ '^[0-9a-f]{64}$'),
  status        text not null default 'uploading' check (status in ('uploading', 'uploaded', 'validating', 'processing', 'mapping',
                  'importing', 'ready', 'partial', 'failed', 'blocked', 'expired')),
  stage_error   jsonb,                                   -- { etapa, mensaje } para reintentar desde la etapa que falló
  source        text not null default 'chat' check (source in ('chat', 'dashboard', 'api', 'shared')),
  security      jsonb not null default '{}'::jsonb,       -- controles hechos (firma, macros, escaneo antivirus: no disponible)
  meta          jsonb not null default '{}'::jsonb,       -- páginas, hojas, columnas, dimensiones, resumen
  version_of    uuid references public.so_files (id) on delete set null,
  version       int not null default 1,
  retention     text not null default 'temporary' check (retention in ('temporary', 'active', 'archive', 'lineage')),
  expires_at    timestamptz default now() + interval '90 days',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  search        tsvector generated always as (to_tsvector('spanish', coalesce(original_name, '') || ' ' || coalesce(meta ->> 'resumen', ''))) stored,
  check (storage_path is null or storage_path like owner_id::text || '/' || id::text || '/%')
);
create index if not exists so_files_owner_idx on public.so_files (owner_id, created_at desc);
create index if not exists so_files_checksum_idx on public.so_files (owner_id, checksum);
create index if not exists so_files_search_idx on public.so_files using gin (search);

-- Contenido extraído en fragmentos con referencia (página/hoja/diapositiva/sección), para recuperar solo lo relevante.
create table if not exists public.so_file_chunks (
  id       bigint generated always as identity primary key,
  file_id  uuid not null references public.so_files (id) on delete cascade,
  owner_id uuid not null default auth.uid(),
  ord      int not null,
  ref      jsonb not null default '{}'::jsonb,
  content  text not null check (length(content) <= 8000),
  tsv      tsvector generated always as (to_tsvector('spanish', content)) stored,
  unique (file_id, ord)
);
create index if not exists so_file_chunks_tsv_idx on public.so_file_chunks using gin (tsv);
create index if not exists so_file_chunks_owner_idx on public.so_file_chunks (owner_id);

-- ===================================================== DatasetRegistry (so_datasources): una fuente, muchos artefactos
alter table public.so_datasources add column if not exists description text;
alter table public.so_datasources add column if not exists source_types text[] not null default '{}';
alter table public.so_datasources add column if not exists storage text not null default 'so_records';
alter table public.so_datasources add column if not exists retention text not null default 'indefinida';

-- ===================================================== Entradas de datos declaradas por cada artefacto
create table if not exists public.so_data_inputs (
  id               uuid primary key default gen_random_uuid(),
  owner_id         uuid not null default auth.uid(),
  artifact_id      uuid not null references public.so_artifacts (id) on delete cascade,
  dataset_id       uuid references public.so_datasources (id) on delete restrict,
  name             text not null check (length(name) between 1 and 120),
  type             text not null check (type in ('FILE_UPLOAD', 'API', 'EXISTING_DATASET', 'MANUAL_INPUT', 'CONNECTOR', 'GENERATED')),
  configuration    jsonb not null default '{}'::jsonb,
  schema           jsonb not null default '{}'::jsonb,
  mapping          jsonb not null default '{}'::jsonb,
  refresh_strategy text not null default 'MANUAL' check (refresh_strategy in ('MANUAL', 'ON_OPEN', 'INTERVAL', 'SCHEDULED', 'WEBHOOK')),
  permissions      jsonb not null default '{}'::jsonb,
  status           text not null default 'active' check (status in ('active', 'paused', 'error', 'removed')),
  last_updated_at  timestamptz,
  created_at       timestamptz not null default now()
);
create index if not exists so_data_inputs_artifact_idx on public.so_data_inputs (artifact_id);

-- ===================================================== Fuentes API (sin secretos: solo referencia a Vault)
create table if not exists public.so_api_sources (
  id                   uuid primary key default gen_random_uuid(),
  owner_id             uuid not null default auth.uid(),
  artifact_id          uuid references public.so_artifacts (id) on delete set null,
  dataset_id           uuid references public.so_datasources (id) on delete restrict,
  input_id             uuid references public.so_data_inputs (id) on delete set null,
  name                 text not null check (length(name) between 1 and 120),
  base_url             text not null check (base_url ~ '^https://[A-Za-z0-9.-]+(:443)?(/[^\s]*)?$' and length(base_url) <= 2000),
  method               text not null default 'GET' check (method in ('GET', 'POST')),
  headers              jsonb not null default '{}'::jsonb,     -- solo encabezados no secretos
  auth_ref             uuid,                                    -- id del secreto en Vault (nunca el valor)
  auth_scheme          text not null default 'none' check (auth_scheme in ('none', 'bearer', 'header', 'query')),
  auth_name            text check (auth_name is null or auth_name ~ '^[A-Za-z0-9_-]{1,64}$'),
  parameters           jsonb not null default '{}'::jsonb,
  pagination           jsonb not null default '{}'::jsonb,
  response_mapping     jsonb not null default '{}'::jsonb,
  refresh_strategy     text not null default 'MANUAL' check (refresh_strategy in ('MANUAL', 'ON_OPEN', 'INTERVAL', 'SCHEDULED', 'WEBHOOK')),
  refresh_interval_min int check (refresh_interval_min is null or refresh_interval_min >= 15),
  timeout_ms           int not null default 10000 check (timeout_ms between 1000 and 30000),
  retry_policy         jsonb not null default '{"max": 2}'::jsonb,
  status               text not null default 'draft' check (status in ('draft', 'ok', 'error', 'paused')),
  last_sync_at         timestamptz,
  last_error           text,
  created_at           timestamptz not null default now()
);

-- ===================================================== Lotes de importación (auditoría, linaje, reversión, duplicados)
create table if not exists public.so_import_batches (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid not null default auth.uid(),
  dataset_id      uuid not null references public.so_datasources (id) on delete restrict,
  artifact_id     uuid references public.so_artifacts (id) on delete set null,
  input_id        uuid references public.so_data_inputs (id) on delete set null,
  source_file_id  uuid references public.so_files (id) on delete set null,
  api_source_id   uuid references public.so_api_sources (id) on delete set null,
  user_id         uuid default auth.uid(),
  source_type     text not null default 'file' check (source_type in ('file', 'api', 'manual', 'shared')),
  strategy        text not null check (strategy in ('APPEND', 'UPSERT', 'REPLACE', 'TEMPORARY')),
  key_field       text,
  checksum        text,
  source_name     text,
  mapping         jsonb not null default '{}'::jsonb,
  status          text not null default 'importing' check (status in ('importing', 'ready', 'partial', 'failed', 'undone', 'expired')),
  rows_received   int not null default 0,
  rows_accepted   int not null default 0,
  rows_rejected   int not null default 0,
  rows_superseded int not null default 0,
  errors          jsonb not null default '[]'::jsonb,       -- primeras incidencias por fila: [{ fila, motivo }]
  error_summary   text,
  started_at      timestamptz not null default now(),
  completed_at    timestamptz,
  check (strategy <> 'UPSERT' or key_field is not null)
);
create index if not exists so_import_batches_ds_idx on public.so_import_batches (dataset_id, started_at desc);
create index if not exists so_import_batches_checksum_idx on public.so_import_batches (dataset_id, checksum);

alter table public.so_records add column if not exists import_batch_id uuid references public.so_import_batches (id) on delete set null;
alter table public.so_records add column if not exists source_ref jsonb;          -- { fila, hoja } o { item } dentro del origen
alter table public.so_records add column if not exists superseded_by uuid references public.so_import_batches (id) on delete set null;
create index if not exists so_records_batch_idx on public.so_records (import_batch_id);
create index if not exists so_records_activos_idx on public.so_records (datasource_id, period) where superseded_by is null;

-- ===================================================== Registro técnico de ingesta (sin contenido)
create table if not exists public.so_ingest_log (
  id              bigint generated always as identity primary key,
  owner_id        uuid not null default auth.uid(),
  upload_id       text,
  file_id         uuid,
  import_batch_id uuid,
  dataset_id      uuid,
  artifact_id     uuid,
  source_type     text,
  stage           text not null,
  status          text not null,
  size            bigint,
  ms              int,
  rows            int,
  errors          int,
  retry           int not null default 0,
  at              timestamptz not null default now()
);

-- ===================================================== RLS
do $$
declare t text;
begin
  foreach t in array array['so_files', 'so_file_chunks', 'so_data_inputs', 'so_api_sources', 'so_import_batches', 'so_ingest_log'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('drop policy if exists %I on public.%I', t || '_dueno', t);
    execute format('create policy %I on public.%I for all to authenticated using (owner_id = auth.uid() and public.es_valo()) '
                   'with check (owner_id = auth.uid() and public.es_valo())', t || '_dueno', t);
  end loop;
end $$;
revoke update, delete on public.so_ingest_log from authenticated;

-- ===================================================== Integridad (mismo dueño) y versiones de archivos
create or replace function public.so_t_ingesta() returns trigger
language plpgsql security definer set search_path = public as $$
declare previo public.so_files;
begin
  if tg_table_name = 'so_files' then
    if new.project_id is not null and not exists (select 1 from public.so_projects p where p.id = new.project_id and p.owner_id = new.owner_id) then
      raise exception 'el proyecto no pertenece al usuario' using errcode = '42501'; end if;
    if new.artifact_id is not null and not exists (select 1 from public.so_artifacts a where a.id = new.artifact_id and a.owner_id = new.owner_id) then
      raise exception 'el artefacto no pertenece al usuario' using errcode = '42501'; end if;
    if new.chat_id is not null and not exists (select 1 from public.so_chats c where c.id = new.chat_id and c.owner_id = new.owner_id) then
      raise exception 'el chat no pertenece al usuario' using errcode = '42501'; end if;
    if tg_op = 'INSERT' then
      -- Mismo nombre en el mismo proyecto → nueva versión (la anterior se conserva para el linaje).
      select * into previo from public.so_files f
       where f.owner_id = new.owner_id and lower(f.safe_name) = lower(new.safe_name)
         and f.project_id is not distinct from new.project_id and f.id <> new.id and f.status <> 'expired'
       order by f.version desc limit 1;
      if previo.id is not null and previo.checksum <> new.checksum then new.version_of := previo.id; new.version := previo.version + 1; end if;
    end if;
    new.updated_at := now();
  elsif tg_table_name = 'so_file_chunks' then
    if not exists (select 1 from public.so_files f where f.id = new.file_id and f.owner_id = new.owner_id) then
      raise exception 'el archivo no pertenece al usuario' using errcode = '42501'; end if;
  elsif tg_table_name in ('so_data_inputs', 'so_api_sources', 'so_import_batches') then
    if new.dataset_id is not null and not exists (select 1 from public.so_datasources d where d.id = new.dataset_id and d.owner_id = new.owner_id) then
      raise exception 'el dataset no pertenece al usuario' using errcode = '42501'; end if;
    if new.artifact_id is not null and not exists (select 1 from public.so_artifacts a where a.id = new.artifact_id and a.owner_id = new.owner_id) then
      raise exception 'el artefacto no pertenece al usuario' using errcode = '42501'; end if;
    if tg_table_name = 'so_import_batches' then
      if new.source_file_id is not null and not exists (select 1 from public.so_files f where f.id = new.source_file_id and f.owner_id = new.owner_id) then
        raise exception 'el archivo no pertenece al usuario' using errcode = '42501'; end if;
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists so_files_ingesta on public.so_files;
create trigger so_files_ingesta before insert or update on public.so_files for each row execute function public.so_t_ingesta();
drop trigger if exists so_file_chunks_ingesta on public.so_file_chunks;
create trigger so_file_chunks_ingesta before insert on public.so_file_chunks for each row execute function public.so_t_ingesta();
drop trigger if exists so_data_inputs_ingesta on public.so_data_inputs;
create trigger so_data_inputs_ingesta before insert or update on public.so_data_inputs for each row execute function public.so_t_ingesta();
drop trigger if exists so_api_sources_ingesta on public.so_api_sources;
create trigger so_api_sources_ingesta before insert or update on public.so_api_sources for each row execute function public.so_t_ingesta();
drop trigger if exists so_import_batches_ingesta on public.so_import_batches;
create trigger so_import_batches_ingesta before insert or update on public.so_import_batches for each row execute function public.so_t_ingesta();

-- Registros: se valida el contenido al insertar o cuando cambia `data` (marcar como reemplazado no re-valida).
create or replace function public.so_t_mismo_dueno() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'so_records' then
    select d.owner_id into new.owner_id from public.so_datasources d where d.id = new.datasource_id;
    if new.owner_id is null then raise exception 'datasource inexistente' using errcode = '23503'; end if;
    if tg_op = 'INSERT' or new.data is distinct from old.data then perform public.so_validar_registro(new.datasource_id, new.data); end if;
    if new.import_batch_id is not null and not exists (select 1 from public.so_import_batches b where b.id = new.import_batch_id and b.dataset_id = new.datasource_id) then
      raise exception 'el lote no corresponde a este dataset' using errcode = '42501'; end if;
  elsif tg_table_name in ('so_datasources', 'so_artifacts') then
    if not exists (select 1 from public.so_projects p where p.id = new.project_id and p.owner_id = new.owner_id) then
      raise exception 'el proyecto no pertenece al usuario' using errcode = '42501';
    end if;
    if tg_table_name = 'so_artifacts' then
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

-- ===================================================== Estrategias de importación (reversibles: nada se borra al reemplazar)
-- REPLACE: marca como reemplazados los registros activos del dataset que no son de este lote.
-- UPSERT: marca como reemplazados los registros activos con la misma clave de negocio que alguno del lote.
create or replace function public.so_aplicar_estrategia(p_batch uuid) returns int
language plpgsql security invoker set search_path = public as $$
declare b public.so_import_batches; n int := 0;
begin
  select * into b from public.so_import_batches where id = p_batch;
  if b.id is null then raise exception 'lote inexistente o sin permiso' using errcode = '42501'; end if;
  if b.strategy = 'REPLACE' then
    update public.so_records r set superseded_by = b.id
     where r.datasource_id = b.dataset_id and r.superseded_by is null and r.import_batch_id is distinct from b.id;
    get diagnostics n = row_count;
  elsif b.strategy = 'UPSERT' then
    update public.so_records r set superseded_by = b.id
     where r.datasource_id = b.dataset_id and r.superseded_by is null and r.import_batch_id is distinct from b.id
       and r.data ->> b.key_field in (select n2.data ->> b.key_field from public.so_records n2 where n2.import_batch_id = b.id and n2.data ? b.key_field);
    get diagnostics n = row_count;
  end if;
  update public.so_import_batches set rows_superseded = n where id = b.id;
  return n;
end;
$$;

-- Deshacer una importación: quita sus filas y reactiva lo que había reemplazado. Se niega si un lote posterior depende de ella.
create or replace function public.so_deshacer_importacion(p_batch uuid) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare b public.so_import_batches; quitadas int; reactivadas int;
begin
  select * into b from public.so_import_batches where id = p_batch;
  if b.id is null then raise exception 'lote inexistente o sin permiso' using errcode = '42501'; end if;
  if b.status = 'undone' then return jsonb_build_object('ya', true); end if;
  if exists (select 1 from public.so_records r where r.import_batch_id = b.id and r.superseded_by is not null and r.superseded_by <> b.id) then
    raise exception 'una importación posterior reemplazó datos de esta: deshacé primero esa' using errcode = '55000';
  end if;
  delete from public.so_records where import_batch_id = b.id;
  get diagnostics quitadas = row_count;
  update public.so_records set superseded_by = null where superseded_by = b.id;
  get diagnostics reactivadas = row_count;
  update public.so_import_batches set status = 'undone', completed_at = coalesce(completed_at, now()) where id = b.id;
  return jsonb_build_object('quitadas', quitadas, 'reactivadas', reactivadas);
end;
$$;

-- ===================================================== Linaje: ¿de dónde salió este dato?
create or replace function public.so_origen_registro(p_record bigint) returns jsonb
language sql stable security invoker set search_path = public as $$
  select jsonb_build_object(
    'registro', r.id, 'periodo', r.period, 'cargado', r.created_at, 'activo', r.superseded_by is null, 'ref', r.source_ref,
    'dataset', d.name,
    'lote', case when b.id is null then null else jsonb_build_object('id', b.id, 'estrategia', b.strategy, 'origen', b.source_type,
      'nombre', b.source_name, 'fecha', b.started_at, 'estado', b.status) end,
    'archivo', case when f.id is null then null else jsonb_build_object('id', f.id, 'nombre', f.original_name, 'version', f.version, 'subido', f.created_at) end,
    'api', case when a.id is null then null else jsonb_build_object('id', a.id, 'nombre', a.name, 'host', split_part(split_part(a.base_url, '://', 2), '/', 1)) end,
    'por', coalesce(p.nombre, p.email))
  from public.so_records r
  join public.so_datasources d on d.id = r.datasource_id
  left join public.so_import_batches b on b.id = r.import_batch_id
  left join public.so_files f on f.id = b.source_file_id
  left join public.so_api_sources a on a.id = b.api_source_id
  left join public.perfiles p on p.id = coalesce(b.user_id, r.created_by)
  where r.id = p_record;
$$;

-- ===================================================== Secretos de APIs en Vault (el valor nunca vuelve a la página)
create or replace function public.exists_header_secreto(h jsonb) returns boolean
language sql immutable set search_path = public as $$
  select exists (select 1 from jsonb_object_keys(coalesce(h, '{}'::jsonb)) k
                  where lower(k) in ('authorization', 'proxy-authorization', 'x-api-key', 'api-key', 'apikey', 'x-auth-token', 'cookie'));
$$;
-- Los encabezados guardados no pueden ser credenciales: esas van a Vault.
alter table public.so_api_sources drop constraint if exists so_api_sin_secretos;
alter table public.so_api_sources add constraint so_api_sin_secretos check (not public.exists_header_secreto(headers));

-- auth_ref solo lo fija so_api_guardar_secreto: si la página pudiera escribirlo, podría apuntar al secreto de otra persona.
create or replace function public.so_t_api_ref() returns trigger
language plpgsql security invoker set search_path = public as $$
begin
  if (tg_op = 'INSERT' and new.auth_ref is not null or tg_op = 'UPDATE' and new.auth_ref is distinct from old.auth_ref)
     and current_user in ('authenticated', 'anon') then
    raise exception 'la credencial se guarda solo con so_api_guardar_secreto' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists so_api_sources_ref on public.so_api_sources;
create trigger so_api_sources_ref before insert or update on public.so_api_sources for each row execute function public.so_t_api_ref();

create or replace function public.so_api_guardar_secreto(p_source uuid, p_secreto text) returns void
language plpgsql security definer set search_path = public, vault as $$
declare s public.so_api_sources; sid uuid;
begin
  select * into s from public.so_api_sources where id = p_source;
  if s.id is null or s.owner_id <> auth.uid() or not public.es_valo() then raise exception 'sin permiso' using errcode = '42501'; end if;
  if coalesce(length(p_secreto), 0) not between 1 and 4096 then raise exception 'credencial inválida' using errcode = '22023'; end if;
  if s.auth_ref is not null and exists (select 1 from vault.secrets where id = s.auth_ref) then
    perform vault.update_secret(s.auth_ref, p_secreto);
  else
    sid := vault.create_secret(p_secreto, 'so_api:' || s.id::text, 'Credencial de la fuente API ' || s.name);
    update public.so_api_sources set auth_ref = sid where id = s.id;
  end if;
  insert into public.so_audit (owner_id, action, artifact_id, detail) values (s.owner_id, 'api.secret_set', s.artifact_id, jsonb_build_object('source', s.id));
end;
$$;

-- Solo para la función del servidor (service_role): devuelve la credencial para ejecutar la llamada.
create or replace function public.so_api_leer_secreto(p_source uuid) returns text
language sql stable security definer set search_path = public, vault as $$
  select ds.decrypted_secret from public.so_api_sources s join vault.decrypted_secrets ds on ds.id = s.auth_ref where s.id = p_source;
$$;

-- ===================================================== Acceso compartido con entradas (redefine las funciones compartidas)
-- USE solo puede aportar datos si el dueño lo habilitó explícitamente (permissions.shared_input = true). EDIT, siempre.
create or replace function public.so_puede_cargar(p_artifact uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select case public.so_permiso(p_artifact)
    when 'OWNER' then true when 'EDIT' then true
    when 'USE' then coalesce((select (a.permissions ->> 'shared_input')::boolean from public.so_artifacts a where a.id = p_artifact), false)
    else false end;
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
   where r.datasource_id = a.datasource_id and r.superseded_by is null
     and (p_desde is null or r.period >= p_desde) and (p_hasta is null or r.period <= p_hasta);
  return jsonb_build_object('id', a.id, 'name', a.name, 'type', a.type, 'version', a.version, 'permission', perm,
                            'puede_cargar', public.so_puede_cargar(p_artifact),
                            'specification', a.specification, 'schema', a.schema,
                            'view', jsonb_build_object('grafico', a.configuration -> 'grafico', 'metrica', a.configuration -> 'metrica'),
                            'fields', coalesce(d.fields, '[]'::jsonb), 'records', recs);
end;
$$;

create or replace function public.so_shared_add_record(p_artifact uuid, p_period date, p_data jsonb, p_key text default null) returns bigint
language plpgsql security definer set search_path = public as $$
declare a public.so_artifacts; rid bigint;
begin
  if not public.so_puede_cargar(p_artifact) then raise exception 'sin permiso para cargar datos' using errcode = '42501'; end if;
  select * into a from public.so_artifacts where id = p_artifact;
  if a.datasource_id is null then raise exception 'el artefacto no tiene datos persistentes' using errcode = '22023'; end if;
  insert into public.so_records (datasource_id, owner_id, period, data, idempotency_key)
  values (a.datasource_id, a.owner_id, coalesce(p_period, current_date), p_data, nullif(p_key, ''))
  on conflict (datasource_id, idempotency_key) do nothing returning id into rid;
  if rid is not null then
    insert into public.so_audit (owner_id, action, artifact_id, detail) values (a.owner_id, 'record.add', p_artifact, jsonb_build_object('record', rid, 'via', public.so_permiso(p_artifact)));
  end if;
  return rid;
end;
$$;

-- Importación desde la vista compartida (el archivo se procesa en el navegador de quien carga y no se guarda en la carpeta
-- del dueño). Siempre APPEND, por lotes idempotentes, con filas inválidas en revisión y detección de archivo repetido.
create or replace function public.so_shared_importar(p_artifact uuid, p_lote uuid, p_nombre text, p_checksum text,
  p_filas jsonb, p_rechazadas jsonb default '[]'::jsonb, p_final boolean default false, p_forzar boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a public.so_artifacts; b public.so_import_batches; f jsonb; ok int := 0; mal jsonb := '[]'::jsonb; dup uuid;
begin
  if not public.so_puede_cargar(p_artifact) then raise exception 'sin permiso para cargar datos' using errcode = '42501'; end if;
  if jsonb_typeof(p_filas) <> 'array' or jsonb_array_length(p_filas) > 1000 then raise exception 'lote inválido (máximo 1000 filas)' using errcode = '22023'; end if;
  if coalesce(p_checksum, '') !~ '^[0-9a-f]{64}$' then raise exception 'checksum inválido' using errcode = '22023'; end if;
  select * into a from public.so_artifacts where id = p_artifact;
  select * into b from public.so_import_batches where id = p_lote;
  if b.id is null then
    select id into dup from public.so_import_batches where dataset_id = a.datasource_id and checksum = p_checksum and status in ('importing', 'ready', 'partial') limit 1;
    if dup is not null and not p_forzar then return jsonb_build_object('duplicado', true, 'lote_previo', dup); end if;
    insert into public.so_import_batches (id, owner_id, dataset_id, artifact_id, user_id, source_type, strategy, checksum, source_name)
    values (p_lote, a.owner_id, a.datasource_id, a.id, auth.uid(), 'shared', 'APPEND', p_checksum, left(p_nombre, 255)) returning * into b;
  elsif b.artifact_id is distinct from a.id or b.user_id is distinct from auth.uid() or b.status <> 'importing' then
    raise exception 'lote inválido' using errcode = '42501';
  end if;
  for f in select * from jsonb_array_elements(p_filas) loop
    begin
      insert into public.so_records (datasource_id, owner_id, period, data, idempotency_key, import_batch_id, source_ref, created_by)
      values (a.datasource_id, a.owner_id, coalesce((f ->> 'period')::date, current_date), f -> 'data',
              b.id::text || ':' || (f ->> 'fila'), b.id, jsonb_build_object('fila', (f ->> 'fila')::int), auth.uid())
      on conflict (datasource_id, idempotency_key) do nothing;
      if found then ok := ok + 1; end if;
    exception when others then
      mal := mal || jsonb_build_array(jsonb_build_object('fila', (f ->> 'fila')::int, 'motivo', left(sqlerrm, 200)));
    end;
  end loop;
  update public.so_import_batches set
    rows_received = rows_received + jsonb_array_length(p_filas) + jsonb_array_length(coalesce(p_rechazadas, '[]'::jsonb)),
    rows_accepted = rows_accepted + ok,
    rows_rejected = rows_rejected + jsonb_array_length(mal) + jsonb_array_length(coalesce(p_rechazadas, '[]'::jsonb)),
    errors = (select coalesce(jsonb_agg(e), '[]'::jsonb) from (select e from jsonb_array_elements(errors || mal || coalesce(p_rechazadas, '[]'::jsonb)) e limit 500) z),
    status = case when p_final then case when rows_rejected + jsonb_array_length(mal) + jsonb_array_length(coalesce(p_rechazadas, '[]'::jsonb)) > 0 then 'partial' else 'ready' end else status end,
    completed_at = case when p_final then now() else completed_at end
  where id = b.id returning * into b;
  if p_final then
    insert into public.so_audit (owner_id, action, artifact_id, detail)
    values (a.owner_id, 'import.shared', a.id, jsonb_build_object('lote', b.id, 'aceptadas', b.rows_accepted, 'rechazadas', b.rows_rejected));
  end if;
  return jsonb_build_object('lote', b.id, 'aceptadas', b.rows_accepted, 'rechazadas', b.rows_rejected, 'estado', b.status);
end;
$$;

-- ===================================================== Búsqueda global: suma archivos (por nombre y contenido), con RLS
create or replace function public.so_buscar(p_q text, p_limit int default 20)
returns table (kind text, id text, title text, subtitle text, artifact_id uuid, updated_at timestamptz)
language plpgsql stable security invoker set search_path = public as $$
declare patron text; consulta tsquery;
begin
  if length(trim(coalesce(p_q, ''))) < 2 then return; end if;
  patron := '%' || replace(replace(replace(trim(p_q), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  consulta := plainto_tsquery('spanish', p_q);
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
      where r.superseded_by is null and r.data::text ilike patron order by r.created_at desc limit 8)
    union all
    (select 'file'::text, f.id::text, f.original_name, f.detected_type || ' · v' || f.version, f.artifact_id, f.created_at
       from public.so_files f
      where f.status not in ('expired', 'blocked') and (f.original_name ilike patron or f.search @@ consulta
            or exists (select 1 from public.so_file_chunks k where k.file_id = f.id and k.tsv @@ consulta))
      order by f.created_at desc limit 8);
end;
$$;

-- Recuperación de fragmentos relevantes de archivos del usuario (para responder sin mandar el archivo entero).
create or replace function public.so_buscar_fragmentos(p_files uuid[], p_q text, p_limit int default 6)
returns table (file_id uuid, ord int, ref jsonb, content text, rank real)
language sql stable security invoker set search_path = public as $$
  select k.file_id, k.ord, k.ref, k.content, ts_rank(k.tsv, websearch_to_tsquery('spanish', coalesce(p_q, ''))) as rank
    from public.so_file_chunks k
   where k.file_id = any (p_files)
   order by rank desc, k.ord
   limit least(greatest(p_limit, 1), 20);
$$;

-- ===================================================== Ciclo de vida: temporales y archivos vencidos
create or replace function public.so_retencion() returns jsonb
language plpgsql security definer set search_path = public as $$
declare temporales int; vencidos int;
begin
  -- TEMPORARY: los datos de prueba se retiran a las 24 h (reversible: quedan marcados, no borrados).
  update public.so_records r set superseded_by = b.id
    from public.so_import_batches b
   where r.import_batch_id = b.id and b.strategy = 'TEMPORARY' and b.started_at < now() - interval '24 hours' and r.superseded_by is null;
  update public.so_import_batches set status = 'expired' where strategy = 'TEMPORARY' and status in ('ready', 'partial') and started_at < now() - interval '24 hours';
  get diagnostics temporales = row_count;
  -- Archivos usados como origen de una importación se conservan por linaje.
  update public.so_files f set retention = 'lineage', expires_at = null
   where retention = 'temporary' and exists (select 1 from public.so_import_batches b where b.source_file_id = f.id);
  update public.so_files set status = 'expired' where retention = 'temporary' and expires_at < now() and status <> 'expired';
  get diagnostics vencidos = row_count;
  return jsonb_build_object('temporales', temporales, 'archivos_vencidos', vencidos);
end;
$$;

-- ===================================================== Permisos de ejecución
revoke all on function public.so_aplicar_estrategia(uuid) from public, anon;
revoke all on function public.so_deshacer_importacion(uuid) from public, anon;
revoke all on function public.so_origen_registro(bigint) from public, anon;
revoke all on function public.so_api_guardar_secreto(uuid, text) from public, anon;
revoke all on function public.so_api_leer_secreto(uuid) from public, anon, authenticated;
revoke all on function public.so_puede_cargar(uuid) from public, anon;
revoke all on function public.so_shared_importar(uuid, uuid, text, text, jsonb, jsonb, boolean, boolean) from public, anon;
revoke all on function public.so_buscar_fragmentos(uuid[], text, int) from public, anon;
revoke all on function public.so_retencion() from public, anon, authenticated;
revoke all on function public.so_t_ingesta() from public, anon, authenticated;
grant execute on function public.so_aplicar_estrategia(uuid) to authenticated;
grant execute on function public.so_deshacer_importacion(uuid) to authenticated;
grant execute on function public.so_origen_registro(bigint) to authenticated;
grant execute on function public.so_api_guardar_secreto(uuid, text) to authenticated;
grant execute on function public.so_api_leer_secreto(uuid) to service_role;
grant execute on function public.so_puede_cargar(uuid) to authenticated;
grant execute on function public.so_shared_importar(uuid, uuid, text, text, jsonb, jsonb, boolean, boolean) to authenticated;
grant execute on function public.so_buscar_fragmentos(uuid[], text, int) to authenticated;

do $$ begin perform cron.unschedule('so-retencion'); exception when others then null; end $$;
select cron.schedule('so-retencion', '17 4 * * *', $$select public.so_retencion()$$);

notify pgrst, 'reload schema';
