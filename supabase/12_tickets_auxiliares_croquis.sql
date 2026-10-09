-- =====================================================================
--  SISTEMA DE ASIGNACIÓN DE LABORATORIOS — UPDS
--  Script 12: TICKETS, AUXILIARES (rotación) y CROQUIS de PCs
--  - Estados de PC: operativa / inactiva / mantenimiento / baja.
--  - Atenciones = tickets: tipo ampliado (software, mantenimiento físico,
--    soporte académico, tarea, petición…) + alcance individual/grupal.
--  - El mantenimiento deja de ser módulo aparte (es un tipo de ticket).
--  - Rotación de sábados + asignación de turnos (admin/encargado).
--  Ejecutar en: Supabase > SQL Editor (después de 10–11).
-- =====================================================================

-- 1) Estados de PC
do $$
declare c text;
begin
  select conname into c from pg_constraint
   where conrelid='public.ambiente_pcs'::regclass and contype='c'
     and pg_get_constraintdef(oid) ilike '%estado%';
  if c is not null then execute format('alter table public.ambiente_pcs drop constraint %I', c); end if;
end $$;
update public.ambiente_pcs set estado='mantenimiento' where estado='dañada';
alter table public.ambiente_pcs
  add constraint ambiente_pcs_estado_check check (estado in ('operativa','inactiva','mantenimiento','baja'));

-- 2) Atenciones = tickets
do $$
declare c text;
begin
  select conname into c from pg_constraint
   where conrelid='public.atenciones'::regclass and contype='c'
     and pg_get_constraintdef(oid) ilike '%tipo%';
  if c is not null then execute format('alter table public.atenciones drop constraint %I', c); end if;
end $$;
alter table public.atenciones
  add constraint atenciones_tipo_check check (tipo in
    ('instalacion_software','mantenimiento_fisico','soporte_academico','problema','tarea','peticion','otro'));
update public.atenciones set tipo='peticion' where tipo='atencion';
alter table public.atenciones add column if not exists alcance text not null default 'individual'
  check (alcance in ('individual','grupal'));

-- 3) El mantenimiento pasa a ser un tipo de ticket
drop table if exists public.mantenimientos cascade;

-- 4) Rotación de sábados
create table if not exists public.rotacion_sabados (
  id          bigint generated always as identity primary key,
  fecha       date        not null unique,
  auxiliar_id uuid        references public.perfiles(id) on delete set null,
  turno       text        check (turno in ('M','MD','T','N')),
  nota        text,
  creado_en   timestamptz not null default now()
);
create index if not exists rotacion_sabados_fecha_idx on public.rotacion_sabados (fecha desc);

-- 5) Gestión de auxiliares (admin o encargado)
create or replace function public.fn_puede_gestionar_auxiliares()
returns boolean language sql stable set search_path = public as $$
  select coalesce(public.fn_rol_actual() in ('admin','encargado'), false);
$$;

create or replace function public.fn_asignar_turno(p_usuario uuid, p_turno text, p_sabado boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.fn_puede_gestionar_auxiliares() then
    raise exception 'Solo el administrador o el encargado pueden asignar turnos.';
  end if;
  if p_turno is not null and p_turno not in ('M','MD','T','N') then
    raise exception 'Turno inválido.';
  end if;
  update public.perfiles
     set turno_habitual = p_turno, sabado_rotativo = coalesce(p_sabado, false)
   where id = p_usuario;
end $$;

-- 6) RLS de rotacion_sabados
alter table public.rotacion_sabados enable row level security;
drop policy if exists rotacion_sabados_ver     on public.rotacion_sabados;
drop policy if exists rotacion_sabados_gestion on public.rotacion_sabados;
create policy rotacion_sabados_ver on public.rotacion_sabados
  for select to authenticated using (public.fn_puede_ver());
create policy rotacion_sabados_gestion on public.rotacion_sabados
  for all to authenticated using (public.fn_puede_gestionar_auxiliares()) with check (public.fn_puede_gestionar_auxiliares());

-- 7) SCPC sin cero a la izquierda (LAB-01 -> SCPC101)
create or replace function public.fn_generar_pcs(p_ambiente_id bigint, p_cantidad int)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_lab text; v_num text; v_i int; v_etq text; v_orden int; v_creadas int := 0;
begin
  if not public.fn_puede_operar() then
    raise exception 'No tiene permisos para generar PCs.';
  end if;
  if p_cantidad is null or p_cantidad < 1 or p_cantidad > 100 then
    raise exception 'Cantidad inválida (1 a 100).';
  end if;
  select codigo into v_lab from public.ambientes where id = p_ambiente_id;
  if v_lab is null then raise exception 'Laboratorio no encontrado.'; end if;
  v_num := ltrim(coalesce(nullif(regexp_replace(v_lab, '\D', '', 'g'), ''), p_ambiente_id::text), '0');
  if v_num = '' then v_num := p_ambiente_id::text; end if;
  select coalesce(max(orden), 0) into v_orden from public.ambiente_pcs where ambiente_id = p_ambiente_id;
  for v_i in 1..p_cantidad loop
    v_etq := 'SCPC' || v_num || lpad(v_i::text, 2, '0');
    if not exists (select 1 from public.ambiente_pcs where ambiente_id = p_ambiente_id and etiqueta = v_etq) then
      v_orden := v_orden + 1;
      insert into public.ambiente_pcs (ambiente_id, etiqueta, estado, orden)
      values (p_ambiente_id, v_etq, 'operativa', v_orden);
      v_creadas := v_creadas + 1;
    end if;
  end loop;
  return v_creadas;
end $$;

revoke all on public.rotacion_sabados from anon;
revoke execute on function public.fn_asignar_turno(uuid, text, boolean) from anon, public;
grant execute on all functions in schema public to authenticated;
