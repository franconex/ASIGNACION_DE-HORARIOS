-- =====================================================================
--  SISTEMA DE ASIGNACIÓN DE LABORATORIOS — UPDS
--  Script 18: DASHBOARD DE USO DE LABORATORIOS (solo ADMIN)
--  fn_dashboard_uso devuelve en JSON, para un período:
--  - materias que más ocupan los laboratorios (clases y cesiones),
--  - eventos / defensas que más los ocupan,
--  - horas de uso por laboratorio (clases, cedidas, eventos),
--  - actividades más comunes de los auxiliares en cada laboratorio,
--  - pedidos (tickets) más frecuentes, con las peticiones.
--  Ejecutar en: Supabase > SQL Editor (después de 17).
-- =====================================================================
create or replace function public.fn_dashboard_uso(p_desde date, p_hasta date)
returns jsonb
language plpgsql stable security invoker set search_path = public as $$
declare
  v_zona constant text := 'America/La_Paz';
  r jsonb;
begin
  if public.fn_rol_actual() is distinct from 'admin' then
    raise exception 'Solo el administrador puede ver el uso de laboratorios.';
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
