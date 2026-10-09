-- =====================================================================
--  SISTEMA DE ASIGNACIÓN DE LABORATORIOS — UPDS
--  Script 00 (OPCIONAL): REINICIAR
--  Borra TODAS las tablas y funciones del sistema para volver a instalar
--  desde el script 01. Úselo solo si ya ejecutó una versión anterior.
--  ¡CUIDADO! Elimina todos los datos (no borra los usuarios de Auth).
-- =====================================================================

drop trigger if exists trg_auth_nuevo_usuario on auth.users;

drop table if exists
  public.reubicaciones, public.reserva_horarios, public.reservas, public.tipos_reserva,
  public.cesion_fechas, public.cesiones, public.asignacion_fechas, public.asignacion_horarios,
  public.asignaciones, public.feriados, public.bloques_horario, public.periodos,
  public.sistemas_academicos, public.ambientes, public.docente_materias, public.materias,
  public.docente_carreras, public.docentes, public.carreras, public.perfiles
cascade;

-- Elimina todas las funciones creadas por el sistema (prefijos fn_ y rpc_)
do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as firma
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and (p.proname like 'fn\_%' or p.proname like 'rpc\_%')
  loop
    execute 'drop function if exists ' || f.firma || ' cascade';
  end loop;
end $$;
