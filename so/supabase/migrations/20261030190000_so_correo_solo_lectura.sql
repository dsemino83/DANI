-- SO · Correo pasa a ser solo lectura: se quitan las respuestas (borradores). La tabla de borradores deja de usarse.
-- Se borra solo si está vacía; si tuviera filas, se conserva (nunca destruir historia) y se le quita todo acceso.
do $$
begin
  if to_regclass('public.so_mail_drafts') is null then return; end if;
  if exists (select 1 from public.so_mail_drafts) then
    revoke all on public.so_mail_drafts from anon, authenticated;
    raise notice 'so_mail_drafts tiene filas: se conserva sin acceso';
  else
    drop table public.so_mail_drafts;
  end if;
end $$;

notify pgrst, 'reload schema';
