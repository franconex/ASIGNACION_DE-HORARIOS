-- =====================================================================
--  SISTEMA DE ASIGNACIÓN DE LABORATORIOS — UPDS
--  Script 57: PRENDIDA / APAGADA AL INSTANTE
--  - Solo dos estados: prendida o apagada (el motivo no importa).
--  - El agente avisa "me prendí" al arrancar y "me apago" al apagar
--    Windows o al detener / deshabilitar el servicio.
--  - Sin energía o PC colgada (no alcanza a avisar): una tarea de pg_cron
--    revisa cada minuto y la marca apagada a los minutos_apagada sin latido.
--  - pc_conexion se escribe SOLO cuando el estado cambia, y Supabase
--    Realtime lo envía a la página al instante (la página ya no pregunta
--    cada 2 minutos). La base no crece: una fila por PC.
--  - Se quitan las alertas de PCs: solo se muestra si está fuera del dominio.
--  Ejecutar en: Supabase > SQL Editor (después de 56).
-- =====================================================================

-- 1) Prendida o apagada de cada equipo, y desde cuándo
create table if not exists public.pc_conexion (
  equipo_id bigint      primary key references public.pc_equipos(id) on delete cascade,
  prendida  boolean     not null,
  cambio_en timestamptz not null default now()
);
comment on table public.pc_conexion is 'Prendida o apagada de cada equipo; solo se escribe cuando cambia (Realtime la envía a la página).';

alter table public.pc_conexion enable row level security;
create policy pc_conexion_ver on public.pc_conexion for select to authenticated using (public.fn_puede_ver());
revoke all on public.pc_conexion from anon, authenticated;
grant select on public.pc_conexion to authenticated;

-- Realtime: la página recibe cada cambio al instante (respeta la política de arriba)
alter publication supabase_realtime add table public.pc_conexion;

-- Equipos que ya existían: su estado según el último latido
insert into public.pc_conexion (equipo_id, prendida, cambio_en)
select l.equipo_id,
       l.ultimo_latido > now() - make_interval(mins => (select minutos_apagada from public.agente_pcs_config where id = 1)),
       l.ultimo_latido
  from public.pc_latidos l
on conflict (equipo_id) do nothing;

-- 2) Cambia el estado SOLO si es distinto (si no, no escribe nada y Realtime no envía nada)
create or replace function public.fn_agente_conexion(p_equipo_id bigint, p_prendida boolean)
returns void language sql security definer set search_path = public as $$
  insert into public.pc_conexion (equipo_id, prendida, cambio_en)
  values (p_equipo_id, p_prendida, now())
  on conflict (equipo_id) do update
    set prendida = excluded.prendida, cambio_en = excluded.cambio_en
    where pc_conexion.prendida is distinct from excluded.prendida;
$$;

-- 3) Aviso del agente: "encendida" o "apagada"
create or replace function public.fn_agente_evento(p_identificador text, p_datos jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_equipo public.pc_equipos;
begin
  select * into v_equipo from public.pc_equipos where identificador = p_identificador;
  if not found then
    -- Equipo nuevo: primero tiene que mandar su inventario
    return jsonb_build_object('ok', true, 'necesitaInventario', p_datos->>'evento' = 'encendida');
  end if;

  if p_datos->>'evento' = 'apagada' then
    perform public.fn_agente_conexion(v_equipo.id, false);
    return jsonb_build_object('ok', true);
  end if;

  -- "encendida": cuenta también como latido
  insert into public.pc_latidos (equipo_id, ultimo_latido, encendido_desde)
  values (v_equipo.id, now(), public.fn_agente_fecha(p_datos->>'encendidoDesde'))
  on conflict (equipo_id) do update set
    ultimo_latido = now(), encendido_desde = coalesce(excluded.encendido_desde, pc_latidos.encendido_desde);
  perform public.fn_agente_conexion(v_equipo.id, true);
  return jsonb_build_object('ok', true,
    'necesitaInventario', v_equipo.nombre_equipo is distinct from upper(btrim(coalesce(p_datos->>'nombreEquipo', '')))
                          or v_equipo.huella is distinct from public.fn_agente_texto(p_datos->>'huella', 64));
end $$;

-- 4) Latido: actualiza la hora y confirma "prendida" (solo escribe en
--    pc_conexion si estaba apagada, por ejemplo tras volver la energía)
create or replace function public.fn_agente_latido(p_identificador text, p_datos jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_equipo_id bigint;
  v_nombre    text;
  v_huella    text;
begin
  select id, nombre_equipo, huella into v_equipo_id, v_nombre, v_huella from public.pc_equipos where identificador = p_identificador;
  if v_equipo_id is null then
    return jsonb_build_object('ok', true, 'necesitaInventario', true);
  end if;

  insert into public.pc_latidos (equipo_id, ultimo_latido, encendido_desde)
  values (v_equipo_id, now(), public.fn_agente_fecha(p_datos->>'encendidoDesde'))
  on conflict (equipo_id) do update set
    ultimo_latido   = now(),
    encendido_desde = coalesce(excluded.encendido_desde, pc_latidos.encendido_desde);
  perform public.fn_agente_conexion(v_equipo_id, true);

  return jsonb_build_object('ok', true,
    'necesitaInventario', v_nombre is distinct from upper(btrim(coalesce(p_datos->>'nombreEquipo', '')))
                          or v_huella is distinct from public.fn_agente_texto(p_datos->>'huella', 64));
end $$;

-- 5) Punto de entrada del agente (agrega el tipo "evento"; el inventario cuenta como prendida)
create or replace function public.rpc_agente_reportar(p_token text, p_datos jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_config        public.agente_pcs_config;
  v_identificador text := public.fn_agente_texto(p_datos->>'identificador', 120);
  v_respuesta     jsonb;
begin
  select * into v_config from public.agente_pcs_config where id = 1;
  if not found or encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex') <> v_config.token_hash then
    raise exception 'Token del agente inválido.' using errcode = '42501';
  end if;
  if not v_config.activo then
    return jsonb_build_object('ok', false, 'motivo', 'El agente está desactivado en el servidor.');
  end if;
  if v_identificador is null then
    raise exception 'Falta el identificador del equipo.';
  end if;

  case p_datos->>'tipo'
    when 'latido' then return public.fn_agente_latido(v_identificador, p_datos);
    when 'evento' then return public.fn_agente_evento(v_identificador, p_datos);
    when 'inventario' then
      v_respuesta := public.fn_agente_inventario(v_identificador, p_datos);
      perform public.fn_agente_conexion(e.id, true) from public.pc_equipos e where e.identificador = v_identificador;
      return v_respuesta;
    else raise exception 'Tipo de reporte inválido.';
  end case;
end $$;

-- 6) Sin energía o PC colgada: cada minuto se marcan apagadas las que llevan
--    minutos_apagada sin latido (solo escribe las que cambian)
create or replace function public.fn_agente_marcar_sin_senal()
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_n integer;
begin
  update public.pc_conexion c set prendida = false, cambio_en = l.ultimo_latido
    from public.pc_latidos l, public.agente_pcs_config cfg
   where cfg.id = 1 and l.equipo_id = c.equipo_id and c.prendida
     and l.ultimo_latido < now() - make_interval(mins => cfg.minutos_apagada);
  get diagnostics v_n = row_count;
  return v_n;
end $$;

create extension if not exists pg_cron;
select cron.schedule('agente_pcs_sin_senal', '* * * * *', 'select public.fn_agente_marcar_sin_senal()');

-- pg_cron guarda un registro por cada ejecución (1.440 al día): sin esta
-- limpieza la base crecería ~12 MB al mes. Cada día a las 3:00 (hora de
-- Bolivia = 07:00 UTC) se borran los registros de más de 7 días.
select cron.schedule('limpiar_registro_cron', '0 7 * * *',
  $$delete from cron.job_run_details where end_time < now() - interval '7 days'$$);

-- 7) Sin alertas: la página solo muestra si una PC está fuera del dominio
--    (pc_equipos.en_dominio). El agente ya no guarda alertas. La tabla
--    pc_alertas y rpc_resolver_alerta_pc quedan sin uso (las usaba el script 56).
create or replace function public.fn_agente_alerta(p_equipo_id bigint, p_tipo text, p_detalle text)
returns void language plpgsql security definer set search_path = public as $$
begin
  null;  -- ya no se guardan alertas
end $$;

-- 8) Permisos
revoke execute on function public.fn_agente_conexion(bigint, boolean), public.fn_agente_evento(text, jsonb),
  public.fn_agente_latido(text, jsonb), public.fn_agente_marcar_sin_senal()
  from anon, authenticated, public;
revoke execute on function public.rpc_agente_reportar(text, jsonb) from public;
grant execute on function public.rpc_agente_reportar(text, jsonb) to anon, authenticated;
