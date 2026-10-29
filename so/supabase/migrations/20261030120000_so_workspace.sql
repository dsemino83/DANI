-- SO · Adaptive Workspace + Universal File System.
-- Solo agrega columnas y una tabla nueva (sin borrar ni reescribir nada existente):
--   · so_menu: vista previa en caché (ArtifactPreviewCache) y tamaño de tarjeta (S/M/L). El orden ya existe (ord) y
--     ocultar usa status = 'hidden'; archivar usa so_artifacts.state = 'archived' (ya permitido).
--   · so_files: origen del archivo (subido, generado por Francisco, exportado, API, conector), resumen del cambio de
--     cada versión y colección lógica. Las versiones ya existen (version_of / version).
--   · so_file_templates: plantillas reutilizables de archivos (estructura, secciones, formato, fuente).
-- RLS igual que el resto de SO: cada usuario solo ve y modifica lo suyo (owner_id = auth.uid() y es_valo()).

alter table public.so_menu add column if not exists preview jsonb;
alter table public.so_menu add column if not exists preview_at timestamptz;
alter table public.so_menu add column if not exists size text not null default 'M';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'so_menu_size_check') then
    alter table public.so_menu add constraint so_menu_size_check check (size in ('S', 'M', 'L'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'so_menu_preview_check') then
    alter table public.so_menu add constraint so_menu_preview_check check (preview is null or (jsonb_typeof(preview) = 'object' and pg_column_size(preview) < 16384));
  end if;
end $$;

alter table public.so_files add column if not exists origin text not null default 'upload';
alter table public.so_files add column if not exists change_summary text;
alter table public.so_files add column if not exists collection text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'so_files_origin_check') then
    alter table public.so_files add constraint so_files_origin_check check (origin in ('upload', 'generated', 'export', 'api', 'connector'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'so_files_change_summary_check') then
    alter table public.so_files add constraint so_files_change_summary_check check (change_summary is null or length(change_summary) <= 300);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'so_files_collection_check') then
    alter table public.so_files add constraint so_files_collection_check check (collection is null or length(collection) between 1 and 80);
  end if;
end $$;
create index if not exists so_files_version_of_idx on public.so_files (version_of);
create index if not exists so_files_origin_idx on public.so_files (owner_id, origin, created_at desc);

create table if not exists public.so_file_templates (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null default auth.uid(),
  project_id  uuid references public.so_projects (id) on delete cascade,
  artifact_id uuid references public.so_artifacts (id) on delete set null,
  name        text not null check (length(name) between 1 and 120),
  formato     text not null check (formato in ('xlsx', 'csv', 'json', 'pdf', 'docx', 'pptx', 'txt', 'md')),
  spec        jsonb not null default '{}'::jsonb check (pg_column_size(spec) < 65536),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (owner_id, name)
);
create index if not exists so_file_templates_owner_idx on public.so_file_templates (owner_id);
alter table public.so_file_templates enable row level security;
drop policy if exists so_file_templates_propios on public.so_file_templates;
create policy so_file_templates_propios on public.so_file_templates for all to authenticated
  using (owner_id = auth.uid() and public.es_valo()) with check (owner_id = auth.uid() and public.es_valo());
revoke all on public.so_file_templates from anon;
grant select, insert, update, delete on public.so_file_templates to authenticated;

-- La plantilla solo puede apuntar a proyectos y artefactos del mismo dueño.
create or replace function public.so_t_plantilla() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.project_id is not null and not exists (select 1 from public.so_projects p where p.id = new.project_id and p.owner_id = new.owner_id) then
    raise exception 'el proyecto no pertenece al usuario' using errcode = '42501'; end if;
  if new.artifact_id is not null and not exists (select 1 from public.so_artifacts a where a.id = new.artifact_id and a.owner_id = new.owner_id) then
    raise exception 'el artefacto no pertenece al usuario' using errcode = '42501'; end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists so_file_templates_dueno on public.so_file_templates;
create trigger so_file_templates_dueno before insert or update on public.so_file_templates for each row execute function public.so_t_plantilla();

-- Retención: un archivo generado o exportado con linaje no es temporal (la limpieza diaria solo toca 'temporary').
update public.so_files set retention = 'active', expires_at = null where origin in ('generated', 'export') and retention = 'temporary';
