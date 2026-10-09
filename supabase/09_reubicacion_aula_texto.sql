-- =====================================================================
--  SISTEMA DE ASIGNACIÓN DE LABORATORIOS — UPDS
--  Script 09: aula destino por TEXTO en la reubicación de clases.
--  Al crear un evento sobre un laboratorio ocupado, la clase afectada puede
--  moverse a otro laboratorio (controlado) o a un aula registrada SOLO como
--  texto (no se controla su ocupación), igual que ya hace la cesión.
--    ambiente_destino_id    -> movida a ese laboratorio
--    aula_destino (texto)   -> movida a ese aula (no controlada)
--    ambos nulos            -> clase suspendida ese día
-- =====================================================================
alter table public.reubicaciones add column if not exists aula_destino text;

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
