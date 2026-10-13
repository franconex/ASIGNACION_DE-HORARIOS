-- =====================================================================
--  SISTEMA DE ASIGNACIÓN DE LABORATORIOS — UPDS
--  Script 52: EL ENCARGADO DE AUXILIARES GESTIONA USUARIOS (LIMITADO)
--  - El encargado entra a Configuración > Usuarios. Solo ve y toca
--    cuentas invitado, auxiliar y encargado.
--  - fn_crear_usuario: el encargado puede crear cuentas, pero solo con
--    rol auxiliar o encargado.
--  - fn_asignar_rol(p_usuario, p_rol): el encargado asigna auxiliar o
--    encargado a una cuenta invitado/auxiliar/encargado (no a sí mismo).
--    Si era invitado, queda activa. El admin puede asignar cualquier rol.
--  - perfiles_editar sigue siendo solo del admin: el encargado no
--    desactiva cuentas, no cambia turnos ni contraseñas.
--  Ejecutar en: Supabase > SQL Editor (después de 51).
-- =====================================================================

create or replace function public.fn_crear_usuario(p_correo text, p_password text, p_nombre text, p_rol text)
returns uuid language plpgsql security definer set search_path = public, auth, extensions as $$
declare
  v_id uuid := gen_random_uuid();
  v_correo text := lower(trim(p_correo));
  v_rol_actual text := coalesce(public.fn_rol_actual(), '');
begin
  if v_rol_actual not in ('admin', 'encargado') then
    raise exception 'Solo el administrador o el encargado de auxiliares pueden registrar usuarios.';
  end if;
  if p_rol not in ('admin', 'auxiliar', 'decano', 'encargado') then
    raise exception 'Rol no válido: %', p_rol;
  end if;
  if v_rol_actual = 'encargado' and p_rol not in ('auxiliar', 'encargado') then
    raise exception 'El encargado solo puede crear auxiliares o encargados.';
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
  update public.perfiles set rol = p_rol, activo = true, nombre_completo = p_nombre where id = v_id;
  return v_id;
end $$;

create or replace function public.fn_asignar_rol(p_usuario uuid, p_rol text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_rol_actual text := coalesce(public.fn_rol_actual(), '');
  v_rol_destino text;
begin
  if v_rol_actual not in ('admin', 'encargado') then
    raise exception 'Solo el administrador o el encargado de auxiliares pueden asignar roles.';
  end if;
  if p_rol not in ('invitado', 'admin', 'auxiliar', 'decano', 'encargado') then
    raise exception 'Rol no válido: %', p_rol;
  end if;
  if p_usuario = auth.uid() then
    raise exception 'No puede cambiar su propio rol.';
  end if;
  select rol into v_rol_destino from public.perfiles where id = p_usuario;
  if not found then
    raise exception 'El usuario no existe.';
  end if;
  if v_rol_actual = 'encargado' and (
       v_rol_destino not in ('invitado', 'auxiliar', 'encargado')
       or p_rol not in ('auxiliar', 'encargado')) then
    raise exception 'El encargado solo puede asignar los roles auxiliar o encargado de auxiliares.';
  end if;
  update public.perfiles
     set rol = p_rol,
         activo = case when v_rol_destino = 'invitado' and p_rol <> 'invitado' then true else activo end
   where id = p_usuario;
end $$;

revoke execute on function public.fn_crear_usuario(text, text, text, text) from anon, public;
grant execute on function public.fn_crear_usuario(text, text, text, text) to authenticated;
revoke execute on function public.fn_asignar_rol(uuid, text) from anon, public;
grant execute on function public.fn_asignar_rol(uuid, text) to authenticated;
