-- =====================================================================
--  SISTEMA DE ASIGNACIÓN DE LABORATORIOS — UPDS
--  Script 35: COMPLETAR LA CUENTA AL RECIBIR UN ROL
--  - Quien entró con Google y ya tiene rol (auxiliar, encargado…) debe,
--    la primera vez, confirmar su nombre y crear una contraseña. Así
--    también puede entrar con correo y contraseña desde el login.
--  - perfiles.cuenta_completa: false hasta que lo haga. Los usuarios que
--    ya tienen contraseña quedan como completos.
--  - rpc_completar_cuenta(nombre): guarda el nombre y marca la cuenta
--    como completa (solo si la contraseña ya se creó en Supabase Auth).
--  Ejecutar en: Supabase > SQL Editor (después de 34).
-- =====================================================================

alter table public.perfiles add column if not exists cuenta_completa boolean not null default false;

update public.perfiles p
   set cuenta_completa = true
  from auth.users u
 where u.id = p.id
   and coalesce(u.encrypted_password, '') <> '';

create or replace function public.rpc_completar_cuenta(p_nombre text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_nombre text := btrim(coalesce(p_nombre, ''));
begin
  if auth.uid() is null then
    raise exception 'Sesión no válida.';
  end if;
  if char_length(v_nombre) not between 3 and 120 then
    raise exception 'Escriba su nombre completo (entre 3 y 120 letras).';
  end if;
  if not exists (select 1 from auth.users where id = auth.uid() and coalesce(encrypted_password, '') <> '') then
    raise exception 'Primero cree su contraseña.';
  end if;
  update public.perfiles
     set nombre_completo = v_nombre, cuenta_completa = true
   where id = auth.uid() and activo and rol <> 'invitado';
  if not found then
    raise exception 'Su cuenta todavía no tiene un rol asignado.';
  end if;
end $$;
revoke execute on function public.rpc_completar_cuenta(text) from anon, public;
grant execute on function public.rpc_completar_cuenta(text) to authenticated;

-- Usuario nuevo: si ya nace con contraseña (lo creó el admin o se registró
-- con correo) su cuenta queda completa; si entró con Google, no.
create or replace function public.fn_trg_nuevo_usuario()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.perfiles (id, nombre_completo, correo, rol, activo, cuenta_completa)
  values (new.id,
          left(coalesce(nullif(new.raw_user_meta_data->>'nombre_completo', ''),
                        nullif(new.raw_user_meta_data->>'full_name', ''),
                        nullif(new.raw_user_meta_data->>'name', ''),
                        split_part(new.email, '@', 1)), 120),
          new.email,
          'invitado',
          true,
          coalesce(new.encrypted_password, '') <> '')
  on conflict (id) do nothing;
  return new;
end $$;
revoke execute on function public.fn_trg_nuevo_usuario() from anon, authenticated, public;
