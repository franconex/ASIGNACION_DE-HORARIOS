-- =====================================================================
--  SISTEMA DE ASIGNACIÓN DE LABORATORIOS — UPDS
--  Script 44: FOTOS DE CIERRE 30 DÍAS
--  - La foto del cierre de turno dura 30 días desde que se sube (antes
--    vencía a las 12:00 siguientes). Las que aún existen pasan a durar
--    30 días desde su cierre.
--  Ejecutar en: Supabase > SQL Editor (después de 43).
-- =====================================================================

-- 1) Foto del cierre: 30 días desde la subida
create or replace function public.fn_trg_reporte_foto()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.foto_path is null then
    new.foto_expira := null;
  elsif tg_op = 'INSERT' or new.foto_path is distinct from old.foto_path then
    new.foto_expira := now() + interval '30 days';
  else
    new.foto_expira := old.foto_expira;
  end if;
  return new;
end $$;

update public.reportes_turno
   set foto_expira = greatest(foto_expira, coalesce(actualizado_en, creado_en) + interval '30 days')
 where foto_path is not null;
