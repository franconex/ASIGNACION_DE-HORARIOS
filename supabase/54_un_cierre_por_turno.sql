-- =====================================================================
--  SISTEMA DE ASIGNACIÓN DE LABORATORIOS — UPDS
--  Script 54: UN SOLO CIERRE POR TURNO
--  - Cada turno (Mañana, Mediodía, Tarde, Noche) se cierra una sola vez
--    por día: si un auxiliar o el encargado ya lo cerró, a los demás se
--    les avisa quién lo cerró y no se guarda un segundo cierre.
--  - Vale también al editar un reporte y cambiarle el turno.
--  Ejecutar en: Supabase > SQL Editor (después de 53).
-- =====================================================================

-- 1) Aviso claro: quién y a qué hora cerró ese turno
create or replace function public.fn_trg_reporte_unico_turno()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  previo record;
begin
  if tg_op = 'UPDATE' and new.turno is not distinct from old.turno and new.fecha is not distinct from old.fecha then
    return new;
  end if;
  select r.creado_en, p.nombre_completo into previo
    from public.reportes_turno r left join public.perfiles p on p.id = r.auxiliar_id
   where r.fecha = new.fecha and r.turno = new.turno and r.id is distinct from new.id
   limit 1;
  if found then
    raise exception 'El turno % de este día ya fue cerrado por % a las %. No hace falta cerrarlo de nuevo.',
      case new.turno when 'M' then 'Mañana' when 'MD' then 'Mediodía' when 'T' then 'Tarde' else 'Noche' end,
      coalesce(previo.nombre_completo, 'otro usuario'),
      to_char(previo.creado_en at time zone 'America/La_Paz', 'HH24:MI');
  end if;
  return new;
end $$;

drop trigger if exists trg_reportes_turno_unico on public.reportes_turno;
create trigger trg_reportes_turno_unico
  before insert or update on public.reportes_turno
  for each row execute function public.fn_trg_reporte_unico_turno();

revoke execute on function public.fn_trg_reporte_unico_turno() from anon, authenticated, public;

-- 2) Respaldo: si dos cierran al mismo segundo, la base solo acepta uno
create unique index if not exists reportes_turno_fecha_turno_unico on public.reportes_turno (fecha, turno);
