-- =====================================================================
--  SISTEMA DE ASIGNACIÓN DE LABORATORIOS — UPDS
--  Script 56: AGENTE DE INVENTARIO DE PCs
--  - El programa agente-pcs (Go) corre como servicio en cada PC y manda un
--    "latido" cada 5 minutos con la huella de su hardware. El inventario
--    completo solo viaja la primera vez o cuando el hardware cambió.
--  - Nombre SCPC + nº lab + 2 dígitos (SCPC120 = LAB-01, PC 20): la PC se
--    ubica en su laboratorio. Si la figurita ya existe se REUSA (mismo id,
--    se conserva su historial de tickets); si no existe, se crea.
--  - Cualquier otro nombre (PC personal, PCDOCENTE…) va al ambiente OTROS.
--  - Fuera de dominio, lab inexistente, nombre duplicado, cambio de hardware
--    o agente sin señal: queda una alerta en pc_alertas.
--  - SOLO AGREGA: no borra ni cambia columnas existentes. De ambiente_pcs
--    solo escribe procesador, ram y almacenamiento (y crea filas nuevas).
--  Ejecutar en: Supabase > SQL Editor (después de 55).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Ambiente OTROS: PCs que no son de ningún laboratorio.
--    tipo 'otro' + estado 'baja' a propósito: así NO aparece en horarios,
--    asignaciones, reservas, reubicaciones ni dashboards (todos filtran
--    tipo = 'laboratorio' o estado activo).
-- ---------------------------------------------------------------------
insert into public.ambientes (codigo, nombre, tipo, capacidad, estado, color, orden)
values ('OTROS', 'Otros (PCs sin laboratorio)', 'otro', 0, 'baja', '#64748b', 999)
on conflict (codigo) do nothing;

-- ---------------------------------------------------------------------
-- 2) Configuración del agente (una sola fila)
--    activo = false detiene al instante todo lo que escribe el agente.
--    token_hash = SHA-256 del token que lleva el agente (el token no se guarda).
-- ---------------------------------------------------------------------
create table if not exists public.agente_pcs_config (
  id              smallint    primary key default 1 check (id = 1),
  activo          boolean     not null default true,
  token_hash      text        not null,
  minutos_apagada integer     not null default 12 check (minutos_apagada between 2 and 60), -- latido cada 5 min
  actualizado_en  timestamptz not null default now()
);
comment on table public.agente_pcs_config is 'Interruptor y token del agente de inventario de PCs.';

insert into public.agente_pcs_config (id, token_hash)
values (1, '8121f3704139675737db156af80d2d7d4fb011338a589c50cc3d53840331e06d')
on conflict (id) do nothing;

-- Sin políticas: solo se lee desde las funciones del agente o el SQL Editor
alter table public.agente_pcs_config enable row level security;
revoke all on public.agente_pcs_config from anon, authenticated;

-- ---------------------------------------------------------------------
-- 3) Equipos físicos que reportó el agente (uno por máquina)
-- ---------------------------------------------------------------------
create table if not exists public.pc_equipos (
  id                     bigint      generated always as identity primary key,
  identificador          text        not null unique,             -- UUID de hardware (o serie / MAC)
  pc_id                  bigint      unique references public.ambiente_pcs(id) on delete set null, -- su figurita
  nombre_equipo          text        not null,
  en_dominio             boolean     not null default false,
  dominio                text,
  fabricante             text,
  modelo                 text,
  numero_serie           text,
  procesador             text,
  nucleos                integer,
  hilos                  integer,
  memoria_total_gb       numeric(8,2),
  placa_fabricante       text,
  placa_modelo           text,
  placa_serie            text,
  sistema_operativo      text,
  version_so             text,
  arquitectura           text,
  ip                     text,
  mac                    text,
  version_agente         text,
  resumen_procesador     text,                                     -- lo último que el agente puso en la figurita
  resumen_ram            text,
  resumen_almacenamiento text,
  huella                 text,                                     -- SHA-256 del hardware: si no cambia, no se reenvía el inventario
  inventario_en          timestamptz,
  creado_en              timestamptz not null default now(),
  actualizado_en         timestamptz not null default now()
);
comment on table public.pc_equipos is 'Máquinas que reporta el agente de inventario; pc_id es su figurita en ambiente_pcs.';

drop trigger if exists trg_pc_equipos_actualizado on public.pc_equipos;
create trigger trg_pc_equipos_actualizado
  before update on public.pc_equipos
  for each row execute function public.fn_set_actualizado_en();

-- ---------------------------------------------------------------------
-- 3b) Último latido de cada equipo, en una tabla ANGOSTA aparte:
--     se actualiza cada pocos minutos, así que cada cambio copia una fila
--     de ~60 bytes (no la fila completa del equipo). fillfactor 50 deja
--     espacio libre en cada página para que Postgres reescriba en el mismo
--     lugar (HOT) y la tabla no crezca.
-- ---------------------------------------------------------------------
create table if not exists public.pc_latidos (
  equipo_id       bigint      primary key references public.pc_equipos(id) on delete cascade,
  ultimo_latido   timestamptz not null default now(),   -- prendida si es reciente
  encendido_desde timestamptz                            -- arranque de Windows
) with (fillfactor = 50);
comment on table public.pc_latidos is 'Último aviso de cada equipo del agente (prendida / apagada).';

-- ---------------------------------------------------------------------
-- 4) Componentes de cada equipo (se reemplazan en cada inventario)
-- ---------------------------------------------------------------------
create table if not exists public.pc_componentes (
  id           bigint        generated always as identity primary key,
  equipo_id    bigint        not null references public.pc_equipos(id) on delete cascade,
  tipo         text          not null check (tipo in ('ram', 'disco', 'video', 'red')),
  descripcion  text          not null,          -- modelo o nombre
  fabricante   text,
  capacidad_gb numeric(10,2),
  detalle      text,                            -- "DDR4 · 3200 MHz", "SSD · NVMe", "MAC … · 192.168…"
  ranura       text,
  numero_serie text,
  orden        smallint      not null default 0
);
create index if not exists pc_componentes_equipo_idx on public.pc_componentes (equipo_id, tipo, orden);
comment on table public.pc_componentes is 'RAM, discos, video y red de cada equipo, según el último inventario.';

-- ---------------------------------------------------------------------
-- 5) Alertas del agente (una abierta por equipo y tipo)
-- ---------------------------------------------------------------------
create table if not exists public.pc_alertas (
  id           bigint      generated always as identity primary key,
  equipo_id    bigint      not null references public.pc_equipos(id) on delete cascade,
  tipo         text        not null check (tipo in ('fuera_de_dominio', 'nombre_no_reconocido', 'laboratorio_no_valido',
                                                     'nombre_duplicado', 'cambio_hardware', 'agente_detenido')),
  detalle      text        not null,
  creada_en    timestamptz not null default now(),
  resuelta     boolean     not null default false,
  resuelta_por uuid        references public.perfiles(id) on delete set null,  -- null = se resolvió sola
  resuelta_en  timestamptz
);
create unique index if not exists pc_alertas_abierta_un on public.pc_alertas (equipo_id, tipo) where not resuelta;
create index if not exists pc_alertas_resuelta_por_idx on public.pc_alertas (resuelta_por);
comment on table public.pc_alertas is 'Alertas del agente de inventario (fuera de dominio, duplicados, cambios de hardware…).';

-- ---------------------------------------------------------------------
-- 6) Seguridad: leen los usuarios activos; escribe solo el agente
--    (por la función) y la operación resuelve alertas por RPC.
-- ---------------------------------------------------------------------
alter table public.pc_equipos     enable row level security;
alter table public.pc_latidos     enable row level security;
alter table public.pc_componentes enable row level security;
alter table public.pc_alertas     enable row level security;

drop policy if exists pc_equipos_ver     on public.pc_equipos;
drop policy if exists pc_latidos_ver     on public.pc_latidos;
drop policy if exists pc_componentes_ver on public.pc_componentes;
drop policy if exists pc_alertas_ver     on public.pc_alertas;
create policy pc_equipos_ver     on public.pc_equipos     for select to authenticated using (public.fn_puede_ver());
create policy pc_latidos_ver     on public.pc_latidos     for select to authenticated using (public.fn_puede_ver());
create policy pc_componentes_ver on public.pc_componentes for select to authenticated using (public.fn_puede_ver());
create policy pc_alertas_ver     on public.pc_alertas     for select to authenticated using (public.fn_puede_ver());

revoke all on public.pc_equipos, public.pc_latidos, public.pc_componentes, public.pc_alertas from anon, authenticated;
grant select on public.pc_equipos, public.pc_latidos, public.pc_componentes, public.pc_alertas to authenticated;

-- ---------------------------------------------------------------------
-- 7) Ayudantes internos
-- ---------------------------------------------------------------------

-- Texto limpio y recortado (null si viene vacío)
create or replace function public.fn_agente_texto(p_valor text, p_largo integer)
returns text language sql immutable set search_path = public as $$
  select left(nullif(btrim(p_valor), ''), p_largo);
$$;

-- Devuelve la lista JSON, o una lista vacía si no vino
create or replace function public.fn_agente_lista(p_valor jsonb)
returns jsonb language sql immutable set search_path = public as $$
  select case when jsonb_typeof(p_valor) = 'array' then p_valor else '[]'::jsonb end;
$$;

-- Abre (o actualiza) la alerta de un tipo para un equipo
create or replace function public.fn_agente_alerta(p_equipo_id bigint, p_tipo text, p_detalle text)
returns void language sql security definer set search_path = public as $$
  insert into public.pc_alertas (equipo_id, tipo, detalle)
  values (p_equipo_id, p_tipo, left(p_detalle, 500))
  on conflict (equipo_id, tipo) where not resuelta
  do update set detalle = excluded.detalle, creada_en = now();
$$;

-- Cierra sola una alerta que ya no aplica (ej. la PC entró al dominio)
create or replace function public.fn_agente_cerrar_alerta(p_equipo_id bigint, p_tipo text)
returns void language sql security definer set search_path = public as $$
  update public.pc_alertas set resuelta = true, resuelta_en = now()
   where equipo_id = p_equipo_id and tipo = p_tipo and not resuelta;
$$;

-- Fecha que manda el agente; null si viene vacía o es la "fecha cero" de Go (año 1)
create or replace function public.fn_agente_fecha(p_valor text)
returns timestamptz language plpgsql stable set search_path = public as $$
declare
  v_fecha timestamptz;
begin
  v_fecha := nullif(btrim(p_valor), '')::timestamptz;
  return case when v_fecha < timestamptz '2000-01-01' then null else v_fecha end;
exception when others then
  return null;
end $$;

-- Fecha y hora en Bolivia para los textos de las alertas
create or replace function public.fn_agente_hora(p_momento timestamptz)
returns text language sql stable set search_path = public as $$
  select to_char(p_momento at time zone 'America/La_Paz', 'DD/MM/YYYY HH24:MI');
$$;

-- ---------------------------------------------------------------------
-- 8) Latido: "sigo prendida". Si el equipo no existe, cambió de nombre o
--    su huella de hardware es otra, se le pide el inventario completo.
--    Si nada cambió, solo se actualiza la hora del latido.
-- ---------------------------------------------------------------------
create or replace function public.fn_agente_latido(p_identificador text, p_datos jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_equipo_id bigint;
  v_nombre    text;
  v_huella    text;
  v_latido    public.pc_latidos;
  v_encendido timestamptz := public.fn_agente_fecha(p_datos->>'encendidoDesde');
  v_minutos   integer;
begin
  select id, nombre_equipo, huella into v_equipo_id, v_nombre, v_huella from public.pc_equipos where identificador = p_identificador;
  if v_equipo_id is null then
    return jsonb_build_object('ok', true, 'necesitaInventario', true);
  end if;
  select * into v_latido from public.pc_latidos where equipo_id = v_equipo_id for update;

  -- Hubo un hueco sin señal y Windows NO se reinició en ese tiempo:
  -- el agente estuvo detenido (o sin red, o la PC suspendida).
  select minutos_apagada into v_minutos from public.agente_pcs_config where id = 1;
  if v_latido.ultimo_latido is not null
     and now() - v_latido.ultimo_latido > make_interval(mins => v_minutos)
     and v_encendido is not null and v_encendido < v_latido.ultimo_latido then
    perform public.fn_agente_alerta(v_equipo_id, 'agente_detenido',
      format('Sin señal entre %s y %s aunque la PC no se reinició (agente detenido, sin red o PC suspendida).',
             public.fn_agente_hora(v_latido.ultimo_latido), public.fn_agente_hora(now())));
  end if;

  -- Solo se toca la fila angosta del latido (la del equipo queda igual)
  insert into public.pc_latidos (equipo_id, ultimo_latido, encendido_desde)
  values (v_equipo_id, now(), v_encendido)
  on conflict (equipo_id) do update set
    ultimo_latido   = now(),
    encendido_desde = coalesce(excluded.encendido_desde, pc_latidos.encendido_desde);

  return jsonb_build_object('ok', true,
    'necesitaInventario', v_nombre is distinct from upper(btrim(coalesce(p_datos->>'nombreEquipo', '')))
                          or v_huella is distinct from public.fn_agente_texto(p_datos->>'huella', 64));
end $$;

-- ---------------------------------------------------------------------
-- 9) Inventario completo: ubica la PC, reusa o crea su figurita, guarda
--    los componentes y abre o cierra las alertas.
-- ---------------------------------------------------------------------
create or replace function public.fn_agente_inventario(p_identificador text, p_datos jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_inv          jsonb   := p_datos->'inventario';
  v_etiqueta     text    := left(upper(btrim(coalesce(v_inv->>'nombreEquipo', ''))), 30);
  v_en_dominio   boolean := coalesce((v_inv->>'enDominio')::boolean, false);
  v_res_cpu      text    := public.fn_agente_texto(v_inv#>>'{resumen,procesador}', 60);
  v_res_ram      text    := public.fn_agente_texto(v_inv#>>'{resumen,ram}', 60);
  v_res_disco    text    := public.fn_agente_texto(v_inv#>>'{resumen,almacenamiento}', 60);
  v_red          jsonb   := public.fn_agente_lista(v_inv->'redes')->0;
  v_minutos      integer;
  v_otros_id     bigint;
  v_partes       text[];
  v_num_lab      integer;
  v_num_pc       integer;
  v_codigo       text;
  v_lab          public.ambientes;
  v_ambiente_id  bigint;
  v_existia      boolean;
  v_anterior     public.pc_equipos;
  v_equipo       public.pc_equipos;
  v_otro         public.pc_equipos;
  v_pc           public.ambiente_pcs;
  v_pc_anterior  public.ambiente_pcs;
  v_tipos        text[]  := '{}';   -- alertas que aplican hoy
  v_detalles     text[]  := '{}';
  v_cambios      text[]  := '{}';
  v_tipo         text;
  i              integer;
begin
  if v_etiqueta = '' then
    raise exception 'Falta el nombre del equipo.';
  end if;
  -- Dos PCs con el mismo nombre no se procesan a la vez
  perform pg_advisory_xact_lock(hashtext('agente_pcs:' || v_etiqueta));

  select minutos_apagada into v_minutos from public.agente_pcs_config where id = 1;
  select id into v_otros_id from public.ambientes where codigo = 'OTROS';
  if v_otros_id is null then
    raise exception 'Falta el ambiente OTROS: ejecute el script 56 completo.';
  end if;

  -- 1) Cómo estaba el equipo antes de este inventario
  select * into v_anterior from public.pc_equipos where identificador = p_identificador for update;
  v_existia := found;

  -- 2) Guarda los datos del equipo
  insert into public.pc_equipos as e (
    identificador, nombre_equipo, en_dominio, dominio, fabricante, modelo, numero_serie,
    procesador, nucleos, hilos, memoria_total_gb, placa_fabricante, placa_modelo, placa_serie,
    sistema_operativo, version_so, arquitectura, ip, mac, version_agente, huella, inventario_en)
  values (
    p_identificador, v_etiqueta, v_en_dominio,
    case when v_en_dominio then public.fn_agente_texto(v_inv->>'dominio', 120) end,
    public.fn_agente_texto(v_inv->>'fabricante', 120),
    public.fn_agente_texto(v_inv->>'modelo', 120),
    public.fn_agente_texto(v_inv->>'numeroSerie', 120),
    public.fn_agente_texto(v_inv#>>'{procesador,nombre}', 120),
    nullif(v_inv#>>'{procesador,nucleos}', '')::integer,
    nullif(v_inv#>>'{procesador,hilos}', '')::integer,
    round(nullif(v_inv->>'memoriaTotalGb', '')::numeric, 2),
    public.fn_agente_texto(v_inv#>>'{placaMadre,fabricante}', 120),
    public.fn_agente_texto(v_inv#>>'{placaMadre,modelo}', 120),
    public.fn_agente_texto(v_inv#>>'{placaMadre,numeroSerie}', 120),
    public.fn_agente_texto(v_inv#>>'{sistemaOperativo,nombre}', 120),
    public.fn_agente_texto(v_inv#>>'{sistemaOperativo,version}', 40),
    public.fn_agente_texto(v_inv#>>'{sistemaOperativo,arquitectura}', 40),
    public.fn_agente_texto(v_red#>>'{ips,0}', 60),
    public.fn_agente_texto(v_red->>'mac', 40),
    public.fn_agente_texto(p_datos->>'versionAgente', 20),
    public.fn_agente_texto(p_datos->>'huella', 64),
    now())
  on conflict (identificador) do update set
    nombre_equipo = excluded.nombre_equipo, en_dominio = excluded.en_dominio, dominio = excluded.dominio,
    fabricante = excluded.fabricante, modelo = excluded.modelo, numero_serie = excluded.numero_serie,
    procesador = excluded.procesador, nucleos = excluded.nucleos, hilos = excluded.hilos,
    memoria_total_gb = excluded.memoria_total_gb, placa_fabricante = excluded.placa_fabricante,
    placa_modelo = excluded.placa_modelo, placa_serie = excluded.placa_serie,
    sistema_operativo = excluded.sistema_operativo, version_so = excluded.version_so,
    arquitectura = excluded.arquitectura, ip = excluded.ip, mac = excluded.mac,
    version_agente = excluded.version_agente, huella = excluded.huella, inventario_en = now()
  returning * into v_equipo;

  -- El inventario también cuenta como latido
  insert into public.pc_latidos (equipo_id, ultimo_latido, encendido_desde)
  values (v_equipo.id, now(), public.fn_agente_fecha(v_inv#>>'{sistemaOperativo,encendidoDesde}'))
  on conflict (equipo_id) do update set ultimo_latido = now(), encendido_desde = excluded.encendido_desde;

  -- 3) ¿A qué laboratorio va? SCPC + lab (1 a 3 dígitos) + PC (2 dígitos)
  v_partes := regexp_match(v_etiqueta, '^SCPC([0-9]{1,3})([0-9]{2})$');
  if v_partes is not null then
    v_num_lab := v_partes[1]::integer;
    v_num_pc  := v_partes[2]::integer;
  end if;

  if coalesce(v_num_lab, 0) >= 1 and coalesce(v_num_pc, 0) >= 1 then
    v_codigo := 'LAB-' || lpad(v_num_lab::text, 2, '0');
    select * into v_lab from public.ambientes where codigo = v_codigo and tipo = 'laboratorio';
    if not found or v_lab.estado = 'baja' then
      v_ambiente_id := v_otros_id;
      v_tipos    := v_tipos || 'laboratorio_no_valido'::text;
      v_detalles := v_detalles || format('%s apunta a %s, que %s.', v_etiqueta, v_codigo,
                                         case when v_lab.id is null then 'no existe' else 'está dado de baja' end);
    else
      v_ambiente_id := v_lab.id;
      if not v_en_dominio then
        v_tipos    := v_tipos || 'fuera_de_dominio'::text;
        v_detalles := v_detalles || format('%s tiene nombre institucional pero no está en el dominio.', v_etiqueta);
      end if;
    end if;
  else
    v_ambiente_id := v_otros_id;
    v_tipos    := v_tipos || 'nombre_no_reconocido'::text;
    v_detalles := v_detalles || format('"%s" no sigue el formato SCPC + laboratorio + número de PC.', v_etiqueta);
  end if;

  -- 4) Figurita en un laboratorio: se reusa la que tiene ese nombre
  if v_ambiente_id <> v_otros_id then
    select * into v_pc from public.ambiente_pcs
     where ambiente_id = v_ambiente_id and upper(btrim(etiqueta)) = v_etiqueta and not es_docente
     order by id limit 1;

    if found then
      select * into v_otro from public.pc_equipos where pc_id = v_pc.id and id <> v_equipo.id;
      if found and exists (select 1 from public.pc_latidos l where l.equipo_id = v_otro.id
                            and l.ultimo_latido > now() - make_interval(mins => v_minutos)) then
        -- Otra máquina prendida ya usa ese nombre: esta va a OTROS
        v_tipos    := v_tipos || 'nombre_duplicado'::text;
        v_detalles := v_detalles || format('Otra PC prendida (serie %s) ya usa el nombre %s.', coalesce(v_otro.numero_serie, '—'), v_etiqueta);
        v_ambiente_id := v_otros_id;
        v_pc := null;
      elsif found then
        -- La máquina vieja dejó de reportarse: esta la reemplaza
        update public.pc_equipos set pc_id = null where id = v_otro.id;
        v_tipos    := v_tipos || 'cambio_hardware'::text;
        v_detalles := v_detalles || format('%s ahora es otra máquina (serie %s → %s).', v_etiqueta,
                                           coalesce(v_otro.numero_serie, '—'), coalesce(v_equipo.numero_serie, '—'));
      end if;
    else
      insert into public.ambiente_pcs (ambiente_id, etiqueta, estado, orden, es_docente)
      values (v_ambiente_id, v_etiqueta, 'operativa', v_num_pc, false)
      returning * into v_pc;
    end if;
  end if;

  -- 5) Figurita en OTROS: la suya si ya la tenía, o una libre con su nombre, o una nueva
  if v_ambiente_id = v_otros_id then
    select p.* into v_pc from public.ambiente_pcs p
     where p.ambiente_id = v_otros_id and upper(btrim(p.etiqueta)) = v_etiqueta
       and not exists (select 1 from public.pc_equipos e where e.pc_id = p.id and e.id <> v_equipo.id)
     order by (p.id = v_anterior.pc_id) desc nulls last, p.id
     limit 1;
    if not found then
      insert into public.ambiente_pcs (ambiente_id, etiqueta, estado, orden, es_docente)
      values (v_otros_id, v_etiqueta, 'operativa',
              coalesce((select max(orden) from public.ambiente_pcs where ambiente_id = v_otros_id), 0) + 1, false)
      returning * into v_pc;
    end if;
  end if;

  -- 6) Si cambió de figurita (la renombraron o la movieron): la vieja queda "sin agente".
  --    Si la vieja era de OTROS y no tiene tickets, se borra para no dejar basura.
  if v_existia and v_anterior.pc_id is not null and v_anterior.pc_id <> v_pc.id then
    update public.pc_equipos set pc_id = null where id = v_equipo.id;
    select * into v_pc_anterior from public.ambiente_pcs where id = v_anterior.pc_id;
    if found and v_pc_anterior.ambiente_id = v_otros_id
       and not exists (select 1 from public.atenciones where pc_id = v_pc_anterior.id)
       and not exists (select 1 from public.solicitudes_baja where pc_id = v_pc_anterior.id) then
      delete from public.ambiente_pcs where id = v_pc_anterior.id;
    end if;
  end if;
  update public.pc_equipos set pc_id = v_pc.id where id = v_equipo.id;

  -- 7) Componentes: se reemplazan por los del inventario actual
  delete from public.pc_componentes where equipo_id = v_equipo.id;

  insert into public.pc_componentes (equipo_id, tipo, descripcion, fabricante, capacidad_gb, detalle, ranura, numero_serie, orden)
  select v_equipo.id, 'ram',
         coalesce(public.fn_agente_texto(m->>'numeroParte', 120), 'Módulo de RAM'),
         public.fn_agente_texto(m->>'fabricante', 60),
         round(nullif(m->>'capacidadGb', '')::numeric, 2),
         nullif(concat_ws(' · ', public.fn_agente_texto(m->>'tipo', 10),
                          case when nullif(m->>'velocidadMhz', '')::numeric > 0 then (m->>'velocidadMhz') || ' MHz' end), ''),
         public.fn_agente_texto(m->>'ranura', 40),
         public.fn_agente_texto(m->>'numeroSerie', 80),
         o
    from jsonb_array_elements(public.fn_agente_lista(v_inv->'modulosRam')) with ordinality as x(m, o);

  insert into public.pc_componentes (equipo_id, tipo, descripcion, capacidad_gb, detalle, numero_serie, orden)
  select v_equipo.id, 'disco',
         coalesce(public.fn_agente_texto(d->>'modelo', 120), 'Disco'),
         round(nullif(d->>'capacidadGb', '')::numeric, 2),
         nullif(concat_ws(' · ', nullif(d->>'tipo', 'Desconocido'), public.fn_agente_texto(d->>'conexion', 20)), ''),
         public.fn_agente_texto(d->>'numeroSerie', 80),
         o
    from jsonb_array_elements(public.fn_agente_lista(v_inv->'discos')) with ordinality as x(d, o);

  insert into public.pc_componentes (equipo_id, tipo, descripcion, detalle, orden)
  select v_equipo.id, 'video',
         coalesce(public.fn_agente_texto(t->>'nombre', 120), 'Tarjeta de video'),
         'Driver ' || public.fn_agente_texto(t->>'versionDriver', 40),
         o
    from jsonb_array_elements(public.fn_agente_lista(v_inv->'tarjetasVideo')) with ordinality as x(t, o);

  insert into public.pc_componentes (equipo_id, tipo, descripcion, detalle, orden)
  select v_equipo.id, 'red',
         coalesce(public.fn_agente_texto(r->>'descripcion', 120), 'Adaptador de red'),
         nullif(concat_ws(' · ', 'MAC ' || public.fn_agente_texto(r->>'mac', 40),
                          (select string_agg(ip, ', ') from jsonb_array_elements_text(public.fn_agente_lista(r->'ips')) ip)), ''),
         o
    from jsonb_array_elements(public.fn_agente_lista(v_inv->'redes')) with ordinality as x(r, o);

  -- 8) Cambio de hardware respecto del inventario anterior
  if v_existia and v_anterior.inventario_en is not null then
    if v_anterior.resumen_procesador is distinct from v_res_cpu then
      v_cambios := v_cambios || format('Procesador: %s → %s', coalesce(v_anterior.resumen_procesador, '—'), coalesce(v_res_cpu, '—'));
    end if;
    if v_anterior.resumen_ram is distinct from v_res_ram then
      v_cambios := v_cambios || format('RAM: %s → %s', coalesce(v_anterior.resumen_ram, '—'), coalesce(v_res_ram, '—'));
    end if;
    if v_anterior.resumen_almacenamiento is distinct from v_res_disco then
      v_cambios := v_cambios || format('Almacenamiento: %s → %s', coalesce(v_anterior.resumen_almacenamiento, '—'), coalesce(v_res_disco, '—'));
    end if;
    if cardinality(v_cambios) > 0 then
      perform public.fn_agente_alerta(v_equipo.id, 'cambio_hardware', v_etiqueta || ': ' || array_to_string(v_cambios, '; '));
    end if;
  end if;

  -- 9) Textos de la figurita: el agente los llena si están vacíos o si los
  --    puso él antes; si alguien los escribió a mano, no se tocan.
  update public.ambiente_pcs p set
    procesador     = case when p.procesador is null or p.procesador = v_anterior.resumen_procesador then v_res_cpu else p.procesador end,
    ram            = case when p.ram is null or p.ram = v_anterior.resumen_ram then v_res_ram else p.ram end,
    almacenamiento = case when p.almacenamiento is null or p.almacenamiento = v_anterior.resumen_almacenamiento then v_res_disco else p.almacenamiento end
  where p.id = v_pc.id
    and (p.procesador, p.ram, p.almacenamiento) is distinct from (
      case when p.procesador is null or p.procesador = v_anterior.resumen_procesador then v_res_cpu else p.procesador end,
      case when p.ram is null or p.ram = v_anterior.resumen_ram then v_res_ram else p.ram end,
      case when p.almacenamiento is null or p.almacenamiento = v_anterior.resumen_almacenamiento then v_res_disco else p.almacenamiento end);

  update public.pc_equipos set
    resumen_procesador = v_res_cpu, resumen_ram = v_res_ram, resumen_almacenamiento = v_res_disco
  where id = v_equipo.id;

  -- 10) Abre las alertas que aplican y cierra solas las que ya no
  for i in 1 .. coalesce(array_length(v_tipos, 1), 0) loop
    perform public.fn_agente_alerta(v_equipo.id, v_tipos[i], v_detalles[i]);
  end loop;
  foreach v_tipo in array array['fuera_de_dominio', 'nombre_no_reconocido', 'laboratorio_no_valido', 'nombre_duplicado'] loop
    if not v_tipo = any (v_tipos) then
      perform public.fn_agente_cerrar_alerta(v_equipo.id, v_tipo);
    end if;
  end loop;
  -- Las alertas ya resueltas se guardan 90 días (para no acumular filas)
  delete from public.pc_alertas where equipo_id = v_equipo.id and resuelta and resuelta_en < now() - interval '90 days';

  return jsonb_build_object('ok', true, 'etiqueta', v_etiqueta, 'pcId', v_pc.id,
    'laboratorio', (select codigo from public.ambientes where id = v_ambiente_id), 'alertas', to_jsonb(v_tipos));
end $$;

-- ---------------------------------------------------------------------
-- 10) Punto de entrada del agente (lo llama con la clave pública + su token)
-- ---------------------------------------------------------------------
create or replace function public.rpc_agente_reportar(p_token text, p_datos jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_config        public.agente_pcs_config;
  v_identificador text := public.fn_agente_texto(p_datos->>'identificador', 120);
begin
  select * into v_config from public.agente_pcs_config where id = 1;
  if not found or encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex') <> v_config.token_hash then
    raise exception 'Token del agente inválido.' using errcode = '42501';
  end if;
  -- Interruptor: con activo = false el agente no escribe nada
  if not v_config.activo then
    return jsonb_build_object('ok', false, 'motivo', 'El agente está desactivado en el servidor.');
  end if;
  if v_identificador is null then
    raise exception 'Falta el identificador del equipo.';
  end if;

  case p_datos->>'tipo'
    when 'latido'     then return public.fn_agente_latido(v_identificador, p_datos);
    when 'inventario' then return public.fn_agente_inventario(v_identificador, p_datos);
    else raise exception 'Tipo de reporte inválido.';
  end case;
end $$;

-- ---------------------------------------------------------------------
-- 11) La operación marca una alerta como revisada
-- ---------------------------------------------------------------------
create or replace function public.rpc_resolver_alerta_pc(p_id bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.fn_puede_operar() then
    raise exception 'Solo el personal de operación puede marcar alertas como revisadas.';
  end if;
  update public.pc_alertas set resuelta = true, resuelta_por = auth.uid(), resuelta_en = now()
   where id = p_id and not resuelta;
end $$;

-- ---------------------------------------------------------------------
-- 12) Permisos de las funciones
-- ---------------------------------------------------------------------
revoke execute on function public.fn_agente_alerta(bigint, text, text), public.fn_agente_cerrar_alerta(bigint, text),
  public.fn_agente_latido(text, jsonb), public.fn_agente_inventario(text, jsonb)
  from anon, authenticated, public;
revoke execute on function public.rpc_agente_reportar(text, jsonb) from public;
grant execute on function public.rpc_agente_reportar(text, jsonb) to anon, authenticated;
revoke execute on function public.rpc_resolver_alerta_pc(bigint) from anon, public;
grant execute on function public.rpc_resolver_alerta_pc(bigint) to authenticated;
