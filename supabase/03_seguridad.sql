-- =====================================================================
--  SISTEMA DE ASIGNACIÓN DE LABORATORIOS — UPDS
--  Script 03: SEGURIDAD (perfiles, roles, RLS, gestión de usuarios)
-- =====================================================================
--  Roles:
--    admin    -> todo, incluida la gestión de usuarios y catálogos base
--    auxiliar -> registra asignaciones, cesiones, eventos, defensas,
--                docentes, materias, ambientes, feriados…
--    decano   -> solo lectura (calendario, tarjetas, reportes)
--  Usuarios inactivos o sin perfil no ven nada.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Funciones de rol (SECURITY DEFINER para no depender de RLS de perfiles)
-- ---------------------------------------------------------------------
create or replace function public.fn_rol_actual()
returns text language sql stable security definer set search_path = public as $$
  select rol from public.perfiles where id = auth.uid() and activo;
$$;

create or replace function public.fn_es_admin()
returns boolean language sql stable as $$
  select coalesce(public.fn_rol_actual() = 'admin', false);
$$;

create or replace function public.fn_puede_editar()
returns boolean language sql stable as $$
  select coalesce(public.fn_rol_actual() in ('admin', 'auxiliar'), false);
$$;

create or replace function public.fn_puede_ver()
returns boolean language sql stable as $$
  select public.fn_rol_actual() is not null;
$$;

-- ---------------------------------------------------------------------
-- Perfil automático al crear un usuario en Supabase Auth.
-- Por seguridad entra como 'auxiliar' INACTIVO: solo un admin lo activa
-- (o fn_crear_usuario, que lo deja activo con el rol elegido).
-- ---------------------------------------------------------------------
create or replace function public.fn_trg_nuevo_usuario()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.perfiles (id, nombre_completo, correo, rol, activo)
  values (new.id,
          coalesce(nullif(new.raw_user_meta_data->>'nombre_completo', ''), split_part(new.email, '@', 1)),
          new.email,
          'auxiliar',
          false)
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists trg_auth_nuevo_usuario on auth.users;
create trigger trg_auth_nuevo_usuario
  after insert on auth.users
  for each row execute function public.fn_trg_nuevo_usuario();

-- ---------------------------------------------------------------------
-- Crear usuario desde la app (solo admin). Inserta en auth.users e
-- auth.identities con la contraseña cifrada (bcrypt).
-- ---------------------------------------------------------------------
create or replace function public.fn_crear_usuario(
  p_correo   text,
  p_password text,
  p_nombre   text,
  p_rol      text
)
returns uuid
language plpgsql security definer set search_path = public, auth, extensions as $$
declare
  v_id uuid := gen_random_uuid();
  v_correo text := lower(trim(p_correo));
begin
  if not public.fn_es_admin() then
    raise exception 'Solo un administrador puede registrar usuarios.';
  end if;
  if p_rol not in ('admin', 'auxiliar', 'decano') then
    raise exception 'Rol no válido: %', p_rol;
  end if;
  if length(coalesce(p_password, '')) < 8 then
    raise exception 'La contraseña debe tener al menos 8 caracteres.';
  end if;
  if exists (select 1 from auth.users where email = v_correo) then
    raise exception 'Ya existe un usuario con el correo %.', v_correo;
  end if;

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change
  ) values (
    '00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated',
    v_correo, extensions.crypt(p_password, extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('nombre_completo', p_nombre),
    now(), now(), '', '', '', ''
  );

  insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), v_id, v_id::text,
          jsonb_build_object('sub', v_id::text, 'email', v_correo, 'email_verified', true),
          'email', now(), now(), now());

  -- El trigger creó el perfil inactivo: se activa con el rol elegido
  update public.perfiles set rol = p_rol, activo = true, nombre_completo = p_nombre where id = v_id;
  return v_id;
end $$;

-- Cambiar la contraseña de cualquier usuario (solo admin)
create or replace function public.fn_cambiar_password(p_usuario uuid, p_password text)
returns void
language plpgsql security definer set search_path = public, auth, extensions as $$
begin
  if not public.fn_es_admin() then
    raise exception 'Solo un administrador puede cambiar contraseñas.';
  end if;
  if length(coalesce(p_password, '')) < 8 then
    raise exception 'La contraseña debe tener al menos 8 caracteres.';
  end if;
  update auth.users
     set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf')),
         updated_at = now()
   where id = p_usuario;
end $$;

-- Un admin no puede quitarse su propio rol ni desactivarse (evita quedar sin admin)
create or replace function public.fn_trg_proteger_admin()
returns trigger language plpgsql as $$
begin
  if old.id = auth.uid() and (new.rol <> 'admin' or not new.activo) and old.rol = 'admin' then
    raise exception 'No puede quitarse a sí mismo el rol de administrador ni desactivarse.';
  end if;
  return new;
end $$;

create trigger trg_perfiles_proteger_admin
  before update on public.perfiles
  for each row execute function public.fn_trg_proteger_admin();

-- ---------------------------------------------------------------------
-- ROW LEVEL SECURITY
-- ---------------------------------------------------------------------
alter table public.perfiles            enable row level security;
alter table public.carreras            enable row level security;
alter table public.docentes            enable row level security;
alter table public.docente_carreras    enable row level security;
alter table public.materias            enable row level security;
alter table public.docente_materias    enable row level security;
alter table public.ambientes           enable row level security;
alter table public.sistemas_academicos enable row level security;
alter table public.asignacion_fechas   enable row level security;
alter table public.bloques_horario     enable row level security;
alter table public.feriados            enable row level security;
alter table public.asignaciones        enable row level security;
alter table public.asignacion_horarios enable row level security;
alter table public.cesiones            enable row level security;
alter table public.cesion_fechas       enable row level security;
alter table public.tipos_reserva       enable row level security;
alter table public.reservas            enable row level security;
alter table public.reserva_horarios    enable row level security;
alter table public.reubicaciones       enable row level security;

-- Perfiles: cada uno ve el suyo; el admin ve y edita todos
create policy perfiles_ver on public.perfiles
  for select to authenticated using (id = auth.uid() or public.fn_es_admin());
create policy perfiles_editar on public.perfiles
  for update to authenticated using (public.fn_es_admin()) with check (public.fn_es_admin());

-- Tablas operativas y catálogos: leen todos los usuarios activos,
-- escriben admin y auxiliar.
do $$
declare
  t text;
begin
  foreach t in array array[
    'carreras', 'docentes', 'docente_carreras', 'materias', 'docente_materias',
    'ambientes', 'feriados', 'asignacion_fechas',
    'asignaciones', 'asignacion_horarios', 'cesiones', 'cesion_fechas',
    'reservas', 'reserva_horarios', 'reubicaciones'
  ] loop
    execute format('create policy %I on public.%I for select to authenticated using (public.fn_puede_ver())', t || '_ver', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.fn_puede_editar())', t || '_crear', t);
    execute format('create policy %I on public.%I for update to authenticated using (public.fn_puede_editar()) with check (public.fn_puede_editar())', t || '_editar', t);
    execute format('create policy %I on public.%I for delete to authenticated using (public.fn_puede_editar())', t || '_borrar', t);
  end loop;

  -- Catálogos base: solo admin escribe
  foreach t in array array['sistemas_academicos', 'bloques_horario', 'tipos_reserva'] loop
    execute format('create policy %I on public.%I for select to authenticated using (public.fn_puede_ver())', t || '_ver', t);
    execute format('create policy %I on public.%I for all to authenticated using (public.fn_es_admin()) with check (public.fn_es_admin())', t || '_admin', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Permisos de ejecución: nada para anónimos
-- ---------------------------------------------------------------------
revoke all on all tables    in schema public from anon;
revoke execute on all functions in schema public from anon, public;
grant  execute on all functions in schema public to authenticated;
