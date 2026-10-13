-- =====================================================================
--  SISTEMA DE ASIGNACIÓN DE LABORATORIOS — UPDS
--  Script 51: SOFTWARE ES SOLO EL CATÁLOGO
--  - "software" es la lista de programas e ISOs que se manejan en los
--    laboratorios: en el ticket se busca, se marca y, si no está, se
--    agrega. No se lleva qué tiene instalado cada laboratorio.
--  - Se quitan laboratorio_software y el trigger que la actualizaba con
--    los tickets (scripts 48 y 50).
--  - El dashboard (fn_dashboard_software) no cambia: cuenta pedidos
--    (tickets de docente) e instalaciones (tickets de Programas) desde
--    los tickets.
--  Ejecutar en: Supabase > SQL Editor (después de 50).
-- =====================================================================

drop trigger if exists trg_atenciones_software on public.atenciones;
drop function if exists public.fn_trg_ticket_software();
drop table if exists public.laboratorio_software;
