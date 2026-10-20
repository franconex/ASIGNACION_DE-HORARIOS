-- =====================================================================
--  SISTEMA DE ASIGNACIÓN DE LABORATORIOS — UPDS
--  Script 53: EL SEMESTRAL (MEDICINA) SE MODIFICA DESDE HOY EN ADELANTE
--  - Al editar una asignación semestral que ya empezó, los días pasados
--    no cambian: la asignación original se cierra ayer (queda como
--    historial) y los cambios se guardan como una asignación nueva que
--    va desde hoy hasta la fecha de fin.
--  - Si solo cambia la observación o la fecha de fin, se actualiza la
--    misma asignación (no se parte).
--  - Una asignación semestral que ya terminó no se puede modificar
--    (salvo la observación).
--  - Las reubicaciones de hoy en adelante del tramo original se borran
--    (el formulario las vuelve a mandar para el tramo nuevo). Si hay
--    cesiones de hoy en adelante, primero hay que quitarlas.
--  Ejecutar en: Supabase > SQL Editor (después de 52).
-- =====================================================================

create or replace function public.rpc_guardar_asignacion(p jsonb)
returns bigint language plpgsql set search_path = public as $$
declare
  v_id     bigint := nullif(p->>'id', '')::bigint;
  v_modo   text;
  v_inicio date;
  v_fin    date;
  v_ids    bigint[];
  h        jsonb;
  r        jsonb;
  v_hid    bigint;
  v_fecha  date;
  v_dest   bigint;
  v_aula   text;
  v_hoy    date := (now() at time zone 'America/La_Paz')::date;
  v_ant    public.asignaciones;
  v_cambia boolean;
begin
  if jsonb_array_length(coalesce(p->'horarios', '[]')) = 0 then
    raise exception 'Debe registrar al menos un horario (día, hora y laboratorio).';
  end if;

  select modo_fechas into v_modo from public.sistemas_academicos where id = (p->>'sistema_id')::bigint;
  if v_modo is null then
    raise exception 'Seleccione el sistema (modular o semestral).';
  end if;

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

  -- Semestral que ya empezó: lo pasado no se toca, se cambia desde hoy
  if v_id is not null and v_modo = 'rango' then
    select * into v_ant from public.asignaciones where id = v_id;
    if found and v_ant.fecha_inicio < v_hoy then
      -- El inicio de lo ya dictado no se mueve
      v_inicio := v_ant.fecha_inicio;
      v_cambia := v_ant.sistema_id is distinct from (p->>'sistema_id')::bigint
        or v_ant.docente_id is distinct from (p->>'docente_id')::bigint
        or v_ant.materia_id is distinct from (p->>'materia_id')::bigint
        or v_ant.carrera_id is distinct from (p->>'carrera_id')::bigint
        or v_ant.grupo is distinct from nullif(p->>'grupo', '')
        or exists (
          (select (x->>'dia_semana')::smallint, (x->>'hora_inicio')::time, (x->>'hora_fin')::time, (x->>'ambiente_id')::bigint
             from jsonb_array_elements(p->'horarios') x
           except
           select dia_semana, hora_inicio, hora_fin, ambiente_id from public.asignacion_horarios where asignacion_id = v_id)
          union all
          (select dia_semana, hora_inicio, hora_fin, ambiente_id from public.asignacion_horarios where asignacion_id = v_id
           except
           select (x->>'dia_semana')::smallint, (x->>'hora_inicio')::time, (x->>'hora_fin')::time, (x->>'ambiente_id')::bigint
             from jsonb_array_elements(p->'horarios') x));

      if v_ant.fecha_fin < v_hoy then
        if v_cambia or v_fin is distinct from v_ant.fecha_fin then
          raise exception 'Esta asignación ya terminó el %: no se puede modificar.', to_char(v_ant.fecha_fin, 'DD/MM/YYYY');
        end if;
      elsif v_fin < v_hoy then
        raise exception 'La fecha de fin no puede ser anterior a hoy (%): los días pasados no se modifican.', to_char(v_hoy, 'DD/MM/YYYY');
      end if;

      if v_cambia then
        if exists (select 1 from public.cesion_fechas cf
                     join public.cesiones c on c.id = cf.cesion_id
                     join public.asignacion_horarios h on h.id = c.asignacion_horario_id
                    where h.asignacion_id = v_id and cf.fecha >= v_hoy) then
          raise exception 'Esta clase tiene cesiones de hoy en adelante: quítelas antes de cambiarla.';
        end if;
        delete from public.reubicaciones r using public.asignacion_horarios h
         where h.id = r.asignacion_horario_id and h.asignacion_id = v_id and r.fecha >= v_hoy;
        -- Lo dictado hasta ayer queda como estaba
        update public.asignaciones set fecha_fin = v_hoy - 1 where id = v_id;
        -- Desde hoy: asignación nueva con los cambios (horarios nuevos, sin ids)
        v_id := null;
        v_inicio := v_hoy;
        p := jsonb_set(p, '{horarios}', (select jsonb_agg(x - 'id') from jsonb_array_elements(p->'horarios') x));
      end if;
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

  delete from public.asignacion_fechas where asignacion_id = v_id;
  if v_modo = 'dias' then
    insert into public.asignacion_fechas (asignacion_id, fecha)
    select distinct v_id, (x #>> '{}')::date from jsonb_array_elements(p->'fechas') x;
  end if;

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

  -- Días que chocan: la clase va a otro laboratorio o a un aula ese día
  for r in select * from jsonb_array_elements(coalesce(p->'reubicaciones', '[]')) loop
    v_fecha := (r->>'fecha')::date;
    v_dest  := nullif(r->>'ambiente_destino_id', '')::bigint;
    v_aula  := left(nullif(trim(r->>'aula_destino'), ''), 80);
    if v_dest is null and v_aula is null then
      raise exception 'Indique a qué laboratorio o aula va la clase el %.', to_char(v_fecha, 'DD/MM/YYYY');
    end if;
    select ah.id into v_hid from public.asignacion_horarios ah
     where ah.asignacion_id = v_id
       and ah.dia_semana = (r->>'dia_semana')::smallint
       and ah.hora_inicio = (r->>'hora_inicio')::time
       and ah.ambiente_id = (r->>'ambiente_id')::bigint
     limit 1;
    if v_hid is null then
      raise exception 'No se encontró el horario a mover el %.', to_char(v_fecha, 'DD/MM/YYYY');
    end if;
    if extract(isodow from v_fecha) <> (r->>'dia_semana')::int or v_fecha not between v_inicio and v_fin then
      raise exception 'El % no es un día de clase de este horario.', to_char(v_fecha, 'DD/MM/YYYY');
    end if;
    if v_dest = (r->>'ambiente_id')::bigint then
      raise exception 'El % la clase debe ir a otro laboratorio (ese está ocupado).', to_char(v_fecha, 'DD/MM/YYYY');
    end if;
    insert into public.reubicaciones (asignacion_horario_id, fecha, ambiente_destino_id, aula_destino, motivo, reserva_id)
    values (v_hid, v_fecha, v_dest, case when v_dest is null then v_aula end,
            coalesce(left(nullif(trim(r->>'motivo'), ''), 300), 'El laboratorio está ocupado ese día'),
            nullif(r->>'reserva_id', '')::bigint)
    on conflict (asignacion_horario_id, fecha) do update set
      ambiente_destino_id = excluded.ambiente_destino_id,
      aula_destino        = excluded.aula_destino,
      motivo              = excluded.motivo,
      reserva_id          = excluded.reserva_id;
  end loop;

  return v_id;
end $$;

