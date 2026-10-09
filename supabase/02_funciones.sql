-- =====================================================================
--  SISTEMA DE ASIGNACIÓN DE LABORATORIOS — UPDS
--  Script 02: FUNCIONES (ocupación, choques, validaciones y RPC)
-- =====================================================================
--  Idea central: fn_ocupaciones(desde, hasta) "expande" los horarios
--  semanales a fechas reales y aplica cesiones, reubicaciones, feriados
--  y reservas. Todo lo demás (calendario, tarjetas, choques) sale de ahí.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Utilidades de texto para mensajes en español
-- ---------------------------------------------------------------------
create or replace function public.fn_texto_fecha(p_fecha date)
returns text language sql immutable as $$
  -- Ej: "martes 13/10/2026"
  select (array['lunes','martes','miércoles','jueves','viernes','sábado','domingo'])[extract(isodow from p_fecha)::int]
         || ' ' || to_char(p_fecha, 'DD/MM/YYYY');
$$;

create or replace function public.fn_texto_hora(p_hora time)
returns text language sql immutable as $$
  select to_char(p_hora, 'HH24:MI');
$$;

-- Nombre completo de un docente ("Apellidos Nombres")
create or replace function public.fn_nombre_docente(p_docente_id bigint)
returns text language sql stable as $$
  select trim(d.apellidos || ' ' || d.nombres) from public.docentes d where d.id = p_docente_id;
$$;

-- ---------------------------------------------------------------------
-- fn_ocupaciones: todo lo que ocupa un ambiente / docente entre 2 fechas
--   origen = 'clase'   -> clase normal o reubicada
--            'cesion'  -> ambiente cedido a otro docente
--            'reserva' -> evento, defensa, mantenimiento…
--   p_ignorar_reserva_id / p_ignorar_cesion_id: simula que esa reserva o
--   cesión NO existe (sirve para validar mientras se edita).
-- ---------------------------------------------------------------------
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
language sql stable as $$
  with dias as (
    -- Días del rango, sin feriados
    select g::date as fecha, extract(isodow from g)::smallint as dow
    from generate_series(p_desde, p_hasta, interval '1 day') g
    where not exists (select 1 from public.feriados f where f.fecha = g::date)
  ),
  base as (
    -- Cada horario semanal convertido en fechas concretas:
    --   modular  -> solo los días marcados en asignacion_fechas
    --   semestral -> todos los días del rango inicio-fin
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
    -- Se agregan las excepciones del día: reubicación y/o cesión
    select b.*,
           r.id as rid, r.ambiente_destino_id, r.hora_inicio as rhi, r.hora_fin as rhf,
           cs.id as cid, cs.docente_receptor_id, cs.materia_receptor, cs.carrera_receptor_id
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
  -- 1) Clases (normales o reubicadas). Si se cedió y no se reubicó, no hay clase.
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
     or (c.rid is not null and c.ambiente_destino_id is not null)

  union all

  -- 2) Cesiones: el ambiente original queda ocupado por el docente que recibe
  select 'S-' || c.cid || '-' || c.fecha,
         'cesion',
         c.fecha, c.hora_inicio, c.hora_fin, c.ambiente_id,
         c.docente_receptor_id, c.asignacion_id, c.hid, c.cid, null, null, null,
         coalesce(c.carrera_receptor_id, c.carrera_id),
         coalesce(nullif(c.materia_receptor, ''), 'Cesión de ' || m.nombre),
         trim(dr.apellidos || ' ' || dr.nombres) || ' · cedido por ' || trim(d.apellidos || ' ' || d.nombres),
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

  -- 3) Reservas (eventos, defensas…)
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

-- ---------------------------------------------------------------------
-- fn_conflictos: pares de ocupaciones que chocan en un rango de fechas
--  * Choque de ambiente: mismo ambiente, horas solapadas, distinto docente
--    (o alguna es una reserva).
--  * Choque de docente: mismo docente en dos ambientes a la vez.
--  * Mismo docente + mismo ambiente + misma hora = grupos fusionados (OK).
-- ---------------------------------------------------------------------
create or replace function public.fn_conflictos(p_desde date, p_hasta date)
returns table (
  tipo_choque  text,
  fecha        date,
  hora_inicio  time,
  hora_fin     time,
  ambiente_id  bigint,
  docente_id   bigint,
  clave_a text, origen_a text, titulo_a text, detalle_a text, ambiente_a bigint,
  asignacion_a bigint, horario_a bigint, cesion_a bigint, reserva_a bigint, reserva_horario_a bigint,
  clave_b text, origen_b text, titulo_b text, detalle_b text, ambiente_b bigint,
  asignacion_b bigint, horario_b bigint, cesion_b bigint, reserva_b bigint, reserva_horario_b bigint,
  mensaje text
)
language sql stable as $$
  with o as materialized (
    select * from public.fn_ocupaciones(p_desde, p_hasta)
  ),
  pares as (
    select a.*,
           b.clave as b_clave, b.origen as b_origen, b.titulo as b_titulo, b.detalle as b_detalle,
           b.ambiente_id as b_ambiente, b.docente_id as b_docente, b.asignacion_id as b_asig,
           b.asignacion_horario_id as b_hor, b.cesion_id as b_ces, b.reserva_id as b_res,
           b.reserva_horario_id as b_rh,
           greatest(a.hora_inicio, b.hora_inicio) as solape_ini,
           least(a.hora_fin, b.hora_fin)          as solape_fin,
           case when a.ambiente_id = b.ambiente_id then 'ambiente' else 'docente' end as tipo
    from o a
    join o b on a.fecha = b.fecha
            and a.clave < b.clave
            and a.hora_inicio < b.hora_fin
            and b.hora_inicio < a.hora_fin
    where (a.ambiente_id = b.ambiente_id
           and (a.docente_id is null or b.docente_id is null or a.docente_id <> b.docente_id))
       or (a.docente_id = b.docente_id and a.ambiente_id <> b.ambiente_id)
  )
  select p.tipo, p.fecha, p.solape_ini, p.solape_fin,
         case when p.tipo = 'ambiente' then p.ambiente_id end,
         case when p.tipo = 'docente'  then p.docente_id  end,
         p.clave, p.origen, p.titulo, p.detalle, p.ambiente_id,
         p.asignacion_id, p.asignacion_horario_id, p.cesion_id, p.reserva_id, p.reserva_horario_id,
         p.b_clave, p.b_origen, p.b_titulo, p.b_detalle, p.b_ambiente,
         p.b_asig, p.b_hor, p.b_ces, p.b_res, p.b_rh,
         case when p.tipo = 'ambiente' then
           format('Choque de ambiente: %s el %s de %s a %s está ocupado por "%s" (%s) y por "%s" (%s).',
                  am.codigo, public.fn_texto_fecha(p.fecha),
                  public.fn_texto_hora(p.solape_ini), public.fn_texto_hora(p.solape_fin),
                  p.titulo, p.detalle, p.b_titulo, p.b_detalle)
         else
           format('Choque de docente: %s estaría en %s ("%s") y en %s ("%s") al mismo tiempo el %s de %s a %s.',
                  public.fn_nombre_docente(p.docente_id),
                  am.codigo, p.titulo, bm.codigo, p.b_titulo,
                  public.fn_texto_fecha(p.fecha),
                  public.fn_texto_hora(p.solape_ini), public.fn_texto_hora(p.solape_fin))
         end
  from pares p
  join public.ambientes am on am.id = p.ambiente_id
  join public.ambientes bm on bm.id = p.b_ambiente
  order by p.fecha, p.solape_ini;
$$;

-- ---------------------------------------------------------------------
-- fn_verificar_choques: valida "candidatos" ANTES de guardar (uso en vivo
-- desde los formularios). p_items es un arreglo JSON de:
--   { "fecha": "2026-10-13", "hora_inicio": "19:00", "hora_fin": "22:00",
--     "ambiente_id": 3, "docente_id": 7 }
--   o patrón semanal:
--   { "dia_semana": 2, "desde": "2026-10-05", "hasta": "2026-10-30", … }
-- p_ignorar: { "asignacion_id": 1, "reserva_id": 2, "cesion_id": 3,
--              "asignacion_horario_ids": [4,5] } (lo que se está editando)
-- ---------------------------------------------------------------------
drop function if exists public.fn_verificar_choques(jsonb, jsonb);
create or replace function public.fn_verificar_choques(p_items jsonb, p_ignorar jsonb default '{}'::jsonb)
returns table (
  indice                integer,
  tipo_choque           text,
  fecha                 date,
  hora_inicio           time,
  hora_fin              time,
  ambiente_id           bigint,
  docente_id            bigint,
  clave                 text,
  origen                text,
  titulo                text,
  detalle               text,
  asignacion_id         bigint,
  asignacion_horario_id bigint,
  reserva_id            bigint,
  prioridad             integer,
  mensaje               text,
  ocupacion_inicio      time,      -- horario completo de lo que ya ocupa
  ocupacion_fin         time
)
language sql stable as $$
  with candidatos as (
    -- Cada candidato expandido a fechas concretas
    select (e.ord - 1)::int as idx, f.fecha,
           (e.x->>'hora_inicio')::time as hi, (e.x->>'hora_fin')::time as hf,
           nullif(e.x->>'ambiente_id', '')::bigint as amb,
           nullif(e.x->>'docente_id', '')::bigint  as doc
    from jsonb_array_elements(p_items) with ordinality as e(x, ord)
    cross join lateral (
      select (e.x->>'fecha')::date as fecha
      where nullif(e.x->>'fecha', '') is not null
      union all
      select g::date
      from generate_series((e.x->>'desde')::date, (e.x->>'hasta')::date, interval '1 day') g
      where nullif(e.x->>'fecha', '') is null
        and extract(isodow from g) = (e.x->>'dia_semana')::int
        and not exists (select 1 from public.feriados fe where fe.fecha = g::date)
    ) f
  ),
  ignorar as (
    select nullif(p_ignorar->>'asignacion_id', '')::bigint as asig,
           nullif(p_ignorar->>'reserva_id', '')::bigint    as res,
           nullif(p_ignorar->>'cesion_id', '')::bigint     as ces,
           coalesce((select array_agg(x::bigint)
                     from jsonb_array_elements_text(p_ignorar->'asignacion_horario_ids') x), '{}') as hors
  ),
  rango as (
    select min(c.fecha) as desde, max(c.fecha) as hasta from candidatos c
  ),
  o as materialized (
    -- Ocupaciones existentes, sin lo que se está editando
    select oc.*
    from rango, ignorar i,
         lateral public.fn_ocupaciones(rango.desde, rango.hasta, i.res, i.ces) oc
    where rango.desde is not null
      and not coalesce(oc.asignacion_id = i.asig, false)
      and not coalesce(oc.asignacion_horario_id = any(i.hors), false)
  )
  select c.idx,
         case when o.ambiente_id = c.amb then 'ambiente' else 'docente' end,
         c.fecha,
         greatest(o.hora_inicio, c.hi), least(o.hora_fin, c.hf),
         o.ambiente_id, o.docente_id, o.clave, o.origen, o.titulo, o.detalle,
         o.asignacion_id, o.asignacion_horario_id, o.reserva_id, o.prioridad,
         case when o.ambiente_id = c.amb then
           format('%s el %s de %s a %s ya está ocupado por "%s" (%s).',
                  am.codigo, public.fn_texto_fecha(c.fecha),
                  public.fn_texto_hora(o.hora_inicio), public.fn_texto_hora(o.hora_fin),
                  o.titulo, o.detalle)
         else
           format('%s ya tiene "%s" en %s el %s de %s a %s.',
                  public.fn_nombre_docente(o.docente_id), o.titulo, am.codigo,
                  public.fn_texto_fecha(c.fecha),
                  public.fn_texto_hora(o.hora_inicio), public.fn_texto_hora(o.hora_fin))
         end,
         o.hora_inicio, o.hora_fin
  from candidatos c
  join o on o.fecha = c.fecha and o.hora_inicio < c.hf and c.hi < o.hora_fin
  join public.ambientes am on am.id = o.ambiente_id
  where (c.amb is not null and o.ambiente_id = c.amb
         and (c.doc is null or o.docente_id is null or o.docente_id <> c.doc))
     or (c.doc is not null and o.docente_id = c.doc
         and (c.amb is null or o.ambiente_id <> c.amb))
  order by c.fecha, 4;
$$;

-- ---------------------------------------------------------------------
-- fn_ambientes_libres: ambientes activos sin ocupación en fecha/horas
-- ---------------------------------------------------------------------
create or replace function public.fn_ambientes_libres(
  p_fecha       date,
  p_hora_inicio time,
  p_hora_fin    time,
  p_tipo        text  default null,
  p_ignorar     jsonb default '{}'::jsonb
)
returns setof public.ambientes
language sql stable as $$
  select am.*
  from public.ambientes am
  where am.estado = 'activo'
    and (p_tipo is null or am.tipo = p_tipo)
    and not exists (
      select 1
      from public.fn_ocupaciones(p_fecha, p_fecha,
                                 nullif(p_ignorar->>'reserva_id', '')::bigint,
                                 nullif(p_ignorar->>'cesion_id', '')::bigint) o
      where o.ambiente_id = am.id
        and o.hora_inicio < p_hora_fin
        and p_hora_inicio < o.hora_fin
        and not coalesce(o.asignacion_horario_id = nullif(p_ignorar->>'asignacion_horario_id', '')::bigint, false)
    )
  order by case am.tipo when 'laboratorio' then 0 when 'aula' then 1 else 2 end, am.orden, am.codigo;
$$;

-- ---------------------------------------------------------------------
-- fn_ambientes_libres_fechas: ambientes libres en TODAS las fechas dadas
-- (ej. todos los martes marcados del módulo de 19:00 a 22:00).
-- Sirve para sugerir laboratorios al crear una asignación o una cesión.
-- ---------------------------------------------------------------------
drop function if exists public.fn_ambientes_libres_patron(integer, date, date, time, time, text, jsonb);
create or replace function public.fn_ambientes_libres_fechas(
  p_fechas      date[],
  p_hora_inicio time,
  p_hora_fin    time,
  p_tipo        text  default null,
  p_ignorar     jsonb default '{}'::jsonb
)
returns setof public.ambientes
language sql stable as $$
  with o as materialized (
    select oc.*
    from public.fn_ocupaciones((select min(f) from unnest(p_fechas) f), (select max(f) from unnest(p_fechas) f),
                               nullif(p_ignorar->>'reserva_id', '')::bigint,
                               nullif(p_ignorar->>'cesion_id', '')::bigint) oc
    where oc.fecha = any(p_fechas)
      and oc.hora_inicio < p_hora_fin
      and p_hora_inicio < oc.hora_fin
      and not coalesce(oc.asignacion_id = nullif(p_ignorar->>'asignacion_id', '')::bigint, false)
      and not coalesce(oc.asignacion_horario_id = nullif(p_ignorar->>'asignacion_horario_id', '')::bigint, false)
  )
  select am.*
  from public.ambientes am
  where am.estado = 'activo'
    and (p_tipo is null or am.tipo = p_tipo)
    and coalesce(array_length(p_fechas, 1), 0) > 0
    and not exists (select 1 from o where o.ambiente_id = am.id)
  order by case am.tipo when 'laboratorio' then 0 when 'aula' then 1 else 2 end, am.orden, am.codigo;
$$;

-- ---------------------------------------------------------------------
-- fn_estado_ambientes: estado en vivo (libre / ocupado) en un momento.
-- Por defecto usa la hora actual de Bolivia.
-- ---------------------------------------------------------------------
create or replace function public.fn_estado_ambientes(
  p_momento timestamp default (now() at time zone 'America/La_Paz')
)
returns table (
  ambiente_id   bigint,
  ocupado       boolean,
  titulo        text,
  detalle       text,
  origen        text,
  hora_inicio   time,
  hora_fin      time
)
language sql stable as $$
  select am.id,
         o.clave is not null,
         o.titulo, o.detalle, o.origen, o.hora_inicio, o.hora_fin
  from public.ambientes am
  left join lateral (
    select oc.*
    from public.fn_ocupaciones(p_momento::date, p_momento::date) oc
    where oc.ambiente_id = am.id
      and oc.hora_inicio <= p_momento::time
      and oc.hora_fin    >  p_momento::time
    order by oc.prioridad desc
    limit 1
  ) o on true
  where am.estado <> 'baja';
$$;

-- =====================================================================
--  VALIDACIONES EN EL SERVIDOR (triggers)
--  Las reglas se cumplen aunque alguien escriba directo en la base.
-- =====================================================================

-- ¿La fecha corresponde a una clase de ese horario? (día, rango, feriado)
create or replace function public.fn_es_fecha_del_horario(p_horario_id bigint, p_fecha date)
returns boolean language sql stable as $$
  select exists (
    select 1
    from public.asignacion_horarios h
    join public.asignaciones a        on a.id = h.asignacion_id
    join public.sistemas_academicos s on s.id = a.sistema_id
    where h.id = p_horario_id
      and extract(isodow from p_fecha) = h.dia_semana
      and p_fecha between a.fecha_inicio and a.fecha_fin
      and (s.modo_fechas = 'rango'
           or exists (select 1 from public.asignacion_fechas af where af.asignacion_id = a.id and af.fecha = p_fecha))
      and not exists (select 1 from public.feriados f where f.fecha = p_fecha)
  );
$$;

-- Lanza error con mensaje claro si existe un choque que involucre al registro
create or replace function public.fn_exigir_sin_choques(
  p_desde date, p_hasta date, p_tipo text, p_id bigint, p_fecha date default null
)
returns void language plpgsql stable as $$
declare
  v_mensaje text;
begin
  if p_desde is null or p_hasta is null then
    return;
  end if;

  select c.mensaje into v_mensaje
  from public.fn_conflictos(p_desde, p_hasta) c
  where (p_fecha is null or c.fecha = p_fecha)
    and case p_tipo
          when 'horario'         then p_id in (c.horario_a, c.horario_b)
          when 'asignacion'      then p_id in (c.asignacion_a, c.asignacion_b)
          when 'cesion'          then p_id in (c.cesion_a, c.cesion_b)
          when 'reserva_horario' then p_id in (c.reserva_horario_a, c.reserva_horario_b)
          else false
        end
  limit 1;

  if v_mensaje is not null then
    raise exception '%', v_mensaje
      using errcode = 'P0001',
            hint = 'Elija otro ambiente, cambie el horario, registre una cesión o reubique la clase afectada.';
  end if;
end $$;

-- ---- Validaciones inmediatas (BEFORE) --------------------------------

-- Horario de asignación: ambiente activo y día permitido por el sistema académico
create or replace function public.fn_trg_validar_horario()
returns trigger language plpgsql as $$
declare
  v_estado  text;
  v_codigo  text;
  v_dias    smallint[];
  v_sistema text;
begin
  select estado, codigo into v_estado, v_codigo from public.ambientes where id = new.ambiente_id;
  if v_estado <> 'activo' then
    raise exception 'El ambiente % está en estado "%" y no puede asignarse.', v_codigo, v_estado;
  end if;

  select s.dias_permitidos, s.nombre into v_dias, v_sistema
  from public.asignaciones a
  join public.sistemas_academicos s on s.id = a.sistema_id
  where a.id = new.asignacion_id;

  if not (new.dia_semana = any(v_dias)) then
    raise exception 'El sistema "%" no permite clases el día %.', v_sistema,
      (array['lunes','martes','miércoles','jueves','viernes','sábado','domingo'])[new.dia_semana];
  end if;
  return new;
end $$;

drop trigger if exists trg_asignacion_horarios_validar on public.asignacion_horarios;
create trigger trg_asignacion_horarios_validar
  before insert or update on public.asignacion_horarios
  for each row execute function public.fn_trg_validar_horario();

-- Asignación: duración del semestral (no llega a meses_maximo)
create or replace function public.fn_trg_validar_asignacion()
returns trigger language plpgsql as $$
declare
  v_sistema public.sistemas_academicos;
begin
  select * into v_sistema from public.sistemas_academicos where id = new.sistema_id;
  if v_sistema.modo_fechas = 'rango' and v_sistema.meses_maximo is not null
     and new.fecha_fin >= (new.fecha_inicio + make_interval(months => v_sistema.meses_maximo))::date then
    raise exception 'En el sistema "%" la duración debe ser menor a % meses (fin máximo: %).',
      v_sistema.nombre, v_sistema.meses_maximo,
      to_char((new.fecha_inicio + make_interval(months => v_sistema.meses_maximo))::date - 1, 'DD/MM/YYYY');
  end if;
  return new;
end $$;

drop trigger if exists trg_asignaciones_validar on public.asignaciones;
create trigger trg_asignaciones_validar
  before insert or update on public.asignaciones
  for each row execute function public.fn_trg_validar_asignacion();

-- Días marcados (modular): día permitido por el sistema y dentro del rango
create or replace function public.fn_trg_validar_asignacion_fecha()
returns trigger language plpgsql as $$
declare
  v_dias    smallint[];
  v_sistema text;
  v_inicio  date;
  v_fin     date;
begin
  select s.dias_permitidos, s.nombre, a.fecha_inicio, a.fecha_fin into v_dias, v_sistema, v_inicio, v_fin
  from public.asignaciones a join public.sistemas_academicos s on s.id = a.sistema_id
  where a.id = new.asignacion_id;
  if not (extract(isodow from new.fecha)::smallint = any(v_dias)) then
    raise exception 'El sistema "%" no permite clases el %.', v_sistema, public.fn_texto_fecha(new.fecha);
  end if;
  if new.fecha not between v_inicio and v_fin then
    raise exception 'El % está fuera del rango de la asignación.', public.fn_texto_fecha(new.fecha);
  end if;
  return new;
end $$;

drop trigger if exists trg_asignacion_fechas_validar on public.asignacion_fechas;
create trigger trg_asignacion_fechas_validar
  before insert or update on public.asignacion_fechas
  for each row execute function public.fn_trg_validar_asignacion_fecha();

-- Fecha de cesión: debe ser un día de clase y el receptor no puede ser el mismo docente
create or replace function public.fn_trg_validar_cesion_fecha()
returns trigger language plpgsql as $$
declare
  v_horario  bigint;
  v_receptor bigint;
  v_docente  bigint;
  v_otro     text;
begin
  select c.asignacion_horario_id, c.docente_receptor_id, a.docente_id
    into v_horario, v_receptor, v_docente
  from public.cesiones c
  join public.asignacion_horarios h on h.id = c.asignacion_horario_id
  join public.asignaciones a on a.id = h.asignacion_id
  where c.id = new.cesion_id;

  if v_receptor = v_docente then
    raise exception 'Un docente no puede cederse el ambiente a sí mismo.';
  end if;
  if not public.fn_es_fecha_del_horario(v_horario, new.fecha) then
    raise exception 'El % no es un día de clase de ese horario (revise los días marcados de la asignación y los feriados).',
      public.fn_texto_fecha(new.fecha);
  end if;
  -- Un mismo día no se puede ceder dos veces
  select public.fn_nombre_docente(c.docente_receptor_id) into v_otro
  from public.cesiones c join public.cesion_fechas cf on cf.cesion_id = c.id
  where c.asignacion_horario_id = v_horario and cf.fecha = new.fecha and c.id <> new.cesion_id
  limit 1;
  if v_otro is not null then
    raise exception 'El % ya fue cedido a %. Edite esa cesión en lugar de crear otra.', public.fn_texto_fecha(new.fecha), v_otro;
  end if;
  return new;
end $$;

drop trigger if exists trg_cesion_fechas_validar on public.cesion_fechas;
create trigger trg_cesion_fechas_validar
  before insert or update on public.cesion_fechas
  for each row execute function public.fn_trg_validar_cesion_fecha();

-- Reubicación: fecha válida y ambiente destino activo
create or replace function public.fn_trg_validar_reubicacion()
returns trigger language plpgsql as $$
declare
  v_estado text;
  v_codigo text;
begin
  if not public.fn_es_fecha_del_horario(new.asignacion_horario_id, new.fecha) then
    raise exception 'El % no es un día de clase de ese horario.', public.fn_texto_fecha(new.fecha);
  end if;
  if new.ambiente_destino_id is not null then
    select estado, codigo into v_estado, v_codigo from public.ambientes where id = new.ambiente_destino_id;
    if v_estado <> 'activo' then
      raise exception 'El ambiente % está en estado "%" y no puede usarse.', v_codigo, v_estado;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_reubicaciones_validar on public.reubicaciones;
create trigger trg_reubicaciones_validar
  before insert or update on public.reubicaciones
  for each row execute function public.fn_trg_validar_reubicacion();

-- Horario de reserva: ambiente no dado de baja
create or replace function public.fn_trg_validar_reserva_horario()
returns trigger language plpgsql as $$
declare
  v_estado text;
  v_codigo text;
begin
  select estado, codigo into v_estado, v_codigo from public.ambientes where id = new.ambiente_id;
  if v_estado = 'baja' then
    raise exception 'El ambiente % está dado de baja.', v_codigo;
  end if;
  return new;
end $$;

drop trigger if exists trg_reserva_horarios_validar on public.reserva_horarios;
create trigger trg_reserva_horarios_validar
  before insert or update on public.reserva_horarios
  for each row execute function public.fn_trg_validar_reserva_horario();

-- ---- Validación de choques al confirmar la transacción (DEFERRED) -----
-- Se valida al final para permitir guardar en un solo paso una reserva
-- junto con las reubicaciones obligatorias de las clases afectadas.

-- Rango de fechas efectivo de una asignación
create or replace function public.fn_rango_asignacion(p_asignacion_id bigint, out desde date, out hasta date)
language sql stable as $$
  select a.fecha_inicio, a.fecha_fin from public.asignaciones a where a.id = p_asignacion_id;
$$;

create or replace function public.fn_trg_choques_horario()
returns trigger language plpgsql as $$
declare r record;
begin
  -- El registro pudo borrarse más adelante en la misma transacción
  if not exists (select 1 from public.asignacion_horarios where id = new.id) then return null; end if;
  select * into r from public.fn_rango_asignacion(new.asignacion_id);
  perform public.fn_exigir_sin_choques(r.desde, r.hasta, 'horario', new.id);
  return null;
end $$;

drop trigger if exists trg_asignacion_horarios_choques on public.asignacion_horarios;
create constraint trigger trg_asignacion_horarios_choques
  after insert or update on public.asignacion_horarios
  deferrable initially deferred
  for each row execute function public.fn_trg_choques_horario();

create or replace function public.fn_trg_choques_asignacion()
returns trigger language plpgsql as $$
declare r record;
begin
  if not exists (select 1 from public.asignaciones where id = new.id) then return null; end if;
  select * into r from public.fn_rango_asignacion(new.id);
  perform public.fn_exigir_sin_choques(r.desde, r.hasta, 'asignacion', new.id);
  return null;
end $$;

drop trigger if exists trg_asignaciones_choques on public.asignaciones;
create constraint trigger trg_asignaciones_choques
  after update on public.asignaciones
  deferrable initially deferred
  for each row execute function public.fn_trg_choques_asignacion();

-- Días marcados de una asignación modular: revisa esa fecha
create or replace function public.fn_trg_choques_asignacion_fecha()
returns trigger language plpgsql as $$
begin
  if not exists (select 1 from public.asignacion_fechas where asignacion_id = new.asignacion_id and fecha = new.fecha) then
    return null;
  end if;
  perform public.fn_exigir_sin_choques(new.fecha, new.fecha, 'asignacion', new.asignacion_id, new.fecha);
  return null;
end $$;

drop trigger if exists trg_asignacion_fechas_choques on public.asignacion_fechas;
create constraint trigger trg_asignacion_fechas_choques
  after insert on public.asignacion_fechas
  deferrable initially deferred
  for each row execute function public.fn_trg_choques_asignacion_fecha();

-- Fechas de cesión (alta o baja): revisa ese horario en esa fecha
create or replace function public.fn_trg_choques_cesion_fecha()
returns trigger language plpgsql as $$
declare
  v_fila    record := coalesce(new, old);
  v_horario bigint;
begin
  select asignacion_horario_id into v_horario from public.cesiones where id = v_fila.cesion_id;
  if v_horario is null then return null; end if;
  perform public.fn_exigir_sin_choques(v_fila.fecha, v_fila.fecha, 'horario', v_horario, v_fila.fecha);
  return null;
end $$;

drop trigger if exists trg_cesion_fechas_choques on public.cesion_fechas;
create constraint trigger trg_cesion_fechas_choques
  after insert or update or delete on public.cesion_fechas
  deferrable initially deferred
  for each row execute function public.fn_trg_choques_cesion_fecha();

-- Cambio de receptor de una cesión
create or replace function public.fn_trg_choques_cesion()
returns trigger language plpgsql as $$
declare
  v_desde date;
  v_hasta date;
begin
  select min(fecha), max(fecha) into v_desde, v_hasta from public.cesion_fechas where cesion_id = new.id;
  perform public.fn_exigir_sin_choques(v_desde, v_hasta, 'cesion', new.id);
  return null;
end $$;

drop trigger if exists trg_cesiones_choques on public.cesiones;
create constraint trigger trg_cesiones_choques
  after update on public.cesiones
  deferrable initially deferred
  for each row execute function public.fn_trg_choques_cesion();

-- Reubicaciones (alta, cambio o baja): revisa el horario en esa fecha
create or replace function public.fn_trg_choques_reubicacion()
returns trigger language plpgsql as $$
declare v_fila record := coalesce(new, old);
begin
  if not exists (select 1 from public.asignacion_horarios where id = v_fila.asignacion_horario_id) then
    return null;
  end if;
  perform public.fn_exigir_sin_choques(v_fila.fecha, v_fila.fecha, 'horario', v_fila.asignacion_horario_id, v_fila.fecha);
  return null;
end $$;

drop trigger if exists trg_reubicaciones_choques on public.reubicaciones;
create constraint trigger trg_reubicaciones_choques
  after insert or update or delete on public.reubicaciones
  deferrable initially deferred
  for each row execute function public.fn_trg_choques_reubicacion();

-- Horarios de reservas
create or replace function public.fn_trg_choques_reserva_horario()
returns trigger language plpgsql as $$
begin
  if not exists (select 1 from public.reserva_horarios where id = new.id) then return null; end if;
  perform public.fn_exigir_sin_choques(new.fecha, new.fecha, 'reserva_horario', new.id, new.fecha);
  return null;
end $$;

drop trigger if exists trg_reserva_horarios_choques on public.reserva_horarios;
create constraint trigger trg_reserva_horarios_choques
  after insert or update on public.reserva_horarios
  deferrable initially deferred
  for each row execute function public.fn_trg_choques_reserva_horario();

-- =====================================================================
--  RPC: operaciones completas en una sola transacción
--  (se llaman desde Angular con supabase.rpc('nombre', { p: {...} }))
-- =====================================================================

-- ---------------------------------------------------------------------
-- rpc_guardar_asignacion
-- p = { id?, sistema_id, docente_id, materia_id, carrera_id, grupo, observacion?,
--       fecha_inicio?, fecha_fin?,          (semestral: rango)
--       fechas?: ["2026-10-05", …],        (modular: días marcados)
--       horarios: [ { id?, dia_semana, hora_inicio, hora_fin, ambiente_id } ] }
-- ---------------------------------------------------------------------
create or replace function public.rpc_guardar_asignacion(p jsonb)
returns bigint language plpgsql as $$
declare
  v_id     bigint := nullif(p->>'id', '')::bigint;
  v_modo   text;
  v_inicio date;
  v_fin    date;
  v_ids    bigint[];
  h        jsonb;
begin
  if jsonb_array_length(coalesce(p->'horarios', '[]')) = 0 then
    raise exception 'Debe registrar al menos un horario (día, hora y laboratorio).';
  end if;

  select modo_fechas into v_modo from public.sistemas_academicos where id = (p->>'sistema_id')::bigint;
  if v_modo is null then
    raise exception 'Seleccione el sistema (modular o semestral).';
  end if;

  -- Rango: en modular sale de los días marcados
  if v_modo = 'dias' then
    if jsonb_array_length(coalesce(p->'fechas', '[]')) = 0 then
      raise exception 'Marque en el calendario los días de clase.';
    end if;
    select min((x #>> '{}')::date), max((x #>> '{}')::date) into v_inicio, v_fin
    from jsonb_array_elements(p->'fechas') x;
  else
    v_inicio := nullif(p->>'fecha_inicio', '')::date;
    v_fin    := nullif(p->>'fecha_fin', '')::date;
    if v_inicio is null or v_fin is null then
      raise exception 'Indique la fecha de inicio y de fin.';
    end if;
  end if;

  if v_id is null then
    insert into public.asignaciones (sistema_id, docente_id, materia_id, carrera_id, grupo, fecha_inicio, fecha_fin, observacion)
    values ((p->>'sistema_id')::bigint, (p->>'docente_id')::bigint, (p->>'materia_id')::bigint, (p->>'carrera_id')::bigint,
            nullif(p->>'grupo', ''), v_inicio, v_fin, nullif(p->>'observacion', ''))
    returning id into v_id;
  else
    update public.asignaciones set
      sistema_id   = (p->>'sistema_id')::bigint,
      docente_id   = (p->>'docente_id')::bigint,
      materia_id   = (p->>'materia_id')::bigint,
      carrera_id   = (p->>'carrera_id')::bigint,
      grupo        = nullif(p->>'grupo', ''),
      fecha_inicio = v_inicio,
      fecha_fin    = v_fin,
      observacion  = nullif(p->>'observacion', '')
    where id = v_id;
    if not found then
      raise exception 'La asignación % no existe.', v_id;
    end if;
  end if;

  -- Días marcados (se reemplazan)
  delete from public.asignacion_fechas where asignacion_id = v_id;
  if v_modo = 'dias' then
    insert into public.asignacion_fechas (asignacion_id, fecha)
    select distinct v_id, (x #>> '{}')::date from jsonb_array_elements(p->'fechas') x;
  end if;

  -- Se eliminan los horarios que ya no vienen (sus cesiones/reubicaciones caen en cascada)
  select coalesce(array_agg((x->>'id')::bigint), '{}') into v_ids
  from jsonb_array_elements(p->'horarios') x where nullif(x->>'id', '') is not null;

  delete from public.asignacion_horarios where asignacion_id = v_id and not (id = any(v_ids));

  for h in select * from jsonb_array_elements(p->'horarios') loop
    if nullif(h->>'id', '') is null then
      insert into public.asignacion_horarios (asignacion_id, dia_semana, hora_inicio, hora_fin, ambiente_id)
      values (v_id, (h->>'dia_semana')::smallint, (h->>'hora_inicio')::time, (h->>'hora_fin')::time, (h->>'ambiente_id')::bigint);
    else
      update public.asignacion_horarios set
        dia_semana  = (h->>'dia_semana')::smallint,
        hora_inicio = (h->>'hora_inicio')::time,
        hora_fin    = (h->>'hora_fin')::time,
        ambiente_id = (h->>'ambiente_id')::bigint
      where id = (h->>'id')::bigint and asignacion_id = v_id;
    end if;
  end loop;

  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- rpc_guardar_cesion
-- p = { id?, asignacion_horario_id, docente_receptor_id, carrera_receptor_id?,
--       materia_receptor?, motivo, fechas: ["2026-10-13", …],
--       reubicacion?: { ambiente_destino_id, hora_inicio?, hora_fin? } }
--   reubicacion = dónde pasa clase el docente que cede (opcional).
-- ---------------------------------------------------------------------
create or replace function public.rpc_guardar_cesion(p jsonb)
returns bigint language plpgsql as $$
declare
  v_id      bigint := nullif(p->>'id', '')::bigint;
  v_horario bigint := (p->>'asignacion_horario_id')::bigint;
  v_reub    jsonb  := p->'reubicacion';
  v_fecha   date;
begin
  if jsonb_array_length(coalesce(p->'fechas', '[]')) = 0 then
    raise exception 'Seleccione al menos una fecha para la cesión.';
  end if;
  if nullif(trim(p->>'motivo'), '') is null then
    raise exception 'Indique el motivo de la cesión.';
  end if;

  if v_id is null then
    insert into public.cesiones (asignacion_horario_id, docente_receptor_id, carrera_receptor_id, materia_receptor, motivo)
    values (v_horario, (p->>'docente_receptor_id')::bigint, nullif(p->>'carrera_receptor_id', '')::bigint,
            nullif(p->>'materia_receptor', ''), p->>'motivo')
    returning id into v_id;
  else
    update public.cesiones set
      asignacion_horario_id = v_horario,
      docente_receptor_id   = (p->>'docente_receptor_id')::bigint,
      carrera_receptor_id   = nullif(p->>'carrera_receptor_id', '')::bigint,
      materia_receptor      = nullif(p->>'materia_receptor', ''),
      motivo                = p->>'motivo'
    where id = v_id;
    delete from public.cesion_fechas where cesion_id = v_id;
    delete from public.reubicaciones where cesion_id = v_id;
  end if;

  for v_fecha in select distinct (x #>> '{}')::date from jsonb_array_elements(p->'fechas') x loop
    insert into public.cesion_fechas (cesion_id, fecha) values (v_id, v_fecha);

    if v_reub is not null and jsonb_typeof(v_reub) = 'object' and nullif(v_reub->>'ambiente_destino_id', '') is not null then
      begin
        insert into public.reubicaciones (asignacion_horario_id, fecha, ambiente_destino_id, hora_inicio, hora_fin, motivo, cesion_id)
        values (v_horario, v_fecha, (v_reub->>'ambiente_destino_id')::bigint,
                nullif(v_reub->>'hora_inicio', '')::time, nullif(v_reub->>'hora_fin', '')::time,
                'Cede su ambiente: ' || (p->>'motivo'), v_id);
      exception when unique_violation then
        raise exception 'La clase del % ya tiene una reubicación registrada. Elimínela antes de ceder ese día.',
          public.fn_texto_fecha(v_fecha);
      end;
    end if;
  end loop;

  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- rpc_guardar_reserva (eventos, defensas…)
-- p = { id?, tipo_id, titulo, descripcion?, responsable?, carrera_id?,
--       horarios:      [ { ambiente_id, fecha, hora_inicio, hora_fin } ],
--       reubicaciones: [ { asignacion_horario_id, fecha, ambiente_destino_id|null,
--                          hora_inicio?, hora_fin? } ] }
-- Si la reserva choca con clases, deben venir sus reubicaciones; si no,
-- la validación diferida rechaza la operación (regla de prioridad).
-- ---------------------------------------------------------------------
create or replace function public.rpc_guardar_reserva(p jsonb)
returns bigint language plpgsql as $$
declare
  v_id bigint := nullif(p->>'id', '')::bigint;
  v_titulo text := nullif(trim(p->>'titulo'), '');
  h jsonb;
begin
  if v_titulo is null then
    raise exception 'Indique el nombre del evento o defensa.';
  end if;
  if jsonb_array_length(coalesce(p->'horarios', '[]')) = 0 then
    raise exception 'Seleccione al menos una fecha y un ambiente.';
  end if;

  if v_id is null then
    insert into public.reservas (tipo_id, titulo, descripcion, responsable, carrera_id)
    values ((p->>'tipo_id')::bigint, v_titulo, nullif(p->>'descripcion', ''), nullif(p->>'responsable', ''),
            nullif(p->>'carrera_id', '')::bigint)
    returning id into v_id;
  else
    update public.reservas set
      tipo_id     = (p->>'tipo_id')::bigint,
      titulo      = v_titulo,
      descripcion = nullif(p->>'descripcion', ''),
      responsable = nullif(p->>'responsable', ''),
      carrera_id  = nullif(p->>'carrera_id', '')::bigint
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
      insert into public.reubicaciones (asignacion_horario_id, fecha, ambiente_destino_id, hora_inicio, hora_fin, motivo, reserva_id)
      values ((h->>'asignacion_horario_id')::bigint, (h->>'fecha')::date, nullif(h->>'ambiente_destino_id', '')::bigint,
              nullif(h->>'hora_inicio', '')::time, nullif(h->>'hora_fin', '')::time,
              'Reubicada por: ' || v_titulo, v_id);
    exception when unique_violation then
      raise exception 'Una clase afectada del % ya tiene otra reubicación. Revísela antes de crear la reserva.',
        public.fn_texto_fecha((h->>'fecha')::date);
    end;
  end loop;

  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- rpc_reubicar_clase: mover / suspender UNA clase en una fecha concreta
-- p = { asignacion_horario_id, fecha, ambiente_destino_id|null,
--       hora_inicio?, hora_fin?, motivo }
-- ---------------------------------------------------------------------
create or replace function public.rpc_reubicar_clase(p jsonb)
returns bigint language plpgsql as $$
declare v_id bigint;
begin
  if nullif(trim(p->>'motivo'), '') is null then
    raise exception 'Indique el motivo de la reubicación.';
  end if;

  insert into public.reubicaciones (asignacion_horario_id, fecha, ambiente_destino_id, hora_inicio, hora_fin, motivo)
  values ((p->>'asignacion_horario_id')::bigint, (p->>'fecha')::date, nullif(p->>'ambiente_destino_id', '')::bigint,
          nullif(p->>'hora_inicio', '')::time, nullif(p->>'hora_fin', '')::time, p->>'motivo')
  on conflict (asignacion_horario_id, fecha) do update set
    ambiente_destino_id = excluded.ambiente_destino_id,
    hora_inicio         = excluded.hora_inicio,
    hora_fin            = excluded.hora_fin,
    motivo              = excluded.motivo
  returning id into v_id;
  return v_id;
end $$;
