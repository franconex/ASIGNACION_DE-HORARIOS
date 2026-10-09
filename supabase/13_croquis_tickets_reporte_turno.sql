-- =====================================================================
--  SISTEMA DE ASIGNACIÓN DE LABORATORIOS — UPDS
--  Script 13: CROQUIS (PC docente), TICKETS POR LOTE y REPORTE DE TURNO
--  - PC del docente: columna es_docente (PCDOCENTE1, PCDOCENTE2…).
--  - Generar PCs agrega N máquinas NUEVAS siguiendo la numeración
--    (SCPC101…SCPC130; si luego se agregan 5 -> SCPC131…SCPC135).
--  - Tickets: motivo (descripcion) + solución; un ticket con varias PCs
--    se guarda como un ticket por PC unidos por el mismo "lote".
--  - Reporte de turno: novedades + tareas pendientes (checklist) que
--    el siguiente turno ve y va marcando como hechas.
--  Ejecutar en: Supabase > SQL Editor (después de 12).
-- =====================================================================

-- 1) PC del docente
alter table public.ambiente_pcs add column if not exists es_docente boolean not null default false;
-- Una sola PC docente por laboratorio
create unique index if not exists ambiente_pcs_un_docente
  on public.ambiente_pcs (ambiente_id) where es_docente;

-- 2) Generar PCs: crea p_cantidad máquinas nuevas a continuación de las
--    existentes, y la PC docente si aún no existe.
--    LAB-01 -> SCPC101…, PCDOCENTE1 · LAB-12 -> SCPC1201…, PCDOCENTE12
create or replace function public.fn_generar_pcs(p_ambiente_id bigint, p_cantidad int)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_lab text; v_num text; v_etq text; v_orden int; v_i int := 0; v_creadas int := 0;
begin
  if not public.fn_puede_operar() then
    raise exception 'No tiene permisos para generar PCs.';
  end if;
  if p_cantidad is null or p_cantidad < 0 or p_cantidad > 100 then
    raise exception 'Cantidad inválida (0 a 100).';
  end if;
  select codigo into v_lab from public.ambientes where id = p_ambiente_id;
  if v_lab is null then raise exception 'Laboratorio no encontrado.'; end if;
  v_num := ltrim(coalesce(nullif(regexp_replace(v_lab, '\D', '', 'g'), ''), p_ambiente_id::text), '0');
  if v_num = '' then v_num := p_ambiente_id::text; end if;

  -- PC docente (orden 0: va primero)
  if not exists (select 1 from public.ambiente_pcs where ambiente_id = p_ambiente_id and es_docente) then
    insert into public.ambiente_pcs (ambiente_id, etiqueta, estado, orden, es_docente)
    values (p_ambiente_id, 'PCDOCENTE' || v_num, 'operativa', 0, true);
  end if;

  select coalesce(max(orden), 0) into v_orden from public.ambiente_pcs where ambiente_id = p_ambiente_id;
  -- Busca el primer número libre y sigue hasta crear p_cantidad máquinas
  while v_creadas < p_cantidad loop
    v_i := v_i + 1;
    if v_i > 999 then exit; end if;
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

-- 3) Tickets: solución + lote (los tickets creados juntos para varias PCs)
alter table public.atenciones add column if not exists solucion text;
alter table public.atenciones add column if not exists lote uuid;
create index if not exists atenciones_lote_idx on public.atenciones (lote);
create index if not exists atenciones_pc_idx   on public.atenciones (pc_id, creado_en desc);

-- 4) Reporte de turno
create table if not exists public.reportes_turno (
  id          bigint generated always as identity primary key,
  fecha       date        not null default (now() at time zone 'America/La_Paz')::date,
  turno       text        not null check (turno in ('M', 'MD', 'T', 'N')),
  auxiliar_id uuid        default auth.uid() references public.perfiles(id) on delete set null,
  novedades   text,
  creado_en   timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
create index if not exists reportes_turno_fecha_idx on public.reportes_turno (fecha desc, creado_en desc);

create trigger trg_reportes_turno_actualizado
  before update on public.reportes_turno
  for each row execute function public.fn_set_actualizado_en();

create table if not exists public.reporte_tareas (
  id          bigint generated always as identity primary key,
  reporte_id  bigint      not null references public.reportes_turno(id) on delete cascade,
  ambiente_id bigint      references public.ambientes(id) on delete set null,
  descripcion text        not null,
  hecha       boolean     not null default false,
  hecha_por   uuid        references public.perfiles(id) on delete set null,
  hecha_en    timestamptz,
  creado_en   timestamptz not null default now()
);
create index if not exists reporte_tareas_pendientes_idx on public.reporte_tareas (hecha, creado_en);
create index if not exists reporte_tareas_reporte_idx on public.reporte_tareas (reporte_id);

comment on table public.reportes_turno is 'Reporte que deja cada turno: novedades y tareas pendientes.';
comment on table public.reporte_tareas is 'Tareas pendientes de un reporte de turno; el siguiente turno las marca como hechas.';

alter table public.reportes_turno enable row level security;
alter table public.reporte_tareas enable row level security;

do $$
declare t text;
begin
  foreach t in array array['reportes_turno', 'reporte_tareas'] loop
    execute format('drop policy if exists %I on public.%I', t || '_ver', t);
    execute format('drop policy if exists %I on public.%I', t || '_crear', t);
    execute format('drop policy if exists %I on public.%I', t || '_editar', t);
    execute format('drop policy if exists %I on public.%I', t || '_borrar', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.fn_puede_ver())', t || '_ver', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.fn_puede_operar())', t || '_crear', t);
    execute format('create policy %I on public.%I for update to authenticated using (public.fn_puede_operar()) with check (public.fn_puede_operar())', t || '_editar', t);
    execute format('create policy %I on public.%I for delete to authenticated using (public.fn_puede_operar())', t || '_borrar', t);
  end loop;
end $$;

revoke all on public.reportes_turno, public.reporte_tareas from anon;
grant execute on all functions in schema public to authenticated;
