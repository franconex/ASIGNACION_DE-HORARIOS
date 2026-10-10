-- =====================================================================
--  SISTEMA DE ASIGNACIÓN DE LABORATORIOS — UPDS
--  Script 38: SÁBADOS CON UNO O VARIOS AUXILIARES
--  - Un mismo sábado puede tener varios auxiliares, cada uno con su turno
--    (distinto al de lunes a viernes). Único por (sábado, auxiliar).
--  - El sábado, el turno que vale para cerrar/editar el reporte es el de
--    la rotación. Si ese sábado no tiene a nadie en la rotación, vale el
--    turno de lunes a viernes (como antes).
--  Ejecutar en: Supabase > SQL Editor (después de 37).
-- =====================================================================

-- 1) Varios auxiliares por sábado
alter table public.rotacion_sabados drop constraint if exists rotacion_sabados_fecha_key;
alter table public.rotacion_sabados drop constraint if exists rotacion_sabados_fecha_auxiliar_key;
alter table public.rotacion_sabados
  add constraint rotacion_sabados_fecha_auxiliar_key unique (fecha, auxiliar_id);
create index if not exists rotacion_sabados_auxiliar_idx on public.rotacion_sabados (auxiliar_id, fecha);

-- 2) Turno del auxiliar en un día concreto (el sábado manda la rotación)
create or replace function public.fn_turno_del_dia(
  p_perfil uuid,
  p_fecha date default (now() at time zone 'America/La_Paz')::date)
returns text language sql stable set search_path = public as $$
  select case
    when extract(isodow from p_fecha) = 6
         and exists (select 1 from public.rotacion_sabados r where r.fecha = p_fecha)
      then (select r.turno from public.rotacion_sabados r
             where r.fecha = p_fecha and r.auxiliar_id = p_perfil limit 1)
    else public.fn_turno_vigente(p_perfil, p_fecha)
  end;
$$;

-- 3) Cerrar turno: usa el turno del día (sábado incluido)
create or replace function public.fn_puede_cerrar_turno(p_turno text)
returns boolean language sql stable set search_path = public as $$
  select case
    when public.fn_puede_gestionar_auxiliares() then true
    when public.fn_rol_actual() = 'auxiliar' then
      p_turno = public.fn_turno_del_dia(auth.uid())
      and (now() at time zone 'America/La_Paz')::time
          >= coalesce((select h.hora_inicio from public.horarios_turno h where h.turno = p_turno), time '00:00')
    else false
  end;
$$;

revoke execute on function public.fn_turno_del_dia(uuid, date) from anon, public;
grant execute on function public.fn_turno_del_dia(uuid, date) to authenticated;
