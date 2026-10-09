-- =====================================================================
--  SISTEMA DE ASIGNACIÓN DE LABORATORIOS — UPDS
--  Script 29: HORARIO DE CADA TURNO (editable) + RETRASO AL CERRAR
--  - Tabla horarios_turno: hora de inicio y fin de Mañana, Mediodía,
--    Tarde y Noche. La editan admin y encargado de auxiliares.
--  - El auxiliar puede cerrar su turno desde que empieza hasta el final
--    del día; si cierra después de la hora de fin, el reporte guarda
--    cuántos minutos de retraso tuvo.
--  - Cada reporte guarda el horario que tenía su turno al cerrarse
--    (si luego cambian los horarios, el retraso no cambia).
--  Ejecutar en: Supabase > SQL Editor (después de 28).
-- =====================================================================

-- 1) Horarios
create table if not exists public.horarios_turno (
  turno           text primary key check (turno in ('M', 'MD', 'T', 'N')),
  hora_inicio     time not null,
  hora_fin        time not null,
  actualizado_en  timestamptz not null default now(),
  actualizado_por uuid default auth.uid() references public.perfiles(id) on delete set null,
  constraint horarios_turno_rango check (hora_fin > hora_inicio)
);
create index if not exists horarios_turno_actualizado_por_idx on public.horarios_turno (actualizado_por);
comment on table public.horarios_turno is 'Hora de inicio y fin de cada turno de auxiliares (editable por admin y encargado).';

insert into public.horarios_turno (turno, hora_inicio, hora_fin) values
  ('M', '07:00', '12:00'), ('MD', '12:00', '16:00'), ('T', '14:30', '18:30'), ('N', '18:00', '22:00')
on conflict (turno) do nothing;

create or replace function public.fn_trg_horario_turno()
returns trigger language plpgsql set search_path = public as $$
begin
  new.actualizado_en := now();
  new.actualizado_por := auth.uid();
  return new;
end $$;
drop trigger if exists trg_horarios_turno on public.horarios_turno;
create trigger trg_horarios_turno before update on public.horarios_turno
  for each row execute function public.fn_trg_horario_turno();

alter table public.horarios_turno enable row level security;
drop policy if exists horarios_turno_ver on public.horarios_turno;
create policy horarios_turno_ver on public.horarios_turno for select to authenticated using (public.fn_puede_ver());
drop policy if exists horarios_turno_editar on public.horarios_turno;
create policy horarios_turno_editar on public.horarios_turno for update to authenticated
  using (public.fn_puede_gestionar_auxiliares()) with check (public.fn_puede_gestionar_auxiliares());
revoke all on public.horarios_turno from anon;

-- 2) Horario y retraso guardados en el reporte
alter table public.reportes_turno add column if not exists hora_inicio_turno time;
alter table public.reportes_turno add column if not exists hora_fin_turno time;
alter table public.reportes_turno add column if not exists minutos_retraso int;

create or replace function public.fn_trg_reporte_horario()
returns trigger language plpgsql set search_path = public as $$
declare h public.horarios_turno;
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
  new.minutos_retraso := case when h.hora_fin is null then null else
    greatest(0, floor(extract(epoch from
      (coalesce(new.creado_en, now()) at time zone 'America/La_Paz') - (new.fecha + h.hora_fin)) / 60))::int end;
  return new;
end $$;
drop trigger if exists trg_reportes_turno_horario on public.reportes_turno;
create trigger trg_reportes_turno_horario before insert or update on public.reportes_turno
  for each row execute function public.fn_trg_reporte_horario();

-- 3) El auxiliar cierra su turno desde que empieza (hasta el final del día)
create or replace function public.fn_puede_cerrar_turno(p_turno text)
returns boolean language sql stable set search_path = public as $$
  select case
    when public.fn_puede_gestionar_auxiliares() then true
    when public.fn_rol_actual() = 'auxiliar' then
      p_turno = public.fn_turno_vigente(auth.uid())
      and (now() at time zone 'America/La_Paz')::time
          >= coalesce((select h.hora_inicio from public.horarios_turno h where h.turno = p_turno), time '00:00')
    else false
  end;
$$;

-- ...y edita / borra su reporte solo ese mismo día
create or replace function public.fn_puede_editar_reporte(p_reporte bigint)
returns boolean language sql stable set search_path = public as $$
  select exists (
    select 1 from public.reportes_turno r
     where r.id = p_reporte
       and public.fn_puede_operar()
       and (public.fn_puede_gestionar_auxiliares()
            or (r.auxiliar_id = auth.uid()
                and r.fecha = (now() at time zone 'America/La_Paz')::date
                and public.fn_puede_cerrar_turno(r.turno))));
$$;

drop policy if exists reportes_turno_editar on public.reportes_turno;
create policy reportes_turno_editar on public.reportes_turno for update to authenticated
  using (public.fn_puede_operar() and (public.fn_puede_gestionar_auxiliares()
    or (auxiliar_id = auth.uid() and fecha = (now() at time zone 'America/La_Paz')::date and public.fn_puede_cerrar_turno(turno))))
  with check (public.fn_puede_operar() and (public.fn_puede_gestionar_auxiliares()
    or (auxiliar_id = auth.uid() and fecha = (now() at time zone 'America/La_Paz')::date and public.fn_puede_cerrar_turno(turno))));

drop policy if exists reportes_turno_borrar on public.reportes_turno;
create policy reportes_turno_borrar on public.reportes_turno for delete to authenticated
  using (public.fn_puede_operar() and (public.fn_puede_gestionar_auxiliares()
    or (auxiliar_id = auth.uid() and fecha = (now() at time zone 'America/La_Paz')::date and public.fn_puede_cerrar_turno(turno))));

revoke execute on function public.fn_trg_horario_turno(), public.fn_trg_reporte_horario() from anon, authenticated, public;
