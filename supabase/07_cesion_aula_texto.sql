-- =====================================================================
--  SISTEMA DE ASIGNACIÓN DE LABORATORIOS — UPDS
--  Script 07: el sistema maneja SOLO LABORATORIOS.
--  En la cesión, el aula a la que va el docente que cede es un dato
--  de texto (ej. "C-29"): no se controla su ocupación.
--  (Para instalaciones nuevas ya está incluido en 01, 02 y 05; este
--   script actualiza una base que ya tenía la versión anterior.)
-- =====================================================================

-- 1) Nuevo dato en la cesión: aula a la que se va el docente que cede
alter table public.cesiones add column if not exists aula_destino text;

-- 2) Pasa las reubicaciones creadas por cesiones al nuevo dato de texto
update public.cesiones c
   set aula_destino = sub.codigo
  from (select distinct on (r.cesion_id) r.cesion_id, am.codigo
          from public.reubicaciones r
          join public.ambientes am on am.id = r.ambiente_destino_id
         where r.cesion_id is not null
         order by r.cesion_id, r.fecha) sub
 where sub.cesion_id = c.id and c.aula_destino is null;

delete from public.reubicaciones where cesion_id is not null;

-- 3) Clases asignadas en aulas (ya no se manejan) y las aulas mismas
delete from public.asignaciones a
 where exists (select 1 from public.asignacion_horarios h
               join public.ambientes am on am.id = h.ambiente_id
               where h.asignacion_id = a.id and am.tipo <> 'laboratorio');

update public.reubicaciones r set ambiente_destino_id = null
 where ambiente_destino_id in (select id from public.ambientes where tipo <> 'laboratorio');

delete from public.ambientes am
 where am.tipo <> 'laboratorio'
   and not exists (select 1 from public.reserva_horarios rh where rh.ambiente_id = am.id);

-- 4) La cesión guarda el aula como texto (ya no crea reubicaciones)
create or replace function public.rpc_guardar_cesion(p jsonb)
returns bigint language plpgsql set search_path = public as $$
declare
  v_id      bigint := nullif(p->>'id', '')::bigint;
  v_horario bigint := (p->>'asignacion_horario_id')::bigint;
  v_fecha   date;
begin
  if jsonb_array_length(coalesce(p->'fechas', '[]')) = 0 then
    raise exception 'Seleccione al menos un día para la cesión.';
  end if;
  if nullif(p->>'docente_receptor_id', '') is null then
    raise exception 'Indique qué docente viene al laboratorio.';
  end if;

  if v_id is null then
    insert into public.cesiones (asignacion_horario_id, docente_receptor_id, carrera_receptor_id, materia_receptor, motivo, aula_destino)
    values (v_horario, (p->>'docente_receptor_id')::bigint, nullif(p->>'carrera_receptor_id', '')::bigint,
            nullif(trim(p->>'materia_receptor'), ''), coalesce(nullif(trim(p->>'motivo'), ''), 'Cesión de laboratorio'),
            nullif(trim(p->>'aula_destino'), ''))
    returning id into v_id;
  else
    update public.cesiones set
      asignacion_horario_id = v_horario,
      docente_receptor_id   = (p->>'docente_receptor_id')::bigint,
      carrera_receptor_id   = nullif(p->>'carrera_receptor_id', '')::bigint,
      materia_receptor      = nullif(trim(p->>'materia_receptor'), ''),
      motivo                = coalesce(nullif(trim(p->>'motivo'), ''), 'Cesión de laboratorio'),
      aula_destino          = nullif(trim(p->>'aula_destino'), '')
    where id = v_id;
    delete from public.cesion_fechas where cesion_id = v_id;
  end if;

  for v_fecha in select distinct (x #>> '{}')::date from jsonb_array_elements(p->'fechas') x loop
    insert into public.cesion_fechas (cesion_id, fecha) values (v_id, v_fecha);
  end loop;

  return v_id;
end $$;

-- 5) En las ocupaciones, la cesión muestra a qué aula se fue el que cede
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
         coalesce(nullif(c.materia_receptor, ''), 'Cesión de ' || m.nombre),
         trim(dr.apellidos || ' ' || dr.nombres) || ' · cedido por ' || trim(d.apellidos || ' ' || d.nombres)
           || coalesce(' (se va a ' || nullif(c.aula_destino, '') || ')', ''),
         coalesce(cr.color, '#9333ea'),
         10,
         'cedida'
  from clases c
  join public.materias m  on m.id  = c.materia_id
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
