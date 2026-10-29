-- SO · formatos de salida nuevos y métricas que la app ya registra.
-- Solo amplía restricciones (no borra datos):
--   · so_file_templates.formato: suma rtf, xml, png, jpg y webp.
--   · so_events.name: suma 'download' y 'pin_to_workspace' (la app los enviaba y la restricción los rechazaba).
-- Las colecciones usan la columna so_files.collection ya existente (20261030120000_so_workspace.sql).

alter table public.so_file_templates drop constraint if exists so_file_templates_formato_check;
alter table public.so_file_templates add constraint so_file_templates_formato_check
  check (formato in ('xlsx', 'csv', 'json', 'xml', 'pdf', 'docx', 'pptx', 'rtf', 'txt', 'md', 'png', 'jpg', 'webp'));

alter table public.so_events drop constraint if exists so_events_name_check;
alter table public.so_events add constraint so_events_name_check
  check (name in ('time_to_first_value', 'time_to_result', 'task_completed', 'task_failed', 'retry', 'abandonment',
                  'artifact_reuse', 'search_success', 'search_miss', 'share_success', 'recovery_success', 'undo',
                  'preview_confirmed', 'preview_cancelled', 'download', 'pin_to_workspace'));

create index if not exists so_files_collection_idx on public.so_files (owner_id, collection) where collection is not null;
