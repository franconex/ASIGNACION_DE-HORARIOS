-- =====================================================================
--  SISTEMA DE ASIGNACIÓN DE LABORATORIOS — UPDS
--  Script 45: COMPETENCIA DE AUXILIARES POR REUNIÓN
--  - La competencia va por periodos: cada reunión cierra el periodo en
--    curso, guarda el ranking completo de todos los auxiliares y empieza
--    uno nuevo en 0. Los tickets no se borran nunca.
--  - Se cuentan PUNTOS por tipo de trabajo (puntos_tipo, ajustables).
--    Un trabajo con varias PCs (mismo lote) cuenta una sola vez; colaborar
--    en un trabajo de otro suma los puntos de 'colaboracion'.
--  - Cada periodo cerrado guarda los puntos que se usaron y el ranking,
--    así el historial no cambia aunque luego se ajusten los puntos.
--  - Solo admin y encargado ven y cierran periodos.
--  - Quita campeones_mes / fn_campeones_mes (los reemplaza esto).
--  Ejecutar en: Supabase > SQL Editor (después de 44).
-- =====================================================================

drop function if exists public.fn_campeones_mes();
drop function if exists public.fn_top_mes(date);
drop table if exists public.campeones_mes;

-- 1) Puntos por tipo de trabajo
create table if not exists public.puntos_tipo (
  tipo   text primary key check (tipo in ('docente', 'programas', 'preventivo', 'correctivo', 'personal',
                                          'apertura_lab', 'cierre_lab', 'colaboracion')),
  puntos smallint not null check (puntos between 0 and 20)
);
insert into public.puntos_tipo (tipo, puntos) values
  ('correctivo', 3), ('preventivo', 2), ('programas', 2), ('docente', 2), ('personal', 2),
  ('apertura_lab', 1), ('cierre_lab', 1), ('colaboracion', 1)
on conflict (tipo) do nothing;

alter table public.puntos_tipo enable row level security;
drop policy if exists puntos_tipo_ver on public.puntos_tipo;
create policy puntos_tipo_ver on public.puntos_tipo
  for select to authenticated using (public.fn_puede_gestionar_auxiliares());
drop policy if exists puntos_tipo_editar on public.puntos_tipo;
create policy puntos_tipo_editar on public.puntos_tipo
  for update to authenticated using (public.fn_puede_gestionar_auxiliares()) with check (public.fn_puede_gestionar_auxiliares());
revoke insert, delete on public.puntos_tipo from anon, authenticated;

-- 2) Periodos cerrados (uno por reunión)
create table if not exists public.periodos_competencia (
  id          bigint generated always as identity primary key,
  desde       timestamptz not null,
  hasta       timestamptz not null,
  nota        text check (nota is null or char_length(nota) <= 300),
  cerrado_por uuid references public.perfiles (id) on delete set null,
  puntos      jsonb not null,
  ranking     jsonb not null,
  check (hasta > desde)
);

alter table public.periodos_competencia enable row level security;
drop policy if exists periodos_competencia_ver on public.periodos_competencia;
create policy periodos_competencia_ver on public.periodos_competencia
  for select to authenticated using (public.fn_puede_gestionar_auxiliares());
-- Se escribe solo con fn_cerrar_periodo / fn_deshacer_ultimo_periodo
revoke insert, update, delete on public.periodos_competencia from anon, authenticated;

-- 3) Ranking de todos los auxiliares entre dos momentos
create or replace function public.fn_ranking_competencia(p_desde timestamptz, p_hasta timestamptz)
returns jsonb language sql stable set search_path = public as $$
  with t as (
    select coalesce(a.lote::text, a.id::text) as trabajo, a.tipo, a.auxiliar_id, a.colaboradores
      from public.atenciones a
     where a.creado_en >= p_desde and a.creado_en < p_hasta and a.tipo <> 'cambio_estado'
  ),
  -- Un trabajo (lote) cuenta una vez: varias PCs = 1 trabajo
  w as (select distinct on (trabajo) trabajo, tipo, auxiliar_id, colaboradores from t order by trabajo),
  pts as (select tipo, puntos from public.puntos_tipo),
  reg as (select w.auxiliar_id as pid, w.tipo, count(*)::int as n from w where w.auxiliar_id is not null group by 1, 2),
  col as (select c as pid, count(*)::int as n from w, unnest(w.colaboradores) c where c is distinct from w.auxiliar_id group by 1),
  gente as (
    select p.id, p.nombre_completo from public.perfiles p
     where (p.rol in ('auxiliar', 'encargado') and p.activo)
        or p.id in (select pid from reg union select pid from col)
  ),
  fila as (
    select g.id, g.nombre_completo,
           coalesce((select sum(r.n * coalesce(pts.puntos, 0)) from reg r left join pts on pts.tipo = r.tipo where r.pid = g.id), 0)
             + coalesce((select c.n from col c where c.pid = g.id), 0) * coalesce((select puntos from pts where tipo = 'colaboracion'), 0) as puntos,
           coalesce((select sum(r.n) from reg r where r.pid = g.id), 0) as trabajos,
           coalesce((select c.n from col c where c.pid = g.id), 0) as colaboraciones,
           coalesce((select jsonb_object_agg(r.tipo, r.n) from reg r where r.pid = g.id), '{}'::jsonb) as por_tipo,
           (select count(*) from public.reportes_turno rt where rt.auxiliar_id = g.id and rt.creado_en >= p_desde and rt.creado_en < p_hasta) as cierres,
           (select count(*) from public.reportes_turno rt where rt.auxiliar_id = g.id and rt.creado_en >= p_desde and rt.creado_en < p_hasta
                                                           and coalesce(rt.minutos_retraso, 0) > 0) as retrasos
      from gente g
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', id, 'nombre', nombre_completo, 'puntos', puntos, 'trabajos', trabajos, 'colaboraciones', colaboraciones,
           'por_tipo', por_tipo, 'cierres', cierres, 'retrasos', retrasos)
         order by puntos desc, trabajos desc, nombre_completo), '[]'::jsonb)
    from fila;
$$;

-- Inicio del periodo en curso: el fin del último cerrado (o el primer ticket)
create or replace function public.fn_inicio_periodo_actual()
returns timestamptz language sql stable set search_path = public as $$
  select coalesce((select max(hasta) from public.periodos_competencia),
                  (select min(creado_en) from public.atenciones),
                  now());
$$;

-- 4) Periodo en curso: desde cuándo, puntos y ranking en vivo
create or replace function public.fn_competencia_actual()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_desde timestamptz := public.fn_inicio_periodo_actual();
begin
  if not public.fn_puede_gestionar_auxiliares() then
    raise exception 'Solo el administrador o el encargado pueden ver la competencia.';
  end if;
  return jsonb_build_object(
    'desde', v_desde,
    'puntos', (select jsonb_object_agg(tipo, puntos) from public.puntos_tipo),
    'ranking', public.fn_ranking_competencia(v_desde, now()));
end $$;

-- 5) Cerrar el periodo (el día de la reunión): guarda el ranking y empieza uno nuevo
create or replace function public.fn_cerrar_periodo(p_nota text default null)
returns bigint language plpgsql security definer set search_path = public as $$
declare
  v_desde timestamptz;
  v_id bigint;
begin
  if not public.fn_puede_gestionar_auxiliares() then
    raise exception 'Solo el administrador o el encargado pueden cerrar el periodo.';
  end if;
  lock table public.periodos_competencia in exclusive mode;
  v_desde := public.fn_inicio_periodo_actual();
  if v_desde >= now() then
    raise exception 'El periodo en curso todavía no tiene tickets.';
  end if;
  insert into public.periodos_competencia (desde, hasta, nota, cerrado_por, puntos, ranking)
  values (v_desde, now(), nullif(btrim(p_nota), ''), auth.uid(),
          (select jsonb_object_agg(tipo, puntos) from public.puntos_tipo),
          public.fn_ranking_competencia(v_desde, now()))
  returning id into v_id;
  return v_id;
end $$;

-- 6) Deshacer el último cierre (si se cerró por error): se vuelve a juntar con el periodo en curso
create or replace function public.fn_deshacer_ultimo_periodo()
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.fn_puede_gestionar_auxiliares() then
    raise exception 'Solo el administrador o el encargado pueden deshacer un cierre.';
  end if;
  delete from public.periodos_competencia
   where id = (select id from public.periodos_competencia order by hasta desc limit 1);
  if not found then
    raise exception 'No hay periodos cerrados.';
  end if;
end $$;

revoke execute on function public.fn_ranking_competencia(timestamptz, timestamptz) from anon, authenticated, public;
revoke execute on function public.fn_inicio_periodo_actual() from anon, authenticated, public;
revoke execute on function public.fn_competencia_actual() from anon, public;
revoke execute on function public.fn_cerrar_periodo(text) from anon, public;
revoke execute on function public.fn_deshacer_ultimo_periodo() from anon, public;
grant execute on function public.fn_competencia_actual() to authenticated;
grant execute on function public.fn_cerrar_periodo(text) to authenticated;
grant execute on function public.fn_deshacer_ultimo_periodo() to authenticated;
