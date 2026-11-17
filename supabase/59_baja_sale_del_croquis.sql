-- =====================================================================
--  SISTEMA DE ASIGNACIÓN DE LABORATORIOS — UPDS
--  Script 59: LAS PCs DE BAJA SALEN DEL CROQUIS
--  - Cuando una PC pasa a "De baja" (por la ficha de reparación, por el
--    cambio de estado o por cualquier otro camino) pierde su casilla del
--    croquis: deja de dibujarse en el plano.
--  - Si vuelve a estar activa queda "sin ubicar" y se acomoda de nuevo.
--  - rpc_guardar_croquis no acepta ubicar PCs de baja.
--  - Quitar del plano una PC que no está de baja se hace desde la app
--    llenando su ficha de baja (la app guarda la ficha y luego el croquis).
--  Ejecutar en: Supabase > SQL Editor (después de 58).
-- =====================================================================

-- 1) Al pasar a baja, la PC se saca del croquis
create or replace function public.fn_trg_pc_baja_sale_croquis()
returns trigger language plpgsql set search_path = public as $$
begin
  -- Solo cuando entra a baja (o se registra ya de baja)
  if new.estado = 'baja' and (tg_op = 'INSERT' or old.estado is distinct from 'baja') then
    new.croquis_fila    := null;
    new.croquis_columna := null;
  end if;
  return new;
end $$;

drop trigger if exists trg_ambiente_pcs_baja_croquis on public.ambiente_pcs;
create trigger trg_ambiente_pcs_baja_croquis
  before insert or update of estado on public.ambiente_pcs
  for each row execute function public.fn_trg_pc_baja_sale_croquis();

revoke execute on function public.fn_trg_pc_baja_sale_croquis() from anon, authenticated, public;

-- 2) Las PCs que ya estaban de baja también salen del plano
update public.ambiente_pcs set croquis_fila = null, croquis_columna = null
 where estado = 'baja' and croquis_fila is not null;

-- 3) Guardar el croquis: no se pueden ubicar PCs de baja
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

  update public.ambientes set croquis_filas = p_filas, croquis_columnas = p_columnas where id = p_ambiente_id;
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

revoke execute on function public.rpc_guardar_croquis(bigint, integer, integer, jsonb, integer) from anon, public;
grant execute on function public.rpc_guardar_croquis(bigint, integer, integer, jsonb, integer) to authenticated;
