-- La función de trigger de plantillas no se invoca por RPC (como las demás funciones de trigger de SO).
revoke all on function public.so_t_plantilla() from public, anon, authenticated;
