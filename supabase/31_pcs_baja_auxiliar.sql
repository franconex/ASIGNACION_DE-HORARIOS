-- =====================================================================
--  SISTEMA DE ASIGNACIÓN DE LABORATORIOS — UPDS
--  Script 31: BAJA DE PCs POR AUXILIARES + CIERRE DE TURNO
--  - ELIMINAR una PC del inventario: solo admin y encargado.
--  - Cambiar estado y DAR DE BAJA: cualquier personal de operación
--    (auxiliar incluido), siempre con motivo. Ya no hace falta pedir la baja.
--  - Una PC de baja puede recibir un mantenimiento CORRECTIVO (para
--    repararla). Cuando una PC sale de baja SIEMPRE queda un ticket
--    "Cambio de estado de PC" (De baja → Activa…).
--  - El cierre de turno guarda solo las PCs que su autor dio de baja
--    durante ese turno (pcs_baja).
--  Ejecutar en: Supabase > SQL Editor (después de 30).
-- =====================================================================

-- 1) Eliminar PCs: solo admin y encargado
drop policy if exists ambiente_pcs_borrar on public.ambiente_pcs;
create policy ambiente_pcs_borrar on public.ambiente_pcs for delete to authenticated
  using (public.fn_puede_gestionar_auxiliares());

-- 2) Tickets en PCs de baja: solo el correctivo (para repararla)
create or replace function public.fn_trg_atencion_pc_activa()
returns trigger language plpgsql set search_path = public as $$
declare
  v_estado   text;
  v_etiqueta text;
begin
  if new.pc_id is null or new.tipo = 'cambio_estado'
     or (tg_op = 'UPDATE' and new.pc_id is not distinct from old.pc_id) then
    return new;
  end if;
  select estado, etiqueta into v_estado, v_etiqueta from public.ambiente_pcs where id = new.pc_id;
  if new.tipo <> 'correctivo' and v_estado = 'baja' then
    raise exception 'La PC % está de baja: solo se le puede registrar un mantenimiento correctivo (para repararla).', v_etiqueta;
  end if;
  if new.tipo <> 'correctivo' and v_estado is distinct from 'operativa' then
    raise exception 'La PC % está en %: use un mantenimiento correctivo o pásela a Activa primero.', v_etiqueta, v_estado;
  end if;
  return new;
end $$;

-- 3) Cambio de estado: cualquier personal de operación; salir de baja siempre deja ticket
create or replace function public.rpc_cambiar_estado_pcs(p_ids bigint[], p_estado text, p_detalle text, p_ticket boolean default true)
returns integer language plpgsql set search_path = public as $$
declare
  v_detalle text := nullif(trim(p_detalle), '');
  v_lote    uuid;
  v_turno   bigint;
  v_n       integer := 0;
  pc        record;
  v_textos  constant jsonb := '{"operativa":"Activa","inactiva":"Inactiva","mantenimiento":"Mantenimiento","baja":"De baja"}';
begin
  if not public.fn_puede_operar() then
    raise exception 'No tiene permiso para cambiar el estado de las PCs.';
  end if;
  if p_estado not in ('operativa', 'inactiva', 'mantenimiento', 'baja') then
    raise exception 'Estado de PC inválido.';
  end if;
  if coalesce(cardinality(p_ids), 0) = 0 then
    raise exception 'Elija al menos una PC.';
  end if;
  if v_detalle is null or char_length(v_detalle) < 3 then
    raise exception '%', case when p_estado = 'baja' then 'Escriba el motivo de la baja (al menos 3 letras).'
                              else 'Escriba qué se reparó o el motivo del cambio (al menos 3 letras).' end;
  end if;
  v_detalle := left(v_detalle, 300);

  select id into v_turno from public.turnos_trabajo where estado = 'abierto' order by abierto_en desc limit 1;
  if (select count(*) from public.ambiente_pcs where id = any (p_ids) and estado <> p_estado) > 1 then
    v_lote := gen_random_uuid();
  end if;

  perform set_config('app.cambio_estado_pc', '1', true);
  for pc in select * from public.ambiente_pcs where id = any (p_ids) and estado <> p_estado order by orden, etiqueta loop
    -- Salir de baja siempre queda registrado como ticket propio
    if p_ticket or pc.estado = 'baja' then
      insert into public.atenciones (ambiente_id, pc_id, tipo, alcance, descripcion, solucion, prioridad, estado,
                                     resuelto_por, resuelto_en, lote, turno_trabajo_id)
      values (pc.ambiente_id, pc.id, 'cambio_estado', case when v_lote is null then 'individual' else 'grupal' end,
              format('%s: %s → %s', pc.etiqueta, v_textos->>pc.estado, v_textos->>p_estado),
              v_detalle, 2, 'resuelto', auth.uid(), now(), v_lote, v_turno);
    end if;
    update public.ambiente_pcs set
      estado         = p_estado,
      motivo_baja    = case when p_estado = 'baja' then v_detalle end,
      estado_por     = auth.uid(),
      estado_en      = now(),
      estado_detalle = v_detalle
    where id = pc.id;
    v_n := v_n + 1;
  end loop;
  -- Dar de baja cierra las solicitudes de baja que hubiera pendientes
  if p_estado = 'baja' then
    update public.solicitudes_baja set estado = 'aprobada', resuelto_por = auth.uid(), resuelto_en = now()
     where pc_id = any (p_ids) and estado = 'pendiente';
  end if;
  perform set_config('app.cambio_estado_pc', '', true);
  return v_n;
end $$;

revoke execute on function public.rpc_cambiar_estado_pcs(bigint[], text, text, boolean) from anon, public;
grant execute on function public.rpc_cambiar_estado_pcs(bigint[], text, text, boolean) to authenticated;

-- 4) Cierre de turno: PCs que su autor dio de baja durante el turno
alter table public.reportes_turno add column if not exists pcs_baja jsonb not null default '[]'::jsonb;

create or replace function public.fn_trg_reporte_pcs_baja()
returns trigger language plpgsql set search_path = public as $$
declare v_desde timestamptz;
begin
  if tg_op = 'UPDATE' then
    new.pcs_baja := old.pcs_baja;
    return new;
  end if;
  -- Desde el inicio del turno (lo pone trg_reportes_turno_horario, que corre antes)
  v_desde := (new.fecha + coalesce(new.hora_inicio_turno, time '00:00')) at time zone 'America/La_Paz';
  select coalesce(jsonb_agg(jsonb_build_object(
           'etiqueta', p.etiqueta, 'lab', am.codigo,
           'motivo', coalesce(p.motivo_baja, p.estado_detalle), 'en', p.estado_en) order by p.estado_en), '[]'::jsonb)
    into new.pcs_baja
    from public.ambiente_pcs p
    left join public.ambientes am on am.id = p.ambiente_id
   where p.estado = 'baja'
     and p.estado_por = coalesce(new.auxiliar_id, auth.uid())
     and p.estado_en >= v_desde
     and p.estado_en <= coalesce(new.creado_en, now());
  return new;
end $$;

drop trigger if exists trg_reportes_turno_pcs_baja on public.reportes_turno;
create trigger trg_reportes_turno_pcs_baja before insert or update on public.reportes_turno
  for each row execute function public.fn_trg_reporte_pcs_baja();

revoke execute on function public.fn_trg_reporte_pcs_baja() from anon, authenticated, public;
