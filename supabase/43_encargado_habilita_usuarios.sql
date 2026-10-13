-- =====================================================================
--  SISTEMA DE ASIGNACIÓN DE LABORATORIOS — UPDS
--  Script 43: EL ENCARGADO DE AUXILIARES HABILITA CUENTAS
--  - fn_habilitar_usuario(p_usuario): una cuenta que entró con Google y
--    espera rol (invitado) pasa a auxiliar activo.
--  - La pueden usar el admin y el encargado. El encargado no puede hacer
--    nada más con los usuarios: ni cambiar roles, ni desactivar, ni ver
--    Configuración (perfiles sigue editándose solo por el admin).
--  Ejecutar en: Supabase > SQL Editor (después de 42).
-- =====================================================================

create or replace function public.fn_habilitar_usuario(p_usuario uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if coalesce(public.fn_rol_actual(), '') not in ('admin', 'encargado') then
    raise exception 'Solo el administrador o el encargado de auxiliares pueden habilitar cuentas.';
  end if;
  update public.perfiles
     set rol = 'auxiliar', activo = true
   where id = p_usuario and rol = 'invitado';
  if not found then
    raise exception 'Esa cuenta ya no está esperando acceso.';
  end if;
end $$;

revoke execute on function public.fn_habilitar_usuario(uuid) from anon, public;
grant execute on function public.fn_habilitar_usuario(uuid) to authenticated;
