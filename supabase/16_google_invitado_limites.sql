-- =====================================================================
--  SISTEMA DE ASIGNACIÓN DE LABORATORIOS — UPDS
--  Script 16: INICIO CON GOOGLE (rol INVITADO) + LÍMITES DE TEXTO
--  - Quien entra por primera vez (con Google o registrándose) queda como
--    'invitado': activo, pero sin acceso a nada hasta que el admin le
--    asigne un rol.
--  - Cada usuario puede leer su propio perfil (para saber si sigue
--    esperando rol o si fue desactivado).
--  - Límites de largo en los textos libres, para que no se guarde
--    cualquier cosa aunque se escriba directo contra la API.
--  Ejecutar en: Supabase > SQL Editor (después de 15).
--  Además: Authentication > Sign In / Providers > Google (ver README).
-- =====================================================================

-- 1) Rol invitado
alter table public.perfiles drop constraint if exists perfiles_rol_check;
alter table public.perfiles
  add constraint perfiles_rol_check check (rol in ('admin', 'auxiliar', 'decano', 'encargado', 'invitado'));

-- Usuario nuevo -> invitado activo. Toma el nombre que manda Google (full_name / name).
create or replace function public.fn_trg_nuevo_usuario()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.perfiles (id, nombre_completo, correo, rol, activo)
  values (new.id,
          left(coalesce(nullif(new.raw_user_meta_data->>'nombre_completo', ''),
                        nullif(new.raw_user_meta_data->>'full_name', ''),
                        nullif(new.raw_user_meta_data->>'name', ''),
                        split_part(new.email, '@', 1)), 120),
          new.email,
          'invitado',
          true)
  on conflict (id) do nothing;
  return new;
end $$;
revoke execute on function public.fn_trg_nuevo_usuario() from anon, authenticated, public;

-- El invitado no ve nada: "ver" exige un rol real
create or replace function public.fn_puede_ver()
returns boolean language sql stable set search_path = public as $$
  select coalesce(public.fn_rol_actual() <> 'invitado', false);
$$;

-- Cada uno puede leer su propio perfil (aunque sea invitado o esté inactivo)
drop policy if exists perfiles_propio on public.perfiles;
create policy perfiles_propio on public.perfiles
  for select to authenticated using (id = (select auth.uid()));

-- 2) Límites de texto (largo máximo y sin textos vacíos)
alter table public.atenciones
  drop constraint if exists atenciones_textos_check,
  add constraint atenciones_textos_check check (
    char_length(btrim(descripcion)) between 3 and 500
    and (solucion is null or char_length(solucion) <= 1000)
    and (solicitante is null or char_length(solicitante) <= 120));

alter table public.reporte_tareas
  drop constraint if exists reporte_tareas_textos_check,
  add constraint reporte_tareas_textos_check check (char_length(btrim(descripcion)) between 3 and 300);

alter table public.reportes_turno
  drop constraint if exists reportes_turno_textos_check,
  add constraint reportes_turno_textos_check check (novedades is null or char_length(novedades) <= 2000);

alter table public.ambiente_pcs
  drop constraint if exists ambiente_pcs_textos_check,
  add constraint ambiente_pcs_textos_check check (
    char_length(btrim(etiqueta)) between 1 and 30
    and (procesador is null or char_length(procesador) <= 60)
    and (ram is null or char_length(ram) <= 60)
    and (almacenamiento is null or char_length(almacenamiento) <= 60)
    and (notas is null or char_length(notas) <= 500));

alter table public.docentes
  drop constraint if exists docentes_textos_check,
  add constraint docentes_textos_check check (
    char_length(btrim(nombres)) between 1 and 80
    and char_length(btrim(apellidos)) between 1 and 80
    and (carnet is null or char_length(carnet) <= 20)
    and (telefono is null or char_length(telefono) <= 20)
    and (correo is null or char_length(correo) <= 120));

alter table public.perfiles
  drop constraint if exists perfiles_textos_check,
  add constraint perfiles_textos_check check (char_length(btrim(nombre_completo)) between 1 and 120);

alter table public.rotacion_sabados
  drop constraint if exists rotacion_sabados_textos_check,
  add constraint rotacion_sabados_textos_check check (nota is null or char_length(nota) <= 200);
