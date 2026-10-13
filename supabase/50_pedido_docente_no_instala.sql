-- =====================================================================
--  SISTEMA DE ASIGNACIÓN DE LABORATORIOS — UPDS
--  Script 50: EL PEDIDO DEL DOCENTE NO ES UNA INSTALACIÓN
--  - Un docente pide un programa (Atención a docente → Instalar un
--    programa) y muchas veces lo instala otro turno después (queda como
--    tarea en el cierre de turno). Por eso:
--      · el pedido ya NO cambia el software del laboratorio (el trigger
--        solo atiende tickets de Programas),
--      · en el dashboard, "pedidos" son solo los tickets de docente e
--        "instalaciones" solo los tickets de Programas.
--  Ejecutar en: Supabase > SQL Editor (después de 49).
-- =====================================================================

-- 1) Solo los tickets de Programas cambian el software del laboratorio
create or replace function public.fn_trg_ticket_software()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_accion text := new.detalles->>'accion';
begin
  if new.tipo <> 'programas' or new.ambiente_id is null
     or jsonb_typeof(new.detalles->'software_ids') is distinct from 'array' then
    return new;
  end if;

  if v_accion in ('instalar', 'actualizar') then
    insert into public.laboratorio_software (ambiente_id, software_id, actualizado_en, actualizado_por, atencion_id)
    select new.ambiente_id, s.id, now(), new.auxiliar_id, new.id
      from public.software s
     where s.id in (select (x)::bigint from jsonb_array_elements_text(new.detalles->'software_ids') x)
    on conflict (ambiente_id, software_id) do update
      set actualizado_en = now(), actualizado_por = excluded.actualizado_por, atencion_id = excluded.atencion_id;
  elsif v_accion = 'desinstalar' then
    delete from public.laboratorio_software
     where ambiente_id = new.ambiente_id
       and software_id in (select (x)::bigint from jsonb_array_elements_text(new.detalles->'software_ids') x);
  end if;
  return new;
end $$;

-- 2) Dashboard: pedidos (docentes) e instalaciones (Programas) por separado
create or replace function public.fn_dashboard_software(p_desde date, p_hasta date)
returns jsonb language plpgsql stable set search_path = public as $$
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

  with t as (
    -- Un trabajo por lote (varias PCs del mismo trabajo cuentan una vez)
    select distinct on (coalesce(a.lote::text, a.id::text)) a.*
      from public.atenciones a
     where (a.creado_en at time zone v_zona)::date between p_desde and p_hasta
     order by coalesce(a.lote::text, a.id::text), a.id
  ),
  sw as (
    -- Una fila por ticket y software elegido
    select t.id, t.ambiente_id, t.docente_id, t.solicitante,
           (x)::bigint as software_id,
           case when t.tipo = 'docente' then 'pedido' else coalesce(t.detalles->>'accion', 'instalar') end as accion,
           (t.tipo = 'docente') as pedido
      from t, jsonb_array_elements_text(t.detalles->'software_ids') x
     where jsonb_typeof(t.detalles->'software_ids') = 'array'
       and (t.tipo = 'programas' or (t.tipo = 'docente' and t.detalles->>'pedido' = 'instalar_programa'))
  ),
  -- Mantenimiento: preventivo por trabajo y por PC; correctivo por PC (cada ficha es una PC)
  mant as (
    select
      (select count(distinct coalesce(lote::text, id::text)) from public.atenciones
        where tipo = 'preventivo' and (creado_en at time zone v_zona)::date between p_desde and p_hasta) as preventivos,
      (select count(*) from public.atenciones
        where tipo = 'preventivo' and pc_id is not null and (creado_en at time zone v_zona)::date between p_desde and p_hasta) as pcs_preventivo,
      (select count(*) from public.atenciones
        where tipo = 'correctivo' and (creado_en at time zone v_zona)::date between p_desde and p_hasta) as correctivos,
      (select count(*) from public.atenciones
        where tipo = 'correctivo' and detalles->>'resultado' = 'reparada' and (creado_en at time zone v_zona)::date between p_desde and p_hasta) as reparadas
  )
  select jsonb_build_object(
    'kpis', jsonb_build_object(
      'pedidos',         (select count(*) from sw where pedido),
      'instalaciones',   (select count(*) from sw where accion = 'instalar'),
      'actualizaciones', (select count(*) from sw where accion = 'actualizar'),
      'desinstalaciones',(select count(*) from sw where accion = 'desinstalar'),
      'programas_distintos', (select count(distinct software_id) from sw),
      'preventivos',     (select preventivos from mant),
      'pcs_preventivo',  (select pcs_preventivo from mant),
      'correctivos',     (select correctivos from mant),
      'reparadas',       (select reparadas from mant)
    ),
    'por_software', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', s.id, 'nombre', s.nombre, 'tipo', s.tipo, 'licencia', s.licencia,
               'pedidos', x.pedidos, 'instalar', x.instalar, 'actualizar', x.actualizar, 'desinstalar', x.desinstalar,
               'labs', x.labs)
             order by x.pedidos + x.instalar + x.actualizar desc, s.nombre), '[]')
        from (select software_id,
                     count(*) filter (where pedido) as pedidos,
                     count(*) filter (where accion = 'instalar') as instalar,
                     count(*) filter (where accion = 'actualizar') as actualizar,
                     count(*) filter (where accion = 'desinstalar') as desinstalar,
                     (select coalesce(jsonb_agg(distinct am.codigo), '[]') from sw s2 join public.ambientes am on am.id = s2.ambiente_id
                       where s2.software_id = sw.software_id) as labs
                from sw group by software_id) x
        join public.software s on s.id = x.software_id
    ),
    'por_lab', (
      select coalesce(jsonb_agg(jsonb_build_object('codigo', am.codigo, 'color', am.color,
               'instalar', x.instalar, 'actualizar', x.actualizar, 'desinstalar', x.desinstalar, 'pedidos', x.pedidos)
             order by x.instalar + x.actualizar + x.desinstalar + x.pedidos desc, am.orden), '[]')
        from (select ambiente_id,
                     count(*) filter (where accion = 'instalar') as instalar,
                     count(*) filter (where accion = 'actualizar') as actualizar,
                     count(*) filter (where accion = 'desinstalar') as desinstalar,
                     count(*) filter (where pedido) as pedidos
                from sw group by ambiente_id) x
        join public.ambientes am on am.id = x.ambiente_id
    ),
    'docentes', (
      select coalesce(jsonb_agg(jsonb_build_object('nombre', nombre, 'pedidos', n) order by n desc, nombre), '[]')
        from (select coalesce(d.apellidos || ' ' || d.nombres, btrim(sw.solicitante)) as nombre, count(distinct sw.id) as n
                from sw left join public.docentes d on d.id = sw.docente_id
               where sw.pedido and coalesce(d.id::text, nullif(btrim(sw.solicitante), '')) is not null
               group by 1 order by 2 desc limit 10) x
    )
  ) into r;
  return r;
end $$;

revoke execute on function public.fn_dashboard_software(date, date) from anon, public;
grant execute on function public.fn_dashboard_software(date, date) to authenticated;
