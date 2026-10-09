-- =====================================================================
--  SISTEMA DE ASIGNACIÓN DE LABORATORIOS — UPDS
--  Script 15: DASHBOARD DE DESEMPEÑO (admin y encargado)
--  Una sola función devuelve todo lo que muestra el tablero en JSON:
--  indicadores del período, tickets por día, por tipo, por laboratorio,
--  desempeño de cada auxiliar, estado de las PCs y las PCs con más tickets.
--  Ejecutar en: Supabase > SQL Editor (después de 14).
-- =====================================================================
create or replace function public.fn_dashboard_operacion(p_desde date, p_hasta date)
returns jsonb
language plpgsql stable security invoker set search_path = public as $$
declare
  v_zona   constant text := 'America/La_Paz';
  v_dias   int := (p_hasta - p_desde) + 1;
  v_ant_desde date := p_desde - ((p_hasta - p_desde) + 1);
  v_ant_hasta date := p_desde - 1;
  r jsonb;
begin
  if not public.fn_puede_gestionar_auxiliares() then
    raise exception 'Solo el administrador o el encargado pueden ver el dashboard.';
  end if;
  if p_desde is null or p_hasta is null or p_hasta < p_desde or v_dias > 400 then
    raise exception 'Rango de fechas inválido.';
  end if;

  with t as (   -- tickets del período, con su día local
    select a.*, (a.creado_en at time zone v_zona)::date as dia
      from public.atenciones a
     where (a.creado_en at time zone v_zona)::date between p_desde and p_hasta
  ),
  personal as (
    select id, nombre_completo, rol, turno_habitual
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
      select coalesce(jsonb_agg(x order by (x->>'participaciones')::int desc, x->>'nombre'), '[]')
        from (
          select jsonb_build_object(
            'id', p.id, 'nombre', p.nombre_completo, 'rol', p.rol, 'turno', p.turno_habitual,
            -- tickets que registró
            'registrados', (select count(*) from t where t.auxiliar_id = p.id),
            -- trabajos (un lote de 20 PCs = 1 trabajo) que registró
            'trabajos', (select count(distinct coalesce(lote::text, id::text)) from t where t.auxiliar_id = p.id),
            -- tickets donde ayudó sin haberlos registrado
            'colaboraciones', (select count(*) from t where p.id = any(t.colaboradores) and t.auxiliar_id is distinct from p.id),
            'participaciones', (select count(*) from t where t.auxiliar_id = p.id or p.id = any(t.colaboradores)),
            -- resueltos en los que participó (registró o colaboró): al colaborador también le cuentan
            'resueltos', (select count(*) from t where t.estado = 'resuelto' and (t.auxiliar_id = p.id or p.id = any(t.colaboradores))),
            'pcs_atendidas', (select count(distinct pc_id) from t where pc_id is not null and (t.auxiliar_id = p.id or p.id = any(t.colaboradores))),
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
        from (select pc_id, count(*) n, max(creado_en) ultimo from t where pc_id is not null group by pc_id order by count(*) desc limit 10) x
        join public.ambiente_pcs pc on pc.id = x.pc_id
        left join public.ambientes am on am.id = pc.ambiente_id
    )
  ) into r;
  return r;
end $$;

revoke execute on function public.fn_dashboard_operacion(date, date) from anon, public;
grant execute on function public.fn_dashboard_operacion(date, date) to authenticated;
