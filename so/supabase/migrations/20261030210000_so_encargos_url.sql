-- SO · Encargos: la URL del disparador acepta cualquier id de tarea de Claude (no solo "trig_…").
alter table public.so_claude_vinculos drop constraint if exists so_claude_vinculos_routine_url_check;
alter table public.so_claude_vinculos add constraint so_claude_vinculos_routine_url_check
  check (routine_url ~ '^https://api\.anthropic\.com/v1/claude_code/routines/[A-Za-z0-9_-]{6,128}/fire$');
