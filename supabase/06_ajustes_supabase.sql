-- =====================================================================
--  SISTEMA DE ASIGNACIÓN DE LABORATORIOS — UPDS
--  Script 06: AJUSTES recomendados por el "Advisor" de Supabase
--  (seguridad y rendimiento). Ejecutar después del 04 (o del 05).
-- =====================================================================

-- ---------------------------------------------------------------------
-- Seguridad: search_path fijo en todas las funciones del sistema
-- (evita que un esquema malicioso "suplante" tablas o funciones)
-- ---------------------------------------------------------------------
do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as firma
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and (p.proname like 'fn\_%' or p.proname like 'rpc\_%')
      and p.proname not in ('fn_crear_usuario', 'fn_cambiar_password')  -- ya tienen su search_path
  loop
    execute 'alter function ' || f.firma || ' set search_path = public';
  end loop;
end $$;

-- La función del trigger de Auth no debe poder llamarse desde la API
revoke execute on function public.fn_trg_nuevo_usuario() from authenticated, anon, public;

-- ---------------------------------------------------------------------
-- Rendimiento: índices para claves foráneas sin índice
-- ---------------------------------------------------------------------
create index if not exists asignaciones_creado_por_idx       on public.asignaciones (creado_por);
create index if not exists cesiones_carrera_receptor_idx     on public.cesiones (carrera_receptor_id);
create index if not exists cesiones_creado_por_idx           on public.cesiones (creado_por);
create index if not exists reserva_horarios_ambiente_idx     on public.reserva_horarios (ambiente_id);
create index if not exists reservas_carrera_idx              on public.reservas (carrera_id);
create index if not exists reservas_creado_por_idx           on public.reservas (creado_por);
create index if not exists reubicaciones_ambiente_destino_idx on public.reubicaciones (ambiente_destino_id);
create index if not exists reubicaciones_creado_por_idx      on public.reubicaciones (creado_por);

-- ---------------------------------------------------------------------
-- Rendimiento: auth.uid() se evalúa una sola vez por consulta
-- ---------------------------------------------------------------------
drop policy if exists perfiles_ver on public.perfiles;
create policy perfiles_ver on public.perfiles
  for select to authenticated using (id = (select auth.uid()) or public.fn_es_admin());

-- ---------------------------------------------------------------------
-- Rendimiento: una sola política por acción en los catálogos base
-- (antes "_admin" era FOR ALL y se sumaba a "_ver" en SELECT)
-- ---------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['sistemas_academicos', 'bloques_horario', 'tipos_reserva'] loop
    execute format('drop policy if exists %I on public.%I', t || '_admin', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.fn_es_admin())', t || '_crear', t);
    execute format('create policy %I on public.%I for update to authenticated using (public.fn_es_admin()) with check (public.fn_es_admin())', t || '_editar', t);
    execute format('create policy %I on public.%I for delete to authenticated using (public.fn_es_admin())', t || '_borrar', t);
  end loop;
end $$;
