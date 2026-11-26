-- =====================================================================
--  SISTEMA DE ASIGNACIÓN DE LABORATORIOS — UPDS
--  Script 64: BLOQUEAR CÓDIGO EN LOS TEXTOS (HTML / JavaScript)
--  - Ningún campo de texto escrito por usuarios acepta etiquetas HTML
--    (<script>, <img …>, <iframe>, </b>…) ni enlaces javascript:, vbscript:
--    o data:text/html. Se rechaza en la base, así que da igual desde dónde
--    se intente (la app, la API de Supabase o una herramienta externa).
--  - Textos normales como "a < b", "<3", "O'Brien" o "1=1" siguen permitidos.
--  - Inyección SQL: no hace falta bloquear comillas. Toda la app usa
--    consultas con parámetros (supabase-js / PostgREST y funciones
--    plpgsql sin SQL dinámico), así que un texto nunca se ejecuta como SQL.
--  - Las tablas que llena el agente de las PCs (pc_*) no se revisan:
--    no las escribe una persona y los nombres de programas pueden traer "<".
--  - En un UPDATE solo se revisan las columnas que cambiaron.
--  Ejecutar en: Supabase > SQL Editor (después de 63).
-- =====================================================================

create or replace function public.fn_texto_tiene_codigo(p text)
returns boolean language sql immutable set search_path = public as $$
  -- Una etiqueta HTML es "<" pegado a una letra, "/", "!" o "?" (así "a < b" no cuenta)
  select p ~* '<[a-z!?/]|(java|vb)script\s*:|data\s*:\s*text/html';
$$;

create or replace function public.fn_trg_sin_codigo()
returns trigger language plpgsql set search_path = public as $$
declare
  v_nuevo jsonb := to_jsonb(new);
  v_viejo jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) else '{}'::jsonb end;
  v_col text;
begin
  foreach v_col in array tg_argv loop
    if (v_nuevo ->> v_col) is distinct from (v_viejo ->> v_col)
       and public.fn_texto_tiene_codigo(v_nuevo ->> v_col) then
      raise exception 'El campo "%" no puede contener código ni etiquetas HTML (por ejemplo <script>).', v_col
        using errcode = '22023';
    end if;
  end loop;
  return new;
end $$;

revoke execute on function public.fn_trg_sin_codigo() from anon, authenticated, public;

-- Un trigger por tabla con sus columnas de texto
do $$
declare
  t record;
begin
  for t in
    select c.table_name, array_agg(quote_literal(c.column_name) order by c.ordinal_position) as cols
      from information_schema.columns c
      join pg_tables pt on pt.schemaname = c.table_schema and pt.tablename = c.table_name
     where c.table_schema = 'public'
       and c.data_type in ('text', 'character varying')
       and c.table_name not like 'pc\_%'
       and c.table_name <> 'agente_pcs_config'
     group by c.table_name
  loop
    execute format('drop trigger if exists trg_sin_codigo on public.%I', t.table_name);
    execute format('create trigger trg_sin_codigo before insert or update on public.%I
                    for each row execute function public.fn_trg_sin_codigo(%s)',
                   t.table_name, array_to_string(t.cols, ', '));
  end loop;
end $$;
