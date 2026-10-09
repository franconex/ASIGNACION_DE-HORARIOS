-- =====================================================================
--  SISTEMA DE ASIGNACIÓN DE LABORATORIOS — UPDS
--  Script 10: ROLES (4) + OPERACIÓN DE AUXILIARES
--  - Agrega el rol 'encargado' (encargado de auxiliares).
--  - Reparte permisos: edición ACADÉMICA (horarios) vs OPERACIÓN (turnos).
--  - Turnos de trabajo (abrir / cerrar + pase de turno), atenciones y
--    mantenimiento preventivo/correctivo por PC.
--  Ejecutar en: Supabase > SQL Editor (después de 01–08).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Perfiles: nuevo rol + turno habitual del auxiliar
-- ---------------------------------------------------------------------
do $$
declare c text;
begin
  select conname into c
    from pg_constraint
   where conrelid = 'public.perfiles'::regclass and contype = 'c'
     and pg_get_constraintdef(oid) ilike '%rol%';
  if c is not null then execute format('alter table public.perfiles drop constraint %I', c); end if;
end $$;

alter table public.perfiles
  add constraint perfiles_rol_check check (rol in ('admin', 'auxiliar', 'decano', 'encargado'));

alter table public.perfiles add column if not exists turno_habitual text
  check (turno_habitual in ('M', 'MD', 'T', 'N'));
alter table public.perfiles add column if not exists sabado_rotativo boolean not null default false;

comment on table public.perfiles is 'Usuarios del sistema (admin, decano, encargado, auxiliar) con su turno habitual.';

-- ---------------------------------------------------------------------
-- 2) Permisos por rol
--    fn_puede_editar  -> ACADÉMICO: horarios de clase, cesiones, eventos,
--                        catálogos (admin, decano, encargado).
--    fn_puede_operar  -> OPERACIÓN: turnos, atenciones, mantenimiento,
--                        inventario de PCs (admin, encargado, auxiliar).
--    fn_puede_ver     -> cualquier usuario activo.
-- ---------------------------------------------------------------------
create or replace function public.fn_puede_editar()
returns boolean language sql stable set search_path = public as $$
  select coalesce(public.fn_rol_actual() in ('admin', 'decano', 'encargado'), false);
$$;

create or replace function public.fn_puede_operar()
returns boolean language sql stable set search_path = public as $$
  select coalesce(public.fn_rol_actual() in ('admin', 'encargado', 'auxiliar'), false);
$$;

-- Inventario de PCs: lo mantiene la OPERACIÓN (antes usaba fn_puede_editar)
drop policy if exists ambiente_pcs_crear  on public.ambiente_pcs;
drop policy if exists ambiente_pcs_editar on public.ambiente_pcs;
drop policy if exists ambiente_pcs_borrar on public.ambiente_pcs;
create policy ambiente_pcs_crear  on public.ambiente_pcs for insert to authenticated with check (public.fn_puede_operar());
create policy ambiente_pcs_editar on public.ambiente_pcs for update to authenticated using (public.fn_puede_operar()) with check (public.fn_puede_operar());
create policy ambiente_pcs_borrar on public.ambiente_pcs for delete to authenticated using (public.fn_puede_operar());

-- Crear usuario desde la app: ahora acepta el rol 'encargado'
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
  if p_rol not in ('admin', 'auxiliar', 'decano', 'encargado') then
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

  update public.perfiles set rol = p_rol, activo = true, nombre_completo = p_nombre where id = v_id;
  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- 3) TURNOS DE TRABAJO (abrir / cerrar + pase de turno)
--    Solo puede haber UN turno abierto a la vez (el que está en curso).
-- ---------------------------------------------------------------------
create table if not exists public.turnos_trabajo (
  id                   bigint generated always as identity primary key,
  fecha                date        not null default (now() at time zone 'America/La_Paz')::date,
  turno                text        not null check (turno in ('M', 'MD', 'T', 'N')),
  es_sabado_rotativo   boolean     not null default false,
  estado               text        not null default 'abierto' check (estado in ('abierto', 'cerrado')),
  auxiliar_apertura_id uuid        default auth.uid() references public.perfiles(id) on delete set null,
  abierto_en           timestamptz not null default now(),
  notas_apertura       text,
  auxiliar_cierre_id   uuid        references public.perfiles(id) on delete set null,
  cerrado_en           timestamptz,
  notas_cierre         text,
  creado_en            timestamptz not null default now(),
  actualizado_en       timestamptz not null default now()
);
-- Un solo turno abierto en todo el sistema (índice parcial)
create unique index if not exists turnos_trabajo_uno_abierto on public.turnos_trabajo ((estado)) where estado = 'abierto';
create index if not exists turnos_trabajo_fecha_idx on public.turnos_trabajo (fecha desc, abierto_en desc);

comment on table public.turnos_trabajo is 'Jornada de trabajo del grupo de auxiliares: se abre y se cierra, con notas de pase de turno.';

create trigger trg_turnos_trabajo_actualizado
  before update on public.turnos_trabajo
  for each row execute function public.fn_set_actualizado_en();

-- ---------------------------------------------------------------------
-- 4) ATENCIONES (lo que piden los docentes / lo que se hace)
--    Lo que queda 'pendiente' o 'en_proceso' pasa al siguiente turno.
-- ---------------------------------------------------------------------
create table if not exists public.atenciones (
  id               bigint generated always as identity primary key,
  turno_trabajo_id bigint      references public.turnos_trabajo(id) on delete set null,
  ambiente_id      bigint      references public.ambientes(id) on delete set null,
  pc_id            bigint      references public.ambiente_pcs(id) on delete set null,
  docente_id       bigint      references public.docentes(id) on delete set null,
  solicitante      text,                                   -- si no es un docente del sistema
  tipo             text        not null default 'atencion'
                   check (tipo in ('instalacion_software', 'problema', 'atencion', 'otro')),
  descripcion      text        not null,
  prioridad        smallint    not null default 2 check (prioridad between 1 and 3), -- 1 alta · 2 media · 3 baja
  estado           text        not null default 'pendiente'
                   check (estado in ('pendiente', 'en_proceso', 'resuelto')),
  auxiliar_id      uuid        default auth.uid() references public.perfiles(id) on delete set null,
  creado_en        timestamptz not null default now(),
  resuelto_por     uuid        references public.perfiles(id) on delete set null,
  resuelto_en      timestamptz,
  actualizado_en   timestamptz not null default now()
);
create index if not exists atenciones_estado_idx on public.atenciones (estado, creado_en desc);
create index if not exists atenciones_turno_idx  on public.atenciones (turno_trabajo_id);

comment on table public.atenciones is 'Pedidos de docentes y trabajos del día; lo no resuelto es el pase de turno.';

create trigger trg_atenciones_actualizado
  before update on public.atenciones
  for each row execute function public.fn_set_actualizado_en();

-- ---------------------------------------------------------------------
-- 5) MANTENIMIENTO (preventivo / correctivo por PC)
-- ---------------------------------------------------------------------
create table if not exists public.mantenimientos (
  id               bigint generated always as identity primary key,
  pc_id            bigint      references public.ambiente_pcs(id) on delete cascade,
  ambiente_id      bigint      references public.ambientes(id) on delete set null,
  turno_trabajo_id bigint      references public.turnos_trabajo(id) on delete set null,
  tipo             text        not null check (tipo in ('preventivo', 'correctivo')),
  descripcion      text        not null,
  acciones         text,
  estado           text        not null default 'realizado'
                   check (estado in ('pendiente', 'en_proceso', 'realizado')),
  auxiliar_id      uuid        default auth.uid() references public.perfiles(id) on delete set null,
  fecha            date        not null default (now() at time zone 'America/La_Paz')::date,
  creado_en        timestamptz not null default now(),
  actualizado_en   timestamptz not null default now()
);
create index if not exists mantenimientos_pc_idx on public.mantenimientos (pc_id, fecha desc);

comment on table public.mantenimientos is 'Mantenimiento preventivo y correctivo de cada PC.';

create trigger trg_mantenimientos_actualizado
  before update on public.mantenimientos
  for each row execute function public.fn_set_actualizado_en();

-- ---------------------------------------------------------------------
-- 6) Seguridad de las tablas de operación
--    Leen todos los usuarios activos; escriben los de operación.
-- ---------------------------------------------------------------------
alter table public.turnos_trabajo enable row level security;
alter table public.atenciones     enable row level security;
alter table public.mantenimientos enable row level security;

do $$
declare t text;
begin
  foreach t in array array['turnos_trabajo', 'atenciones', 'mantenimientos'] loop
    execute format('drop policy if exists %I on public.%I', t || '_ver', t);
    execute format('drop policy if exists %I on public.%I', t || '_crear', t);
    execute format('drop policy if exists %I on public.%I', t || '_editar', t);
    execute format('drop policy if exists %I on public.%I', t || '_borrar', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.fn_puede_ver())', t || '_ver', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.fn_puede_operar())', t || '_crear', t);
    execute format('create policy %I on public.%I for update to authenticated using (public.fn_puede_operar()) with check (public.fn_puede_operar())', t || '_editar', t);
    execute format('create policy %I on public.%I for delete to authenticated using (public.fn_puede_operar())', t || '_borrar', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 7) Generar PCs de un laboratorio con nomenclatura SCPC
--    SCPC + número de lab + número de máquina (2 dígitos).
--    Ej.: LAB-03, máquina 1 -> SCPC0301
-- ---------------------------------------------------------------------
create or replace function public.fn_generar_pcs(p_ambiente_id bigint, p_cantidad int)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_lab text; v_num text; v_i int; v_etq text; v_orden int; v_creadas int := 0;
begin
  if not public.fn_puede_operar() then
    raise exception 'No tiene permisos para generar PCs.';
  end if;
  if p_cantidad is null or p_cantidad < 1 or p_cantidad > 100 then
    raise exception 'Cantidad inválida (1 a 100).';
  end if;
  select codigo into v_lab from public.ambientes where id = p_ambiente_id;
  if v_lab is null then raise exception 'Laboratorio no encontrado.'; end if;

  -- número del lab tomado del código (LAB-03 -> "03"); si no hay dígitos, usa el id
  v_num := coalesce(nullif(regexp_replace(v_lab, '\D', '', 'g'), ''), p_ambiente_id::text);
  select coalesce(max(orden), 0) into v_orden from public.ambiente_pcs where ambiente_id = p_ambiente_id;

  for v_i in 1..p_cantidad loop
    v_etq := 'SCPC' || v_num || lpad(v_i::text, 2, '0');
    if not exists (select 1 from public.ambiente_pcs where ambiente_id = p_ambiente_id and etiqueta = v_etq) then
      v_orden := v_orden + 1;
      insert into public.ambiente_pcs (ambiente_id, etiqueta, estado, orden)
      values (p_ambiente_id, v_etq, 'operativa', v_orden);
      v_creadas := v_creadas + 1;
    end if;
  end loop;
  return v_creadas;
end $$;

-- ---------------------------------------------------------------------
-- 8) Perfiles visibles para todos los usuarios activos (solo lectura)
--    Así se ve el nombre de quién abrió/cerró el turno y quién registró
--    cada atención o mantenimiento. La edición sigue siendo solo admin.
-- ---------------------------------------------------------------------
drop policy if exists perfiles_ver on public.perfiles;
create policy perfiles_ver on public.perfiles
  for select to authenticated using (public.fn_puede_ver());

-- Permisos
revoke all on public.turnos_trabajo, public.atenciones, public.mantenimientos from anon;
revoke execute on function public.fn_generar_pcs(bigint, int) from anon, public;
grant execute on all functions in schema public to authenticated;
