-- =====================================================================
--  SISTEMA DE ASIGNACIÓN DE LABORATORIOS — UPDS
--  Script 27: CERRAR TURNO (reporte de turno) SOLO EN SU TURNO
--  - Auxiliar: cierra turno y edita su reporte SOLO durante su turno
--    programado vigente (y a la hora de ese turno, hora de La Paz).
--  - Admin / encargado de auxiliares: cierran en cualquier turno.
--  - Marcar tareas hechas sigue abierto al personal operativo (el turno
--    siguiente es quien las marca).
--  Ejecutar en: Supabase > SQL Editor (después de 26).
-- =====================================================================

-- 1) Turno vigente de un auxiliar en una fecha (la programación más reciente <= fecha)
create or replace function public.fn_turno_vigente(
  p_perfil uuid,
  p_fecha date default (now() at time zone 'America/La_Paz')::date)
returns text language sql stable set search_path = public as $$
  select tp.turno from public.turnos_programados tp
   where tp.perfil_id = p_perfil and tp.desde <= p_fecha
   order by tp.desde desc limit 1;
$$;

-- 2) ¿Puede cerrar / editar un reporte de este turno ahora?
create or replace function public.fn_puede_cerrar_turno(p_turno text)
returns boolean language sql stable set search_path = public as $$
  select case
    when public.fn_puede_gestionar_auxiliares() then true
    when public.fn_rol_actual() = 'auxiliar' then
      p_turno = public.fn_turno_vigente(auth.uid())
      and p_turno = public.fn_turno_de_hora(now())
    else false
  end;
$$;

-- 3) ¿Puede tocar un reporte? (su autor en su turno, o admin/encargado)
create or replace function public.fn_puede_editar_reporte(p_reporte bigint)
returns boolean language sql stable set search_path = public as $$
  select exists (
    select 1 from public.reportes_turno r
     where r.id = p_reporte
       and public.fn_puede_operar()
       and (public.fn_puede_gestionar_auxiliares()
            or (r.auxiliar_id = auth.uid() and public.fn_puede_cerrar_turno(r.turno))));
$$;

-- 4) Reglas de reportes_turno
drop policy if exists reportes_turno_crear on public.reportes_turno;
create policy reportes_turno_crear on public.reportes_turno for insert to authenticated
  with check (public.fn_puede_operar()
    and (auxiliar_id = auth.uid() or public.fn_puede_gestionar_auxiliares())
    and public.fn_puede_cerrar_turno(turno));

drop policy if exists reportes_turno_editar on public.reportes_turno;
create policy reportes_turno_editar on public.reportes_turno for update to authenticated
  using (public.fn_puede_operar()
    and (public.fn_puede_gestionar_auxiliares() or (auxiliar_id = auth.uid() and public.fn_puede_cerrar_turno(turno))))
  with check (public.fn_puede_operar()
    and (public.fn_puede_gestionar_auxiliares() or (auxiliar_id = auth.uid() and public.fn_puede_cerrar_turno(turno))));

drop policy if exists reportes_turno_borrar on public.reportes_turno;
create policy reportes_turno_borrar on public.reportes_turno for delete to authenticated
  using (public.fn_puede_operar()
    and (public.fn_puede_gestionar_auxiliares() or (auxiliar_id = auth.uid() and public.fn_puede_cerrar_turno(turno))));

-- 5) Tareas: crear y quitar solo al editar el reporte. Marcarlas hechas sigue abierto
--    (lo hace el turno siguiente; el trigger de tareas hechas ya protege lo demás).
drop policy if exists reporte_tareas_crear on public.reporte_tareas;
create policy reporte_tareas_crear on public.reporte_tareas for insert to authenticated
  with check (public.fn_puede_editar_reporte(reporte_id));

drop policy if exists reporte_tareas_borrar on public.reporte_tareas;
create policy reporte_tareas_borrar on public.reporte_tareas for delete to authenticated
  using (public.fn_puede_editar_reporte(reporte_id));

revoke execute on function public.fn_turno_vigente(uuid, date), public.fn_puede_cerrar_turno(text),
  public.fn_puede_editar_reporte(bigint) from anon, public;
