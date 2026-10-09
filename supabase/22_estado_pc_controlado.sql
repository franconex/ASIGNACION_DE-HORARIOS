-- =====================================================================
--  SISTEMA DE ASIGNACIÓN DE LABORATORIOS — UPDS
--  Script 22: ESTADO DE LAS PCs CONTROLADO Y CON TICKET
--  - Solo ADMIN y ENCARGADO cambian el estado de una PC.
--  - Todo cambio de estado se hace con rpc_cambiar_estado_pcs, que deja un
--    ticket "Cambio de estado de PC" (resuelto) con quién lo cambió, de qué
--    estado a cuál y qué se reparó o por qué (obligatorio).
--  - La PC guarda su último cambio (quién, cuándo y el detalle).
--  Ejecutar en: Supabase > SQL Editor (después de 21).
-- =====================================================================

-- 1) Nuevo tipo de ticket
alter table public.atenciones drop constraint if exists atenciones_tipo_check;
alter table public.atenciones add constraint atenciones_tipo_check check (tipo in (
  'instalacion_software', 'mantenimiento_fisico', 'soporte_academico', 'problema', 'tarea', 'peticion', 'otro', 'cambio_estado'));

-- 2) Último cambio de estado de la PC
alter table public.ambiente_pcs add column if not exists estado_por uuid references public.perfiles(id) on delete set null;
alter table public.ambiente_pcs add column if not exists estado_en timestamptz;
alter table public.ambiente_pcs add column if not exists estado_detalle text;
create index if not exists ambiente_pcs_estado_por_idx on public.ambiente_pcs (estado_por);

-- 3) El estado solo cambia por la función (así siempre queda el ticket)
create or replace function public.fn_trg_pc_estado_controlado()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.estado <> 'operativa' and not public.fn_puede_gestionar_auxiliares() then
      raise exception 'Solo el administrador o el encargado pueden registrar una PC que no esté activa.';
    end if;
  elsif new.estado is distinct from old.estado
        and current_setting('app.cambio_estado_pc', true) is distinct from '1' then
    raise exception 'El estado de una PC se cambia desde el croquis (lo hace el administrador o el encargado y queda en un ticket).';
  end if;
  return new;
end $$;

drop trigger if exists trg_ambiente_pcs_estado on public.ambiente_pcs;
create trigger trg_ambiente_pcs_estado
  before insert or update of estado on public.ambiente_pcs
  for each row execute function public.fn_trg_pc_estado_controlado();

-- 4) Los tickets de cambio de estado no exigen que la PC esté activa
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
  if v_estado = 'baja' then
    raise exception 'La PC % está de baja: no se le pueden registrar tickets.', v_etiqueta;
  elsif v_estado is distinct from 'operativa' then
    raise exception 'La PC % está en %: pida al administrador o al encargado que la pase a Activa.', v_etiqueta, v_estado;
  end if;
  return new;
end $$;

-- 5) Cambia el estado de una o varias PCs y deja el ticket
create or replace function public.rpc_cambiar_estado_pcs(p_ids bigint[], p_estado text, p_detalle text)
returns integer language plpgsql set search_path = public as $$
declare
  v_detalle text := nullif(trim(p_detalle), '');
  v_lote    uuid;
  v_turno   bigint;
  v_n       integer := 0;
  pc        record;
  v_textos  constant jsonb := '{"operativa":"Activa","inactiva":"Inactiva","mantenimiento":"Mantenimiento","baja":"De baja"}';
begin
  if not public.fn_puede_gestionar_auxiliares() then
    raise exception 'Solo el administrador o el encargado pueden cambiar el estado de las PCs.';
  end if;
  if p_estado not in ('operativa', 'inactiva', 'mantenimiento', 'baja') then
    raise exception 'Estado de PC inválido.';
  end if;
  if v_detalle is null or char_length(v_detalle) < 3 then
    raise exception 'Escriba qué se reparó o el motivo del cambio.';
  end if;
  if char_length(v_detalle) > 300 then
    raise exception 'El detalle no puede pasar de 300 letras.';
  end if;

  select id into v_turno from public.turnos_trabajo where estado = 'abierto' order by abierto_en desc limit 1;
  if (select count(*) from public.ambiente_pcs where id = any (p_ids) and estado <> p_estado) > 1 then
    v_lote := gen_random_uuid();
  end if;

  perform set_config('app.cambio_estado_pc', '1', true);
  for pc in select * from public.ambiente_pcs where id = any (p_ids) and estado <> p_estado order by orden, etiqueta loop
    insert into public.atenciones (ambiente_id, pc_id, tipo, alcance, descripcion, solucion, prioridad, estado,
                                   resuelto_por, resuelto_en, lote, turno_trabajo_id)
    values (pc.ambiente_id, pc.id, 'cambio_estado', case when v_lote is null then 'individual' else 'grupal' end,
            format('%s: %s → %s', pc.etiqueta, v_textos->>pc.estado, v_textos->>p_estado),
            v_detalle, 2, 'resuelto', auth.uid(), now(), v_lote, v_turno);
    update public.ambiente_pcs set
      estado         = p_estado,
      motivo_baja    = case when p_estado = 'baja' then v_detalle end,
      estado_por     = auth.uid(),
      estado_en      = now(),
      estado_detalle = v_detalle
    where id = pc.id;
    v_n := v_n + 1;
  end loop;
  perform set_config('app.cambio_estado_pc', '', true);
  return v_n;
end $$;

revoke execute on function public.rpc_cambiar_estado_pcs(bigint[], text, text) from anon, public;
grant execute on function public.rpc_cambiar_estado_pcs(bigint[], text, text) to authenticated;
revoke execute on function public.fn_trg_pc_estado_controlado() from anon, authenticated, public;
