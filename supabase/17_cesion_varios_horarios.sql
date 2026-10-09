-- =====================================================================
--  SISTEMA DE ASIGNACIÓN DE LABORATORIOS — UPDS
--  Script 17: CEDER VARIOS HORARIOS A LA VEZ
--  - Una cesión puede abarcar varios horarios de la misma clase
--    (ej. todos los jueves Y todos los viernes). Se guarda una fila de
--    'cesiones' por horario y todas comparten el mismo LOTE, para
--    editarlas juntas.
--  - rpc_guardar_cesiones: crea / edita el lote completo en una sola
--    operación (quita los horarios que ya no se ceden).
--  - En las ocupaciones, el bloque cedido se titula con la materia de
--    quien VIENE (o su facultad), ya no con la materia de quien cede.
--  Ejecutar en: Supabase > SQL Editor (después de 16).
-- =====================================================================

-- 1) Lote: agrupa las cesiones creadas juntas (las existentes quedan solas)
alter table public.cesiones add column if not exists lote uuid not null default gen_random_uuid();
create index if not exists cesiones_lote_idx on public.cesiones (lote);

-- 2) Guarda un lote de cesiones (varios horarios, cada uno con sus días)
--    p = { lote, docente_receptor_id, carrera_receptor_id, materia_receptor, motivo, aula_destino,
--          horarios: [ { asignacion_horario_id, fechas: [...] }, ... ] }
create or replace function public.rpc_guardar_cesiones(p jsonb)
returns uuid language plpgsql set search_path = public as $$
declare
  v_lote  uuid := coalesce(nullif(p->>'lote', '')::uuid, gen_random_uuid());
  v_item  jsonb;
  v_hid   bigint;
  v_id    bigint;
  v_hids  bigint[] := '{}';
begin
  for v_item in select x from jsonb_array_elements(coalesce(p->'horarios', '[]')) x loop
    if jsonb_array_length(coalesce(v_item->'fechas', '[]')) > 0 then
      v_hids := v_hids || (v_item->>'asignacion_horario_id')::bigint;
    end if;
  end loop;
  if cardinality(v_hids) = 0 then
    raise exception 'Seleccione al menos un día para la cesión.';
  end if;

  -- Horarios que estaban en el lote y ya no se ceden
  delete from public.cesiones where lote = v_lote and asignacion_horario_id <> all (v_hids);

  for v_item in select x from jsonb_array_elements(p->'horarios') x loop
    if jsonb_array_length(coalesce(v_item->'fechas', '[]')) = 0 then continue; end if;
    v_hid := (v_item->>'asignacion_horario_id')::bigint;
    select id into v_id from public.cesiones where lote = v_lote and asignacion_horario_id = v_hid order by id limit 1;
    v_id := public.rpc_guardar_cesion(
      (p - 'horarios' - 'lote') || jsonb_build_object('id', v_id, 'asignacion_horario_id', v_hid, 'fechas', v_item->'fechas'));
    update public.cesiones set lote = v_lote where id = v_id and lote <> v_lote;
  end loop;

  return v_lote;
end $$;

revoke execute on function public.rpc_guardar_cesiones(jsonb) from anon, public;
grant execute on function public.rpc_guardar_cesiones(jsonb) to authenticated;

-- 3) Ocupaciones: el bloque cedido muestra la materia de quien viene
create or replace function public.fn_ocupaciones(
  p_desde date,
  p_hasta date,
  p_ignorar_reserva_id bigint default null,
  p_ignorar_cesion_id  bigint default null
)
returns table (
  clave                 text,
  origen                text,
  fecha                 date,
  hora_inicio           time,
  hora_fin              time,
  ambiente_id           bigint,
  docente_id            bigint,
  asignacion_id         bigint,
  asignacion_horario_id bigint,
  cesion_id             bigint,
  reserva_id            bigint,
  reserva_horario_id    bigint,
  reubicacion_id        bigint,
  carrera_id            bigint,
  titulo                text,
  detalle               text,
  color                 text,
  prioridad             integer,
  estado                text
)
language sql stable set search_path = public as $$
  with dias as (
    select g::date as fecha, extract(isodow from g)::smallint as dow
    from generate_series(p_desde, p_hasta, interval '1 day') g
    where not exists (select 1 from public.feriados f where f.fecha = g::date)
  ),
  base as (
    select h.id as hid, h.asignacion_id, h.hora_inicio, h.hora_fin, h.ambiente_id,
           a.docente_id, a.materia_id, a.carrera_id, a.grupo, d.fecha
    from public.asignacion_horarios h
    join public.asignaciones a        on a.id = h.asignacion_id
    join public.sistemas_academicos s on s.id = a.sistema_id
    join dias d                       on d.dow = h.dia_semana
                                     and d.fecha between a.fecha_inicio and a.fecha_fin
    where a.fecha_inicio <= p_hasta and a.fecha_fin >= p_desde
      and (s.modo_fechas = 'rango'
           or exists (select 1 from public.asignacion_fechas af
                      where af.asignacion_id = a.id and af.fecha = d.fecha))
  ),
  clases as (
    select b.*,
           r.id as rid, r.ambiente_destino_id, r.hora_inicio as rhi, r.hora_fin as rhf,
           cs.id as cid, cs.docente_receptor_id, cs.materia_receptor, cs.carrera_receptor_id, cs.aula_destino
    from base b
    left join public.reubicaciones r
           on r.asignacion_horario_id = b.hid and r.fecha = b.fecha
          and (p_ignorar_reserva_id is null or r.reserva_id is distinct from p_ignorar_reserva_id)
          and (p_ignorar_cesion_id  is null or r.cesion_id  is distinct from p_ignorar_cesion_id)
    left join lateral (
      select c.*
      from public.cesiones c
      join public.cesion_fechas cf on cf.cesion_id = c.id
      where c.asignacion_horario_id = b.hid
        and cf.fecha = b.fecha
        and c.id is distinct from p_ignorar_cesion_id
      order by c.id
      limit 1
    ) cs on true
  )
  select 'C-' || c.hid || '-' || c.fecha,
         'clase',
         c.fecha,
         coalesce(c.rhi, c.hora_inicio),
         coalesce(c.rhf, c.hora_fin),
         case when c.rid is not null then c.ambiente_destino_id else c.ambiente_id end,
         c.docente_id, c.asignacion_id, c.hid, c.cid, null::bigint, null::bigint, c.rid, c.carrera_id,
         m.nombre,
         trim(d.apellidos || ' ' || d.nombres) || ' · ' || ca.nombre || coalesce(' · Gr. ' || c.grupo, ''),
         ca.color,
         10,
         case when c.rid is not null then 'reubicada' else 'normal' end
  from clases c
  join public.materias m  on m.id  = c.materia_id
  join public.docentes d  on d.id  = c.docente_id
  join public.carreras ca on ca.id = c.carrera_id
  where (c.rid is null and c.cid is null)
     or (c.rid is not null and c.ambiente_destino_id is not null and c.cid is null)

  union all

  select 'S-' || c.cid || '-' || c.fecha,
         'cesion',
         c.fecha, c.hora_inicio, c.hora_fin, c.ambiente_id,
         c.docente_receptor_id, c.asignacion_id, c.hid, c.cid, null, null, null,
         coalesce(c.carrera_receptor_id, c.carrera_id),
         coalesce(nullif(c.materia_receptor, ''), cr.nombre, 'Laboratorio cedido'),
         trim(dr.apellidos || ' ' || dr.nombres) || ' · cedido por ' || trim(d.apellidos || ' ' || d.nombres)
           || coalesce(' (se va a ' || nullif(c.aula_destino, '') || ')', ''),
         coalesce(cr.color, '#9333ea'),
         10,
         'cedida'
  from clases c
  join public.docentes d  on d.id  = c.docente_id
  join public.docentes dr on dr.id = c.docente_receptor_id
  left join public.carreras cr on cr.id = c.carrera_receptor_id
  where c.cid is not null

  union all

  select 'R-' || rh.id,
         'reserva',
         rh.fecha, rh.hora_inicio, rh.hora_fin, rh.ambiente_id,
         null, null, null, null, r.id, rh.id, null, r.carrera_id,
         r.titulo,
         t.nombre || coalesce(' · ' || nullif(r.responsable, ''), ''),
         t.color,
         t.prioridad,
         lower(t.codigo)
  from public.reserva_horarios rh
  join public.reservas r      on r.id = rh.reserva_id
  join public.tipos_reserva t on t.id = r.tipo_id
  where rh.fecha between p_desde and p_hasta
    and r.id is distinct from p_ignorar_reserva_id;
$$;
