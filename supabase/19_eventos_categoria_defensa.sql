-- =====================================================================
--  SISTEMA DE ASIGNACIÓN DE LABORATORIOS — UPDS
--  Script 19: EVENTOS POR CATEGORÍA Y DEFENSAS SIMPLIFICADAS
--  - Evento: nombre, responsable, descripción y CATEGORÍA
--    (taller, conferencia, capacitación u otros).
--  - Defensa: solo facultad (carrera) y descripción; el nombre se arma
--    solo: "Defensa de grado - <facultad>".
--  - En las ocupaciones, el evento muestra su categoría.
--  Ejecutar en: Supabase > SQL Editor (después de 18).
-- =====================================================================

-- 1) Categoría del evento
alter table public.reservas add column if not exists categoria text;
alter table public.reservas drop constraint if exists reservas_categoria_check;
alter table public.reservas add constraint reservas_categoria_check
  check (categoria is null or categoria in ('taller', 'conferencia', 'capacitacion', 'otros'));

-- 2) Guardar reserva con categoría; la defensa arma su nombre con la facultad
create or replace function public.rpc_guardar_reserva(p jsonb)
returns bigint language plpgsql set search_path = public as $$
declare
  v_id     bigint := nullif(p->>'id', '')::bigint;
  v_tipo   text   := (select codigo from public.tipos_reserva where id = (p->>'tipo_id')::bigint);
  v_titulo text   := nullif(trim(p->>'titulo'), '');
  v_cat    text   := nullif(p->>'categoria', '');
  h jsonb;
begin
  if v_tipo = 'DEFENSA' then
    if nullif(p->>'carrera_id', '') is null then
      raise exception 'Indique la facultad de la defensa.';
    end if;
    v_titulo := coalesce(v_titulo, 'Defensa de grado - ' ||
                (select nombre from public.carreras where id = (p->>'carrera_id')::bigint));
    v_cat := null;
  elsif v_tipo = 'EVENTO' and v_cat is null then
    raise exception 'Elija la categoría del evento (taller, conferencia, capacitación u otros).';
  elsif v_tipo <> 'EVENTO' then
    v_cat := null;
  end if;
  if v_titulo is null then
    raise exception 'Indique el nombre del evento.';
  end if;
  if jsonb_array_length(coalesce(p->'horarios', '[]')) = 0 then
    raise exception 'Seleccione al menos una fecha y un ambiente.';
  end if;

  if v_id is null then
    insert into public.reservas (tipo_id, titulo, descripcion, responsable, carrera_id, categoria)
    values ((p->>'tipo_id')::bigint, v_titulo, nullif(p->>'descripcion', ''), nullif(p->>'responsable', ''),
            nullif(p->>'carrera_id', '')::bigint, v_cat)
    returning id into v_id;
  else
    update public.reservas set
      tipo_id     = (p->>'tipo_id')::bigint,
      titulo      = v_titulo,
      descripcion = nullif(p->>'descripcion', ''),
      responsable = nullif(p->>'responsable', ''),
      carrera_id  = nullif(p->>'carrera_id', '')::bigint,
      categoria   = v_cat
    where id = v_id;
    delete from public.reserva_horarios where reserva_id = v_id;
    delete from public.reubicaciones    where reserva_id = v_id;
  end if;

  for h in select * from jsonb_array_elements(p->'horarios') loop
    insert into public.reserva_horarios (reserva_id, ambiente_id, fecha, hora_inicio, hora_fin)
    values (v_id, (h->>'ambiente_id')::bigint, (h->>'fecha')::date, (h->>'hora_inicio')::time, (h->>'hora_fin')::time);
  end loop;

  for h in select * from jsonb_array_elements(coalesce(p->'reubicaciones', '[]')) loop
    begin
      insert into public.reubicaciones (asignacion_horario_id, fecha, ambiente_destino_id, aula_destino, hora_inicio, hora_fin, motivo, reserva_id)
      values ((h->>'asignacion_horario_id')::bigint, (h->>'fecha')::date, nullif(h->>'ambiente_destino_id', '')::bigint,
              nullif(trim(h->>'aula_destino'), ''), nullif(h->>'hora_inicio', '')::time, nullif(h->>'hora_fin', '')::time,
              'Reubicada por: ' || v_titulo, v_id);
    exception when unique_violation then
      raise exception 'Una clase afectada del % ya tiene otra reubicación. Revísela antes de crear la reserva.',
        public.fn_texto_fecha((h->>'fecha')::date);
    end;
  end loop;

  return v_id;
end $$;

-- 3) Ocupaciones: el evento muestra su categoría (Taller · responsable)
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
         case r.categoria when 'taller' then 'Taller' when 'conferencia' then 'Conferencia'
                          when 'capacitacion' then 'Capacitación' when 'otros' then 'Evento'
                          else t.nombre end
           || coalesce(' · ' || nullif(r.responsable, ''), ''),
         t.color,
         t.prioridad,
         lower(t.codigo)
  from public.reserva_horarios rh
  join public.reservas r      on r.id = rh.reserva_id
  join public.tipos_reserva t on t.id = r.tipo_id
  where rh.fecha between p_desde and p_hasta
    and r.id is distinct from p_ignorar_reserva_id;
$$;
