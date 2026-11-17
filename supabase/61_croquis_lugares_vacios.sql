-- =====================================================================
--  SISTEMA DE ASIGNACIÓN DE LABORATORIOS — UPDS
--  Script 61: LUGARES VACÍOS EN EL CROQUIS
--  - Al acomodar se pueden marcar casillas como "lugar vacío": un puesto
--    de la mesa sin PC (ej. mesa de 4 lugares con 3 PCs y un espacio).
--  - El lugar vacío NO corta la mesa y conserva el tamaño de un puesto
--    (una casilla vacía común sigue siendo pasillo / separación).
--  - Se guardan en ambientes.croquis_huecos: [[fila, columna], ...]
--  - rpc_guardar_croquis recibe además p_huecos.
--  Ejecutar en: Supabase > SQL Editor (después de 60).
-- =====================================================================

-- 1) Lugares vacíos de cada laboratorio
alter table public.ambientes add column if not exists croquis_huecos jsonb not null default '[]'::jsonb;
alter table public.ambientes drop constraint if exists ambientes_croquis_huecos_check;
alter table public.ambientes add constraint ambientes_croquis_huecos_check check (jsonb_typeof(croquis_huecos) = 'array');

-- 2) Guardar el croquis (igual que en el script 59, más los lugares vacíos)
--    Se quita la versión anterior: con el parámetro nuevo opcional las dos
--    quedarían ambiguas al llamarlas.
drop function if exists public.rpc_guardar_croquis(bigint, integer, integer, jsonb, integer);
drop function if exists public.rpc_guardar_croquis(bigint, integer, integer, jsonb, integer, jsonb);
create or replace function public.rpc_guardar_croquis(
  p_ambiente_id bigint, p_filas integer, p_columnas integer, p_posiciones jsonb,
  p_docente_fila integer default null, p_huecos jsonb default '[]'::jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_n integer := 0;
  v_huecos jsonb;
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
  if jsonb_typeof(coalesce(p_huecos, '[]'::jsonb)) <> 'array' then
    raise exception 'Lugares vacíos inválidos.';
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
  -- Las PCs de baja no van en el plano
  if exists (
    select 1 from jsonb_to_recordset(coalesce(p_posiciones, '[]'::jsonb)) as x(pc_id bigint, fila integer, columna integer)
      join public.ambiente_pcs p on p.id = x.pc_id
     where p.estado = 'baja'
  ) then
    raise exception 'Hay PCs de baja en el plano: recargue la página.';
  end if;
  if p_docente_fila is not null and p_docente_fila not between 0 and p_filas - 1 then
    raise exception 'La PC docente está fuera del croquis.';
  end if;

  -- Lugares vacíos: solo [fila, columna] dentro de la cuadrícula, sin repetir
  -- y sin pisar una PC (lo demás se descarta)
  select coalesce(jsonb_agg(jsonb_build_array(h.fila, h.columna) order by h.fila, h.columna), '[]'::jsonb)
    into v_huecos
    from (
      select distinct (e ->> 0)::integer as fila, (e ->> 1)::integer as columna
        from jsonb_array_elements(coalesce(p_huecos, '[]'::jsonb)) as e
       where jsonb_typeof(e) = 'array' and jsonb_array_length(e) = 2
         and jsonb_typeof(e -> 0) = 'number' and jsonb_typeof(e -> 1) = 'number'
    ) h
   where h.fila between 0 and p_filas - 1 and h.columna between 0 and p_columnas - 1
     and not exists (
       select 1 from jsonb_to_recordset(coalesce(p_posiciones, '[]'::jsonb)) as x(pc_id bigint, fila integer, columna integer)
        where x.fila = h.fila and x.columna = h.columna);

  update public.ambientes set croquis_filas = p_filas, croquis_columnas = p_columnas, croquis_huecos = v_huecos
   where id = p_ambiente_id;
  if not found then raise exception 'El laboratorio no existe.'; end if;

  -- Primero se vacían todas las casillas (así se pueden intercambiar PCs sin chocar)
  update public.ambiente_pcs set croquis_fila = null, croquis_columna = null
   where ambiente_id = p_ambiente_id and croquis_fila is not null;

  update public.ambiente_pcs p set croquis_fila = x.fila, croquis_columna = x.columna
    from jsonb_to_recordset(p_posiciones) as x(pc_id bigint, fila integer, columna integer)
   where p.id = x.pc_id and p.ambiente_id = p_ambiente_id;
  get diagnostics v_n = row_count;

  -- PC docente: fila dentro de su zona (si está de baja no se ubica)
  update public.ambiente_pcs set croquis_fila = p_docente_fila, croquis_columna = case when p_docente_fila is null then null else 0 end
   where ambiente_id = p_ambiente_id and es_docente and estado <> 'baja';
  return v_n;
end $$;

revoke execute on function public.rpc_guardar_croquis(bigint, integer, integer, jsonb, integer, jsonb) from anon, public;
grant execute on function public.rpc_guardar_croquis(bigint, integer, integer, jsonb, integer, jsonb) to authenticated;
