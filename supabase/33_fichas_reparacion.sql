-- =====================================================================
--  SISTEMA DE ASIGNACIÓN DE LABORATORIOS — UPDS
--  Script 33: FICHA DE REPARACIÓN POR PC + CATÁLOGO DE FALLAS
--  - fallas_pc: lista de fallas (hardware, software, periféricos, red) que
--    admin y encargado mantienen; "Otra" se escribe a mano.
--  - Cada PC reparada / cambiada de estado / dada de baja es un ticket
--    CORRECTIVO con sus fallas (varias), diagnóstico, corrección, pieza
--    cambiada (opcional) y estado anterior → final.
--  - rpc_registrar_reparaciones: guarda todas las fichas de una vez
--    (validando cada una) y cambia el estado de cada PC. Lo usan
--    Atenciones (correctivo) y el croquis del laboratorio.
--  - fn_dashboard_fallas: fallas más repetidas, "otras" más escritas,
--    piezas más cambiadas y PCs reincidentes.
--  Ejecutar en: Supabase > SQL Editor (después de 32).
-- =====================================================================

-- 1) Catálogo de fallas
create table if not exists public.fallas_pc (
  id        bigint generated always as identity primary key,
  nombre    text not null check (char_length(trim(nombre)) between 2 and 60),
  categoria text not null default 'otro' check (categoria in ('hardware', 'software', 'perifericos', 'red', 'otro')),
  activo    boolean not null default true,
  orden     int not null default 100,
  creado_en timestamptz not null default now()
);
create unique index if not exists fallas_pc_nombre_uk on public.fallas_pc (lower(trim(nombre)));
comment on table public.fallas_pc is 'Fallas de PC para elegir en la ficha de reparación (las mantiene admin/encargado).';

insert into public.fallas_pc (nombre, categoria, orden) values
  ('No enciende', 'hardware', 10), ('Fuente de poder', 'hardware', 11), ('Memoria RAM', 'hardware', 12),
  ('Disco duro', 'hardware', 13), ('Placa madre', 'hardware', 14), ('Sobrecalentamiento', 'hardware', 15),
  ('Windows no inicia', 'software', 20), ('Pantalla azul', 'software', 21), ('Lenta', 'software', 22),
  ('Virus', 'software', 23), ('Programa no abre', 'software', 24),
  ('Teclado', 'perifericos', 30), ('Mouse', 'perifericos', 31), ('Monitor', 'perifericos', 32), ('Cable', 'perifericos', 33),
  ('Sin internet', 'red', 40)
on conflict do nothing;

alter table public.fallas_pc enable row level security;
drop policy if exists fallas_pc_ver on public.fallas_pc;
create policy fallas_pc_ver on public.fallas_pc for select to authenticated using (public.fn_puede_ver());
drop policy if exists fallas_pc_gestion on public.fallas_pc;
create policy fallas_pc_gestion on public.fallas_pc for all to authenticated
  using (public.fn_puede_gestionar_auxiliares()) with check (public.fn_puede_gestionar_auxiliares());
revoke all on public.fallas_pc from anon;

-- 2) Datos de la ficha en el ticket
alter table public.atenciones add column if not exists fallas bigint[] not null default '{}';
alter table public.atenciones add column if not exists falla_otra text;
alter table public.atenciones add column if not exists pieza text;
alter table public.atenciones add column if not exists estado_anterior text;
alter table public.atenciones add column if not exists estado_final text;
alter table public.atenciones drop constraint if exists atenciones_ficha_check;
alter table public.atenciones add constraint atenciones_ficha_check check (
  (falla_otra is null or char_length(falla_otra) <= 120)
  and (pieza is null or char_length(pieza) <= 60)
  and (estado_anterior is null or estado_anterior in ('operativa', 'inactiva', 'mantenimiento', 'baja'))
  and (estado_final is null or estado_final in ('operativa', 'inactiva', 'mantenimiento', 'baja')));
create index if not exists atenciones_fallas_idx on public.atenciones using gin (fallas);

-- 3) Guarda las fichas: un ticket correctivo por PC y su cambio de estado
create or replace function public.rpc_registrar_reparaciones(
  p_fichas jsonb, p_colaboradores uuid[] default '{}', p_prioridad int default 2)
returns integer language plpgsql set search_path = public as $$
declare
  f        jsonb;
  pc       record;
  v_lote   uuid;
  v_turno  bigint;
  v_n      int := 0;
  v_fallas bigint[];
  v_nombres text;
  v_otra   text;
  v_diag   text;
  v_corr   text;
  v_pieza  text;
  v_final  text;
  v_bajas  bigint[] := '{}';
begin
  if not public.fn_puede_operar() then
    raise exception 'No tiene permiso para registrar reparaciones.';
  end if;
  if jsonb_typeof(p_fichas) is distinct from 'array' or jsonb_array_length(p_fichas) = 0 then
    raise exception 'Elija al menos una PC.';
  end if;
  if jsonb_array_length(p_fichas) > 60 then
    raise exception 'Son demasiadas PCs a la vez (máximo 60).';
  end if;
  if jsonb_array_length(p_fichas) > 1 then
    v_lote := gen_random_uuid();
  end if;
  select id into v_turno from public.turnos_trabajo where estado = 'abierto' order by abierto_en desc limit 1;

  perform set_config('app.cambio_estado_pc', '1', true);
  for f in select * from jsonb_array_elements(p_fichas) loop
    select * into pc from public.ambiente_pcs where id = (f->>'pc_id')::bigint;
    if not found then
      raise exception 'Una de las PCs ya no existe: recargue la página.';
    end if;

    v_fallas := coalesce(array(select distinct x::bigint from jsonb_array_elements_text(coalesce(f->'fallas', '[]'::jsonb)) x), '{}');
    if exists (select 1 from unnest(v_fallas) i where not exists (select 1 from public.fallas_pc fp where fp.id = i)) then
      raise exception '%: una de las fallas elegidas ya no existe.', pc.etiqueta;
    end if;
    v_otra  := left(nullif(trim(f->>'falla_otra'), ''), 120);
    v_diag  := left(nullif(trim(f->>'diagnostico'), ''), 300);
    v_corr  := left(nullif(trim(f->>'correccion'), ''), 1000);
    v_pieza := left(nullif(trim(f->>'pieza'), ''), 60);
    v_final := f->>'estado_final';

    if cardinality(v_fallas) = 0 and v_otra is null then
      raise exception '%: elija al menos una falla o escriba la falla en "Otra".', pc.etiqueta;
    end if;
    if v_otra is not null and char_length(v_otra) < 3 then
      raise exception '%: describa la otra falla con al menos 3 letras.', pc.etiqueta;
    end if;
    if v_final is null or v_final not in ('operativa', 'inactiva', 'mantenimiento', 'baja') then
      raise exception '%: elija cómo queda la PC (estado final).', pc.etiqueta;
    end if;
    if v_final = 'operativa' and coalesce(char_length(v_corr), 0) < 3 then
      raise exception '%: escriba qué se corrigió para dejarla Activa.', pc.etiqueta;
    end if;
    if v_final = 'baja' and coalesce(char_length(v_corr), 0) < 3 then
      raise exception '%: escriba el motivo de la baja.', pc.etiqueta;
    end if;

    select string_agg(fp.nombre, ', ' order by fp.orden, fp.nombre) into v_nombres
      from public.fallas_pc fp where fp.id = any (v_fallas);
    v_nombres := concat_ws(', ', v_nombres, v_otra);
    if char_length(v_nombres) < 3 then
      v_nombres := 'Falla: ' || v_nombres;
    end if;

    insert into public.atenciones (ambiente_id, pc_id, tipo, alcance, descripcion, solucion, detalles, prioridad, estado,
                                   resuelto_por, resuelto_en, lote, turno_trabajo_id, colaboradores,
                                   fallas, falla_otra, pieza, estado_anterior, estado_final)
    values (pc.ambiente_id, pc.id, 'correctivo', case when v_lote is null then 'individual' else 'grupal' end,
            left(v_nombres, 500), v_corr,
            jsonb_strip_nulls(jsonb_build_object('diagnostico', v_diag, 'pieza', v_pieza,
              'resultado', case v_final when 'operativa' then 'reparada' when 'mantenimiento' then 'sigue'
                                        when 'baja' then 'requiere_baja' else 'inactiva' end)),
            least(3, greatest(1, coalesce(p_prioridad, 2))),
            -- Si queda en mantenimiento, el trabajo sigue abierto (pase de turno)
            case when v_final = 'mantenimiento' then 'en_proceso' else 'resuelto' end,
            case when v_final = 'mantenimiento' then null else auth.uid() end,
            case when v_final = 'mantenimiento' then null else now() end,
            v_lote, v_turno, coalesce(p_colaboradores, '{}'), v_fallas, v_otra, v_pieza, pc.estado, v_final);

    if pc.estado is distinct from v_final then
      update public.ambiente_pcs set
        estado         = v_final,
        motivo_baja    = case when v_final = 'baja' then left(v_nombres || ': ' || v_corr, 300) end,
        estado_por     = auth.uid(),
        estado_en      = now(),
        estado_detalle = left(coalesce(v_corr, v_diag, v_nombres), 300)
      where id = pc.id;
    end if;
    if v_final = 'baja' then
      v_bajas := v_bajas || pc.id;
    end if;
    v_n := v_n + 1;
  end loop;

  -- Dar de baja cierra las solicitudes de baja que hubiera pendientes
  if cardinality(v_bajas) > 0 then
    update public.solicitudes_baja set estado = 'aprobada', resuelto_por = auth.uid(), resuelto_en = now()
     where pc_id = any (v_bajas) and estado = 'pendiente';
  end if;
  perform set_config('app.cambio_estado_pc', '', true);
  return v_n;
end $$;

revoke execute on function public.rpc_registrar_reparaciones(jsonb, uuid[], int) from anon, public;
grant execute on function public.rpc_registrar_reparaciones(jsonb, uuid[], int) to authenticated;

-- 4) Dashboard de fallas (admin y encargado)
create or replace function public.fn_dashboard_fallas(p_desde date, p_hasta date)
returns jsonb language plpgsql stable security invoker set search_path = public as $$
declare
  v_zona constant text := 'America/La_Paz';
  r jsonb;
begin
  if not public.fn_puede_gestionar_auxiliares() then
    raise exception 'Solo el administrador o el encargado pueden ver el dashboard.';
  end if;
  if p_desde is null or p_hasta is null or p_hasta < p_desde or (p_hasta - p_desde) > 400 then
    raise exception 'Rango de fechas inválido.';
  end if;

  with c as (   -- correctivos del período
    select a.* from public.atenciones a
     where a.tipo = 'correctivo' and (a.creado_en at time zone v_zona)::date between p_desde and p_hasta
  )
  select jsonb_build_object(
    'total', (select count(*) from c),
    'con_ficha', (select count(*) from c where cardinality(fallas) > 0 or falla_otra is not null),
    'fallas', (
      select coalesce(jsonb_agg(x order by (x->>'veces')::int desc), '[]') from (
        select jsonb_build_object('falla', fp.nombre, 'categoria', fp.categoria, 'veces', count(*),
                 'pcs', count(distinct c.pc_id),
                 'labs', (select string_agg(distinct am.codigo, ', ') from public.ambientes am where am.id = any (array_agg(c.ambiente_id)))) x
          from c cross join lateral unnest(c.fallas) as u(falla_id)
          join public.fallas_pc fp on fp.id = u.falla_id
         group by fp.id, fp.nombre, fp.categoria
         order by count(*) desc limit 15) s
    ),
    'por_categoria', (
      select coalesce(jsonb_agg(jsonb_build_object('categoria', categoria, 'veces', n) order by n desc), '[]')
        from (select fp.categoria, count(*) n
                from c cross join lateral unnest(c.fallas) as u(falla_id)
                join public.fallas_pc fp on fp.id = u.falla_id
               group by fp.categoria) s
    ),
    'otras', (
      select coalesce(jsonb_agg(x order by (x->>'veces')::int desc), '[]') from (
        select jsonb_build_object('texto', min(falla_otra), 'veces', count(*), 'ultimo', max(creado_en),
                 'en_lista', exists (select 1 from public.fallas_pc fp where lower(trim(fp.nombre)) = lower(trim(min(c.falla_otra))))) x
          from c where falla_otra is not null
         group by lower(trim(falla_otra))
         order by count(*) desc limit 15) s
    ),
    'piezas', (
      select coalesce(jsonb_agg(jsonb_build_object('pieza', pieza, 'veces', n) order by n desc), '[]')
        from (select min(pieza) as pieza, count(*) n from c where pieza is not null group by lower(trim(pieza))) s
    ),
    'reincidentes', (
      select coalesce(jsonb_agg(x order by (x->>'veces')::int desc), '[]') from (
        select jsonb_build_object('etiqueta', pc.etiqueta, 'lab', am.codigo, 'estado', pc.estado, 'veces', count(*),
                 'ultima_falla', (array_agg(c.descripcion order by c.creado_en desc))[1],
                 'ultimo', max(c.creado_en)) x
          from c join public.ambiente_pcs pc on pc.id = c.pc_id
          left join public.ambientes am on am.id = pc.ambiente_id
         group by pc.id, pc.etiqueta, am.codigo, pc.estado
        having count(*) >= 2
         order by count(*) desc limit 15) s
    ),
    'resultados', jsonb_build_object(
      'activas', (select count(*) from c where estado_final = 'operativa'),
      'mantenimiento', (select count(*) from c where estado_final = 'mantenimiento'),
      'inactivas', (select count(*) from c where estado_final = 'inactiva'),
      'bajas', (select count(*) from c where estado_final = 'baja'),
      'reactivadas', (select count(*) from c where estado_anterior = 'baja' and estado_final <> 'baja'))
  ) into r;
  return r;
end $$;

revoke execute on function public.fn_dashboard_fallas(date, date) from anon, public;
grant execute on function public.fn_dashboard_fallas(date, date) to authenticated;
