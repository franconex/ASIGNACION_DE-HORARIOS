-- =====================================================================
--  SISTEMA DE ASIGNACIÓN DE LABORATORIOS — UPDS
--  Script 40: TICKETS "ABRIR LAB" Y "CERRAR LAB"
--  - Tipos nuevos de ticket: 'apertura_lab' y 'cierre_lab'.
--  - Al elegir el laboratorio se marcan todas sus PCs activas: un ticket
--    por PC unidos por el mismo lote (igual que los demás tickets).
--  Ejecutar en: Supabase > SQL Editor (después de 39).
-- =====================================================================

alter table public.atenciones drop constraint if exists atenciones_tipo_check;
alter table public.atenciones add constraint atenciones_tipo_check
  check (tipo in ('docente', 'programas', 'preventivo', 'correctivo', 'personal', 'cambio_estado',
                  'apertura_lab', 'cierre_lab'));
