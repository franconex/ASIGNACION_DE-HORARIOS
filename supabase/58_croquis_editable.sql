-- =====================================================================
--  SISTEMA DE ASIGNACIÓN DE LABORATORIOS — UPDS
--  Script 58: CROQUIS EDITABLE (acomodar las PCs arrastrando)
--  - El plano de cada laboratorio es una cuadrícula de filas × columnas.
--  - Cada PC guarda su casilla (croquis_fila, croquis_columna); si está
--    vacía, la PC queda "sin ubicar".
--  - Un laboratorio sin acomodo guardado (croquis_columnas nulo) se sigue
--    dibujando con la regla de siempre: mesas de 4 PCs, 4 mesas por fila.
--  - La PC del docente tiene su zona propia (a la izquierda): solo guarda en
--    qué fila de esa zona está (croquis_fila; croquis_columna queda en 0).
--  - Solo el administrador y el encargado guardan el acomodo.
--  Ejecutar en: Supabase > SQL Editor (después de 57).
-- =====================================================================

-- 1) Tamaño de la cuadrícula de cada laboratorio
alter table public.ambientes add column if not exists croquis_filas    smallint;
alter table public.ambientes add column if not exists croquis_columnas smallint;
alter table public.ambientes drop constraint if exists ambientes_croquis_tamano_check;
alter table public.ambientes add constraint ambientes_croquis_tamano_check check (
  (croquis_filas is null and croquis_columnas is null)
  or (croquis_filas between 1 and 40 and croquis_columnas between 1 and 40));

-- 2) Casilla de cada PC
alter table public.ambiente_pcs add column if not exists croquis_fila    smallint;
alter table public.ambiente_pcs add column if not exists croquis_columna smallint;
alter table public.ambiente_pcs drop constraint if exists ambiente_pcs_croquis_casilla_check;
alter table public.ambiente_pcs add constraint ambiente_pcs_croquis_casilla_check check (
  (croquis_fila is null and croquis_columna is null)
  or (croquis_fila >= 0 and croquis_columna >= 0));

-- Dos PCs de alumnos no pueden estar en la misma casilla (la docente va aparte)
drop index if exists public.ambiente_pcs_croquis_casilla_uq;
create unique index ambiente_pcs_croquis_casilla_uq
  on public.ambiente_pcs (ambiente_id, croquis_fila, croquis_columna)
  where croquis_fila is not null and not es_docente;

-- 3) Guarda el acomodo completo de un laboratorio de una sola vez
--    p_posiciones: [{"pc_id": 12, "fila": 0, "columna": 3}, ...]
--    Las PCs del laboratorio que no vengan en la lista quedan sin ubicar.
--    p_docente_fila: fila de la PC docente en su zona (null si no hay).
drop function if exists public.rpc_guardar_croquis(bigint, integer, integer, jsonb);
create or replace function public.rpc_guardar_croquis(
  p_ambiente_id bigint, p_filas integer, p_columnas integer, p_posiciones jsonb, p_docente_fila integer default null)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_n integer := 0;
begin
  if not public.fn_puede_gestionar_auxiliares() then
    raise exception 'Solo el administrador o el encargado pueden acomodar el croquis.';
  end if;
  if p_filas not between 1 and 40 or p_columnas not between 1 and 40 then
    raise exception 'El croquis debe tener entre 1 y 40 filas y columnas.';
  end if;
  if jsonb_typeof(coalesce(p_posiciones, '[]'::jsonb)) <> 'array' then
    raise exception 'Posiciones inválidas.';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(coalesce(p_posiciones, '[]'::jsonb)) as x(pc_id bigint, fila integer, columna integer)
     where x.fila is null or x.columna is null or x.fila not between 0 and p_filas - 1 or x.columna not between 0 and p_columnas - 1
  ) then
    raise exception 'Hay PCs fuera de la cuadrícula.';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(coalesce(p_posiciones, '[]'::jsonb)) as x(pc_id bigint, fila integer, columna integer)
      left join public.ambiente_pcs p on p.id = x.pc_id and p.ambiente_id = p_ambiente_id and not p.es_docente
     where p.id is null
  ) then
    raise exception 'Hay PCs que no son de este laboratorio.';
  end if;
  if p_docente_fila is not null and p_docente_fila not between 0 and p_filas - 1 then
    raise exception 'La PC docente está fuera del croquis.';
  end if;

  update public.ambientes set croquis_filas = p_filas, croquis_columnas = p_columnas where id = p_ambiente_id;
  if not found then raise exception 'El laboratorio no existe.'; end if;

  -- Primero se vacían todas las casillas (así se pueden intercambiar PCs sin chocar)
  update public.ambiente_pcs set croquis_fila = null, croquis_columna = null
   where ambiente_id = p_ambiente_id and croquis_fila is not null;

  update public.ambiente_pcs p set croquis_fila = x.fila, croquis_columna = x.columna
    from jsonb_to_recordset(p_posiciones) as x(pc_id bigint, fila integer, columna integer)
   where p.id = x.pc_id and p.ambiente_id = p_ambiente_id;
  get diagnostics v_n = row_count;

  -- PC docente: fila dentro de su zona
  update public.ambiente_pcs set croquis_fila = p_docente_fila, croquis_columna = case when p_docente_fila is null then null else 0 end
   where ambiente_id = p_ambiente_id and es_docente;
  return v_n;
end $$;

revoke execute on function public.rpc_guardar_croquis(bigint, integer, integer, jsonb, integer) from anon, public;
grant execute on function public.rpc_guardar_croquis(bigint, integer, integer, jsonb, integer) to authenticated;
