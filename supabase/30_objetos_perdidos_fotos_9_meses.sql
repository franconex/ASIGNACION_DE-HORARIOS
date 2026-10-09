-- =====================================================================
--  SISTEMA DE ASIGNACIÓN DE LABORATORIOS — UPDS
--  Script 30: FOTOS DE OBJETOS PERDIDOS SE BORRAN A LOS 9 MESES
--  - A los 9 meses de registrado el objeto se borran sus fotos (la del
--    objeto y la de la entrega) para no llenar el almacenamiento.
--  - El registro se queda (qué era, laboratorio, fechas, a quién se
--    entregó); queda marcada la fecha en que se borraron las fotos.
--  - La app borra los archivos de Storage al abrir Objetos perdidos.
--  Ejecutar en: Supabase > SQL Editor (después de 29).
-- =====================================================================

-- 1) Las fotos pueden faltar si ya se borraron por antigüedad
alter table public.objetos_perdidos add column if not exists fotos_borradas_en timestamptz;
alter table public.objetos_perdidos alter column foto_path drop not null;

alter table public.objetos_perdidos drop constraint if exists objetos_perdidos_foto_check;
alter table public.objetos_perdidos add constraint objetos_perdidos_foto_check
  check (foto_path is not null or fotos_borradas_en is not null);

alter table public.objetos_perdidos drop constraint if exists objetos_perdidos_entrega_completa;
alter table public.objetos_perdidos add constraint objetos_perdidos_entrega_completa check (
  estado = 'en_custodia'
  or (nullif(trim(entregado_a), '') is not null and entregado_en is not null
      and (foto_entrega_path is not null or fotos_borradas_en is not null)));

create index if not exists objetos_perdidos_fotos_vencen_idx on public.objetos_perdidos (creado_en)
  where fotos_borradas_en is null;

-- 2) Trigger: solo la limpieza (marca interna 'app.limpiando_fotos') puede
--    quitar fotos y poner fotos_borradas_en, aun en objetos ya entregados
create or replace function public.fn_trg_objeto_perdido()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.estado := 'en_custodia';
    new.encontrado_por := coalesce(new.encontrado_por, auth.uid());
    new.entregado_a := null; new.entregado_documento := null; new.entregado_en := null;
    new.entregado_por := null; new.foto_entrega_path := null; new.observacion_entrega := null;
    new.fotos_borradas_en := null;
    return new;
  end if;
  if coalesce(current_setting('app.limpiando_fotos', true), '') = 'si' then
    return new;
  end if;
  new.fotos_borradas_en := old.fotos_borradas_en;
  if old.estado = 'entregado' and not public.fn_puede_gestionar_auxiliares() then
    raise exception 'Este objeto ya fue entregado: solo el administrador o el encargado pueden modificarlo.';
  end if;
  if new.estado = 'entregado' and old.estado = 'en_custodia' then
    new.entregado_en  := now();
    new.entregado_por := auth.uid();
  elsif new.estado = 'en_custodia' then
    new.entregado_a := null; new.entregado_documento := null; new.entregado_en := null;
    new.entregado_por := null; new.foto_entrega_path := null; new.observacion_entrega := null;
  end if;
  return new;
end $$;
revoke execute on function public.fn_trg_objeto_perdido() from anon, authenticated, public;

-- 3) Limpieza: quita las fotos de más de 9 meses y devuelve sus rutas
--    para que la app borre los archivos de Storage
create or replace function public.fn_limpiar_fotos_objetos()
returns setof text language plpgsql security definer set search_path = public as $$
begin
  if not public.fn_puede_operar() then
    return;
  end if;
  perform set_config('app.limpiando_fotos', 'si', true);
  return query
    with viejos as (
      select id, foto_path, foto_entrega_path from public.objetos_perdidos
       where fotos_borradas_en is null and creado_en <= now() - interval '9 months'
       for update
    ), limpiar as (
      update public.objetos_perdidos o
         set foto_path = null, foto_entrega_path = null, fotos_borradas_en = now()
        from viejos v where o.id = v.id
    )
    select ruta from viejos v, unnest(array[v.foto_path, v.foto_entrega_path]) as ruta where ruta is not null;
  perform set_config('app.limpiando_fotos', '', true);
end $$;

revoke execute on function public.fn_limpiar_fotos_objetos() from anon, public;
grant execute on function public.fn_limpiar_fotos_objetos() to authenticated;

-- 4) Storage: admin/encargado borran como antes; el resto del personal
--    solo archivos que ya ningún objeto usa (las fotos vencidas)
drop policy if exists objetos_perdidos_fotos_borrar on storage.objects;
create policy objetos_perdidos_fotos_borrar on storage.objects for delete to authenticated
  using (bucket_id = 'objetos-perdidos' and (
    public.fn_puede_gestionar_auxiliares()
    or (public.fn_puede_operar() and not exists (
          select 1 from public.objetos_perdidos o
           where o.foto_path = storage.objects.name or o.foto_entrega_path = storage.objects.name))));
