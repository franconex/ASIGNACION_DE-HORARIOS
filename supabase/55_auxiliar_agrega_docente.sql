-- =====================================================================
--  SISTEMA DE ASIGNACIÓN DE LABORATORIOS — UPDS
--  Script 55: EL AUXILIAR AGREGA DOCENTES DESDE ATENCIONES
--  - En Atenciones, si el docente que pide ayuda no está en la lista,
--    el auxiliar lo registra con el mismo formulario de Docentes.
--  - Solo puede AGREGAR (docente y sus facultades); editar y eliminar
--    docentes sigue siendo de admin, decano y encargado.
--  Ejecutar en: Supabase > SQL Editor (después de 54).
-- =====================================================================

drop policy if exists docentes_crear on public.docentes;
create policy docentes_crear on public.docentes for insert to authenticated
  with check (public.fn_puede_editar() or public.fn_puede_operar());

drop policy if exists docente_carreras_crear on public.docente_carreras;
create policy docente_carreras_crear on public.docente_carreras for insert to authenticated
  with check (public.fn_puede_editar() or public.fn_puede_operar());
