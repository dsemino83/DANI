-- SO · Anular cualquier subida del histórico (no solo la última) y poder restaurarla.
-- Anular no borra nada: las filas de la subida quedan marcadas como reemplazadas por su propio lote (superseded_by = el
-- lote) y dejan de contar; lo que esa subida había reemplazado vuelve a estar activo, salvo que una subida posterior ya
-- haya reemplazado esos datos: entonces queda reemplazado por esa posterior (como si la anulada nunca hubiera existido).
-- Todo lo necesario para restaurar se guarda en el lote (anulacion).

alter table public.so_import_batches add column if not exists anulacion jsonb;

create or replace function public.so_anular_importacion(p_batch uuid) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare b public.so_import_batches; sucesor uuid; previos jsonb; reactivadas jsonb; reasignadas jsonb; anuladas int;
begin
  select * into b from public.so_import_batches where id = p_batch for update;
  if b.id is null then raise exception 'lote inexistente o sin permiso' using errcode = '42501'; end if;
  if b.status = 'undone' then return jsonb_build_object('ya', true); end if;

  -- La subida posterior más reciente que reemplazó filas de esta (si la hay).
  select r.superseded_by into sucesor from public.so_records r join public.so_import_batches s on s.id = r.superseded_by
   where r.import_batch_id = b.id and r.superseded_by <> b.id order by s.started_at desc limit 1;

  -- Filas propias que ya estaban reemplazadas por otra subida (para restaurarlas tal cual).
  select coalesce(jsonb_agg(jsonb_build_array(r.id, r.superseded_by)), '[]') into previos
    from public.so_records r where r.import_batch_id = b.id and r.superseded_by is not null and r.superseded_by <> b.id;

  -- Lo que esta subida había reemplazado: vuelve a estar activo, o pasa a la subida posterior.
  if sucesor is null then
    with u as (update public.so_records r set superseded_by = null where r.superseded_by = b.id and r.import_batch_id is distinct from b.id returning r.id)
    select coalesce(jsonb_agg(id), '[]') into reactivadas from u;
    reasignadas := '[]';
  else
    with u as (update public.so_records r set superseded_by = sucesor where r.superseded_by = b.id and r.import_batch_id is distinct from b.id returning r.id)
    select coalesce(jsonb_agg(id), '[]') into reasignadas from u;
    reactivadas := '[]';
  end if;

  update public.so_records r set superseded_by = b.id where r.import_batch_id = b.id;
  get diagnostics anuladas = row_count;
  update public.so_import_batches set status = 'undone', completed_at = coalesce(completed_at, now()),
    anulacion = jsonb_build_object('at', now(), 'por', auth.uid(), 'estado_previo', b.status, 'sucesor', sucesor,
      'previos', previos, 'reactivadas', reactivadas, 'reasignadas', reasignadas)
   where id = b.id;
  return jsonb_build_object('anuladas', anuladas, 'reactivadas', jsonb_array_length(reactivadas), 'reasignadas', jsonb_array_length(reasignadas));
end;
$$;

-- Restaurar una subida anulada. Se niega si después de anularla hubo otra subida en el mismo dataset (restaurar pisaría
-- datos más nuevos sin que nadie lo decida).
create or replace function public.so_restaurar_importacion(p_batch uuid) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare b public.so_import_batches; x jsonb; n int;
begin
  select * into b from public.so_import_batches where id = p_batch for update;
  if b.id is null then raise exception 'lote inexistente o sin permiso' using errcode = '42501'; end if;
  if b.status <> 'undone' or b.anulacion is null or b.anulacion ? 'restaurada_at' then raise exception 'esta subida no está anulada' using errcode = '55000'; end if;
  if exists (select 1 from public.so_import_batches o where o.dataset_id = b.dataset_id and o.id <> b.id and o.started_at > (b.anulacion ->> 'at')::timestamptz and o.status in ('ready', 'partial', 'importing')) then
    raise exception 'hubo subidas posteriores a la anulación: restaurarla pisaría datos más nuevos' using errcode = '55000';
  end if;
  update public.so_records r set superseded_by = null where r.import_batch_id = b.id and r.superseded_by = b.id;
  get diagnostics n = row_count;
  for x in select * from jsonb_array_elements(b.anulacion -> 'previos') loop
    update public.so_records set superseded_by = (x ->> 1)::uuid where id = (x ->> 0)::bigint and import_batch_id = b.id;
  end loop;
  update public.so_records set superseded_by = b.id where id in (select (v #>> '{}')::bigint from jsonb_array_elements(b.anulacion -> 'reactivadas') v) and superseded_by is null;
  update public.so_records set superseded_by = b.id where id in (select (v #>> '{}')::bigint from jsonb_array_elements(b.anulacion -> 'reasignadas') v) and superseded_by = (b.anulacion ->> 'sucesor')::uuid;
  update public.so_import_batches set status = coalesce(b.anulacion ->> 'estado_previo', 'ready'), anulacion = b.anulacion || jsonb_build_object('restaurada_at', now()) where id = b.id;
  return jsonb_build_object('restauradas', n);
end;
$$;

-- "Deshacer importación" (panel y chat) pasa a ser la anulación reversible: ya no borra filas.
create or replace function public.so_deshacer_importacion(p_batch uuid) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare j jsonb;
begin
  j := public.so_anular_importacion(p_batch);
  return j || jsonb_build_object('quitadas', coalesce((j ->> 'anuladas')::int, 0));
end;
$$;

revoke all on function public.so_anular_importacion(uuid) from public, anon;
revoke all on function public.so_restaurar_importacion(uuid) from public, anon;
grant execute on function public.so_anular_importacion(uuid) to authenticated;
grant execute on function public.so_restaurar_importacion(uuid) to authenticated;

notify pgrst, 'reload schema';
