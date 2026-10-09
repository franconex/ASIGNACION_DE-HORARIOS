-- =====================================================================
--  SISTEMA DE ASIGNACIÓN DE LABORATORIOS — UPDS
--  Script 08: INVENTARIO DE PCs POR LABORATORIO
--  Cada fila = una PC de un laboratorio, con su estado y características.
--  Ejecutar en: Supabase > SQL Editor (después de 01–03).
-- =====================================================================
create table public.ambiente_pcs (
  id             bigint generated always as identity primary key,
  ambiente_id    bigint      not null references public.ambientes(id) on delete cascade,
  etiqueta       text        not null,                 -- "PC-01", "#12"
  procesador     text,                                 -- CPU (ej. Core i5)
  ram            text,                                  -- ej. "8 GB"
  almacenamiento text,                                  -- ej. "256 GB SSD"
  estado         text        not null default 'operativa'
                 check (estado in ('operativa', 'dañada', 'baja')),
  notas          text,
  orden          integer     not null default 0,
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
create index ambiente_pcs_ambiente_idx on public.ambiente_pcs (ambiente_id, orden);

comment on table public.ambiente_pcs is 'Inventario de PCs (equipos) de cada laboratorio.';

create trigger trg_ambiente_pcs_actualizado
  before update on public.ambiente_pcs
  for each row execute function public.fn_set_actualizado_en();

-- ---------------------------------------------------------------------
-- Seguridad: leen los usuarios activos; escriben admin y auxiliar
-- ---------------------------------------------------------------------
alter table public.ambiente_pcs enable row level security;

create policy ambiente_pcs_ver    on public.ambiente_pcs for select to authenticated using (public.fn_puede_ver());
create policy ambiente_pcs_crear  on public.ambiente_pcs for insert to authenticated with check (public.fn_puede_editar());
create policy ambiente_pcs_editar on public.ambiente_pcs for update to authenticated using (public.fn_puede_editar()) with check (public.fn_puede_editar());
create policy ambiente_pcs_borrar on public.ambiente_pcs for delete to authenticated using (public.fn_puede_editar());

revoke all on public.ambiente_pcs from anon;
