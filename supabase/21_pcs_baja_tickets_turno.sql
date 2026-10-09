-- =====================================================================
--  SISTEMA DE ASIGNACIÓN DE LABORATORIOS — UPDS
--  Script 21: BAJA CON MOTIVO, TICKETS SOLO EN PCs ACTIVAS Y TURNO REAL
--  - Dar de baja una PC exige el motivo (se guarda quién y cuándo).
--  - Un ticket solo se registra sobre PCs ACTIVAS: si está en
--    mantenimiento o inactiva, primero se pasa a Activa; de baja, nunca.
--  - El reporte de turno guarda en qué turno se hizo realmente
--    (según la hora de La Paz), además del turno que se reporta.
--  Ejecutar en: Supabase > SQL Editor (después de 20).
-- =====================================================================

-- 1) Motivo de baja de la PC
alter table public.ambiente_pcs add column if not exists motivo_baja text;
alter table public.ambiente_pcs add column if not exists baja_en timestamptz;
alter table public.ambiente_pcs add column if not exists baja_por uuid references public.perfiles(id) on delete set null;
create index if not exists ambiente_pcs_baja_por_idx on public.ambiente_pcs (baja_por);
alter table public.ambiente_pcs drop constraint if exists ambiente_pcs_motivo_baja_largo;
alter table public.ambiente_pcs add constraint ambiente_pcs_motivo_baja_largo check (char_length(motivo_baja) <= 300);

create or replace function public.fn_trg_pc_baja()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.estado = 'baja' then
    if tg_op = 'INSERT' or old.estado is distinct from 'baja' then
      new.motivo_baja := nullif(trim(new.motivo_baja), '');
      if new.motivo_baja is null then
        raise exception 'Indique el motivo para dar de baja %.', new.etiqueta;
      end if;
      new.baja_en  := now();
      new.baja_por := auth.uid();
    end if;
  else
    new.motivo_baja := null;
    new.baja_en     := null;
    new.baja_por    := null;
  end if;
  return new;
end $$;

drop trigger if exists trg_ambiente_pcs_baja on public.ambiente_pcs;
create trigger trg_ambiente_pcs_baja
  before insert or update of estado, motivo_baja on public.ambiente_pcs
  for each row execute function public.fn_trg_pc_baja();

-- 2) Tickets solo en PCs activas
create or replace function public.fn_trg_atencion_pc_activa()
returns trigger language plpgsql set search_path = public as $$
declare
  v_estado   text;
  v_etiqueta text;
begin
  if new.pc_id is null or (tg_op = 'UPDATE' and new.pc_id is not distinct from old.pc_id) then
    return new;
  end if;
  select estado, etiqueta into v_estado, v_etiqueta from public.ambiente_pcs where id = new.pc_id;
  if v_estado = 'baja' then
    raise exception 'La PC % está de baja: no se le pueden registrar tickets.', v_etiqueta;
  elsif v_estado is distinct from 'operativa' then
    raise exception 'La PC % está en %: cámbiela a Activa antes de registrar el ticket.', v_etiqueta, v_estado;
  end if;
  return new;
end $$;

drop trigger if exists trg_atenciones_pc_activa on public.atenciones;
create trigger trg_atenciones_pc_activa
  before insert or update of pc_id on public.atenciones
  for each row execute function public.fn_trg_atencion_pc_activa();

-- 3) Turno en que se hizo el reporte (por la hora de La Paz)
alter table public.reportes_turno add column if not exists turno_realizado text;

create or replace function public.fn_turno_de_hora(p_momento timestamptz)
returns text language sql stable set search_path = public as $$
  select case
           when extract(hour from p_momento at time zone 'America/La_Paz') < 11 then 'M'
           when extract(hour from p_momento at time zone 'America/La_Paz') < 14 then 'MD'
           when extract(hour from p_momento at time zone 'America/La_Paz') < 18 then 'T'
           else 'N'
         end;
$$;

create or replace function public.fn_trg_reporte_turno_realizado()
returns trigger language plpgsql set search_path = public as $$
begin
  new.turno_realizado := public.fn_turno_de_hora(coalesce(new.creado_en, now()));
  return new;
end $$;

drop trigger if exists trg_reportes_turno_realizado on public.reportes_turno;
create trigger trg_reportes_turno_realizado
  before insert on public.reportes_turno
  for each row execute function public.fn_trg_reporte_turno_realizado();

update public.reportes_turno set turno_realizado = public.fn_turno_de_hora(creado_en) where turno_realizado is null;

revoke execute on function public.fn_trg_pc_baja(), public.fn_trg_atencion_pc_activa(),
  public.fn_trg_reporte_turno_realizado() from anon, authenticated, public;
