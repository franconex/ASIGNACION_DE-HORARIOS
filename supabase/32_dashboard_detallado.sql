-- =====================================================================
--  SISTEMA DE ASIGNACIÓN DE LABORATORIOS — UPDS
--  Script 32: DASHBOARD DETALLADO (admin y encargado)
--  - "Uso de laboratorios" ahora lo ve también el encargado.
--  - fn_dashboard_detalle: horas de uso por día, por día de la semana y
--    por hora; carreras y docentes que más usan los laboratorios; tickets
--    por turno, por día de la semana y tiempo de resolución por tipo;
--    cierres de turno (a tiempo / con retraso, por turno y por auxiliar);
--    PCs dadas de baja y reactivadas; objetos perdidos.
--  Ejecutar en: Supabase > SQL Editor (después de 31).
-- =====================================================================

-- 1) Uso de laboratorios: admin y encargado
create or replace function public.fn_dashboard_uso(p_desde date, p_hasta date)
returns jsonb
language plpgsql stable security invoker set search_path = public as $$
declare
  v_zona constant text := 'America/La_Paz';
  r jsonb;
begin
  if not public.fn_puede_gestionar_auxiliares() then
    raise exception 'Solo el administrador o el encargado pueden ver el uso de laboratorios.';
  end if;
  if p_desde is null or p_hasta is null or p_hasta < p_desde or (p_hasta - p_desde) > 400 then
    raise exception 'Rango de fechas inválido.';
  end if;

  with o as (   -- todo lo que ocupó laboratorios en el período, con sus horas
    select x.*, am.codigo as lab, am.color as lab_color,
           extract(epoch from (x.hora_fin - x.hora_inicio)) / 3600.0 as horas
      from public.fn_ocupaciones(p_desde, p_hasta) x
      join public.ambientes am on am.id = x.ambiente_id and am.tipo = 'laboratorio'
  ),
  t as (        -- tickets del período, con su día local
    select a.*, (a.creado_en at time zone v_zona)::date as dia
      from public.atenciones a
     where (a.creado_en at time zone v_zona)::date between p_desde and p_hasta
  )
  select jsonb_build_object(
    'totales', (
      select jsonb_build_object(
        'horas_clase',  round(coalesce(sum(horas) filter (where origen = 'clase'), 0)::numeric, 1),
        'horas_cesion', round(coalesce(sum(horas) filter (where origen = 'cesion'), 0)::numeric, 1),
        'horas_evento', round(coalesce(sum(horas) filter (where origen = 'reserva'), 0)::numeric, 1),
        'materias',     count(distinct titulo) filter (where origen in ('clase', 'cesion')),
        'eventos',      count(distinct reserva_id) filter (where origen = 'reserva'))
      from o
    ),
    -- Materias: en una cesión cuenta la materia de quien viene
    'materias', (
      select coalesce(jsonb_agg(m order by (m->>'horas')::numeric desc), '[]')
        from (
          select jsonb_build_object(
                   'materia', titulo,
                   'horas', round(sum(horas)::numeric, 1),
                   'sesiones', count(*),
                   'docentes', count(distinct docente_id),
                   'cedidas', count(*) filter (where origen = 'cesion'),
                   'labs', string_agg(distinct lab, ', ')) m
            from o where origen in ('clase', 'cesion')
           group by titulo
           order by sum(horas) desc
           limit 12
        ) s
    ),
    'eventos', (
      select coalesce(jsonb_agg(e order by (e->>'horas')::numeric desc), '[]')
        from (
          select jsonb_build_object(
                   'titulo', titulo,
                   'tipo', estado,
                   'horas', round(sum(horas)::numeric, 1),
                   'dias', count(distinct fecha),
                   'labs', string_agg(distinct lab, ', ')) e
            from o where origen = 'reserva'
           group by titulo, estado
           order by sum(horas) desc
           limit 10
        ) s
    ),
    'por_lab', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'codigo', am.codigo, 'color', am.color,
               'clase',  round(coalesce((select sum(horas) from o where o.ambiente_id = am.id and origen = 'clase'), 0)::numeric, 1),
               'cesion', round(coalesce((select sum(horas) from o where o.ambiente_id = am.id and origen = 'cesion'), 0)::numeric, 1),
               'evento', round(coalesce((select sum(horas) from o where o.ambiente_id = am.id and origen = 'reserva'), 0)::numeric, 1),
               'materia_top', (select titulo from o where o.ambiente_id = am.id and origen in ('clase', 'cesion')
                                group by titulo order by sum(horas) desc limit 1)
             ) order by am.orden, am.codigo), '[]')
        from public.ambientes am
       where am.tipo = 'laboratorio' and am.estado <> 'baja'
    ),
    -- Actividad más común de los auxiliares en cada laboratorio
    'actividades_lab', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'codigo', am.codigo, 'color', am.color, 'total', x.total,
               'tipos', x.tipos) order by x.total desc, am.codigo), '[]')
        from (
          select ambiente_id, sum(n) as total,
                 jsonb_agg(jsonb_build_object('tipo', tipo, 'tickets', n) order by n desc) as tipos
            from (select ambiente_id, tipo, count(*) n from t where ambiente_id is not null group by ambiente_id, tipo) y
           group by ambiente_id
        ) x
        join public.ambientes am on am.id = x.ambiente_id
    ),
    -- Pedidos más repetidos (mismo texto, sin importar mayúsculas)
    'pedidos', (
      select coalesce(jsonb_agg(p order by (p->>'veces')::int desc), '[]')
        from (
          select jsonb_build_object(
                   'descripcion', min(descripcion),
                   'tipo', tipo,
                   'veces', count(*),
                   'trabajos', count(distinct coalesce(lote::text, id::text)),
                   'pendientes', count(*) filter (where estado <> 'resuelto'),
                   'labs', (select string_agg(distinct am.codigo, ', ') from public.ambientes am
                             where am.id = any (array_agg(t.ambiente_id))),
                   'solicitantes', nullif(string_agg(distinct nullif(trim(solicitante), ''), ', '), ''),
                   'ultimo', max(creado_en)) p
            from t
           group by tipo, lower(trim(descripcion))
           order by count(*) desc
           limit 30
        ) s
    )
  ) into r;
  return r;
end $$;

revoke execute on function public.fn_dashboard_uso(date, date) from anon, public;
grant execute on function public.fn_dashboard_uso(date, date) to authenticated;

-- 2) Análisis detallado del período (admin y encargado)
create or replace function public.fn_dashboard_detalle(p_desde date, p_hasta date)
returns jsonb
language plpgsql stable security invoker set search_path = public as $$
declare
  v_zona constant text := 'America/La_Paz';
  r jsonb;
begin
  if not public.fn_puede_gestionar_auxiliares() then
    raise exception 'Solo el administrador o el encargado pueden ver el dashboard.';
  end if;
  if p_desde is null or p_hasta is null or p_hasta < p_desde or (p_hasta - p_desde) > 400 then
    raise exception 'Rango de fechas inválido.';
  end if;

  with o as (   -- ocupación de laboratorios con sus horas
    select x.*, extract(epoch from (x.hora_fin - x.hora_inicio)) / 3600.0 as horas
      from public.fn_ocupaciones(p_desde, p_hasta) x
      join public.ambientes am on am.id = x.ambiente_id and am.tipo = 'laboratorio'
  ),
  t as (        -- tickets del período con su hora local y el turno en que se crearon
    select a.*, (a.creado_en at time zone v_zona) as local,
           coalesce((select h.turno from public.horarios_turno h
                      where h.hora_inicio <= (a.creado_en at time zone v_zona)::time
                      order by ((a.creado_en at time zone v_zona)::time < h.hora_fin) desc, h.hora_inicio desc
                      limit 1), 'N') as turno_creado
      from public.atenciones a
     where (a.creado_en at time zone v_zona)::date between p_desde and p_hasta
  ),
  rt as (       -- cierres de turno del período
    select r.*, p.nombre_completo from public.reportes_turno r
      left join public.perfiles p on p.id = r.auxiliar_id
     where r.fecha between p_desde and p_hasta
  )
  select jsonb_build_object(
    -- Horas de uso por día (clases, cedidas, eventos)
    'uso_por_dia', (
      select coalesce(jsonb_agg(x order by x->>'dia'), '[]') from (
        select jsonb_build_object('dia', d::date,
                 'clase',  round(coalesce(sum(o.horas) filter (where o.origen = 'clase'), 0)::numeric, 1),
                 'cesion', round(coalesce(sum(o.horas) filter (where o.origen = 'cesion'), 0)::numeric, 1),
                 'evento', round(coalesce(sum(o.horas) filter (where o.origen = 'reserva'), 0)::numeric, 1)) x
          from generate_series(p_desde, p_hasta, interval '1 day') d
          left join o on o.fecha = d::date
         group by d) s
    ),
    -- Horas de uso por día de la semana (1 = lunes … 7 = domingo)
    'uso_por_dia_semana', (
      select coalesce(jsonb_agg(x order by (x->>'dia')::int), '[]') from (
        select jsonb_build_object('dia', g.n,
                 'clase',  round(coalesce(sum(o.horas) filter (where o.origen = 'clase'), 0)::numeric, 1),
                 'cesion', round(coalesce(sum(o.horas) filter (where o.origen = 'cesion'), 0)::numeric, 1),
                 'evento', round(coalesce(sum(o.horas) filter (where o.origen = 'reserva'), 0)::numeric, 1)) x
          from generate_series(1, 7) g(n)
          left join o on extract(isodow from o.fecha) = g.n
         group by g.n) s
    ),
    -- Horas pico: cuántas horas de laboratorio se usan en cada franja de una hora
    'uso_por_hora', (
      select coalesce(jsonb_agg(x order by (x->>'hora')::int), '[]') from (
        select jsonb_build_object('hora', g.h,
                 'clase',  round(coalesce(sum(ov) filter (where origen = 'clase'), 0)::numeric, 1),
                 'cesion', round(coalesce(sum(ov) filter (where origen = 'cesion'), 0)::numeric, 1),
                 'evento', round(coalesce(sum(ov) filter (where origen = 'reserva'), 0)::numeric, 1)) x
          from generate_series(6, 22) g(h)
          left join lateral (
            select o.origen,
                   greatest(0, extract(epoch from (least(o.hora_fin, make_time(g.h + 1, 0, 0))
                                                   - greatest(o.hora_inicio, make_time(g.h, 0, 0)))) / 3600.0) as ov
              from o
             where o.hora_inicio < make_time(g.h + 1, 0, 0) and o.hora_fin > make_time(g.h, 0, 0)
          ) y on true
         group by g.h) s
    ),
    -- Horas por carrera
    'carreras', (
      select coalesce(jsonb_agg(x order by (x->>'horas')::numeric desc), '[]') from (
        select jsonb_build_object('carrera', coalesce(c.sigla, c.nombre, 'Sin carrera'), 'nombre', coalesce(c.nombre, 'Sin carrera'),
                 'horas', round(sum(o.horas)::numeric, 1), 'sesiones', count(*),
                 'materias', count(distinct o.titulo), 'docentes', count(distinct o.docente_id)) x
          from o left join public.carreras c on c.id = o.carrera_id
         where o.origen in ('clase', 'cesion')
         group by c.id, c.sigla, c.nombre
         order by sum(o.horas) desc limit 12) s
    ),
    -- Docentes que más usan los laboratorios
    'docentes', (
      select coalesce(jsonb_agg(x order by (x->>'horas')::numeric desc), '[]') from (
        select jsonb_build_object('docente', trim(d.nombres || ' ' || d.apellidos),
                 'horas', round(sum(o.horas)::numeric, 1), 'sesiones', count(*),
                 'materias', string_agg(distinct o.titulo, ', '),
                 'pedidos', (select count(*) from t where t.docente_id = d.id)) x
          from o join public.docentes d on d.id = o.docente_id
         where o.origen in ('clase', 'cesion')
         group by d.id, d.nombres, d.apellidos
         order by sum(o.horas) desc limit 10) s
    ),
    -- Tickets según el turno en que se crearon
    'tickets_por_turno', (
      select coalesce(jsonb_agg(jsonb_build_object('turno', h.turno,
               'tickets', (select count(*) from t where t.turno_creado = h.turno),
               'resueltos', (select count(*) from t where t.turno_creado = h.turno and t.estado = 'resuelto'),
               'horas_resolucion', (select round((avg(extract(epoch from (t.resuelto_en - t.creado_en)) / 3600)
                                     filter (where t.estado = 'resuelto' and t.resuelto_en > t.creado_en + interval '1 minute'))::numeric, 1)
                                      from t where t.turno_creado = h.turno and t.tipo <> 'cambio_estado'))
             order by h.hora_inicio), '[]')
        from public.horarios_turno h
    ),
    -- Tickets por día de la semana
    'tickets_por_dia_semana', (
      select coalesce(jsonb_agg(jsonb_build_object('dia', g.n,
               'tickets', (select count(*) from t where extract(isodow from t.local) = g.n),
               'resueltos', (select count(*) from t where extract(isodow from t.local) = g.n and t.estado = 'resuelto'))
             order by g.n), '[]')
        from generate_series(1, 7) g(n)
    ),
    -- Tiempo promedio para resolver por tipo de ticket
    'resolucion_por_tipo', (
      select coalesce(jsonb_agg(x order by (x->>'horas')::numeric desc), '[]') from (
        select jsonb_build_object('tipo', tipo,
                 'horas', round((avg(extract(epoch from (resuelto_en - creado_en)) / 3600))::numeric, 1),
                 'tickets', count(*)) x
          from t
         where tipo <> 'cambio_estado' and estado = 'resuelto' and resuelto_en > creado_en + interval '1 minute'
         group by tipo) s
    ),
    -- Cierres de turno: a tiempo o con retraso
    'cierres', jsonb_build_object(
      'total',      (select count(*) from rt),
      'a_tiempo',   (select count(*) from rt where minutos_retraso = 0),
      'con_retraso',(select count(*) from rt where minutos_retraso > 0),
      'sin_horario',(select count(*) from rt where minutos_retraso is null),
      'retraso_promedio', (select round(avg(minutos_retraso))::int from rt where minutos_retraso > 0),
      'retraso_maximo',   (select max(minutos_retraso) from rt),
      'pcs_baja',   (select coalesce(sum(jsonb_array_length(pcs_baja)), 0) from rt),
      'por_dia', (
        select coalesce(jsonb_agg(jsonb_build_object('dia', d::date,
                 'a_tiempo', (select count(*) from rt where rt.fecha = d::date and rt.minutos_retraso = 0),
                 'con_retraso', (select count(*) from rt where rt.fecha = d::date and rt.minutos_retraso > 0),
                 'sin_horario', (select count(*) from rt where rt.fecha = d::date and rt.minutos_retraso is null)) order by d), '[]')
          from generate_series(p_desde, p_hasta, interval '1 day') d),
      'por_turno', (
        select coalesce(jsonb_agg(jsonb_build_object('turno', h.turno,
                 'cierres', (select count(*) from rt where rt.turno = h.turno),
                 'a_tiempo', (select count(*) from rt where rt.turno = h.turno and rt.minutos_retraso = 0),
                 'sin_horario', (select count(*) from rt where rt.turno = h.turno and rt.minutos_retraso is null),
                 'con_retraso', (select count(*) from rt where rt.turno = h.turno and rt.minutos_retraso > 0),
                 'retraso_promedio', (select round(avg(minutos_retraso))::int from rt where rt.turno = h.turno and rt.minutos_retraso > 0))
               order by h.hora_inicio), '[]')
          from public.horarios_turno h),
      'por_auxiliar', (
        select coalesce(jsonb_agg(x order by (x->>'cierres')::int desc), '[]') from (
          select jsonb_build_object('nombre', coalesce(nombre_completo, '—'),
                   'cierres', count(*),
                   'a_tiempo', count(*) filter (where minutos_retraso = 0),
                   'con_retraso', count(*) filter (where minutos_retraso > 0),
                   'retraso_promedio', round(avg(minutos_retraso) filter (where minutos_retraso > 0))::int,
                   'retraso_maximo', max(minutos_retraso),
                   'pcs_baja', coalesce(sum(jsonb_array_length(pcs_baja)), 0)) x
            from rt group by auxiliar_id, nombre_completo) s)
    ),
    -- PCs dadas de baja en el período (siguen de baja) y reactivaciones
    'bajas', (
      select coalesce(jsonb_agg(jsonb_build_object('etiqueta', p.etiqueta, 'lab', am.codigo,
               'motivo', coalesce(p.motivo_baja, p.estado_detalle), 'por', pf.nombre_completo, 'en', p.estado_en)
             order by p.estado_en desc), '[]')
        from public.ambiente_pcs p
        left join public.ambientes am on am.id = p.ambiente_id
        left join public.perfiles pf on pf.id = p.estado_por
       where p.estado = 'baja' and (p.estado_en at time zone v_zona)::date between p_desde and p_hasta
    ),
    'reactivadas', (select count(*) from t where (tipo = 'cambio_estado' and descripcion like '%De baja →%')
                                         or (tipo = 'correctivo' and estado_anterior = 'baja' and estado_final <> 'baja')),
    -- Objetos perdidos
    'objetos', jsonb_build_object(
      'registrados', (select count(*) from public.objetos_perdidos where (encontrado_en at time zone v_zona)::date between p_desde and p_hasta),
      'entregados',  (select count(*) from public.objetos_perdidos where (entregado_en at time zone v_zona)::date between p_desde and p_hasta),
      'en_custodia', (select count(*) from public.objetos_perdidos where estado = 'en_custodia'),
      'por_lab', (
        select coalesce(jsonb_agg(jsonb_build_object('codigo', am.codigo, 'color', am.color, 'objetos', x.n) order by x.n desc), '[]')
          from (select ambiente_id, count(*) n from public.objetos_perdidos
                 where (encontrado_en at time zone v_zona)::date between p_desde and p_hasta group by ambiente_id) x
          join public.ambientes am on am.id = x.ambiente_id)
    )
  ) into r;
  return r;
end $$;

revoke execute on function public.fn_dashboard_detalle(date, date) from anon, public;
grant execute on function public.fn_dashboard_detalle(date, date) to authenticated;
