-- =====================================================================
--  SISTEMA DE ASIGNACIÓN DE LABORATORIOS — UPDS
--  Script 26: TURNOS PROGRAMADOS POR FECHA
--  - El admin/encargado programa el turno de cada auxiliar indicando a
--    partir de qué fecha empieza (p. ej. Tarde desde el 01/11/2026).
--  - Cada asignación queda guardada: el turno vigente es el de la fecha
--    de inicio más reciente que ya llegó; el próximo es el siguiente.
--  - Todo el personal puede ver los turnos (para que el auxiliar vea el suyo).
--  Ejecutar en: Supabase > SQL Editor (después de 25).
-- =====================================================================

-- 1) Tabla
create table if not exists public.turnos_programados (
  id           bigint generated always as identity primary key,
  perfil_id    uuid not null references public.perfiles(id) on delete cascade,
  turno        text not null check (turno in ('M', 'MD', 'T', 'N')),
  desde        date not null,
  creado_por   uuid default auth.uid() references public.perfiles(id) on delete set null,
  creado_en    timestamptz not null default now(),
  constraint turnos_programados_unico unique (perfil_id, desde)
);
create index if not exists turnos_programados_perfil_idx on public.turnos_programados (perfil_id, desde desc);

comment on table public.turnos_programados is 'Turno de cada auxiliar desde una fecha de inicio. Vigente = la fecha más reciente <= hoy.';

-- 2) Seguridad: todo el personal ve; admin/encargado programan y corrigen
alter table public.turnos_programados enable row level security;
drop policy if exists turnos_programados_ver on public.turnos_programados;
create policy turnos_programados_ver on public.turnos_programados
  for select to authenticated using (public.fn_puede_ver());
drop policy if exists turnos_programados_gestion on public.turnos_programados;
create policy turnos_programados_gestion on public.turnos_programados
  for all to authenticated using (public.fn_puede_gestionar_auxiliares()) with check (public.fn_puede_gestionar_auxiliares());
revoke all on public.turnos_programados from anon;
