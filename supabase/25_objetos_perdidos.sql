-- =====================================================================
--  SISTEMA DE ASIGNACIÓN DE LABORATORIOS — UPDS
--  Script 25: OBJETOS PERDIDOS
--  - Se registra el objeto encontrado: nombre, laboratorio, fecha y hora,
--    quién lo encontró y FOTO del objeto (obligatoria).
--  - Al entregarlo: a quién, FOTO de la entrega (obligatoria); el estado
--    pasa a 'entregado' con fecha, hora y quién lo entregó.
--  - Las fotos van al bucket privado 'objetos-perdidos' de Storage.
--  Ejecutar en: Supabase > SQL Editor (después de 24).
-- =====================================================================

-- 1) Tabla
create table if not exists public.objetos_perdidos (
  id                  bigint generated always as identity primary key,
  nombre              text not null check (char_length(trim(nombre)) between 2 and 120),
  descripcion         text check (descripcion is null or char_length(descripcion) <= 500),
  ambiente_id         bigint not null references public.ambientes(id),
  encontrado_en       timestamptz not null default now(),
  encontrado_por      uuid default auth.uid() references public.perfiles(id) on delete set null,
  foto_path           text not null,
  estado              text not null default 'en_custodia' check (estado in ('en_custodia', 'entregado')),
  entregado_a         text check (entregado_a is null or char_length(entregado_a) <= 120),
  entregado_documento text check (entregado_documento is null or char_length(entregado_documento) <= 30),
  entregado_en        timestamptz,
  entregado_por       uuid references public.perfiles(id) on delete set null,
  foto_entrega_path   text,
  observacion_entrega text check (observacion_entrega is null or char_length(observacion_entrega) <= 300),
  creado_en           timestamptz not null default now(),
  constraint objetos_perdidos_entrega_completa check (
    estado = 'en_custodia'
    or (nullif(trim(entregado_a), '') is not null and foto_entrega_path is not null and entregado_en is not null))
);
create index if not exists objetos_perdidos_ambiente_idx on public.objetos_perdidos (ambiente_id);
create index if not exists objetos_perdidos_estado_idx on public.objetos_perdidos (estado, encontrado_en desc);
create index if not exists objetos_perdidos_encontrado_por_idx on public.objetos_perdidos (encontrado_por);
create index if not exists objetos_perdidos_entregado_por_idx on public.objetos_perdidos (entregado_por);

-- 2) Al entregar: fecha, hora y quién entregó se ponen solos; un objeto
--    entregado ya no vuelve atrás (salvo admin/encargado)
create or replace function public.fn_trg_objeto_perdido()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.estado := 'en_custodia';
    new.encontrado_por := coalesce(new.encontrado_por, auth.uid());
    new.entregado_a := null; new.entregado_documento := null; new.entregado_en := null;
    new.entregado_por := null; new.foto_entrega_path := null; new.observacion_entrega := null;
    return new;
  end if;
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

drop trigger if exists trg_objetos_perdidos on public.objetos_perdidos;
create trigger trg_objetos_perdidos
  before insert or update on public.objetos_perdidos
  for each row execute function public.fn_trg_objeto_perdido();
revoke execute on function public.fn_trg_objeto_perdido() from anon, authenticated, public;

-- 3) Seguridad: ve todo el personal; registra y entrega operación; borra admin/encargado
alter table public.objetos_perdidos enable row level security;
drop policy if exists objetos_perdidos_ver on public.objetos_perdidos;
create policy objetos_perdidos_ver on public.objetos_perdidos for select to authenticated using (public.fn_puede_ver());
drop policy if exists objetos_perdidos_crear on public.objetos_perdidos;
create policy objetos_perdidos_crear on public.objetos_perdidos for insert to authenticated with check (public.fn_puede_operar());
drop policy if exists objetos_perdidos_editar on public.objetos_perdidos;
create policy objetos_perdidos_editar on public.objetos_perdidos for update to authenticated
  using (public.fn_puede_operar()) with check (public.fn_puede_operar());
drop policy if exists objetos_perdidos_borrar on public.objetos_perdidos;
create policy objetos_perdidos_borrar on public.objetos_perdidos for delete to authenticated
  using (public.fn_puede_gestionar_auxiliares());
revoke all on public.objetos_perdidos from anon;

-- 4) Fotos: bucket privado (máx. 5 MB, solo imágenes)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('objetos-perdidos', 'objetos-perdidos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists objetos_perdidos_fotos_ver on storage.objects;
create policy objetos_perdidos_fotos_ver on storage.objects for select to authenticated
  using (bucket_id = 'objetos-perdidos' and public.fn_puede_ver());
drop policy if exists objetos_perdidos_fotos_subir on storage.objects;
create policy objetos_perdidos_fotos_subir on storage.objects for insert to authenticated
  with check (bucket_id = 'objetos-perdidos' and public.fn_puede_operar());
drop policy if exists objetos_perdidos_fotos_borrar on storage.objects;
create policy objetos_perdidos_fotos_borrar on storage.objects for delete to authenticated
  using (bucket_id = 'objetos-perdidos' and public.fn_puede_gestionar_auxiliares());
