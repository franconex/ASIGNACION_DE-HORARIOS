-- =====================================================================
--  SISTEMA DE ASIGNACIÓN DE LABORATORIOS — UPDS
--  Script 14: COLABORADORES EN LOS TICKETS
--  Un ticket lo registra un auxiliar (auxiliar_id) y lo pueden haber
--  hecho otros más: se guardan en "colaboradores" (lista de perfiles).
--  Ejecutar en: Supabase > SQL Editor (después de 13).
-- =====================================================================
alter table public.atenciones add column if not exists colaboradores uuid[] not null default '{}';

-- Para buscar rápido "tickets en los que participó X"
create index if not exists atenciones_colaboradores_idx on public.atenciones using gin (colaboradores);

comment on column public.atenciones.colaboradores is 'Otros auxiliares que ayudaron con el ticket (además de quien lo registró).';
