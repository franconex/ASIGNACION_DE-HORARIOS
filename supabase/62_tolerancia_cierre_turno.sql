-- =====================================================================
--  SISTEMA DE ASIGNACIÓN DE LABORATORIOS — UPDS
--  Script 62: TOLERANCIA DE 20 MINUTOS PARA CERRAR EL TURNO
--  - El auxiliar tiene hasta 20 minutos después de la hora de fin de su
--    turno para cerrarlo sin que cuente como retraso.
--  - Si cierra pasados esos 20 minutos, el retraso se cuenta desde la
--    hora de fin del turno (ej.: fin 18:30, cierra 18:55 -> 25 min).
--  - Solo afecta a los cierres nuevos: los reportes ya guardados
--    conservan su retraso (ver el bloque opcional al final).
--  Ejecutar en: Supabase > SQL Editor (después de 61).
-- =====================================================================

create or replace function public.fn_trg_reporte_horario()
returns trigger language plpgsql set search_path = public as $$
declare
  h public.horarios_turno;
  v_min int;
  c_tolerancia constant int := 20;  -- minutos de gracia después del fin del turno
begin
  if tg_op = 'UPDATE' and new.turno is not distinct from old.turno then
    new.hora_inicio_turno := old.hora_inicio_turno;
    new.hora_fin_turno := old.hora_fin_turno;
    new.minutos_retraso := old.minutos_retraso;
    return new;
  end if;
  select * into h from public.horarios_turno where turno = new.turno;
  new.hora_inicio_turno := h.hora_inicio;
  new.hora_fin_turno := h.hora_fin;
  if h.hora_fin is null then
    new.minutos_retraso := null;
  else
    v_min := greatest(0, floor(extract(epoch from
      (coalesce(new.creado_en, now()) at time zone 'America/La_Paz') - (new.fecha + h.hora_fin)) / 60))::int;
    new.minutos_retraso := case when v_min <= c_tolerancia then 0 else v_min end;
  end if;
  return new;
end $$;

revoke execute on function public.fn_trg_reporte_horario() from anon, authenticated, public;

-- ---------------------------------------------------------------------
-- OPCIONAL: aplicar la tolerancia también a los cierres ya guardados
-- (los que tuvieron entre 1 y 20 minutos de retraso pasan a "a tiempo").
-- Descomentar y ejecutar si se desea.
-- ---------------------------------------------------------------------
-- alter table public.reportes_turno disable trigger trg_reportes_turno_horario;
-- update public.reportes_turno set minutos_retraso = 0 where minutos_retraso between 1 and 20;
-- alter table public.reportes_turno enable trigger trg_reportes_turno_horario;
