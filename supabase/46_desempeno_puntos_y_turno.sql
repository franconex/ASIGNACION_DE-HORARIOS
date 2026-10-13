-- =====================================================================
--  SISTEMA DE ASIGNACIÓN DE LABORATORIOS — UPDS
--  Script 46: DESEMPEÑO CON PUNTOS Y TURNO ACTUAL
--  - El ranking de auxiliares de Desempeño usa los mismos puntos que la
--    Competencia (puntos_tipo; un trabajo con varias PCs cuenta una vez),
--    para el mes o rango de fechas elegido.
--  - El turno de cada auxiliar sale de turnos_programados (el vigente hoy),
--    no del campo viejo perfiles.turno_habitual.
--  - fn_ranking_competencia devuelve [] a quien no es admin/encargado, y
--    ahora se puede llamar desde fn_dashboard_operacion.
--  Ejecutar en: Supabase > SQL Editor (después de 45).
-- =====================================================================

-- 1) Ranking por puntos: solo para admin y encargado
create or replace function public.fn_ranking_competencia(p_desde timestamptz, p_hasta timestamptz)
returns jsonb language sql stable set search_path = public as $$
  with t as (
    select coalesce(a.lote::text, a.id::text) as trabajo, a.tipo, a.auxiliar_id, a.colaboradores
      from public.atenciones a
     where a.creado_en >= p_desde and a.creado_en < p_hasta and a.tipo <> 'cambio_estado'
  ),
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
     where public.fn_puede_gestionar_auxiliares()
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', id, 'nombre', nombre_completo, 'puntos', puntos, 'trabajos', trabajos, 'colaboraciones', colaboraciones,
           'por_tipo', por_tipo, 'cierres', cierres, 'retrasos', retrasos)
         order by puntos desc, trabajos desc, nombre_completo), '[]'::jsonb)
    from fila;
$$;
grant execute on function public.fn_ranking_competencia(timestamptz, timestamptz) to authenticated;

-- 2) Dashboard: auxiliares con puntos y turno vigente
create or replace function public.fn_dashboard_operacion(p_desde date, p_hasta date)
returns jsonb language plpgsql stable set search_path = public as $$
declare
  v_zona   constant text := 'America/La_Paz';
  v_dias   int := (p_hasta - p_desde) + 1;
  v_ant_desde date := p_desde - ((p_hasta - p_desde) + 1);
  v_ant_hasta date := p_desde - 1;
  v_hoy    date := (now() at time zone 'America/La_Paz')::date;
  v_rank   jsonb;
  v_pts_col int := coalesce((select puntos from public.puntos_tipo where tipo = 'colaboracion'), 0);
  r jsonb;
begin
  if not public.fn_puede_gestionar_auxiliares() then
    raise exception 'Solo el administrador o el encargado pueden ver el dashboard.';
  end if;
  if p_desde is null or p_hasta is null or p_hasta < p_desde or v_dias > 400 then
    raise exception 'Rango de fechas inválido.';
  end if;

  -- Puntos del periodo (mismo cálculo que la Competencia)
  v_rank := public.fn_ranking_competencia(p_desde::timestamp at time zone v_zona, (p_hasta + 1)::timestamp at time zone v_zona);

  with t as (
    select a.*, (a.creado_en at time zone v_zona)::date as dia
      from public.atenciones a
     where (a.creado_en at time zone v_zona)::date between p_desde and p_hasta
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
        'tickets_anterior', (select count(*) from public.atenciones
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
      select coalesce(jsonb_agg(x order by (x->>'puntos')::int desc, (x->>'trabajos')::int desc, x->>'nombre'), '[]')
        from (
          select jsonb_build_object(
            'id', p.id, 'nombre', p.nombre_completo, 'rol', p.rol,
            -- Turno vigente hoy (el último programado que ya empezó)
            'turno', (select tp.turno from public.turnos_programados tp
                       where tp.perfil_id = p.id and tp.desde <= v_hoy order by tp.desde desc limit 1),
            'puntos', coalesce(rk.puntos, 0),
            'puntos_colaboracion', coalesce(rk.colaboraciones, 0) * v_pts_col,
            'trabajos', coalesce(rk.trabajos, 0),
            'colaboraciones', coalesce(rk.colaboraciones, 0),
            'registrados', (select count(*) from t where t.auxiliar_id = p.id),
            'resueltos', (select count(*) from t where t.estado = 'resuelto' and (t.auxiliar_id = p.id or p.id = any(t.colaboradores))),
            'pcs_atendidas', (select count(distinct pc_id) from t where pc_id is not null and (t.auxiliar_id = p.id or p.id = any(t.colaboradores))),
            'reportes', (select count(*) from public.reportes_turno r where r.auxiliar_id = p.id and r.fecha between p_desde and p_hasta),
            'tareas_hechas', (select count(*) from public.reporte_tareas rt
                               where rt.hecha_por = p.id and (rt.hecha_en at time zone v_zona)::date between p_desde and p_hasta)
          ) x
          from personal p
          left join lateral (
            select (e->>'puntos')::int as puntos, (e->>'trabajos')::int as trabajos, (e->>'colaboraciones')::int as colaboraciones
              from jsonb_array_elements(v_rank) e where e->>'id' = p.id::text
          ) rk on true
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
        from (select pc_id, count(*) n, max(creado_en) ultimo from t where pc_id is not null group by pc_id order by count(*) desc limit 10) x
        join public.ambiente_pcs pc on pc.id = x.pc_id
        left join public.ambientes am on am.id = pc.ambiente_id
    )
  ) into r;
  return r;
end $$;
