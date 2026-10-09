-- =====================================================================
--  SISTEMA DE ASIGNACIÓN DE LABORATORIOS — UPDS
--  Script 23: TICKETS EN 3 CATEGORÍAS + SOLICITUD DE BAJA
--  Categorías y tipos (columna atenciones.tipo):
--    1. Atención a docente ........ 'docente'
--    2. Técnico
--       - Programas ............... 'programas'
--       - Mant. preventivo ........ 'preventivo'
--       - Mant. correctivo ........ 'correctivo'
--    3. Atención personal ......... 'personal'  (académica)
--    (+ 'cambio_estado', automático)
--  Los datos propios de cada formulario van en atenciones.detalles (jsonb).
--  - Los tickets viejos pasan a los tipos nuevos.
--  - El auxiliar puede cambiar el estado de una PC (reparar, mandar a
--    mantenimiento); DAR DE BAJA solo admin/encargado. El auxiliar SOLICITA
--    la baja y el encargado la aprueba o rechaza.
--  - Correctivo: se puede hacer sobre PCs en mantenimiento o inactivas.
--  Ejecutar en: Supabase > SQL Editor (después de 22).
-- =====================================================================

-- 1) Tipos nuevos (y los tickets viejos pasan a ellos)
alter table public.atenciones drop constraint if exists atenciones_tipo_check;
update public.atenciones set tipo = case tipo
    when 'instalacion_software' then 'programas'
    when 'mantenimiento_fisico' then 'correctivo'
    when 'problema'             then 'correctivo'
    when 'tarea'                then 'correctivo'
    when 'otro'                 then 'correctivo'
    when 'soporte_academico'    then 'personal'
    when 'peticion'             then 'docente'
    else tipo end;
alter table public.atenciones alter column tipo set default 'docente';
alter table public.atenciones add constraint atenciones_tipo_check
  check (tipo in ('docente', 'programas', 'preventivo', 'correctivo', 'personal', 'cambio_estado'));

alter table public.atenciones add column if not exists detalles jsonb not null default '{}'::jsonb;
alter table public.atenciones drop constraint if exists atenciones_detalles_check;
alter table public.atenciones add constraint atenciones_detalles_check
  check (jsonb_typeof(detalles) = 'object' and pg_column_size(detalles) <= 4000);

-- 2) PCs válidas para cada tipo de ticket
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
  end if;
  -- El correctivo es justamente para PCs que fallan
  if new.tipo <> 'correctivo' and v_estado is distinct from 'operativa' then
    raise exception 'La PC % está en %: use un mantenimiento correctivo o pásela a Activa primero.', v_etiqueta, v_estado;
  end if;
  return new;
end $$;

-- 3) Estado de PCs: el personal de operación cambia; dar de baja, solo admin/encargado.
--    p_ticket = false cuando el cambio ya queda en otro ticket (ej. un correctivo).
drop function if exists public.rpc_cambiar_estado_pcs(bigint[], text, text);
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
  if p_estado = 'baja' and not public.fn_puede_gestionar_auxiliares() then
    raise exception 'Solo el administrador o el encargado pueden dar de baja una PC. Use "Solicitar baja".';
  end if;
  if p_estado not in ('operativa', 'inactiva', 'mantenimiento', 'baja') then
    raise exception 'Estado de PC inválido.';
  end if;
  if v_detalle is null or char_length(v_detalle) < 3 then
    raise exception 'Escriba qué se reparó o el motivo del cambio.';
  end if;
  v_detalle := left(v_detalle, 300);
  if exists (select 1 from public.ambiente_pcs where id = any (p_ids) and estado = 'baja' and p_estado <> 'baja')
     and not public.fn_puede_gestionar_auxiliares() then
    raise exception 'Solo el administrador o el encargado pueden reactivar una PC dada de baja.';
  end if;

  select id into v_turno from public.turnos_trabajo where estado = 'abierto' order by abierto_en desc limit 1;
  if (select count(*) from public.ambiente_pcs where id = any (p_ids) and estado <> p_estado) > 1 then
    v_lote := gen_random_uuid();
  end if;

  perform set_config('app.cambio_estado_pc', '1', true);
  for pc in select * from public.ambiente_pcs where id = any (p_ids) and estado <> p_estado order by orden, etiqueta loop
    if p_ticket then
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
  -- Al dar de baja, se cierran las solicitudes pendientes de esas PCs
  if p_estado = 'baja' then
    update public.solicitudes_baja set estado = 'aprobada', resuelto_por = auth.uid(), resuelto_en = now()
     where pc_id = any (p_ids) and estado = 'pendiente';
  end if;
  perform set_config('app.cambio_estado_pc', '', true);
  return v_n;
end $$;

revoke execute on function public.rpc_cambiar_estado_pcs(bigint[], text, text, boolean) from anon, public;
grant execute on function public.rpc_cambiar_estado_pcs(bigint[], text, text, boolean) to authenticated;

-- Una PC nueva puede entrar en mantenimiento/inactiva (personal de operación); de baja, solo admin/encargado
create or replace function public.fn_trg_pc_estado_controlado()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.estado = 'baja' and not public.fn_puede_gestionar_auxiliares() then
      raise exception 'Solo el administrador o el encargado pueden registrar una PC de baja.';
    end if;
  elsif new.estado is distinct from old.estado
        and current_setting('app.cambio_estado_pc', true) is distinct from '1' then
    raise exception 'El estado de una PC se cambia desde el croquis o con un mantenimiento correctivo (queda en un ticket).';
  end if;
  return new;
end $$;

-- 4) Solicitudes de baja (el auxiliar pide, el encargado aprueba o rechaza)
create table if not exists public.solicitudes_baja (
  id             bigint generated always as identity primary key,
  pc_id          bigint not null references public.ambiente_pcs(id) on delete cascade,
  atencion_id    bigint references public.atenciones(id) on delete set null,
  motivo         text not null check (char_length(trim(motivo)) between 3 and 300),
  estado         text not null default 'pendiente' check (estado in ('pendiente', 'aprobada', 'rechazada')),
  solicitado_por uuid default auth.uid() references public.perfiles(id) on delete set null,
  solicitado_en  timestamptz not null default now(),
  resuelto_por   uuid references public.perfiles(id) on delete set null,
  resuelto_en    timestamptz,
  respuesta      text check (respuesta is null or char_length(respuesta) <= 300)
);
create unique index if not exists solicitudes_baja_pendiente_uk on public.solicitudes_baja (pc_id) where estado = 'pendiente';
create index if not exists solicitudes_baja_atencion_idx on public.solicitudes_baja (atencion_id);
create index if not exists solicitudes_baja_solicitado_idx on public.solicitudes_baja (solicitado_por);
create index if not exists solicitudes_baja_resuelto_idx on public.solicitudes_baja (resuelto_por);

alter table public.solicitudes_baja enable row level security;
drop policy if exists solicitudes_baja_ver on public.solicitudes_baja;
create policy solicitudes_baja_ver on public.solicitudes_baja for select to authenticated using (public.fn_puede_ver());
drop policy if exists solicitudes_baja_crear on public.solicitudes_baja;
create policy solicitudes_baja_crear on public.solicitudes_baja for insert to authenticated
  with check (public.fn_puede_operar() and estado = 'pendiente');
drop policy if exists solicitudes_baja_resolver on public.solicitudes_baja;
create policy solicitudes_baja_resolver on public.solicitudes_baja for update to authenticated
  using (public.fn_puede_gestionar_auxiliares()) with check (public.fn_puede_gestionar_auxiliares());
drop policy if exists solicitudes_baja_borrar on public.solicitudes_baja;
create policy solicitudes_baja_borrar on public.solicitudes_baja for delete to authenticated
  using (public.fn_puede_gestionar_auxiliares());
revoke all on public.solicitudes_baja from anon;

-- Aprobar (da de baja con el motivo pedido) o rechazar una solicitud
create or replace function public.rpc_resolver_baja(p_id bigint, p_aprobar boolean, p_respuesta text default null)
returns void language plpgsql set search_path = public as $$
declare
  s record;
begin
  if not public.fn_puede_gestionar_auxiliares() then
    raise exception 'Solo el administrador o el encargado resuelven las solicitudes de baja.';
  end if;
  select * into s from public.solicitudes_baja where id = p_id and estado = 'pendiente' for update;
  if not found then
    raise exception 'La solicitud ya fue resuelta.';
  end if;
  if p_aprobar then
    perform public.rpc_cambiar_estado_pcs(array[s.pc_id], 'baja',
      coalesce(nullif(trim(p_respuesta), ''), s.motivo));
  else
    if nullif(trim(p_respuesta), '') is null then
      raise exception 'Escriba por qué se rechaza la baja.';
    end if;
  end if;
  update public.solicitudes_baja set
    estado = case when p_aprobar then 'aprobada' else 'rechazada' end,
    resuelto_por = auth.uid(), resuelto_en = now(),
    respuesta = nullif(trim(p_respuesta), '')
  where id = p_id;
end $$;

revoke execute on function public.rpc_resolver_baja(bigint, boolean, text) from anon, public;
grant execute on function public.rpc_resolver_baja(bigint, boolean, text) to authenticated;
