-- pg_net fuera del esquema public (asesor de seguridad 0014). La extensión no se puede mover: se reinstala en
-- "extensions". Sus funciones siguen en el esquema net (so_disparar_automatizaciones usa net.http_post); solo se
-- pierde el registro temporal de respuestas HTTP (net._http_response), que no guarda datos de usuarios.
do $$ begin
  if exists (select 1 from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_net' and n.nspname = 'public') then
    drop extension pg_net;
  end if;
end $$;
create extension if not exists pg_net with schema extensions;
