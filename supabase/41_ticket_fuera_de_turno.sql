-- =====================================================================
--  Script 41: TICKET FUERA DE TURNO
--  - Cada ticket guarda si el auxiliar que lo registró estaba fuera de su
--    turno (hora de La Paz, según su turno del día: sábado incluido).
--  - Lo calcula la base al crear el ticket (no se puede tocar desde la app).
--  - Solo aplica al rol auxiliar: admin y encargado trabajan en cualquier turno.
--  - Se recalcula para los tickets ya registrados.
-- =====================================================================

alter table public.atenciones
  add column if not exists fuera_de_turno boolean not null default false;

comment on column public.atenciones.fuera_de_turno is
  'true si el auxiliar registró el ticket fuera de su turno del día (lo calcula la base).';

-- ¿Este momento cae fuera del turno de esa persona? (null si no es auxiliar)
create or replace function public.fn_fuera_de_turno(p_perfil uuid, p_momento timestamptz)
returns boolean
language sql
stable
set search_path = public
as $$
  with l as (select (p_momento at time zone 'America/La_Paz') as t),
       x as (select public.fn_turno_del_dia(p_perfil, l.t::date) as turno, l.t::time as hora from l)
  select case
    when (select rol from public.perfiles where id = p_perfil) is distinct from 'auxiliar' then false
    when x.turno is null then true
    else not exists (select 1 from public.horarios_turno h
                      where h.turno = x.turno and x.hora >= h.hora_inicio and x.hora < h.hora_fin)
  end
  from x;
$$;

create or replace function public.fn_trg_atencion_fuera_de_turno()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.fuera_de_turno := coalesce(public.fn_fuera_de_turno(new.auxiliar_id, coalesce(new.creado_en, now())), false);
  else
    new.fuera_de_turno := old.fuera_de_turno;
  end if;
  return new;
end $$;

-- Solo la usa el trigger: nadie la llama como RPC
revoke execute on function public.fn_trg_atencion_fuera_de_turno() from public, anon, authenticated;

drop trigger if exists trg_atenciones_fuera_de_turno on public.atenciones;
create trigger trg_atenciones_fuera_de_turno
  before insert or update of fuera_de_turno on public.atenciones
  for each row execute function public.fn_trg_atencion_fuera_de_turno();

-- Tickets ya registrados (los triggers se apagan un momento: el de fuera de
-- turno no deja cambiarlo y el de actualizado_en movería la fecha de todos)
alter table public.atenciones disable trigger trg_atenciones_fuera_de_turno;
alter table public.atenciones disable trigger trg_atenciones_actualizado;
update public.atenciones a
   set fuera_de_turno = coalesce(public.fn_fuera_de_turno(a.auxiliar_id, a.creado_en), false)
 where a.auxiliar_id is not null;
alter table public.atenciones enable trigger trg_atenciones_fuera_de_turno;
alter table public.atenciones enable trigger trg_atenciones_actualizado;
