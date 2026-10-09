-- =====================================================================
--  SISTEMA DE ASIGNACIÓN DE LABORATORIOS — UPDS
--  Script 24: REPORTES DE TURNO HECHOS NO SE ELIMINAN
--  - Un reporte se puede EDITAR (su autor, el admin o el encargado).
--  - Un reporte con alguna tarea ya hecha NO se puede eliminar.
--  - Una tarea hecha queda fija: no se edita ni se elimina; solo el admin
--    o el encargado la pueden desmarcar (por si se marcó por error).
--  Ejecutar en: Supabase > SQL Editor (después de 23).
-- =====================================================================

-- 1) Editar el reporte: su autor o quien gestiona auxiliares
drop policy if exists reportes_turno_editar on public.reportes_turno;
create policy reportes_turno_editar on public.reportes_turno for update to authenticated
  using (public.fn_puede_operar() and (auxiliar_id = auth.uid() or public.fn_puede_gestionar_auxiliares()))
  with check (public.fn_puede_operar() and (auxiliar_id = auth.uid() or public.fn_puede_gestionar_auxiliares()));

-- 2) Eliminar el reporte: su autor o quien gestiona auxiliares, y solo si no tiene tareas hechas
drop policy if exists reportes_turno_borrar on public.reportes_turno;
create policy reportes_turno_borrar on public.reportes_turno for delete to authenticated
  using (public.fn_puede_operar() and (auxiliar_id = auth.uid() or public.fn_puede_gestionar_auxiliares()));

create or replace function public.fn_trg_reporte_no_borrar_hecho()
returns trigger language plpgsql set search_path = public as $$
begin
  if exists (select 1 from public.reporte_tareas where reporte_id = old.id and hecha) then
    raise exception 'Este reporte ya tiene tareas hechas: no se puede eliminar (sí se puede editar).';
  end if;
  return old;
end $$;

drop trigger if exists trg_reportes_turno_no_borrar on public.reportes_turno;
create trigger trg_reportes_turno_no_borrar
  before delete on public.reportes_turno
  for each row execute function public.fn_trg_reporte_no_borrar_hecho();

-- 3) Tareas hechas: fijas
create or replace function public.fn_trg_tarea_hecha_fija()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if old.hecha then
      raise exception 'Una tarea hecha no se puede eliminar.';
    end if;
    return old;
  end if;
  if old.hecha then
    if new.descripcion is distinct from old.descripcion or new.ambiente_id is distinct from old.ambiente_id
       or new.reporte_id is distinct from old.reporte_id then
      raise exception 'Una tarea hecha ya no se puede modificar.';
    end if;
    if not new.hecha and not public.fn_puede_gestionar_auxiliares() then
      raise exception 'Solo el administrador o el encargado pueden desmarcar una tarea hecha.';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_reporte_tareas_hecha_fija on public.reporte_tareas;
create trigger trg_reporte_tareas_hecha_fija
  before update or delete on public.reporte_tareas
  for each row execute function public.fn_trg_tarea_hecha_fija();

revoke execute on function public.fn_trg_reporte_no_borrar_hecho(), public.fn_trg_tarea_hecha_fija() from anon, authenticated, public;
