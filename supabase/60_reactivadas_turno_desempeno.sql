-- =====================================================================
--  SISTEMA DE ASIGNACIÓN DE LABORATORIOS — UPDS
--  Script 60: PCs REACTIVADAS EN EL CIERRE DE TURNO Y EN DESEMPEÑO
--  - El cierre de turno guarda, además de las PCs dadas de baja, las PCs
--    que su autor sacó de baja (volvieron a Activa u otro estado) durante
--    ese turno (pcs_reactivadas). Incluye las devueltas al croquis.
--  - fn_dashboard_pcs_movimientos: para Desempeño, lista de PCs
--    reactivadas y cuántas bajas / reactivaciones hizo cada persona.
--  Una baja o reactivación es un ticket:
--    · "Cambio de estado de PC" con descripción "X: … → De baja" o "X: De baja → …"
--    · o un correctivo cuya ficha pasó la PC a baja o la sacó de baja.
--  Ejecutar en: Supabase > SQL Editor (después de 59).
-- =====================================================================

-- 1) Cierre de turno: PCs reactivadas por su autor durante el turno
alter table public.reportes_turno add column if not exists pcs_reactivadas jsonb not null default '[]'::jsonb;

create or replace function public.fn_trg_reporte_pcs_baja()
returns trigger language plpgsql set search_path = public as $$
declare
  v_desde timestamptz;
  v_hasta timestamptz;
  v_autor uuid;
begin
  -- Al editar el cierre, las listas no cambian
  if tg_op = 'UPDATE' then
    new.pcs_baja        := old.pcs_baja;
    new.pcs_reactivadas := old.pcs_reactivadas;
    return new;
  end if;
  -- Desde el inicio del turno (lo pone trg_reportes_turno_horario, que corre antes)
  v_desde := (new.fecha + coalesce(new.hora_inicio_turno, time '00:00')) at time zone 'America/La_Paz';
  v_hasta := coalesce(new.creado_en, now());
  v_autor := coalesce(new.auxiliar_id, auth.uid());

  -- PCs que su autor dio de baja en el turno (y siguen de baja)
  select coalesce(jsonb_agg(jsonb_build_object(
           'etiqueta', p.etiqueta, 'lab', am.codigo,
           'motivo', coalesce(p.motivo_baja, p.estado_detalle), 'en', p.estado_en) order by p.estado_en), '[]'::jsonb)
    into new.pcs_baja
    from public.ambiente_pcs p
    left join public.ambientes am on am.id = p.ambiente_id
   where p.estado = 'baja'
     and p.estado_por = v_autor
     and p.estado_en >= v_desde
     and p.estado_en <= v_hasta;

  -- PCs que su autor sacó de baja en el turno
  select coalesce(jsonb_agg(jsonb_build_object(
           'etiqueta', p.etiqueta, 'lab', am.codigo,
           'motivo', coalesce(a.solucion, a.descripcion), 'en', a.resuelto_en) order by a.resuelto_en), '[]'::jsonb)
    into new.pcs_reactivadas
    from public.atenciones a
    join public.ambiente_pcs p on p.id = a.pc_id
    left join public.ambientes am on am.id = p.ambiente_id
   where coalesce(a.resuelto_por, a.auxiliar_id) = v_autor
     and a.resuelto_en >= v_desde
     and a.resuelto_en <= v_hasta
     and ((a.tipo = 'cambio_estado' and a.descripcion like '%: De baja → %')
          or (a.tipo = 'correctivo' and a.estado_anterior = 'baja' and a.estado_final is distinct from 'baja'));
  return new;
end $$;

revoke execute on function public.fn_trg_reporte_pcs_baja() from anon, authenticated, public;

-- 2) Desempeño: reactivaciones y bajas por persona en el período
create or replace function public.fn_dashboard_pcs_movimientos(p_desde date, p_hasta date)
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

  with m as (   -- cada baja o reactivación del período
    select a.resuelto_en as en, coalesce(a.resuelto_por, a.auxiliar_id) as por_id,
           a.pc_id, coalesce(a.solucion, a.descripcion) as detalle,
           case when (a.tipo = 'cambio_estado' and a.descripcion like '%: De baja → %')
                  or (a.tipo = 'correctivo' and a.estado_anterior = 'baja' and a.estado_final is distinct from 'baja')
                then 'reactivada' else 'baja' end as clase
      from public.atenciones a
     where a.resuelto_en is not null
       and (a.resuelto_en at time zone v_zona)::date between p_desde and p_hasta
       and ((a.tipo = 'cambio_estado' and (a.descripcion like '%: De baja → %' or a.descripcion like '% → De baja'))
            or (a.tipo = 'correctivo' and a.estado_anterior = 'baja' and a.estado_final is distinct from 'baja')
            or (a.tipo = 'correctivo' and a.estado_final = 'baja' and a.estado_anterior is distinct from 'baja'))
  )
  select jsonb_build_object(
    'reactivadas', (
      select coalesce(jsonb_agg(jsonb_build_object('etiqueta', p.etiqueta, 'lab', am.codigo, 'detalle', m.detalle,
               'por', pf.nombre_completo, 'en', m.en) order by m.en desc), '[]')
        from m
        left join public.ambiente_pcs p on p.id = m.pc_id
        left join public.ambientes am on am.id = p.ambiente_id
        left join public.perfiles pf on pf.id = m.por_id
       where m.clase = 'reactivada'
    ),
    'por_persona', (
      select coalesce(jsonb_agg(x order by (x->>'bajas')::int + (x->>'reactivadas')::int desc), '[]') from (
        select jsonb_build_object('nombre', coalesce(pf.nombre_completo, '—'),
                 'bajas', count(*) filter (where m.clase = 'baja'),
                 'reactivadas', count(*) filter (where m.clase = 'reactivada')) x
          from m left join public.perfiles pf on pf.id = m.por_id
         group by m.por_id, pf.nombre_completo) s
    )
  ) into r;
  return r;
end $$;

revoke execute on function public.fn_dashboard_pcs_movimientos(date, date) from anon, public;
grant execute on function public.fn_dashboard_pcs_movimientos(date, date) to authenticated;
