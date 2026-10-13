-- =====================================================================
--  SISTEMA DE ASIGNACIÓN DE LABORATORIOS — UPDS
--  Script 47: RANKING POR TICKETS (SIN PUNTOS)
--  - La Competencia y Desempeño cuentan TICKETS, no puntos: cada ticket
--    vale 1, igual que antes.
--  - Única excepción: abrir / cerrar laboratorio vale 1 ticket aunque se
--    haya guardado uno por PC (los del mismo lote cuentan una vez).
--  - Se quitan puntos_tipo y la columna periodos_competencia.puntos.
--  - Desempeño usa la misma regla en todo el dashboard (totales, por día,
--    por tipo, por laboratorio y por auxiliar).
--  Ejecutar en: Supabase > SQL Editor (después de 46).
-- =====================================================================

-- 1) Sin puntos
alter table public.periodos_competencia drop column if exists puntos;
drop table if exists public.puntos_tipo;

-- 2) Unidad de conteo: el ticket, salvo abrir/cerrar lab, que cuenta por lote
create or replace function public.fn_unidad_ticket(p_tipo text, p_lote uuid, p_id bigint)
returns text language sql immutable as $$
  select case when p_tipo in ('apertura_lab', 'cierre_lab') then coalesce(p_lote::text, p_id::text) else p_id::text end;
$$;

-- 3) Ranking de todos los auxiliares por tickets (registró + colaboró)
create or replace function public.fn_ranking_competencia(p_desde timestamptz, p_hasta timestamptz)
returns jsonb language sql stable set search_path = public as $$
  with t as (
    select distinct on (public.fn_unidad_ticket(a.tipo, a.lote, a.id)) a.tipo, a.auxiliar_id, a.colaboradores
      from public.atenciones a
     where a.creado_en >= p_desde and a.creado_en < p_hasta
     order by public.fn_unidad_ticket(a.tipo, a.lote, a.id), a.id
  ),
  reg as (select auxiliar_id as pid, tipo, count(*)::int as n from t where auxiliar_id is not null group by 1, 2),
  col as (select c as pid, count(*)::int as n from t, unnest(t.colaboradores) c where c is distinct from t.auxiliar_id group by 1),
  gente as (
    select p.id, p.nombre_completo from public.perfiles p
     where (p.rol in ('auxiliar', 'encargado') and p.activo)
        or p.id in (select pid from reg union select pid from col)
  ),
  fila as (
    select g.id, g.nombre_completo,
           coalesce((select sum(r.n) from reg r where r.pid = g.id), 0) as registrados,
           coalesce((select c.n from col c where c.pid = g.id), 0) as colaboraciones,
           coalesce((select jsonb_object_agg(r.tipo, r.n) from reg r where r.pid = g.id), '{}'::jsonb) as por_tipo,
           (select count(*) from public.reportes_turno rt where rt.auxiliar_id = g.id and rt.creado_en >= p_desde and rt.creado_en < p_hasta) as cierres,
           (select count(*) from public.reportes_turno rt where rt.auxiliar_id = g.id and rt.creado_en >= p_desde and rt.creado_en < p_hasta
                                                           and coalesce(rt.minutos_retraso, 0) > 0) as retrasos
      from gente g
     where public.fn_puede_gestionar_auxiliares()
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', id, 'nombre', nombre_completo, 'tickets', registrados + colaboraciones,
           'registrados', registrados, 'colaboraciones', colaboraciones,
           'por_tipo', por_tipo, 'cierres', cierres, 'retrasos', retrasos)
         order by registrados + colaboraciones desc, registrados desc, nombre_completo), '[]'::jsonb)
    from fila;
$$;

create or replace function public.fn_competencia_actual()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_desde timestamptz := public.fn_inicio_periodo_actual();
begin
  if not public.fn_puede_gestionar_auxiliares() then
    raise exception 'Solo el administrador o el encargado pueden ver la competencia.';
  end if;
  return jsonb_build_object('desde', v_desde, 'ranking', public.fn_ranking_competencia(v_desde, now()));
end $$;

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
  insert into public.periodos_competencia (desde, hasta, nota, cerrado_por, ranking)
  values (v_desde, now(), nullif(btrim(p_nota), ''), auth.uid(), public.fn_ranking_competencia(v_desde, now()))
  returning id into v_id;
  return v_id;
end $$;

-- 4) Dashboard: misma regla en todo (abrir/cerrar lab = 1 ticket) y turno vigente
create or replace function public.fn_dashboard_operacion(p_desde date, p_hasta date)
returns jsonb language plpgsql stable set search_path = public as $$
declare
  v_zona   constant text := 'America/La_Paz';
  v_dias   int := (p_hasta - p_desde) + 1;
  v_ant_desde date := p_desde - ((p_hasta - p_desde) + 1);
  v_ant_hasta date := p_desde - 1;
  v_hoy    date := (now() at time zone 'America/La_Paz')::date;
  r jsonb;
begin
  if not public.fn_puede_gestionar_auxiliares() then
    raise exception 'Solo el administrador o el encargado pueden ver el dashboard.';
  end if;
  if p_desde is null or p_hasta is null or p_hasta < p_desde or v_dias > 400 then
    raise exception 'Rango de fechas inválido.';
  end if;

  with t as (
    select distinct on (public.fn_unidad_ticket(a.tipo, a.lote, a.id)) a.*, (a.creado_en at time zone v_zona)::date as dia
      from public.atenciones a
     where (a.creado_en at time zone v_zona)::date between p_desde and p_hasta
     order by public.fn_unidad_ticket(a.tipo, a.lote, a.id), a.id
  ),
  personal as (
    select id, nombre_completo, rol
      from public.perfiles
     where rol in ('auxiliar', 'encargado') and activo
  )
  select jsonb_build_object(
    'kpis', (
      select jsonb_build_object(
        'tickets',      count(*),
        'trabajos',     count(distinct coalesce(lote::text, id::text)),
        'resueltos',    count(*) filter (where estado = 'resuelto'),
        'en_proceso',   count(*) filter (where estado = 'en_proceso'),
        'pendientes',   count(*) filter (where estado = 'pendiente'),
        'con_colaboradores', count(distinct coalesce(lote::text, id::text)) filter (where cardinality(colaboradores) > 0),
        'horas_resolucion', round((avg(extract(epoch from (resuelto_en - creado_en)) / 3600)
                              filter (where estado = 'resuelto' and resuelto_en > creado_en + interval '1 minute'))::numeric, 1),
        'tickets_anterior', (select count(distinct public.fn_unidad_ticket(tipo, lote, id)) from public.atenciones
                              where (creado_en at time zone v_zona)::date between v_ant_desde and v_ant_hasta),
        'reportes',     (select count(*) from public.reportes_turno where fecha between p_desde and p_hasta),
        'tareas_pendientes', (select count(*) from public.reporte_tareas where not hecha),
        'pendientes_total',  (select count(*) from public.atenciones where estado <> 'resuelto')
      ) from t
    ),
    'por_dia', (
      select coalesce(jsonb_agg(jsonb_build_object('dia', d::date, 'tickets', coalesce(c.n, 0),
                                                   'resueltos', coalesce(c.res, 0)) order by d), '[]')
        from generate_series(p_desde, p_hasta, interval '1 day') d
        left join (select dia, count(*) n, count(*) filter (where estado = 'resuelto') res from t group by dia) c on c.dia = d::date
    ),
    'por_tipo', (
      select coalesce(jsonb_agg(jsonb_build_object('tipo', tipo, 'tickets', n, 'trabajos', w) order by n desc), '[]')
        from (select tipo, count(*) n, count(distinct coalesce(lote::text, id::text)) w from t group by tipo) x
    ),
    'por_lab', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', am.id, 'codigo', am.codigo, 'color', am.color,
               'tickets', (select count(*) from t where t.ambiente_id = am.id),
               'pendientes', (select count(*) from t where t.ambiente_id = am.id and t.estado <> 'resuelto'),
               'pcs', (select jsonb_build_object(
                          'total', count(*),
                          'operativa', count(*) filter (where p.estado = 'operativa'),
                          'inactiva', count(*) filter (where p.estado = 'inactiva'),
                          'mantenimiento', count(*) filter (where p.estado = 'mantenimiento'),
                          'baja', count(*) filter (where p.estado = 'baja'))
                         from public.ambiente_pcs p where p.ambiente_id = am.id)
             ) order by am.orden, am.codigo), '[]')
        from public.ambientes am
       where am.tipo = 'laboratorio' and am.estado <> 'baja'
    ),
    'auxiliares', (
      select coalesce(jsonb_agg(x order by (x->>'tickets')::int desc, (x->>'registrados')::int desc, x->>'nombre'), '[]')
        from (
          select jsonb_build_object(
            'id', p.id, 'nombre', p.nombre_completo, 'rol', p.rol,
            'turno', (select tp.turno from public.turnos_programados tp
                       where tp.perfil_id = p.id and tp.desde <= v_hoy order by tp.desde desc limit 1),
            'tickets', (select count(*) from t where t.auxiliar_id = p.id or p.id = any(t.colaboradores)),
            'registrados', (select count(*) from t where t.auxiliar_id = p.id),
            'colaboraciones', (select count(*) from t where p.id = any(t.colaboradores) and t.auxiliar_id is distinct from p.id),
            'resueltos', (select count(*) from t where t.estado = 'resuelto' and (t.auxiliar_id = p.id or p.id = any(t.colaboradores))),
            'pcs_atendidas', (select count(distinct a.pc_id) from public.atenciones a
                               where a.pc_id is not null and a.tipo not in ('apertura_lab', 'cierre_lab')
                                 and (a.creado_en at time zone v_zona)::date between p_desde and p_hasta
                                 and (a.auxiliar_id = p.id or p.id = any(a.colaboradores))),
            'reportes', (select count(*) from public.reportes_turno r where r.auxiliar_id = p.id and r.fecha between p_desde and p_hasta),
            'tareas_hechas', (select count(*) from public.reporte_tareas rt
                               where rt.hecha_por = p.id and (rt.hecha_en at time zone v_zona)::date between p_desde and p_hasta)
          ) x
          from personal p
        ) s
    ),
    'pcs', (
      select jsonb_build_object(
        'total', count(*),
        'docentes', count(*) filter (where es_docente),
        'operativa', count(*) filter (where estado = 'operativa'),
        'inactiva', count(*) filter (where estado = 'inactiva'),
        'mantenimiento', count(*) filter (where estado = 'mantenimiento'),
        'baja', count(*) filter (where estado = 'baja'))
      from public.ambiente_pcs
    ),
    'top_pcs', (
      select coalesce(jsonb_agg(jsonb_build_object('etiqueta', pc.etiqueta, 'lab', am.codigo, 'estado', pc.estado,
                                                   'tickets', x.n, 'ultimo', x.ultimo) order by x.n desc, pc.etiqueta), '[]')
        from (select pc_id, count(*) n, max(creado_en) ultimo from public.atenciones
               where pc_id is not null and tipo not in ('apertura_lab', 'cierre_lab')
                 and (creado_en at time zone v_zona)::date between p_desde and p_hasta
               group by pc_id order by count(*) desc limit 10) x
        join public.ambiente_pcs pc on pc.id = x.pc_id
        left join public.ambientes am on am.id = pc.ambiente_id
    )
  ) into r;
  return r;
end $$;
