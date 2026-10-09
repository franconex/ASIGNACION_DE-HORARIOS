-- =====================================================================
--  SISTEMA DE ASIGNACIÓN DE LABORATORIOS — UPDS
--  Script 28: FOTO AL CERRAR TURNO (armario de llaves)
--  - El reporte de cierre puede llevar una foto (bucket privado
--    'reportes-turno').
--  - La foto vence a las 12:00 (La Paz) siguientes a la subida: desde
--    entonces no se muestra y la app borra el archivo; la descripción
--    (novedades) y las tareas se quedan.
--  Ejecutar en: Supabase > SQL Editor (después de 27).
-- =====================================================================

-- 1) Columnas
alter table public.reportes_turno add column if not exists foto_path text;
alter table public.reportes_turno add column if not exists foto_expira timestamptz;

-- 2) Las 12:00 de La Paz siguientes a un momento
create or replace function public.fn_mediodia_siguiente(p_momento timestamptz)
returns timestamptz language sql stable set search_path = public as $$
  select (((p_momento at time zone 'America/La_Paz')::date
           + case when (p_momento at time zone 'America/La_Paz')::time < time '12:00' then 0 else 1 end)
          + time '12:00') at time zone 'America/La_Paz';
$$;

-- 3) El vencimiento lo pone la base (no se puede alargar desde la app)
create or replace function public.fn_trg_reporte_foto()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.foto_path is null then
    new.foto_expira := null;
  elsif tg_op = 'INSERT' or new.foto_path is distinct from old.foto_path then
    new.foto_expira := public.fn_mediodia_siguiente(now());
  else
    new.foto_expira := old.foto_expira;
  end if;
  return new;
end $$;

drop trigger if exists trg_reportes_turno_foto on public.reportes_turno;
create trigger trg_reportes_turno_foto
  before insert or update on public.reportes_turno
  for each row execute function public.fn_trg_reporte_foto();

-- 4) Limpieza: quita de los reportes las fotos vencidas y devuelve sus rutas
--    para que la app borre los archivos de Storage
create or replace function public.fn_limpiar_fotos_reporte()
returns setof text language plpgsql security definer set search_path = public as $$
begin
  if not public.fn_puede_operar() then
    return;
  end if;
  return query
    with vencidas as (
      select id, foto_path from public.reportes_turno
       where foto_path is not null and foto_expira <= now()
       for update
    ), limpiar as (
      update public.reportes_turno r set foto_path = null
        from vencidas v where r.id = v.id
    )
    select v.foto_path from vencidas v;
end $$;

revoke execute on function public.fn_trg_reporte_foto() from anon, authenticated, public;
revoke execute on function public.fn_limpiar_fotos_reporte() from anon, public;
grant execute on function public.fn_limpiar_fotos_reporte() to authenticated;
revoke execute on function public.fn_mediodia_siguiente(timestamptz) from anon, public;

-- 5) Bucket privado (máx. 5 MB, solo imágenes)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('reportes-turno', 'reportes-turno', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists reportes_turno_fotos_ver on storage.objects;
create policy reportes_turno_fotos_ver on storage.objects for select to authenticated
  using (bucket_id = 'reportes-turno' and public.fn_puede_ver());
drop policy if exists reportes_turno_fotos_subir on storage.objects;
create policy reportes_turno_fotos_subir on storage.objects for insert to authenticated
  with check (bucket_id = 'reportes-turno' and public.fn_puede_operar());
-- Se borra solo lo que ningún reporte usa (fotos vencidas o subidas que fallaron)
drop policy if exists reportes_turno_fotos_borrar on storage.objects;
create policy reportes_turno_fotos_borrar on storage.objects for delete to authenticated
  using (bucket_id = 'reportes-turno' and public.fn_puede_operar()
         and not exists (select 1 from public.reportes_turno r where r.foto_path = storage.objects.name));
