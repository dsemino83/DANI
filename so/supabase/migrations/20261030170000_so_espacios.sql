-- Vista de so_projects con nombres neutros. Motivo: en algunas redes, un filtro local (antivirus o proxy) responde 403
-- a la verificación CORS de las URLs con "so_projects"/"memory" y el modo Trabajo no podía cargar. La vista es
-- security_invoker: aplica la misma RLS que la tabla (cada usuario ve y crea solo lo suyo). Insertable (vista simple).
create or replace view public.so_espacios with (security_invoker = true) as
  select id, owner_id, name, mode, memory as memoria, created_at, updated_at from public.so_projects;
revoke all on public.so_espacios from anon;
grant select, insert, update on public.so_espacios to authenticated;
notify pgrst, 'reload schema';
