-- =====================================================================
--  SISTEMA DE ASIGNACIÓN DE LABORATORIOS — UPDS
--  Script 37: "MATERIAS QUE DICTA" SE ANOTA SOLA
--  - Ya no se cargan a mano en la ficha del docente: cada vez que se
--    guarda una asignación, su docente queda anotado como que dicta esa
--    materia (es lo que muestra la ★ al elegir materia).
--  - Lo hace la base (trigger), así vale también para cargas masivas.
--  Ejecutar en: Supabase > SQL Editor (después de 36).
-- =====================================================================

create or replace function public.fn_trg_asignacion_docente_materia()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.docente_materias (docente_id, materia_id)
  values (new.docente_id, new.materia_id)
  on conflict do nothing;
  return new;
end $$;
revoke execute on function public.fn_trg_asignacion_docente_materia() from anon, authenticated, public;

drop trigger if exists trg_asignacion_docente_materia on public.asignaciones;
create trigger trg_asignacion_docente_materia
  after insert or update of docente_id, materia_id on public.asignaciones
  for each row execute function public.fn_trg_asignacion_docente_materia();
